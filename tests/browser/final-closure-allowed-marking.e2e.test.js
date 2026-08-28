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

      // First prove the installed native command/activeTab path still works.
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
      await popup.click('#applyButton');
      await popup.waitForFunction(() => {
        const text = document.getElementById('status')?.textContent || '';
        return !text.includes('Applying') && (text.includes('Marked') || text.includes('Cannot mark'));
      }, null, { timeout: 15000 });

      const diagnostics = await popup.evaluate(async ({ targetTabId }) => {
        const popupStatus = document.getElementById('status')?.textContent || '';
        let contentStatus = null;
        let dictionaryStatus = null;
        try { contentStatus = await chrome.tabs.sendMessage(targetTabId, { type: 'HALO_STATUS' }); }
        catch (error) { contentStatus = { transportError: String(error && error.message || error) }; }
        try { dictionaryStatus = await chrome.runtime.sendMessage({ type: 'HALO_DICTIONARY_STATUS' }); }
        catch (error) { dictionaryStatus = { transportError: String(error && error.message || error) }; }
        return { popupStatus, contentStatus, dictionaryStatus };
      }, { targetTabId: tabId });
      diagnostics.tokenCount = await page.locator('#lesson [data-halo-owned="token"]').count();
      diagnostics.lessonText = await page.locator('#lesson').textContent();
      console.log(`HALO_FINAL_ALLOWED_MARKING_DIAGNOSTIC=${JSON.stringify(diagnostics)}`);

      assert.doesNotMatch(diagnostics.popupStatus, /Cannot mark/);
      assert.match(diagnostics.popupStatus, /Marked\s+[1-9]\d*\s*\/\s*[1-9]\d*/);
      assert.ok(diagnostics.tokenCount > 0, 'allowed page must contain at least one Halo-owned token after Apply');
      assert.equal(diagnostics.lessonText, 'The model learns quickly.');
    });
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
