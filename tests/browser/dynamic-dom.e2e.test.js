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
      await page.waitForSelector('#initial [data-halo-token="1"]');

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
      await page.waitForSelector('#inserted [data-halo-token="1"]');
      await page.waitForSelector('#lazy [data-halo-token="1"]');
      await page.waitForFunction(() =>
        document.querySelectorAll('#feed > p [data-halo-token="1"]').length >= 3
      );

      await page.evaluate(() => {
        document.getElementById('initial').textContent = 'The replacement content renders.';
      });
      await page.waitForFunction(() =>
        document.getElementById('initial').textContent === 'The replacement content renders.' &&
        document.querySelector('#initial [data-halo-token="1"]')
      );

      await page.evaluate(() => {
        const oldNode = document.getElementById('inserted');
        const redraw = document.createElement('p');
        redraw.id = 'inserted';
        redraw.textContent = 'The framework redraw stays singular.';
        oldNode.replaceWith(redraw);
      });
      await page.waitForSelector('#inserted [data-halo-token="1"]');

      await page.evaluate(() => {
        document.getElementById('content').innerHTML = '<p id="spa-push">The pushed route starts.</p>';
        history.pushState({ route: 'push' }, '', '/route-push');
      });
      await page.waitForSelector('#spa-push [data-halo-token="1"]');

      await page.evaluate(() => {
        document.getElementById('content').innerHTML = '<p id="spa-replace">The replaced route starts.</p>';
        history.replaceState({ route: 'replace' }, '', '/route-replace');
      });
      await page.waitForSelector('#spa-replace [data-halo-token="1"]');

      await page.evaluate(() => {
        __haloDynamic.setPopMarkup('<p id="spa-pop">The popped route starts.</p>');
        history.back();
      });
      await page.waitForSelector('#spa-pop [data-halo-token="1"]');

      await page.evaluate(() => {
        document.getElementById('content').innerHTML = '<p id="spa-hash">The hash route starts.</p>';
        location.hash = 'lesson';
      });
      await page.waitForSelector('#spa-hash [data-halo-token="1"]');
      await page.waitForTimeout(400);

      const result = await page.evaluate(async () => {
        const itemTexts = __haloDynamic.semanticRequests.flatMap((request) =>
          request.items.map((item) => item.text)
        );
        const epochs = [...new Set(__haloDynamic.semanticRequests.map((request) => request.pageEpoch))];
        const nestedWrappers = document.querySelectorAll(
          '[data-halo-token="1"] [data-halo-token="1"]'
        ).length;
        const listener = __haloDynamic.listeners[0];
        await new Promise((resolve) => listener({ type: 'HALO_REMOVE_MARKING' }, {}, resolve));
        return {
          itemTexts,
          epochs,
          nestedWrappers,
          wrappersAfterCleanup: document.querySelectorAll('[data-halo-token="1"]').length,
          historyRestored: history.pushState === __haloDynamic.originalPushState &&
            history.replaceState === __haloDynamic.originalReplaceState
        };
      });

      for (const text of [
        'The initial model learns.',
        'The inserted paragraph works.',
        'The lazy paragraph appears.',
        'Infinite item alpha arrives.',
        'Infinite item beta arrives.',
        'Infinite item gamma arrives.',
        'The replacement content renders.',
        'The framework redraw stays singular.',
        'The pushed route starts.',
        'The replaced route starts.',
        'The popped route starts.',
        'The hash route starts.'
      ]) {
        assert.equal(result.itemTexts.filter((value) => value === text).length, 1, text);
      }
      assert.deepEqual(result.epochs, [1, 2, 3, 4, 5]);
      assert.equal(result.nestedWrappers, 0);
      assert.equal(result.wrappersAfterCleanup, 0);
      assert.equal(result.historyRestored, true);
    });
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
