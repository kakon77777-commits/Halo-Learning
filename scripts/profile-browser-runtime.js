#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const {
  launchExtension,
  resolveChromiumExecutable
} = require('../tests/browser/helpers/extension-harness');

const REQUIRED_METRICS = Object.freeze([
  'compressedBytes',
  'uncompressedBytes',
  'fetchMs',
  'jsonParseMs',
  'sha256Ms',
  'integrityValidationMs',
  'deepFreezeMs',
  'englishMapMs',
  'chineseMapMs',
  'morphologyMapMs',
  'firstAnnotationMs',
  'warmAnnotationMs',
  'heapPeakBytes',
  'serviceWorkerRestart'
]);
const LEGACY_INDEX_HASH = 'f2a63b7b5af3673a7faea6acaed53776cb94bcf4146949d965a37b76003fca21';
const TIMING_METRICS = Object.freeze([
  'fetchMs',
  'jsonParseMs',
  'sha256Ms',
  'integrityValidationMs',
  'deepFreezeMs',
  'englishMapMs',
  'chineseMapMs',
  'morphologyMapMs',
  'firstAnnotationMs',
  'warmAnnotationMs'
]);
const DEFAULT_ARCHIVE_PATH = path.join(__dirname, '..', 'dist', 'halo-learning-magic-hand-v0.3.0.zip');
const DEFAULT_EVIDENCE_PATH = path.join(__dirname, '..', 'docs', 'validation', 'v0.4.0-browser-baseline.json');
const DEFAULT_FIXTURE_TEXT = 'The students were learning models while 老師幫助學生學習。';

function assertCompleteMeasurements(measurements) {
  for (const name of REQUIRED_METRICS) {
    if (measurements[name] === undefined) {
      throw new Error('browser baseline measurement is missing: ' + name);
    }
  }
  return measurements;
}

function readZipEntrySizes(archivePath, entryName) {
  const archive = fs.readFileSync(archivePath);
  const minimumEocdOffset = Math.max(0, archive.length - 65_557);
  let eocdOffset = -1;
  for (let offset = archive.length - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('legacy extension ZIP end record is missing');
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  let offset = archive.readUInt32LE(eocdOffset + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('legacy extension ZIP central directory is malformed');
    }
    const compressedBytes = archive.readUInt32LE(offset + 20);
    const uncompressedBytes = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const name = archive.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name === entryName) return { compressedBytes, uncompressedBytes };
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`legacy extension ZIP entry is missing: ${entryName}`);
}

function replaceProfilerAnchor(source, anchor, replacement) {
  const offset = source.indexOf(anchor);
  if (offset < 0 || source.indexOf(anchor, offset + anchor.length) >= 0) {
    throw new Error('legacy runtime profiler anchor is missing or ambiguous');
  }
  return source.slice(0, offset) + replacement + source.slice(offset + anchor.length);
}

