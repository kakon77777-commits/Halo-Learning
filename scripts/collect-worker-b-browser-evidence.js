#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const {
  launchExtension,
  resolveChromiumExecutable
} = require('../tests/browser/helpers/extension-harness');
const { stopExtensionServiceWorker } = require('../tests/browser/helpers/service-worker-cdp');
const {
  prepareShardCandidateExtension,
  runShardColdContext,
  runShardComparison,
  verifyBrowserShardComparison
} = require('./profile-browser-runtime');
const { buildBrowserRuntimeArtifacts } = require('./build-browser-lexical-runtime');
const {
  evaluateBrowserPerformance,
  evaluateMv3Lifecycle
} = require('../packages/quality/browser-performance');

const ROOT = path.resolve(__dirname, '..');
const EXTENSION_ROOT = path.join(ROOT, 'apps', 'extension');
const CORPORA = Object.freeze({
  englishDir: path.join(ROOT, 'data', 'corpora', 'princeton-wordnet-3.0'),
  chineseDir: path.join(ROOT, 'data', 'corpora', 'cc-cedict-v1-2026-08-24')
});
const FIXTURE_TEXT = 'The students were learning models while 老師幫助學生學習。';
const SAMPLE_COUNT = 20;
const OUTPUT_ROOT = path.resolve(process.argv[2] || path.join(ROOT, 'evidence', 'worker-b-final'));

function writeJson(name, value) {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const target = path.join(OUTPUT_ROOT, name);
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}

function writeTree(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function copyCurrentExtension(artifacts, temporaryRoot) {
  const root = path.join(temporaryRoot, 'current-extension');
  fs.mkdirSync(root, { recursive: true });
  fs.copyFileSync(path.join(EXTENSION_ROOT, 'manifest.json'), path.join(root, 'manifest.json'));
  fs.cpSync(path.join(EXTENSION_ROOT, 'src'), path.join(root, 'src'), { recursive: true });
  writeTree(path.join(root, 'data', 'lexical-v0.4.0'), artifacts.files);
  return root;
}

async function browserVersion(page) {
  const session = await page.context().newCDPSession(page);
  try {
    const value = await session.send('Browser.getVersion');
    return `Chromium ${String(value.product || '').split('/').pop()}`;
  } finally {
    await session.detach().catch(() => {});
  }
}

async function heapPeak(page) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Performance.enable').catch(() => {});
    const value = await session.send('Performance.getMetrics');
    const metric = value.metrics.find((item) => item.name === 'JSHeapUsedSize');
    return metric && Number.isFinite(metric.value) ? Math.round(metric.value) : 'unknown';
  } catch {
    return 'unknown';
  } finally {
    await session.detach().catch(() => {});
  }
}

const UX_SCRIPTS = [
  'shared/semantic-contracts.js',
  'shared/dictionary-provider.js',
  'shared/grammar-annotations.js',
  'shared/semantic-annotations.js',
  'shared/reversible-renderer.js'
].map((relative) => path.join(EXTENSION_ROOT, 'src', relative));

async function addUxRuntime(page) {
  for (const script of UX_SCRIPTS) await page.addScriptTag({ path: script });
  await page.evaluate(() => {
    const provider = HaloDictionary.createBootstrapDictionaryProvider();
    const engine = HaloSemanticAnnotations.createSemanticEngine({
      provider,
      grammarAnnotator: HaloGrammarAnnotations.annotateGrammar
    });
    const renderer = HaloReversibleRenderer.createReversibleRenderer({ document });
    let sequence = 0;
    function renderOnce() {
      sequence += 1;
      const lesson = document.querySelector('#lesson');
      const node = lesson.firstChild;
      const start = node.nodeValue.indexOf('model');
      const end = start + 'model'.length;
      const request = {
        schemaVersion: 1,
        runId: `perf-run-${sequence}`,
        rootId: 'perf-root',
        rootRevision: 1,
        analysisKey: `perf-analysis-${sequence}`,
        root: lesson,
        fragments: [{
          node,
          nodeId: `perf-node-${sequence}`,
          start,
          end,
          text: node.nodeValue.slice(start, end),
          renderPlan: {
            marked: true,
            pos: 'n',
            label: 'n',
            colorClass: 'halo-pos-n',
            labelPosition: 'top-right'
          }
        }]
      };
      renderer.apply(request);
      if (!lesson.querySelector('[data-halo-owned="token"]')) throw new Error('primed highlight produced no visible token');
      renderer.removeRoot('perf-root');
    }
    globalThis.__haloWorkerBPerf = { provider, engine, renderer, renderOnce };
  });
}

