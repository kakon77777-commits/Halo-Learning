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

async function extensionWorker(context) {
  return context.serviceWorkers()[0] || context.waitForEvent('serviceworker');
}

async function selectFixture(page) {
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('selection'));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

async function activateFixture(extensionPage, origin) {
  return extensionPage.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url: `${url}/*` });
    if (!tabs.length || !Number.isInteger(tabs[0].id)) throw new Error('fixture tab unavailable');
    await chrome.tabs.update(tabs[0].id, { active: true });
    return tabs[0].id;
  }, origin);
}

async function activeTabSnapshot(extensionPage) {
  return extensionPage.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ? { id: tab.id, url: tab.url } : null;
  });
}

async function directApply(extensionPage, tabId) {
  return extensionPage.evaluate(async (targetTabId) => {
    const stored = await chrome.storage.local.get('haloSettings');
    const settings = HaloSettings.migrateSettings(stored && stored.haloSettings);
    await HaloBrowserEntry.injectPackagedRuntime({ chrome, tabId: targetTabId });
    return chrome.tabs.sendMessage(targetTabId, { type: 'HALO_APPLY_MARKING', settings });
  }, tabId);
}

async function removeMarking(extensionPage, tabId) {
  return extensionPage.evaluate((targetTabId) => chrome.tabs.sendMessage(targetTabId, { type: 'HALO_REMOVE_MARKING' }), tabId);
}

async function diagnostics(extensionPage, tabId) {
  return extensionPage.evaluate(async (targetTabId) => {
    let contentStatus = null;
    let dictionaryStatus = null;
    try { contentStatus = await chrome.tabs.sendMessage(targetTabId, { type: 'HALO_STATUS' }); }
    catch (error) { contentStatus = { transportError: String(error && error.message || error) }; }
    try { dictionaryStatus = await chrome.runtime.sendMessage({ type: 'HALO_DICTIONARY_STATUS' }); }
    catch (error) { dictionaryStatus = { transportError: String(error && error.message || error) }; }
    return { contentStatus, dictionaryStatus };
  }, tabId);
}

test('v0.4 final closure: installed allowed-page Apply produces semantic marking with promoted lexical runtime', async () => {
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-final-allowed-marking-'));
  let context;
  try {
    context = await launchExtension({ extensionRoot, userDataDir, headless: true, executablePath: executable.path });
    const worker = await extensionWorker(context);
    const match = /^chrome-extension:\/\/([^/]+)\//.exec(worker.url());
    assert.ok(match, `real extension worker URL expected, got ${worker.url()}`);
    const extensionId = match[1];

    await withFixtureServer({
      '/allowed.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><body><main><p id="lesson">The model learns quickly.</p><p id="selection">Selected local sentence.</p></main></body></html>'
      }
    }, async ({ origin }) => {
      const page = await context.newPage();
      await page.goto(`${origin}/allowed.html`);

      // Prove the real installed command / activeTab path before diagnosing full-page marking.
      await selectFixture(page);
      await page.bringToFront();
      await page.keyboard.press('Alt+Shift+H');
      const panel = page.locator('[data-halo-owned="panel"]').locator('.halo-core-panel');
      await panel.waitFor({ state: 'visible', timeout: 10000 });
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-halo-owned="panel"]', { state: 'detached' });

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/src/popup.html`);
      await popup.waitForSelector('#applyButton:not([disabled])');
      const tabId = await activateFixture(popup, origin);

      // Phase A: keep the fixture foreground and invoke the exact packaged runtime/message path
      // without clicking the extension-page surrogate for Chrome's real popup surface.
      await page.bringToFront();
      const directActiveBefore = await activeTabSnapshot(popup);
      const directResult = await directApply(popup, tabId);
      let directTokenObserved = true;
      try {
        await page.waitForSelector('#lesson [data-halo-owned="token"]', { timeout: 10000 });
      } catch (_error) {
        directTokenObserved = false;
      }
      const directDiagnostics = await diagnostics(popup, tabId);
      directDiagnostics.activeBefore = directActiveBefore;
      directDiagnostics.result = directResult;
      directDiagnostics.tokenCount = await page.locator('#lesson [data-halo-owned="token"]').count();
      console.log(`HALO_FINAL_ALLOWED_DIRECT_DIAGNOSTIC=${JSON.stringify(directDiagnostics)}`);

      assert.equal(directTokenObserved, true, 'foreground direct Apply must eventually create a Halo token');
      assert.ok(directDiagnostics.tokenCount > 0, 'foreground direct Apply must retain at least one Halo-owned token');
      await removeMarking(popup, tabId);
      await page.waitForSelector('#lesson [data-halo-owned="token"]', { state: 'detached' });

      // Phase B: exercise the actual popup Apply UI while recording which tab Chromium reports
      // active before and after the click. This distinguishes product runtime from popup-tab harness focus.
      await activateFixture(popup, origin);
      const popupActiveBefore = await activeTabSnapshot(popup);
      await popup.click('#applyButton');
      await popup.waitForFunction(() => {
        const text = document.getElementById('status')?.textContent || '';
        return !text.includes('Applying') && (text.includes('Marked') || text.includes('Cannot mark'));
      }, null, { timeout: 15000 });
      const popupActiveAfter = await activeTabSnapshot(popup);
      let popupTokenObserved = true;
      try {
        await page.waitForSelector('#lesson [data-halo-owned="token"]', { timeout: 10000 });
      } catch (_error) {
        popupTokenObserved = false;
      }

      const popupDiagnostics = await diagnostics(popup, tabId);
      popupDiagnostics.popupStatus = await popup.locator('#status').textContent();
      popupDiagnostics.activeBefore = popupActiveBefore;
      popupDiagnostics.activeAfter = popupActiveAfter;
      popupDiagnostics.tokenCount = await page.locator('#lesson [data-halo-owned="token"]').count();
      popupDiagnostics.lessonText = await page.locator('#lesson').textContent();
      console.log(`HALO_FINAL_ALLOWED_POPUP_DIAGNOSTIC=${JSON.stringify(popupDiagnostics)}`);

      assert.doesNotMatch(popupDiagnostics.popupStatus, /Cannot mark/);
      assert.equal(popupTokenObserved, true, 'popup Apply must eventually create a Halo token on the active page');
      assert.ok(popupDiagnostics.tokenCount > 0, 'popup Apply must retain at least one Halo-owned token');
      assert.equal(popupDiagnostics.lessonText, 'The model learns quickly.');
    });
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
