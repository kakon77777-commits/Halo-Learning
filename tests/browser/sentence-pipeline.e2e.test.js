const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchExtension, resolveChromiumExecutable } = require('./helpers/extension-harness');
const { withFixtureServer } = require('./helpers/fixture-server');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const extensionRoot = path.join(repositoryRoot, 'apps', 'extension');
const pipelinePath = path.join(extensionRoot, 'src', 'shared', 'sentence-pipeline.js');
const linguisticsPath = path.join(extensionRoot, 'src', 'shared', 'linguistics.js');
const schedulerPath = path.join(extensionRoot, 'src', 'shared', 'runtime-scheduler.js');
const rendererPath = path.join(extensionRoot, 'src', 'shared', 'reversible-renderer.js');
const contractsPath = path.join(extensionRoot, 'src', 'shared', 'semantic-contracts.js');
const settingsPath = path.join(extensionRoot, 'src', 'shared', 'settings.js');
const progressivePath = path.join(extensionRoot, 'src', 'shared', 'progressive-runtime.js');
const dictionaryPath = path.join(extensionRoot, 'src', 'shared', 'dictionary-provider.js');
const semanticPath = path.join(extensionRoot, 'src', 'shared', 'semantic-annotations.js');
const grammarPath = path.join(extensionRoot, 'src', 'shared', 'grammar-annotations.js');
const projectionPath = path.join(extensionRoot, 'src', 'shared', 'projection.js');
const contentPath = path.join(extensionRoot, 'src', 'content.js');