function instrumentLegacyRuntimeSource(source) {
  let instrumented = replaceProfilerAnchor(source,
    "  'use strict';\n\n  const SCHEMA_VERSION",
    "  'use strict';\n\n" +
    "  const profiler = root.__HALO_RUNTIME_PROFILE__ || null;\n" +
    "  function profileNow() { return root.performance.now(); }\n" +
    "  function recordStage(name, started) {\n" +
    "    if (profiler) profiler.stageMs[name] = profileNow() - started;\n" +
    "  }\n\n" +
    "  const SCHEMA_VERSION");
  instrumented = replaceProfilerAnchor(instrumented,
    '    let maxZhLength = 0;\n    for (const row of document.englishRows) {',
    '    let maxZhLength = 0;\n' +
    '    const englishMapStarted = profileNow();\n' +
    '    for (const row of document.englishRows) {');
  instrumented = replaceProfilerAnchor(instrumented,
    '    for (const row of document.chineseRows) {',
    "    recordStage('englishMapMs', englishMapStarted);\n" +
    '    const chineseMapStarted = profileNow();\n' +
    '    for (const row of document.chineseRows) {');
  instrumented = replaceProfilerAnchor(instrumented,
    '    for (const row of document.morphologyRows) {',
    "    recordStage('chineseMapMs', chineseMapStarted);\n" +
    '    const morphologyMapStarted = profileNow();\n' +
    '    for (const row of document.morphologyRows) {');
  instrumented = replaceProfilerAnchor(instrumented,
    '    return Object.freeze({\n      schemaVersion: document.schemaVersion,',
    "    recordStage('morphologyMapMs', morphologyMapStarted);\n" +
    '    return Object.freeze({\n      schemaVersion: document.schemaVersion,');
  instrumented = replaceProfilerAnchor(instrumented,
    '      raw = serializedText === null ? serialized : JSON.parse(serializedText);',
    '      const jsonParseStarted = profileNow();\n' +
    '      raw = serializedText === null ? serialized : JSON.parse(serializedText);\n' +
    "      recordStage('jsonParseMs', jsonParseStarted);");
  instrumented = replaceProfilerAnchor(instrumented,
    '    if (await sha256Hex(payloadText, cryptoValue) !== raw.hash.value) {',
    '    const sha256Started = profileNow();\n' +
    '    const actualHash = await sha256Hex(payloadText, cryptoValue);\n' +
    "    recordStage('sha256Ms', sha256Started);\n" +
    '    if (actualHash !== raw.hash.value) {');
  instrumented = replaceProfilerAnchor(instrumented,
    '    validateDocument(payload);\n    return runtimeFromDocument(deepFreeze({ ...payload, hash: { ...raw.hash } }));',
    '    const validationStarted = profileNow();\n' +
    '    validateDocument(payload);\n' +
    "    recordStage('integrityValidationMs', validationStarted);\n" +
    '    const deepFreezeStarted = profileNow();\n' +
    '    const frozenDocument = deepFreeze({ ...payload, hash: { ...raw.hash } });\n' +
    "    recordStage('deepFreezeMs', deepFreezeStarted);\n" +
    '    return runtimeFromDocument(frozenDocument);');
  return instrumented;
}

function prepareLegacyExtension(archivePath, temporaryRoot) {
  const extensionRoot = path.join(temporaryRoot, 'extension');
  fs.mkdirSync(extensionRoot, { recursive: true });
  const result = spawnSync('unzip', ['-q', archivePath, '-d', extensionRoot], {
    encoding: 'utf8'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`legacy extension unzip failed: ${(result.stderr || result.stdout).trim()}`);
  }
  const runtimePath = path.join(extensionRoot, 'src', 'shared', 'runtime-index-browser.js');
  const source = fs.readFileSync(runtimePath, 'utf8');
  fs.writeFileSync(runtimePath, instrumentLegacyRuntimeSource(source));
  return extensionRoot;
}