async function measureUx(chromiumExecutable) {
  const browser = await chromium.launch({ executablePath: chromiumExecutable, headless: true, args: ['--no-sandbox'] });
  const cold = [];
  let version = null;
  try {
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
      try {
        await page.setContent('<!doctype html><html lang="en"><body><main><p id="lesson">The model learns safely.</p></main></body></html>');
        const started = await page.evaluate(() => performance.now());
        await addUxRuntime(page);
        const elapsed = await page.evaluate((start) => {
          const perf = globalThis.__haloWorkerBPerf;
          const set = perf.engine.annotateText('The model learns safely.', {
            languageMode: 'en',
            generatedAt: '2026-08-26T00:00:00.000Z'
          });
          if (!set || !Array.isArray(set.tokens) || !set.tokens.length) throw new Error('bootstrap annotation produced no semantic token');
          perf.renderOnce();
          return performance.now() - start;
        }, started);
        cold.push(elapsed);
        if (!version) version = await browserVersion(page);
      } finally {
        await page.close();
      }
    }

    const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
    try {
      await page.setContent('<!doctype html><html lang="en"><body><button id="trigger">Details</button><main><p id="lesson">The model learns safely.</p></main></body></html>');
      await addUxRuntime(page);
      await page.evaluate(() => {
        globalThis.__haloLongTasks = [];
        globalThis.__haloLongTaskSupported = typeof PerformanceObserver === 'function' &&
          Array.isArray(PerformanceObserver.supportedEntryTypes) &&
          PerformanceObserver.supportedEntryTypes.includes('longtask');
        if (globalThis.__haloLongTaskSupported) {
          globalThis.__haloLongTaskObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) globalThis.__haloLongTasks.push(entry.duration);
          });
          globalThis.__haloLongTaskObserver.observe({ type: 'longtask', buffered: true });
        }
      });

      const localSentenceAnalysisMs = [];
      for (let index = 0; index < SAMPLE_COUNT; index += 1) {
        localSentenceAnalysisMs.push(await page.evaluate(() => {
          const started = performance.now();
          const set = __haloWorkerBPerf.engine.annotateText('The model learns safely.', {
            languageMode: 'en', generatedAt: '2026-08-26T00:00:00.000Z'
          });
          if (!set.tokens.length) throw new Error('local sentence analysis produced no tokens');
          return performance.now() - started;
        }));
      }

      const primedHighlightMs = [];
      for (let index = 0; index < SAMPLE_COUNT; index += 1) {
        primedHighlightMs.push(await page.evaluate(() => {
          const started = performance.now();
          __haloWorkerBPerf.renderOnce();
          return performance.now() - started;
        }));
      }

      const warmAnnotationMs = [];
      for (let index = 0; index < SAMPLE_COUNT; index += 1) {
        warmAnnotationMs.push(await page.evaluate(() => {
          const started = performance.now();
          const set = __haloWorkerBPerf.engine.annotateText('The model learns safely.', {
            languageMode: 'en', generatedAt: '2026-08-26T00:00:00.000Z'
          });
          if (!set.tokens.length) throw new Error('warm annotation produced no tokens');
          __haloWorkerBPerf.renderOnce();
          return performance.now() - started;
        }));
      }

      const corePanelFirstVisibleMs = [];
      for (let index = 0; index < SAMPLE_COUNT; index += 1) {
        corePanelFirstVisibleMs.push(await page.evaluate(() => new Promise((resolve, reject) => {
          const started = performance.now();
          const trigger = document.querySelector('#trigger');
          __haloWorkerBPerf.renderer.openPanel({
            title: 'Semantic details', body: 'Noun · model', status: 'Ready', trigger,
            anchor: { x: 24, y: 24 }
          });
          requestAnimationFrame(() => {
            const host = document.querySelector('[data-halo-owned="panel"]');
            const panel = host && host.shadowRoot && host.shadowRoot.querySelector('[role="dialog"]');
            const rect = panel && panel.getBoundingClientRect();
            if (!rect || rect.width <= 0 || rect.height <= 0) {
              reject(new Error('core panel was not visibly laid out'));
              return;
            }
            const duration = performance.now() - started;
            __haloWorkerBPerf.renderer.closePanel('performance-sample');
            resolve(duration);
          });
        })));
      }

      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
      const longTask = await page.evaluate(() => {
        if (globalThis.__haloLongTaskObserver) globalThis.__haloLongTaskObserver.disconnect();
        return {
          supported: Boolean(globalThis.__haloLongTaskSupported),
          samples: globalThis.__haloLongTasks.slice()
        };
      });
      const heap = await heapPeak(page);
      return {
        browserVersion: version || await browserVersion(page),
        cold,
        warmAnnotationMs,
        primedHighlightMs,
        localSentenceAnalysisMs,
        corePanelFirstVisibleMs,
        longTaskSupported: longTask.supported,
        mainThreadLongTaskMs: longTask.samples.length ? longTask.samples : [0],
        heapPeakBytes: heap
      };
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

