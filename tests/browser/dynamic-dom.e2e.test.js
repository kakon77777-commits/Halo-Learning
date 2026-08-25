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
const source = (relative) => path.join(extensionRoot, 'src', relative);
const scripts = [
  'shared/progressive-runtime.js',
  'shared/semantic-contracts.js',
  'shared/dictionary-provider.js',
  'shared/semantic-annotations.js',
  'shared/grammar-annotations.js',
  'shared/projection.js',
  'shared/settings.js',
  'shared/sentence-pipeline.js',
  'shared/runtime-scheduler.js',
  'shared/dynamic-dom-controller.js',
  'shared/reversible-renderer.js',
  'content.js'
].map(source);

test('real Chromium handles dynamic redraws and SPA routes without duplicate semantic work or wrappers', async () => {
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-dynamic-dom-'));
  let context;
  try {
    context = await launchExtension({
      extensionRoot,
      userDataDir,
      headless: true,
      executablePath: executable.path
    });
    await withFixtureServer({
      '/article.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><body><main id="content"><p id="initial">The initial model learns.</p></main></body></html>'
      }
    }, async ({ origin }) => {
      const page = await context.newPage();
      await page.goto(origin + '/article.html');
      await page.evaluate(() => {
        const listeners = [];
        const semanticRequests = [];
        const cancelRequests = [];
        const pendingResponses = new Map();
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        let popMarkup = null;
        addEventListener('popstate', () => {
          if (popMarkup) document.getElementById('content').innerHTML = popMarkup;
        });
        function responseFor(message) {
          const provider = HaloDictionary.createBootstrapDictionaryProvider();
          const engine = HaloSemanticAnnotations.createSemanticEngine({
            provider,
            grammarAnnotator: HaloGrammarAnnotations.annotateGrammar
          });
          const generatedAt = new Date().toISOString();
          return {
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
            status: { mode: 'degraded' }
          };
        }
        Object.defineProperty(globalThis, 'chrome', {
          configurable: true,
          value: {
            runtime: {
              onMessage: { addListener: (listener) => listeners.push(listener) },
              sendMessage: async (message) => {
                if (message.type === 'HALO_CANCEL_REQUEST') {
                  cancelRequests.push(message.requestId);
                  return { status: 'cancelled' };
                }
                if (message.type !== 'HALO_ENRICH_BATCH') return null;
                semanticRequests.push(message);
                if (message.items.some((item) => item.text === 'Pending semantic response.')) {
                  return new Promise((resolve) => pendingResponses.set(message.requestId, { resolve, message }));
                }
                return responseFor(message);
              }
            }
          }
        });
        globalThis.__haloDynamic = {
          listeners,
          semanticRequests,
          cancelRequests,
          originalPushState,
          originalReplaceState,
          resolvePending() {
            for (const [requestId, pending] of pendingResponses) {
              pendingResponses.delete(requestId);
              pending.resolve(responseFor(pending.message));
            }
          },
          setPopMarkup(value) { popMarkup = value; }
        };
      });
      for (const script of scripts) await page.addScriptTag({ path: script });

      await page.evaluate(async () => {
        const listener = __haloDynamic.listeners[0];
        await new Promise((resolve) => listener({
          type: 'HALO_APPLY_MARKING',
          settings: HaloSettings.DEFAULT_SETTINGS
        }, {}, resolve));
      });
      await page.waitForSelector('#initial [data-halo-owned="token"]');

      const initialModelPasses = await page.evaluate(() =>
        __haloDynamic.semanticRequests.flatMap((request) => request.items)
          .filter((item) => item.text === 'The initial model learns.').length
      );
      await page.evaluate(() => {
        const wrapper = document.querySelector('#initial [data-halo-original="model"]');
        wrapper.setAttribute('data-halo-pos', 'third-party-semantic-change');
      });
      await page.waitForFunction((count) =>
        __haloDynamic.semanticRequests.flatMap((request) => request.items)
          .filter((item) => item.text === 'The initial model learns.').length > count &&
        document.querySelector('#initial [data-halo-original="model"]'), initialModelPasses
      );
      await page.evaluate(() => {
        const wrapper = document.querySelector('#initial [data-halo-original="model"]');
        wrapper.setAttribute('data-halo-owned', 'third-party-ownership-change');
      });
      await page.waitForFunction(() =>
        __haloDynamic.semanticRequests.flatMap((request) => request.items)
          .filter((item) => item.text === 'The initial model learns.').length >= 3 &&
        document.querySelector('#initial [data-halo-original="model"]')
      );
      await page.evaluate(() => {
        const wrapper = document.querySelector('#initial [data-halo-original="model"]');
        wrapper.firstChild.nodeValue = 'system';
      });
      await page.waitForFunction(() =>
        __haloDynamic.semanticRequests.flatMap((request) => request.items)
          .some((item) => item.text === 'The initial system learns.') &&
        document.querySelector('#initial [data-halo-original="system"]')
      );
      await page.evaluate(() => {
        const wrapper = document.querySelector('#initial [data-halo-original="system"]');
        const thirdParty = document.createElement('i');
        thirdParty.id = 'third-party-token-child';
        thirdParty.textContent = '!';
        __haloDynamic.thirdParty = thirdParty;
        wrapper.appendChild(thirdParty);
      });
      await page.waitForFunction(() =>
        __haloDynamic.semanticRequests.flatMap((request) => request.items)
          .some((item) => item.text === 'The initial system! learns.') &&
        document.querySelector('#initial [data-halo-owned="token"]')
      );

      await page.evaluate(() => {
        const main = document.getElementById('content');
        const inserted = document.createElement('p');
        inserted.id = 'inserted';
        inserted.textContent = 'The inserted paragraph works.';
        main.appendChild(inserted);

        const lazy = document.createElement('p');
        lazy.id = 'lazy';
        main.appendChild(lazy);
        setTimeout(() => { lazy.textContent = 'The lazy paragraph appears.'; }, 120);

        const feed = document.createElement('section');
        feed.id = 'feed';
        for (const text of [
          'Infinite item alpha arrives.',
          'Infinite item beta arrives.',
          'Infinite item gamma arrives.'
        ]) {
          const item = document.createElement('p');
          item.textContent = text;
          feed.appendChild(item);
        }
        main.appendChild(feed);
      });
      await page.waitForSelector('#inserted [data-halo-owned="token"]');

      await page.evaluate(() => {
        const race = document.createElement('p');
        race.id = 'race';
        race.textContent = 'Pending semantic response.';
        document.getElementById('content').appendChild(race);
      });
      await page.waitForFunction(() =>
        __haloDynamic.semanticRequests.some((request) =>
          request.items.some((item) => item.text === 'Pending semantic response.')
        )
      );
      const staleProjection = await page.evaluate(async () => {
        document.getElementById('race').textContent = 'Replacement wins before response.';
        __haloDynamic.resolvePending();
        await new Promise((resolve) => setTimeout(resolve, 20));
        return document.querySelectorAll('#race [data-halo-owned="token"]').length;
      });
      assert.equal(staleProjection, 0, 'pending result cannot project onto replaced text');
      await page.waitForSelector('#race [data-halo-owned="token"]');
      await page.waitForSelector('#lazy [data-halo-owned="token"]');
      await page.waitForFunction(() =>
        document.querySelectorAll('#feed > p [data-halo-owned="token"]').length >= 3
      );

      await page.evaluate(() => {
        document.getElementById('initial').textContent = 'The replacement content renders.';
      });
      await page.waitForFunction(() =>
        document.getElementById('initial').textContent === 'The replacement content renders.' &&
        document.querySelector('#initial [data-halo-owned="token"]')
      );

      await page.evaluate(() => {
        const oldNode = document.getElementById('inserted');
        const redraw = document.createElement('p');
        redraw.id = 'inserted';
        redraw.textContent = 'The framework redraw stays singular.';
        oldNode.replaceWith(redraw);
      });
      await page.waitForSelector('#inserted [data-halo-owned="token"]');

      await page.evaluate(() => {
        history.pushState({ route: 'push' }, '', '/route-push');
        document.getElementById('content').innerHTML = '<p id="spa-push">The history-first route starts.</p>';
      });
      await page.waitForSelector('#spa-push [data-halo-owned="token"]');

      await page.evaluate(() => {
        document.getElementById('content').innerHTML = '<p id="spa-replace">The replaced route starts.</p>';
        history.replaceState({ route: 'replace' }, '', '/route-replace');
      });
      await page.waitForSelector('#spa-replace [data-halo-owned="token"]');

      await page.evaluate(() => {
        __haloDynamic.setPopMarkup('<p id="spa-pop">The popped route starts.</p>');
        history.back();
      });
      await page.waitForSelector('#spa-pop [data-halo-owned="token"]');

      await page.evaluate(() => {
        document.getElementById('content').innerHTML = '<p id="spa-hash">The hash route starts.</p>';
        location.hash = 'lesson';
      });
      await page.waitForSelector('#spa-hash [data-halo-owned="token"]');
      await page.waitForTimeout(400);

      const result = await page.evaluate(async () => {
        const itemTexts = __haloDynamic.semanticRequests.flatMap((request) =>
          request.items.map((item) => item.text)
        );
        const epochs = [...new Set(__haloDynamic.semanticRequests.map((request) => request.pageEpoch))];
        const epochTwoTexts = __haloDynamic.semanticRequests
          .filter((request) => request.pageEpoch === 2)
          .flatMap((request) => request.items.map((item) => item.text));
        const nestedWrappers = document.querySelectorAll(
          '[data-halo-owned="token"] [data-halo-owned="token"]'
        ).length;
        const listener = __haloDynamic.listeners[0];
        await new Promise((resolve) => listener({ type: 'HALO_REMOVE_MARKING' }, {}, resolve));
        return {
          itemTexts,
          epochs,
          epochTwoTexts,
          nestedWrappers,
          thirdPartyPreserved: document.getElementById('third-party-token-child') === __haloDynamic.thirdParty,
          wrappersAfterCleanup: document.querySelectorAll('[data-halo-owned="token"]').length,
          historyRestored: history.pushState === __haloDynamic.originalPushState &&
            history.replaceState === __haloDynamic.originalReplaceState
        };
      });

      for (const text of [
        'The inserted paragraph works.',
        'The lazy paragraph appears.',
        'Infinite item alpha arrives.',
        'Infinite item beta arrives.',
        'Infinite item gamma arrives.',
        'The replacement content renders.',
        'The framework redraw stays singular.',
        'Pending semantic response.',
        'Replacement wins before response.',
        'The history-first route starts.',
        'The replaced route starts.',
        'The popped route starts.',
        'The hash route starts.'
      ]) {
        assert.equal(result.itemTexts.filter((value) => value === text).length, 1, text);
      }
      assert.equal(result.itemTexts.filter((value) => value === 'The initial model learns.').length, 3);
      assert.equal(result.itemTexts.filter((value) => value === 'The initial system learns.').length, 1);
      assert.equal(result.itemTexts.filter((value) => value === 'The initial system! learns.').length, 1);
      assert.deepEqual(result.epochs, [1, 2, 3, 4, 5]);
      assert.deepEqual(result.epochTwoTexts, ['The history-first route starts.']);
      assert.equal(result.nestedWrappers, 0);
      assert.equal(result.thirdPartyPreserved, true);
      assert.equal(result.wrappersAfterCleanup, 0);
      assert.equal(result.historyRestored, true);
    });
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
