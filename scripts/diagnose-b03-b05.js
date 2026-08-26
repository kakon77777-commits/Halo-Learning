'use strict';
// trigger: diagnostic workflow is present before this push
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchExtension, resolveChromiumExecutable } = require('../tests/browser/helpers/extension-harness');
const { withFixtureServer } = require('../tests/browser/helpers/fixture-server');

(async () => {
  const extensionRoot = path.resolve(__dirname, '..', 'apps', 'extension');
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-command-diagnostic-'));
  const context = await launchExtension({ extensionRoot, userDataDir, headless: true, executablePath: executable.path });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await withFixtureServer({
      '/diagnostic.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><body><main><p id="lesson">The public model learns quickly.</p><p id="selection">Selected local sentence.</p></main></body></html>'
      }
    }, async ({ origin }) => {
      const page = await context.newPage();
      await page.goto(origin + '/diagnostic.html');
      await page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.getElementById('selection'));
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await page.bringToFront();
      const before = await worker.evaluate(async () => ({
        commands: await chrome.commands.getAll(),
        tab: (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
      }));
      console.log('DIAG before', JSON.stringify(before));
      await page.keyboard.press('Alt+Shift+H');
      await page.waitForTimeout(750);
      const afterKeyboard = await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        try { return { tab, status: await chrome.tabs.sendMessage(tab.id, { type: 'HALO_STATUS' }) }; }
        catch (error) { return { tab, error: String(error) }; }
      });
      console.log('DIAG after-keyboard', JSON.stringify(afterKeyboard));
      console.log('DIAG panel-after-keyboard', await page.locator('[data-halo-owned="panel"]').count());
      const direct = await worker.evaluate(async () => {
        const service = globalThis.__HALO_BROWSER_TRIGGER_INITIALIZED__;
        if (!service) return { error: 'trigger service unavailable' };
        return { result: await service.handleCommand('halo-analyze-selection') };
      });
      console.log('DIAG direct-handleCommand', JSON.stringify(direct));
      await page.waitForTimeout(750);
      const afterDirect = await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        try { return { tab, status: await chrome.tabs.sendMessage(tab.id, { type: 'HALO_STATUS' }) }; }
        catch (error) { return { tab, error: String(error) }; }
      });
      console.log('DIAG after-direct', JSON.stringify(afterDirect));
      console.log('DIAG panel-after-direct', await page.locator('[data-halo-owned="panel"]').count());
    });
  } finally {
    await context.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