async function profileLegacyRuntime(options) {
  const settings = options || {};
  const coldContexts = settings.coldContexts === undefined ? 5 : settings.coldContexts;
  const warmAnnotations = settings.warmAnnotations === undefined ? 20 : settings.warmAnnotations;
  if (!Number.isInteger(coldContexts) || coldContexts < 5) {
    throw new Error('browser baseline requires at least five cold contexts');
  }
  if (!Number.isInteger(warmAnnotations) || warmAnnotations < 20) {
    throw new Error('browser baseline requires at least twenty warm annotations per context');
  }
  if (typeof settings.runColdContext !== 'function') {
    throw new TypeError('runColdContext: must be a function');
  }

  const coldSamples = [];
  const warmSamples = [];
  const restartSamples = [];
  let observedBrowserVersion = settings.browserVersion || null;
  for (let contextIndex = 0; contextIndex < coldContexts; contextIndex += 1) {
    const sample = await settings.runColdContext({
      contextIndex,
      fixtureText: settings.fixtureText,
      warmAnnotations
    });
    if (sample.browserVersion) {
      if (observedBrowserVersion && observedBrowserVersion !== sample.browserVersion) {
        throw new Error('browser version changed between cold contexts');
      }
      observedBrowserVersion = sample.browserVersion;
    }
    const measurements = assertCompleteMeasurements(sample.measurements);
    if (!Array.isArray(sample.warmAnnotationSamplesMs) || sample.warmAnnotationSamplesMs.length < warmAnnotations) {
      throw new Error('browser baseline is missing raw warm annotation samples');
    }
    coldSamples.push(Object.freeze({
      condition: 'cold',
      contextIndex,
      measurements: Object.freeze({ ...measurements })
    }));
    warmSamples.push(Object.freeze({
      condition: 'warm',
      contextIndex,
      samplesMs: Object.freeze(sample.warmAnnotationSamplesMs.slice())
    }));
    restartSamples.push(Object.freeze({
      condition: 'service-worker-restart',
      contextIndex,
      result: measurements.serviceWorkerRestart
    }));
  }

  return Object.freeze({
    schemaVersion: 1,
    profileFormat: 'BrowserRuntimeProfile/v1',
    generatedAt: (settings.now || (() => new Date().toISOString()))(),
    browser: Object.freeze({ name: 'Chromium', version: observedBrowserVersion }),
    host: Object.freeze({ ...settings.host }),
    fixture: Object.freeze({
      id: 'legacy-bilingual-annotation-v1',
      text: settings.fixtureText,
      languageMode: 'both'
    }),
    index: Object.freeze({
      condition: 'legacy-v0.3.0-monolith',
      hashAlgorithm: 'sha256',
      hash: settings.indexHash
    }),
    conditions: Object.freeze({
      cold: Object.freeze({ browserContexts: coldContexts, samples: Object.freeze(coldSamples) }),
      warm: Object.freeze({ annotationsPerContext: warmAnnotations, samples: Object.freeze(warmSamples) }),
      serviceWorkerRestart: Object.freeze({ samples: Object.freeze(restartSamples) })
    })
  });
}

function hostClasses() {
  const cpus = os.cpus();
  const cpuModel = cpus.length && cpus[0].model ? cpus[0].model.trim() : 'unknown-model';
  return Object.freeze({
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpuClass: `${cpus.length || 'unknown'} logical CPU; ${cpuModel}`,
    memoryClass: `${Math.ceil(os.totalmem() / (1024 ** 3))} GiB system memory`
  });
}

async function sendAnnotation(page, fixtureText) {
  return page.evaluate((text) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'HALO_ANNOTATE_BATCH',
      texts: [text],
      options: { languageMode: 'both', generatedAt: '2026-08-26T00:00:00.000Z' }
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || response.error || !Array.isArray(response.annotationSets) || response.annotationSets.length !== 1) {
        reject(new Error('legacy service worker returned an invalid annotation response'));
        return;
      }
      resolve(response.annotationSets[0].tokens.length);
    });
  }), fixtureText);
}

