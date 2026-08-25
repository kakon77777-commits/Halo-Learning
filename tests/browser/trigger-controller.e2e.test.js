'use strict';

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
  'shared/browser-entry.js',
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
  'shared/trigger-controller.js',
  'content.js',
  'service-worker.js'
].map(source);

test('real Chromium verifies canonical trigger modes, explicit paths, dismissal, links, timers, and reinjection', async () => {
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-trigger-controller-'));
  let context;
  try {
    context = await launchExtension({
      extensionRoot,
      userDataDir,
      headless: true,
      executablePath: executable.path
    });
    await withFixtureServer({
      '/triggers.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><body><main><p id="lesson">The model learns quickly.</p><a id="normal-link" href="#native-link">Ordinary navigation</a><p id="selection">Selected local sentence.</p></main></body></html>'
      }
    }, async ({ origin }) => {
      const page = await context.newPage();
      await page.goto(origin + '/triggers.html');
      await page.evaluate(() => {
        const listeners = [];
        let stored = null;
        function semanticResponse(message) {
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
        async function deliver(message) {
          for (const listener of listeners) {
            const result = await new Promise((resolve) => {
              let settled = false;
              const sendResponse = (value) => {
                if (settled) return;
                settled = true;
                resolve({ handled: true, value });
              };
              const asyncResponse = listener(message, { tab: { id: 7 } }, sendResponse);
              if (asyncResponse !== true && !settled) {
                settled = true;
                resolve({ handled: false });
              }
            });
            if (result.handled) return result.value;
          }
          return undefined;
        }
        Object.defineProperty(globalThis, 'chrome', {
          configurable: true,
          value: {
            runtime: {
              lastError: null,
              getURL: (value) => value,
              onInstalled: { addListener() {} },
              onMessage: { addListener: (listener) => listeners.push(listener) },
              sendMessage: async (message) => {
                if (message.type === 'HALO_ENRICH_BATCH') return semanticResponse(message);
                if (message.type === 'HALO_CANCEL_REQUEST') return { status: 'cancelled' };
                return null;
              }
            },
            storage: {
              local: {
                async get(key) { return { [key]: stored }; },
                async set(update) { stored = update.haloSettings; }
              }
            },
            scripting: {
              async insertCSS() {},
              async executeScript() {}
            },
            tabs: {
              async query() { return [{ id: 7 }]; },
              async sendMessage(_tabId, message) { return deliver(message); }
            },
            contextMenus: {
              remove(_id, callback) { callback(); },
              create(_value, callback) { callback(); },
              onClicked: { addListener() {} }
            },
            commands: { onCommand: { addListener() {} } }
          }
        });
        globalThis.__haloTriggerFixture = {
          listeners,
          deliver,
          select() {
            const range = document.createRange();
            range.selectNodeContents(document.getElementById('selection'));
            const selection = getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
          }
        };
      });
      for (const script of scripts.slice(0, -2)) await page.addScriptTag({ path: script });
      await page.addScriptTag({ path: scripts[scripts.length - 2] });
      await page.addScriptTag({ path: scripts[scripts.length - 1] });

      async function applyMode(mode) {
        await page.evaluate(async (triggerMode) => {
          const settings = HaloSettings.normalizeSettings({
            ...HaloSettings.DEFAULT_SETTINGS,
            triggerMode,
            density: 1,
            minConfidence: 0
          });
          await chrome.storage.local.set({ haloSettings: settings });
          await __haloTriggerFixture.deliver({ type: 'HALO_APPLY_MARKING', settings });
        }, mode);
        await page.waitForSelector('#lesson [data-halo-owned="token"]');
      }

      await applyMode('hybrid');
      const listenerCount = await page.evaluate(() => __haloTriggerFixture.listeners.length);
      await page.addScriptTag({ path: source('content.js') });
      assert.equal(await page.evaluate(() => __haloTriggerFixture.listeners.length), listenerCount);

      const clickResult = await page.evaluate(() => {
        const token = document.querySelector('#lesson [data-halo-owned="token"]');
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });
        token.dispatchEvent(click);
        return {
          prevented: click.defaultPrevented,
          panel: Boolean(document.querySelector('[data-halo-owned="panel"]'))
        };
      });
      assert.deepEqual(clickResult, { prevented: true, panel: true });

      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-halo-owned="panel"]').count(), 0);
      const normalLink = await page.evaluate(() => {
        const link = document.getElementById('normal-link');
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });
        link.dispatchEvent(click);
        return { prevented: click.defaultPrevented, hash: location.hash };
      });
      assert.equal(normalLink.prevented, false);
      assert.equal(normalLink.hash, '#native-link');

      await page.evaluate(() => {
        const token = document.querySelector('#lesson [data-halo-owned="token"]');
        token.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        token.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
        const panel = document.querySelector('[data-halo-owned="panel"]');
        panel.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: token }));
      });
      await page.waitForTimeout(240);
      assert.equal(await page.locator('[data-halo-owned="panel"]').count(), 1);
      await page.evaluate(() => {
        const panel = document.querySelector('[data-halo-owned="panel"]');
        panel.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
      });
      await page.waitForTimeout(240);
      assert.equal(await page.locator('[data-halo-owned="panel"]').count(), 0);

      for (const mode of ['adaptive-hover', 'hybrid']) {
        await applyMode(mode);
        await page.evaluate(() => {
          const token = document.querySelector('#lesson [data-halo-owned="token"]');
          token.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
        });
        await page.waitForTimeout(1100);
        assert.equal(await page.locator('[data-halo-owned="panel"]').count(), 1, `${mode} plain hover`);
        await page.keyboard.press('Escape');
      }

      await applyMode('explicit-only');
      await page.evaluate(() => {
        const token = document.querySelector('#lesson [data-halo-owned="token"]');
        token.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      });
      await page.waitForTimeout(1100);
      assert.equal(await page.locator('[data-halo-owned="panel"]').count(), 0);
      await page.evaluate(() => {
        const token = document.querySelector('#lesson [data-halo-owned="token"]');
        token.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, altKey: true }));
      });
      assert.equal(await page.locator('[data-halo-owned="panel"]').count(), 1);
      await page.keyboard.press('Escape');

      const explicitResults = await page.evaluate(async () => {
        function panelBody() {
          const host = document.querySelector('[data-halo-owned="panel"]');
          return host && host.shadowRoot.querySelector('.halo-core-body').textContent;
        }
        async function action(callback) {
          __haloTriggerFixture.select();
          const result = await callback();
          const body = panelBody();
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          return { result, body };
        }
        const message = await action(() => __haloTriggerFixture.deliver({
          type: 'HALO_EXPLICIT_SELECTION', action: 'analyze-selection'
        }));
        const popup = await action(() => HaloBrowserEntry.injectAndSendExplicitSelection({ chrome, tabId: 7 }));
        const context = await action(() => __HALO_BROWSER_TRIGGER_INITIALIZED__.handleContextClick({
          menuItemId: 'halo-analyze-selection', selectionText: 'must not cross the boundary'
        }, { id: 7 }));
        const shortcut = await action(() => __HALO_BROWSER_TRIGGER_INITIALIZED__.handleCommand('halo-analyze-selection'));
        const forged = await __haloTriggerFixture.deliver({
          type: 'HALO_EXPLICIT_SELECTION', action: 'analyze-selection', text: 'forged'
        });
        return { message, popup, context, shortcut, forged };
      });
      for (const name of ['message', 'popup', 'context', 'shortcut']) {
        assert.equal(explicitResults[name].result.accepted === true || explicitResults[name].result === true, true, name);
        assert.equal(explicitResults[name].body, 'Selected local sentence.');
      }
      assert.deepEqual(explicitResults.forged, { accepted: false, code: 'INVALID_ACTION' });

      const timerSafety = await page.evaluate(() => {
        const timers = [];
        const opens = [];
        const closes = [];
        const controller = HaloTriggerController.createTriggerController({
          mode: 'hybrid',
          primeThresholdMs: 10,
          openThresholdMs: 20,
          dismissDelayMs: 10,
          now: () => 50,
          setTimeout: (callback) => { timers.push(callback); return timers.length - 1; },
          clearTimeout: () => {},
          openPanel: (value) => opens.push(value.targetId),
          closePanel: (reason) => closes.push(reason)
        });
        controller.dispatch({ type: 'POINTER_ENTER', targetId: 'old', at: 0 });
        const staleHover = timers[0];
        controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'new', at: 1 });
        staleHover();
        controller.dispatch({ type: 'POINTER_LEAVE', targetId: 'new', at: 2 });
        const staleDismiss = timers[1];
        controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'latest', at: 3 });
        staleDismiss();
        const beforeCleanup = controller.state();
        controller.dispatch({ type: 'ROUTE_CLEANUP', at: 4 });
        staleHover();
        staleDismiss();
        return { beforeCleanup, afterCleanup: controller.state(), opens, closes };
      });
      assert.deepEqual(timerSafety.beforeCleanup, { name: 'core-open', targetId: 'latest', source: 'explicit' });
      assert.deepEqual(timerSafety.afterCleanup, { name: 'cancelled' });
      assert.deepEqual(timerSafety.opens, ['new', 'latest']);
      assert.deepEqual(timerSafety.closes, ['route-cleanup']);
    });
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