test('real Chromium preserves nested inline DOM while every sentence and token maps exactly', async () => {
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-sentence-pipeline-'));
  let context;
  try {
    context = await launchExtension({
      extensionRoot,
      userDataDir,
      headless: true,
      executablePath: executable.path
    });
    await withFixtureServer({
      '/lesson.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="zh-Hant"><body><article id="lesson"><span data-level="outer">The <span data-level="inner">mo<a href="/model">del</a></span></span><em> learns.</em> <span>人工<a href="/zh">智慧</a></span><em>學習。</em><span style="display:none">HIDDEN TEXT.</span><span style="content-visibility:hidden">CONTENT VISIBILITY HIDDEN.</span><section aria-hidden="true">ARIA HIDDEN.</section><form><label>Account password</label><input type="password" autocomplete="current-password" value="never-read"></form></article></body></html>'
      }
    }, async ({ origin }) => {
      const page = await context.newPage();
      const requests = [];
      page.on('request', (request) => requests.push(request.url()));
      await page.goto(origin + '/lesson.html');
      await page.addScriptTag({ path: pipelinePath });
      await page.addScriptTag({ path: linguisticsPath });

      const result = await page.evaluate(() => {
        const root = document.getElementById('lesson');

        function inspect() {
          const runs = HaloSentencePipeline.createTextRuns(root, { rootRevision: 23 });
          const records = HaloSentencePipeline.buildSentenceRecords(root, { rootRevision: 23 });
          return {
            records,
            runText: runs.map((run) => run.boundaryBefore + run.text).join(''),
            sentenceChecks: records.map((record) => ({
              text: record.text,
              rebuilt: record.fragments.map((fragment) => {
                const run = runs.find((candidate) => candidate.nodeId === fragment.nodeId);
                return run.node.nodeValue.slice(fragment.start, fragment.end);
              }).join(''),
              fragmentsAreNodeLocal: record.fragments.every((fragment) => {
                const run = runs.find((candidate) => candidate.nodeId === fragment.nodeId);
                return fragment.start >= 0 && fragment.end <= run.node.nodeValue.length;
              }),
              hasNodeReference: record.fragments.some((fragment) => Object.hasOwn(fragment, 'node')),
              tokenChecks: HaloLinguistics.tokenize(record.text, record.language === 'zh-Hant' ? 'zh' : record.language)
                .map((token) => {
                  const fragments = HaloSentencePipeline.mapAggregateSpanToFragments(
                    runs,
                    record.start + token.start,
                    record.start + token.end
                  );
                  return {
                    text: token.text,
                    rebuilt: fragments.map((fragment) =>
                      fragment.node.nodeValue.slice(fragment.start, fragment.end)
                    ).join(''),
                    fragmentCount: fragments.length
                  };
                })
            }))
          };
        }

        const initial = inspect();
        const paragraph = document.createElement('p');
        paragraph.textContent = 'Dynamic sentence.';
        root.appendChild(paragraph);
        const dynamic = inspect();
        return {
          initial,
          dynamic,
          links: Array.from(root.querySelectorAll('a')).map((link) => link.getAttribute('href')),
          emphasis: Array.from(root.querySelectorAll('em')).map((node) => node.textContent),
          nestedSpanPresent: Boolean(root.querySelector('[data-level="outer"] [data-level="inner"]')),
          passwordFieldPresent: Boolean(root.querySelector('input[type="password"]'))
        };
      });

      assert.equal(result.initial.runText, 'The model learns. 人工智慧學習。');
      assert.deepEqual(result.initial.sentenceChecks.map((check) => check.text), [
        'The model learns.',
        '人工智慧學習。'
      ]);
      for (const sentence of result.initial.sentenceChecks) {
        assert.equal(sentence.rebuilt, sentence.text);
        assert.equal(sentence.fragmentsAreNodeLocal, true);
        assert.equal(sentence.hasNodeReference, false);
        for (const token of sentence.tokenChecks) assert.equal(token.rebuilt, token.text);
      }
      const model = result.initial.sentenceChecks[0].tokenChecks.find((token) => token.text === 'model');
      assert.equal(model.fragmentCount, 2, 'one token split by inline markup maps to two local fragments');

      assert.deepEqual(result.dynamic.sentenceChecks.map((check) => check.text), [
        'The model learns.',
        '人工智慧學習。',
        'Dynamic sentence.'
      ]);
      assert.deepEqual(result.links, ['/model', '/zh']);
      assert.deepEqual(result.emphasis, [' learns.', '學習。']);
      assert.equal(result.nestedSpanPresent, true);
      assert.equal(result.passwordFieldPresent, true);
      assert.ok(result.dynamic.sentenceChecks.every((sentence) =>
        !sentence.text.includes('HIDDEN') &&
        !sentence.text.includes('CONTENT VISIBILITY') &&
        !sentence.text.includes('ARIA HIDDEN') &&
        !sentence.text.includes('password')
      ));
      assert.ok(requests.every((url) => url.startsWith(origin)), 'fixture makes no remote requests');
    });
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('real Chromium enforces viewport budgets, cancellation, and long-root multi-batch work', async () => {
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-viewport-scheduler-'));
  let context;
  try {
    context = await launchExtension({
      extensionRoot,
      userDataDir,
      headless: true,
      executablePath: executable.path
    });
    await withFixtureServer({
      '/long-lesson.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="zh-Hant"><body><main><p id="visible">The visible model learns.</p><div style="height:5000px"></div><p id="offscreen">離線字典讓中文學習更清楚。</p><div style="height:5000px"></div><p id="long-root">The model learns. We read clear words. They study a story. I write a sentence. You use the page. We learn together.</p><div style="height:5000px"></div><p id="invalid-root">Reject stale result.</p><div style="height:5000px"></div><p id="invalid-batch">Reject batch version. Batch sibling remains.</p><div style="height:5000px"></div><p id="cancel-root">Cancellable visible sentence.</p></main></body></html>'
      }
    }, async ({ origin }) => {
      const page = await context.newPage();
      await page.goto(origin + '/long-lesson.html');
      await page.evaluate(() => {
        const listeners = [];
        const semanticRequests = [];
        const cancelRequests = [];
        const pending = new Map();
        function responseFor(message) {
          const provider = HaloDictionary.createBootstrapDictionaryProvider();
          const engine = HaloSemanticAnnotations.createSemanticEngine({
            provider,
            grammarAnnotator: HaloGrammarAnnotations.annotateGrammar
          });
          const generatedAt = new Date().toISOString();
          const response = {
            schemaVersion: HaloSemanticContracts.SEMANTIC_SCHEMA_VERSION,
            requestId: message.requestId,
            pageEpoch: message.pageEpoch,
            results: message.items.map((item) => ({
              schemaVersion: HaloSemanticContracts.SEMANTIC_SCHEMA_VERSION,
              requestId: message.requestId,
              pageEpoch: message.pageEpoch,
              rootId: item.rootId,
              rootRevision: item.rootRevision,
              analysisKey: item.analysisKey,
              phase: 'bootstrap',
              lexicalVersion: item.lexicalVersion,
              generatedAt,
              annotationSet: engine.annotateText(item.text, {
                languageMode: item.languageMode,
                generatedAt
              })
            })),
            status: { mode: 'degraded', fallbackActivated: true, failures: [{ code: 'MANIFEST_UNAVAILABLE' }] }
          };
          if (message.items.some((item) => item.text.includes('Reject stale'))) {
            response.results[0] = { ...response.results[0], schemaVersion: 999 };
          }
          if (message.items.some((item) => item.text.includes('Reject batch version'))) {
            response.schemaVersion = 999;
          }
          return response;
        }
        Object.defineProperty(globalThis, 'chrome', {
          configurable: true,
          value: {
            runtime: {
              onMessage: { addListener: (listener) => listeners.push(listener) },
              sendMessage: async (message) => {
                if (message.type === 'HALO_CANCEL_REQUEST') {
                  cancelRequests.push(message.requestId);
                  const blocked = pending.get(message.requestId);
                  if (blocked) {
                    pending.delete(message.requestId);
                    blocked.resolve(responseFor(blocked.message));
                  }
                  return { status: 'cancelled' };
                }
                if (message.type !== 'HALO_ENRICH_BATCH') return null;
                semanticRequests.push(message);
                if (message.items.some((item) => item.text.includes('Cancellable'))) {
                  return new Promise((resolve) => pending.set(message.requestId, { resolve, message }));
                }
                return responseFor(message);
              }
            }
          }
        });
        globalThis.__haloFixture = { listeners, semanticRequests, cancelRequests, schedulerBatches: [] };
      });
      for (const scriptPath of [
        progressivePath, contractsPath, dictionaryPath, semanticPath, grammarPath, projectionPath,
        settingsPath, pipelinePath, schedulerPath, rendererPath
      ]) {
        await page.addScriptTag({ path: scriptPath });
      }
      const browserBudgetChecks = await page.evaluate(async () => {
        const defaults = HaloRuntimeScheduler.DEFAULT_BUDGETS;
        const dimensions = [
          ['maxTextNodes', 'textNodes', 2, 1, 2],
          ['maxCharacters', 'characters', 10, 6, 1],
          ['maxSentences', 'sentences', 2, 1, 2],
          ['maxSemanticTokens', 'semanticTokens', 10, 6, 1],
          ['maxShardIds', 'shardIds', 2, null, 2]
        ];
        const checks = {};
        for (const [budget, metric, limit, amount, expectedItems] of dimensions) {
          const budgets = { ...defaults, [budget]: limit };
          const scheduler = HaloRuntimeScheduler.createRuntimeScheduler({ budgets });
          scheduler.enqueue([0, 1, 2].map((index) => ({
            id: `${budget}-${index}`,
            rootId: `${budget}-${index}`,
            epoch: 1,
            visible: true,
            priority: 'inferred',
            textNodes: 1,
            characters: 1,
            sentences: 1,
            semanticTokens: 1,
            shardIds: [],
            [metric]: metric === 'shardIds' ? [`shard-${index}`] : amount
          })));
          const batch = await scheduler.nextBatch();
          checks[budget] = metric === 'shardIds'
            ? batch.items.length === expectedItems && batch.shardIds.size <= budgets[budget]
            : batch.items.length === expectedItems && batch[metric] <= budgets[budget];
        }
        let milliseconds = -4;
        const sliced = HaloRuntimeScheduler.createRuntimeScheduler({
          budgets: defaults,
          clock: { now: () => { milliseconds += 4; return milliseconds; } }
        });
        sliced.enqueue([0, 1, 2].map((index) => ({
          id: `time-${index}`,
          rootId: `time-${index}`,
          epoch: 1,
          visible: true,
          textNodes: 1,
          characters: 1,
          sentences: 1,
          semanticTokens: 1,
          shardIds: []
        })));
        checks.timeSliceMs = (await sliced.nextBatch()).items.length === 2;
        const bounded = HaloRuntimeScheduler.createRuntimeScheduler({
          budgets: { ...defaults, maxQueuedRoots: 2 }
        });
        bounded.enqueue([0, 1, 2].map((index) => ({
          id: `queue-${index}`,
          rootId: `queue-${index}`,
          epoch: 1,
          visible: false,
          textNodes: 1,
          characters: 1,
          sentences: 1,
          semanticTokens: 1,
          shardIds: []
        })));
        checks.maxQueuedRoots = bounded.status().queuedRoots === 2;
        checks.viewportBufferPx = HaloRuntimeScheduler.normalizeBudgets(defaults).viewportBufferPx === 1200;
        return checks;
      });
      assert.deepEqual(browserBudgetChecks, {
        maxTextNodes: true,
        maxCharacters: true,
        maxSentences: true,
        maxSemanticTokens: true,
        maxShardIds: true,
        timeSliceMs: true,
        maxQueuedRoots: true,
        viewportBufferPx: true
      });
      await page.evaluate(() => {
        const original = HaloRuntimeScheduler.createRuntimeScheduler;
        globalThis.HaloRuntimeScheduler = Object.freeze({
          ...HaloRuntimeScheduler,
          createRuntimeScheduler(options) {
            const processBatch = options.processBatch;
            return original({
              ...options,
              processBatch(batch, context) {
                __haloFixture.schedulerBatches.push({
                  textNodes: batch.textNodes,
                  characters: batch.characters,
                  sentences: batch.sentences,
                  semanticTokens: batch.semanticTokens,
                  shardIds: batch.shardIds.size
                });
                return processBatch(batch, context);
              }
            });
          }
        });
      });
      await page.addScriptTag({ path: contentPath });

      const initial = await page.evaluate(async () => {
        const listener = __haloFixture.listeners[0];
        const settings = HaloSettings.normalizeSettings({
          ...HaloSettings.DEFAULT_SETTINGS,
          runtimeBudgets: {
            maxTextNodes: 2,
            maxCharacters: 60,
            maxSentences: 2,
            maxSemanticTokens: 10,
            maxShardIds: 2,
            timeSliceMs: 8,
            maxQueuedRoots: 20,
            viewportBufferPx: 1200
          }
        });
        const result = await new Promise((resolve) => {
          listener({ type: 'HALO_APPLY_MARKING', settings }, {}, resolve);
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        return {
          result,
          requests: __haloFixture.semanticRequests.map((request) => request.items.map((item) => item.text)),
          offscreenWrapped: Boolean(document.querySelector('#offscreen [data-halo-owned="token"]'))
        };
      });

      assert.ok(initial.requests.flat().some((text) => text.includes('visible model')));
      assert.equal(initial.requests.flat().some((text) => text.includes('離線字典')), false);
      assert.equal(initial.offscreenWrapped, false);
      for (const batch of initial.requests) {
        assert.ok(batch.length <= 24);
        assert.ok(batch.join('').length <= 12000);
      }

      await page.locator('#offscreen').scrollIntoViewIfNeeded();
      await page.waitForFunction(() =>
        __haloFixture.semanticRequests.flatMap((request) => request.items).some((item) => item.text.includes('離線字典'))
      );
      assert.equal(await page.locator('#offscreen [data-halo-owned="token"]').count() > 0, true);

      const longText = await page.locator('#long-root').textContent();
      await page.locator('#long-root').scrollIntoViewIfNeeded();
      await page.waitForFunction(() =>
        __haloFixture.semanticRequests.flatMap((request) => request.items)
          .filter((item) => item.rootId.startsWith('long-root:')).length >= 6
      );
      assert.equal(await page.locator('#long-root').textContent(), longText);
      assert.equal(await page.locator('#long-root [data-halo-owned="token"]').count() > 0, true);
      const schedulerBatches = await page.evaluate(() => __haloFixture.schedulerBatches.map((batch) => ({ ...batch })));
      assert.ok(schedulerBatches.length >= 4);
      for (const batch of schedulerBatches) {
        assert.ok(batch.textNodes <= 2);
        assert.ok(batch.characters <= 60);
        assert.ok(batch.sentences <= 2);
        assert.ok(batch.semanticTokens <= 10);
        assert.ok(batch.shardIds <= 2);
      }

      await page.locator('#invalid-root').scrollIntoViewIfNeeded();
      await page.waitForFunction(() =>
        __haloFixture.semanticRequests.flatMap((request) => request.items)
          .some((item) => item.text.includes('Reject stale'))
      );
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#invalid-root [data-halo-owned="token"]').count(), 0);

      await page.locator('#invalid-batch').scrollIntoViewIfNeeded();
      await page.waitForFunction(() =>
        __haloFixture.semanticRequests.flatMap((request) => request.items)
          .some((item) => item.text.includes('Reject batch version'))
      );
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#invalid-batch [data-halo-owned="token"]').count(), 0);

      await page.locator('#cancel-root').scrollIntoViewIfNeeded();
      await page.waitForFunction(() =>
        __haloFixture.semanticRequests.flatMap((request) => request.items)
          .some((item) => item.text.includes('Cancellable'))
      );
      const cancellableRequestId = await page.evaluate(() =>
        __haloFixture.semanticRequests.find((request) =>
          request.items.some((item) => item.text.includes('Cancellable'))
        ).requestId
      );
      await page.locator('#visible').scrollIntoViewIfNeeded();
      await page.waitForFunction(
        (requestId) => __haloFixture.cancelRequests.includes(requestId),
        cancellableRequestId
      );
      assert.equal(await page.locator('#cancel-root [data-halo-owned="token"]').count(), 0);
    });
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