async function heapBytes(cdpSession) {
  try {
    const response = await cdpSession.send('Performance.getMetrics');
    const metric = response.metrics.find((value) => value.name === 'JSHeapUsedSize');
    return metric && Number.isFinite(metric.value) ? Math.round(metric.value) : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function restartServiceWorker(context, page, worker, fixtureText) {
  const session = await context.newCDPSession(page);
  const versions = [];
  session.on('ServiceWorker.workerVersionUpdated', (event) => versions.splice(0, versions.length, ...event.versions));
  const started = performance.now();
  try {
    await session.send('ServiceWorker.enable');
    await page.waitForTimeout(100);
    const version = versions.find((value) => value.scriptURL === worker.url());
    if (!version) {
      return Object.freeze({ supported: false, restarted: false, durationMs: performance.now() - started });
    }
    await session.send('ServiceWorker.stopWorker', { versionId: version.versionId });
    try {
      await sendAnnotation(page, fixtureText);
      return Object.freeze({ supported: true, restarted: true, durationMs: performance.now() - started });
    } catch {
      return Object.freeze({ supported: true, restarted: false, durationMs: performance.now() - started });
    }
  } catch {
    return Object.freeze({ supported: false, restarted: false, durationMs: performance.now() - started });
  } finally {
    await session.detach().catch(() => {});
  }
}

async function runLegacyColdContext(options) {
  const context = await launchExtension({
    extensionRoot: options.extensionRoot,
    userDataDir: options.userDataDir,
    headless: true,
    executablePath: options.executablePath
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const extensionId = new URL(worker.url()).hostname;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup.html`);
    const cdpSession = await context.newCDPSession(page);
    await cdpSession.send('Performance.enable').catch(() => {});
    const versionInfo = await cdpSession.send('Browser.getVersion');
    const versionNumber = String(versionInfo.product || '').split('/').pop();
    const browserVersion = `Chromium ${versionNumber}`;
    const observedHeap = [await heapBytes(cdpSession)];

    await page.evaluate(() => {
      globalThis.__HALO_RUNTIME_PROFILE__ = { stageMs: {} };
    });
    await page.addScriptTag({ url: `chrome-extension://${extensionId}/src/shared/runtime-index-browser.js` });
    const loaderProfile = await page.evaluate(async () => {
      const fetchStarted = performance.now();
      const response = await fetch(chrome.runtime.getURL('data/lexical-runtime-index.json'), { cache: 'no-store' });
      if (!response.ok) throw new Error('legacy runtime index fetch failed');
      const serialized = await response.text();
      const fetchMs = performance.now() - fetchStarted;
      const runtime = await globalThis.HaloRuntimeIndexBrowser.loadRuntimeLexicalIndex(serialized);
      globalThis.__HALO_PROFILE_RUNTIME__ = runtime;
      return {
        fetchMs,
        indexHash: runtime.hash.value,
        serializedBytes: new TextEncoder().encode(serialized).byteLength,
        stageMs: { ...globalThis.__HALO_RUNTIME_PROFILE__.stageMs }
      };
    });
    if (loaderProfile.indexHash !== LEGACY_INDEX_HASH) {
      throw new Error('legacy browser runtime loaded an unexpected index hash');
    }
    if (loaderProfile.serializedBytes !== options.sizes.uncompressedBytes) {
      throw new Error('legacy browser fetch size differs from the release ZIP entry');
    }
    observedHeap.push(await heapBytes(cdpSession));

    const firstStarted = performance.now();
    await sendAnnotation(page, options.fixtureText);
    const firstAnnotationMs = performance.now() - firstStarted;
    observedHeap.push(await heapBytes(cdpSession));

    const warmAnnotationSamplesMs = [];
    for (let index = 0; index < options.warmAnnotations; index += 1) {
      const warmStarted = performance.now();
      await sendAnnotation(page, options.fixtureText);
      warmAnnotationSamplesMs.push(performance.now() - warmStarted);
      observedHeap.push(await heapBytes(cdpSession));
    }
    const warmAnnotationMs = warmAnnotationSamplesMs.reduce((total, value) => total + value, 0) /
      warmAnnotationSamplesMs.length;
    const serviceWorkerRestart = await restartServiceWorker(context, page, worker, options.fixtureText);
    observedHeap.push(await heapBytes(cdpSession));
    await cdpSession.detach().catch(() => {});
    const knownHeapSamples = observedHeap.filter(Number.isInteger);
    const heapPeakBytes = knownHeapSamples.length ? Math.max(...knownHeapSamples) : 'unknown';
    const measurements = {
      ...options.sizes,
      fetchMs: loaderProfile.fetchMs,
      jsonParseMs: loaderProfile.stageMs.jsonParseMs,
      sha256Ms: loaderProfile.stageMs.sha256Ms,
      integrityValidationMs: loaderProfile.stageMs.integrityValidationMs,
      deepFreezeMs: loaderProfile.stageMs.deepFreezeMs,
      englishMapMs: loaderProfile.stageMs.englishMapMs,
      chineseMapMs: loaderProfile.stageMs.chineseMapMs,
      morphologyMapMs: loaderProfile.stageMs.morphologyMapMs,
      firstAnnotationMs,
      warmAnnotationMs,
      heapPeakBytes,
      serviceWorkerRestart
    };
    return { browserVersion, measurements, warmAnnotationSamplesMs };
  } finally {
    await context.close();
  }
}

async function runBrowserProfile(options) {
  const settings = options || {};
  const archivePath = settings.archivePath || DEFAULT_ARCHIVE_PATH;
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-browser-profile-'));
  try {
    const extensionRoot = prepareLegacyExtension(archivePath, temporaryRoot);
    const sizes = readZipEntrySizes(archivePath, 'data/lexical-runtime-index.json');
    return profileLegacyRuntime({
      browserVersion: null,
      fixtureText: settings.fixtureText || DEFAULT_FIXTURE_TEXT,
      host: settings.host || hostClasses(),
      indexHash: LEGACY_INDEX_HASH,
      runColdContext: ({ contextIndex, fixtureText, warmAnnotations }) => runLegacyColdContext({
        contextIndex,
        executablePath: settings.executablePath,
        extensionRoot,
        fixtureText,
        sizes,
        userDataDir: path.join(temporaryRoot, `user-data-${contextIndex}`),
        warmAnnotations
      })
    });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function requireProfile(condition, message) {
  if (!condition) throw new Error(`invalid BrowserRuntimeProfile/v1: ${message}`);
}

function validRestartMeasurement(restart) {
  return restart && typeof restart === 'object' && typeof restart.supported === 'boolean' &&
    typeof restart.restarted === 'boolean' && Number.isFinite(restart.durationMs) && restart.durationMs >= 0;
}

function verifyBrowserRuntimeProfile(report) {
  requireProfile(report && typeof report === 'object' && !Array.isArray(report), 'report must be an object');
  requireProfile(report.schemaVersion === 1, 'schemaVersion must be 1');
  requireProfile(report.profileFormat === 'BrowserRuntimeProfile/v1', 'profileFormat is unsupported');
  requireProfile(typeof report.generatedAt === 'string' && !Number.isNaN(Date.parse(report.generatedAt)), 'generatedAt is invalid');
  requireProfile(report.browser && report.browser.name === 'Chromium' &&
    typeof report.browser.version === 'string' && report.browser.version.includes('Chromium'), 'actual Chromium version is required');
  requireProfile(report.host && ['os', 'cpuClass', 'memoryClass'].every((name) =>
    typeof report.host[name] === 'string' && Boolean(report.host[name])), 'host class evidence is incomplete');
  requireProfile(report.fixture && typeof report.fixture.text === 'string' && Boolean(report.fixture.text) &&
    report.fixture.languageMode === 'both', 'fixture evidence is incomplete');
  requireProfile(report.index && report.index.hashAlgorithm === 'sha256' &&
    report.index.hash === LEGACY_INDEX_HASH, 'legacy index hash does not match the v0.3.0 artifact');

  const conditions = report.conditions;
  requireProfile(conditions && conditions.cold && conditions.warm && conditions.serviceWorkerRestart,
    'cold, warm, and service-worker-restart conditions are required');
  requireProfile(Number.isInteger(conditions.cold.browserContexts) && conditions.cold.browserContexts >= 5,
    'at least five cold browser contexts are required');
  requireProfile(Array.isArray(conditions.cold.samples) &&
    conditions.cold.samples.length >= conditions.cold.browserContexts, 'cold samples are incomplete');
  for (const sample of conditions.cold.samples) {
    requireProfile(sample.condition === 'cold', 'cold samples must identify their condition');
    const measurements = assertCompleteMeasurements(sample.measurements || {});
    requireProfile(Number.isInteger(measurements.compressedBytes) && measurements.compressedBytes > 0,
      'compressedBytes must be a positive integer');
    requireProfile(Number.isInteger(measurements.uncompressedBytes) &&
      measurements.uncompressedBytes >= measurements.compressedBytes, 'uncompressedBytes is invalid');
    for (const name of TIMING_METRICS) {
      requireProfile(Number.isFinite(measurements[name]) && measurements[name] >= 0, `${name} must be a non-negative browser timing`);
    }
    requireProfile(measurements.heapPeakBytes === 'unknown' ||
      (Number.isInteger(measurements.heapPeakBytes) && measurements.heapPeakBytes >= 0),
    'heapPeakBytes must be a non-negative integer or unknown');
    const restart = measurements.serviceWorkerRestart;
    requireProfile(validRestartMeasurement(restart),
    'serviceWorkerRestart is invalid');
  }

  requireProfile(Number.isInteger(conditions.warm.annotationsPerContext) &&
    conditions.warm.annotationsPerContext >= 20, 'at least twenty warm annotations per context are required');
  requireProfile(Array.isArray(conditions.warm.samples) &&
    conditions.warm.samples.length >= conditions.cold.browserContexts, 'warm context samples are incomplete');
  for (const sample of conditions.warm.samples) {
    requireProfile(sample.condition === 'warm' && Array.isArray(sample.samplesMs) && sample.samplesMs.length >= 20,
      'each context requires twenty raw warm annotation samples');
    requireProfile(sample.samplesMs.every((value) => Number.isFinite(value) && value >= 0),
      'warm annotation timings must be non-negative numbers');
  }
  requireProfile(Array.isArray(conditions.serviceWorkerRestart.samples) &&
    conditions.serviceWorkerRestart.samples.length >= conditions.cold.browserContexts,
  'service-worker-restart samples are incomplete');
  for (const sample of conditions.serviceWorkerRestart.samples) {
    requireProfile(sample.condition === 'service-worker-restart' && Number.isInteger(sample.contextIndex) &&
      validRestartMeasurement(sample.result), 'service-worker-restart sample is invalid');
  }
  return true;
}

function parseCommandLine(args) {
  const modes = ['--write', '--verify'].filter((mode) => args.includes(mode));
  if (modes.length !== 1) throw new Error('Use exactly one of --write or --verify');
  const outputIndex = args.indexOf('--output');
  if (outputIndex >= 0 && !args[outputIndex + 1]) throw new Error('--output requires a path');
  return Object.freeze({
    mode: modes[0],
    outputPath: outputIndex >= 0 ? path.resolve(args[outputIndex + 1]) : DEFAULT_EVIDENCE_PATH
  });
}

function writeEvidence(outputPath, report) {
  const parent = path.dirname(outputPath);
  fs.mkdirSync(parent, { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`);
    fs.renameSync(temporaryPath, outputPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath);
  }
}

async function main(args) {
  const command = parseCommandLine(args);
  if (command.mode === '--verify') {
    const report = JSON.parse(fs.readFileSync(command.outputPath, 'utf8'));
    verifyBrowserRuntimeProfile(report);
    process.stdout.write(`Verified BrowserRuntimeProfile/v1: ${command.outputPath}\n`);
    return;
  }

  const { chromium } = require('playwright');
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const report = await runBrowserProfile({ executablePath: executable.path });
  verifyBrowserRuntimeProfile(report);
  writeEvidence(command.outputPath, report);
  process.stdout.write(`Wrote BrowserRuntimeProfile/v1 from ${executable.source} Chromium: ${command.outputPath}\n`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  DEFAULT_EVIDENCE_PATH,
  LEGACY_INDEX_HASH,
  REQUIRED_METRICS,
  assertCompleteMeasurements,
  instrumentLegacyRuntimeSource,
  main,
  parseCommandLine,
  prepareLegacyExtension,
  profileLegacyRuntime,
  readZipEntrySizes,
  runBrowserProfile,
  runLegacyColdContext,
  verifyBrowserRuntimeProfile
});