async function measureLexical(chromiumExecutable) {
  const comparison = await runShardComparison({ executablePath: chromiumExecutable });
  verifyBrowserShardComparison(comparison);
  const selectionPassed = Boolean(comparison.selection && comparison.selection.status === 'selected');
const selectedBucketCount = selectionPassed ? comparison.selection.selectedBucketCount : null;
const diagnosticBucketCount = selectedBucketCount || 128;
const artifacts = buildBrowserRuntimeArtifacts({
  ...CORPORA,
  builtAt: '2026-08-25T00:00:00.000Z',
  bucketCount: diagnosticBucketCount,
  selectionStatus: selectionPassed ? 'selected-by-browser-comparison' : 'worker-b-diagnostic-only'
});
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-worker-b-lexical-'));
  try {
    const extensionRoot = prepareShardCandidateExtension(artifacts, temporaryRoot);
    const coldRequiredShardsMs = [];
    const warmLookupMs = [];
    const longTasks = [];
    let browserVersionObserved = null;
    for (let contextIndex = 0; contextIndex < SAMPLE_COUNT; contextIndex += 1) {
      const sample = await runShardColdContext({
        contextIndex,
        executablePath: chromiumExecutable,
        extensionRoot,
        fixtureText: FIXTURE_TEXT,
        userDataDir: path.join(temporaryRoot, `user-data-${contextIndex}`),
        warmAnnotations: SAMPLE_COUNT
      });
      if (browserVersionObserved && browserVersionObserved !== sample.browserVersion) {
        throw new Error('Chromium version changed during lexical evidence collection');
      }
      browserVersionObserved = sample.browserVersion;
      coldRequiredShardsMs.push(sample.coldDurationMs);
      warmLookupMs.push(...sample.warmSamplesMs);
      longTasks.push(...sample.longTaskDurationsMs);
    }
    return {
      comparison,
      selectedBucketCount,
      artifacts,
      browserVersion: browserVersionObserved,
      coldRequiredShardsMs,
      warmLookupMs,
      mainThreadLongTaskMs: longTasks.length ? longTasks : [0]
    };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function waitForExtensionWorker(context, timeout = 15_000) {
  return context.serviceWorkers()[0] || context.waitForEvent('serviceworker', { timeout });
}

async function dictionaryStatus(worker) {
  return worker.evaluate(async () => {
    const service = globalThis.__HALO_SEMANTIC_SERVICE_INITIALIZED__;
    if (!service || typeof service.handleMessage !== 'function') throw new Error('semantic service is not initialized');
    return service.handleMessage({ type: 'HALO_DICTIONARY_STATUS' }, {});
  });
}

async function lexicalEnrichment(worker, requestId, tabId) {
  return worker.evaluate(async ({ requestId, tabId, text }) => {
    const semanticVersion = 'worker-b-semantic-v1';
    const grammarVersion = 'worker-b-grammar-v1';
    const profileRevision = 1;
    const lexicalVersion = 'worker-b-request-v1';
    const analysisKey = HaloProgressiveRuntime.createAnalysisKey({
      text,
      languageMode: 'both',
      semanticVersion,
      grammarVersion,
      profileRevision,
      lexicalVersion
    });
    return globalThis.__HALO_SEMANTIC_SERVICE_INITIALIZED__.handleMessage({
      type: 'HALO_ENRICH_BATCH',
      requestId,
      pageEpoch: 1,
      items: [{
        rootId: 'worker-b-root',
        rootRevision: 1,
        text,
        languageMode: 'both',
        semanticVersion,
        grammarVersion,
        profileRevision,
        lexicalVersion,
        analysisKey
      }]
    }, { tab: { id: tabId, url: 'https://example.com/learning' } });
  }, { requestId, tabId, text: FIXTURE_TEXT });
}

async function testFactoryCancellation(worker) {
  return worker.evaluate(async () => {
    let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    const bootstrapProvider = HaloDictionary.createBootstrapDictionaryProvider();
    const service = HaloSemanticService.createShardSemanticService({
      loadShardRuntime: async () => {
        await barrier;
        return {
          runtime: null,
          lexicalVersion: 'worker-b-cancel-runtime',
          bootstrapProvider,
          status: () => ({ mode: 'bootstrap-only', fallbackActivated: false, failures: [] })
        };
      },
      semanticModule: HaloSemanticAnnotations,
      grammarModule: HaloGrammarAnnotations,
      shardedProviderModule: HaloShardedDictionaryProvider
    });
    const text = 'The model learns.';
    const semanticVersion = 'worker-b-semantic-v1';
    const grammarVersion = 'worker-b-grammar-v1';
    const profileRevision = 1;
    const lexicalVersion = 'worker-b-request-v1';
    const analysisKey = HaloProgressiveRuntime.createAnalysisKey({
      text, languageMode: 'en', semanticVersion, grammarVersion, profileRevision, lexicalVersion
    });
    const message = {
      type: 'HALO_ENRICH_BATCH', requestId: 'cancel-request', pageEpoch: 1,
      items: [{
        rootId: 'cancel-root', rootRevision: 1, text, languageMode: 'en', semanticVersion,
        grammarVersion, profileRevision, lexicalVersion, analysisKey
      }]
    };
    const pending = service.enrichBatch(message, { tab: { id: 700 } });
    await Promise.resolve();
    const cancelled = service.cancelRequest({ requestId: 'cancel-request' }, { tab: { id: 700 } });
    release();
    const response = await pending;
    return cancelled.status === 'cancelled' && response.status === 'cancelled' && response.results.length === 0;
  });
}

async function testVersionMismatch(worker) {
  return worker.evaluate(async () => {
    const bootstrapProvider = HaloDictionary.createBootstrapDictionaryProvider();
    const service = HaloSemanticService.createShardSemanticService({
      loadShardRuntime: async () => ({
        runtime: null,
        lexicalVersion: 'worker-b-version-runtime',
        bootstrapProvider,
        status: () => ({ mode: 'bootstrap-only', fallbackActivated: false, failures: [] })
      }),
      semanticModule: HaloSemanticAnnotations,
      grammarModule: HaloGrammarAnnotations,
      shardedProviderModule: HaloShardedDictionaryProvider
    });
    const text = 'The model learns.';
    const semanticVersion = 'worker-b-semantic-v1';
    const grammarVersion = 'worker-b-grammar-v1';
    const profileRevision = 1;
    const correctLexicalVersion = 'worker-b-correct-v1';
    const analysisKey = HaloProgressiveRuntime.createAnalysisKey({
      text, languageMode: 'en', semanticVersion, grammarVersion, profileRevision,
      lexicalVersion: correctLexicalVersion
    });
    try {
      await service.enrichBatch({
        type: 'HALO_ENRICH_BATCH', requestId: 'version-mismatch', pageEpoch: 1,
        items: [{
          rootId: 'version-root', rootRevision: 1, text, languageMode: 'en', semanticVersion,
          grammarVersion, profileRevision, lexicalVersion: 'worker-b-different-v1', analysisKey
        }]
      }, { tab: { id: 701 } });
      return false;
    } catch (error) {
      return error instanceof TypeError && /analysis key does not match/i.test(error.message);
    }
  });
}

async function measureMv3(chromiumExecutable, artifacts) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-worker-b-mv3-'));
  const extensionRoot = copyCurrentExtension(artifacts, temporaryRoot);
  const userDataRoot = path.join(temporaryRoot, 'user-data');
  let context = null;
  let page = null;
  const details = {};
  const gates = {
    coldStart: false,
    workerRestart: false,
    cacheLossReload: false,
    inFlightCancellation: false,
    tabClose: false,
    extensionReload: false,
    browserContextRestart: false,
    versionMismatchRejected: false
  };
  try {
    context = await launchExtension({
      extensionRoot,
      userDataDir: `${userDataRoot}-1`,
      headless: true,
      executablePath: chromiumExecutable
    });
    let worker = await waitForExtensionWorker(context);
    const extensionId = new URL(worker.url()).hostname;
    let status = await dictionaryStatus(worker);
    details.coldStartStatus = status;
    gates.coldStart = status && status.mode === 'ready' && status.networkActivity && status.networkActivity.fetchAttempts >= 1;
    const initialLifetime = status && status.networkActivity && status.networkActivity.lifetimeId;

    const lexical = await lexicalEnrichment(worker, 'worker-b-full-semantic-1', 601);
    details.fullSemanticEnrichment = {
      phase: lexical && lexical.results && lexical.results[0] && lexical.results[0].phase,
      resultCount: lexical && lexical.results ? lexical.results.length : 0,
      statusMode: lexical && lexical.status && lexical.status.mode
    };
    if (details.fullSemanticEnrichment.phase !== 'lexical') {
      throw new Error('current v0.4 service worker did not produce lexical full-semantic enrichment');
    }

    page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup.html`);
    const cdp = await context.newCDPSession(page);
    let stopped;
    try {
      stopped = await stopExtensionServiceWorker({ session: cdp, scriptUrl: worker.url(), timeoutMs: 8_000 });
    } finally {
      await cdp.detach().catch(() => {});
    }
    const restartEvent = context.waitForEvent('serviceworker', { timeout: 12_000 });
    const statusResponse = page.evaluate(() => chrome.runtime.sendMessage({ type: 'HALO_DICTIONARY_STATUS' }));
    const restartedWorker = await restartEvent;
    status = await statusResponse;
    details.workerRestart = { stoppedVersionId: stopped, status };
    gates.workerRestart = Boolean(typeof stopped === 'string' && Boolean(stopped) && restartedWorker !== worker && status && status.mode === 'ready');
    const restartedLifetime = status && status.networkActivity && status.networkActivity.lifetimeId;
    gates.cacheLossReload = Boolean(initialLifetime && restartedLifetime && initialLifetime !== restartedLifetime &&
      status.networkActivity.fetchAttempts >= 1);
    worker = restartedWorker;

    gates.inFlightCancellation = await testFactoryCancellation(worker);
    gates.versionMismatchRejected = await testVersionMismatch(worker);

    const contentTab = await context.newPage();
    await contentTab.setContent('<!doctype html><html><body><p>Close lifecycle fixture.</p></body></html>');
    await contentTab.close();
    const afterClose = await dictionaryStatus(worker);
    gates.tabClose = contentTab.isClosed() && afterClose && afterClose.mode === 'ready';

    const navigationTab = await context.newPage();
    await navigationTab.goto('data:text/html,<p>route-one</p>');
    await navigationTab.goto('data:text/html,<p>route-two</p>');
    details.routeNavigation = (await navigationTab.textContent('body')).includes('route-two');
    await navigationTab.close();

    const priorReloadWorker = worker;
    await worker.evaluate(() => {
      setTimeout(() => chrome.runtime.reload(), 0);
      return true;
    }).catch(() => false);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const reloadPage = await context.newPage();
    await reloadPage.goto(`chrome-extension://${extensionId}/src/popup.html`);
    let reloadedWorker = context.serviceWorkers().find((candidate) => candidate !== priorReloadWorker);
    if (!reloadedWorker) reloadedWorker = await context.waitForEvent('serviceworker', { timeout: 12_000 });
    const reloadStatus = await reloadPage.evaluate(() => chrome.runtime.sendMessage({ type: 'HALO_DICTIONARY_STATUS' }));
    gates.extensionReload = Boolean(reloadedWorker && reloadedWorker !== priorReloadWorker && reloadStatus && reloadStatus.mode === 'ready');
    details.extensionReloadStatus = reloadStatus;
    await reloadPage.close();

    if (page) { await page.close().catch(() => {}); page = null; }
    await context.close();
    context = null;

    context = await launchExtension({
      extensionRoot,
      userDataDir: `${userDataRoot}-2`,
      headless: true,
      executablePath: chromiumExecutable
    });
    worker = await waitForExtensionWorker(context);
    const restartContextStatus = await dictionaryStatus(worker);
    gates.browserContextRestart = Boolean(restartContextStatus && restartContextStatus.mode === 'ready');
    details.browserContextRestartStatus = restartContextStatus;

    return {
      schemaVersion: 1,
      reportFormat: 'MV3LifecycleReport/v1',
      generatedAt: new Date().toISOString(),
      browser: { name: 'Chromium', version: details.browserVersion || null },
      gates,
      details
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function main() {
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const ux = await measureUx(executable.path);
  const lexical = await measureLexical(executable.path);
  if (ux.browserVersion !== lexical.browserVersion) {
    throw new Error(`Chromium version mismatch between UX and lexical evidence: ${ux.browserVersion} vs ${lexical.browserVersion}`);
  }

  const performanceReport = {
    schemaVersion: 1,
    reportFormat: 'BrowserPerformanceReport/v1',
    generatedAt: new Date().toISOString(),
    browser: { name: 'Chromium', version: ux.browserVersion },
    executable: { source: executable.source, path: executable.path },
    conditions: {
      cold: { firstUsableAnnotationMs: ux.cold },
      warm: {
        warmAnnotationMs: ux.warmAnnotationMs,
        primedHighlightMs: ux.primedHighlightMs,
        localSentenceAnalysisMs: ux.localSentenceAnalysisMs,
        corePanelFirstVisibleMs: ux.corePanelFirstVisibleMs,
        mainThreadLongTaskMs: ux.mainThreadLongTaskMs,
        longTaskObserverSupported: ux.longTaskSupported
      },
      bootstrap: { providerMode: 'bootstrap-only', sampleCount: SAMPLE_COUNT },
      fullSemantic: { phase: 'lexical', measuredBy: 'MV3LifecycleReport/v1' },
      lexical: {
        selectedBucketCount: lexical.selectedBucketCount,
        coldRequiredShardsMs: lexical.coldRequiredShardsMs,
        warmLookupMs: lexical.warmLookupMs,
        comparisonFormat: lexical.comparison.comparisonFormat
      }
    },
    memory: { heapPeakBytes: ux.heapPeakBytes }
  };
  const performanceEvaluation = evaluateBrowserPerformance(performanceReport);
  if (!performanceEvaluation.allBlockingPassed) {
    throw new Error(`browser performance gate failed: ${JSON.stringify(performanceEvaluation.gates)}`);
  }

  const mv3Report = await measureMv3(executable.path, lexical.artifacts);
  mv3Report.browser.version = ux.browserVersion;
  const mv3Evaluation = evaluateMv3Lifecycle(mv3Report);
  if (!mv3Evaluation.allBlockingPassed) {
    throw new Error(`MV3 lifecycle gate failed: ${JSON.stringify(mv3Evaluation.gates)}`);
  }
  if (mv3Report.details.routeNavigation !== true) throw new Error('MV3 route-navigation evidence failed');

  writeJson('v0.4.0-worker-b-browser-performance.json', performanceReport);
  writeJson('v0.4.0-worker-b-browser-performance-evaluation.json', {
    measurements: performanceEvaluation.measurements,
    budgets: require('../packages/quality/browser-performance').BUDGETS,
    gates: performanceEvaluation.gates,
    allBlockingPassed: performanceEvaluation.allBlockingPassed
  });
  writeJson('v0.4.0-worker-b-mv3-lifecycle.json', mv3Report);
  writeJson('v0.4.0-worker-b-mv3-lifecycle-evaluation.json', mv3Evaluation);
  writeJson('v0.4.0-browser-shard-comparison.json', lexical.comparison);
  writeJson('v0.4.0-worker-b-browser-summary.json', {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    chromium: { source: executable.source, version: ux.browserVersion },
    performance: performanceEvaluation.measurements,
    performanceGates: performanceEvaluation.gates,
    mv3Gates: mv3Evaluation.gates,
    routeNavigation: mv3Report.details.routeNavigation,
    selectedBucketCount: lexical.selectedBucketCount,
    fullSemanticEnrichment: mv3Report.details.fullSemanticEnrichment,
    memory: performanceReport.memory
  });

  process.stdout.write(`${JSON.stringify({
    chromium: { source: executable.source, version: ux.browserVersion },
    performance: performanceEvaluation.measurements,
    performanceGates: performanceEvaluation.gates,
    mv3Gates: mv3Evaluation.gates,
    selectedBucketCount: lexical.selectedBucketCount,
    fullSemanticEnrichment: mv3Report.details.fullSemanticEnrichment,
    outputRoot: OUTPUT_ROOT
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
