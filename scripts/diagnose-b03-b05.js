'use strict';
// B05 route-cleanup diagnostic: exercise the native extension shortcut, then
// drive the same popup/apply/token/SPA transition used by the canonical E2E.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { launchExtension, resolveChromiumExecutable } = require('../tests/browser/helpers/extension-harness');
const { withFixtureServer } = require('../tests/browser/helpers/fixture-server');

function pressNativeShortcut(windowTitle) {
  const output = execFileSync('xdotool', ['search', '--name', windowTitle], { encoding: 'utf8' }).trim();
  const windows = output.split(/\s+/).filter(Boolean);
  if (!windows.length) throw new Error(`B05 native shortcut window not found: ${windowTitle}`);
  const windowId = windows[windows.length - 1];
  console.log('DIAG xdotool-window', JSON.stringify({ windowTitle, windowId, windows }));
  execFileSync('xdotool', ['windowfocus', '--sync', windowId], { stdio: 'inherit' });
  execFileSync('xdotool', ['key', '--window', windowId, '--clearmodifiers', 'alt+shift+h'], { stdio: 'inherit' });
}

async function workerFor(context) {
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

(async () => {
  const extensionRoot = path.resolve(__dirname, '..', 'apps', 'extension');
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-command-diagnostic-'));
  const context = await launchExtension({ extensionRoot, userDataDir, headless: false, executablePath: executable.path });
  try {
    const worker = await workerFor(context);
    const match = /^chrome-extension:\/\/([^/]+)\//.exec(worker.url());
    if (!match) throw new Error(`extension worker URL unavailable: ${worker.url()}`);
    const extensionId = match[1];

    await withFixtureServer({
      '/diagnostic.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><head><title>Halo B05 Diagnostic</title></head><body><main><p id="lesson">The public model learns quickly.</p><p id="selection">Selected local sentence.</p></main></body></html>'
      }
    }, async ({ origin }) => {
      const page = await context.newPage();
      await page.goto(origin + '/diagnostic.html');
      await selectFixture(page);
      await page.bringToFront();

      const before = await worker.evaluate(async () => ({
        commands: await chrome.commands.getAll(),
        tab: (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
      }));
      console.log('DIAG before', JSON.stringify(before));
      pressNativeShortcut('Halo B05 Diagnostic');
      await page.locator('[data-halo-owned="panel"] .halo-core-panel').waitFor({ state: 'visible', timeout: 5000 });

      const afterNative = await worker.evaluate(async (url) => {
        const [tab] = await chrome.tabs.query({ url: `${url}/*` });
        return { tab, status: await chrome.tabs.sendMessage(tab.id, { type: 'HALO_STATUS' }) };
      }, origin);
      console.log('DIAG after-native-keyboard', JSON.stringify(afterNative));
      console.log('DIAG panel-after-native-keyboard', await page.locator('[data-halo-owned="panel"]').count());
      await page.keyboard.press('Escape');

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/src/popup.html`);
      await popup.waitForSelector('#applyButton:not([disabled])');
      await popup.selectOption('#triggerMode', 'explicit-only');
      await activateFixture(popup, origin);
      await popup.click('#applyButton');
      await page.waitForSelector('#lesson [data-halo-owned="token"]');

      const token = page.locator('#lesson [data-halo-owned="token"]').first();
      await token.click();
      await page.locator('[data-halo-owned="panel"] .halo-core-panel').waitFor({ state: 'visible', timeout: 5000 });
      const beforeRoute = await worker.evaluate(async (url) => {
        const [tab] = await chrome.tabs.query({ url: `${url}/*` });
        return chrome.tabs.sendMessage(tab.id, { type: 'HALO_STATUS' });
      }, origin);
      console.log('DIAG before-route', JSON.stringify(beforeRoute));

      await page.evaluate(() => history.pushState({}, '', '/route-two'));
      await page.waitForTimeout(500);

      const dom = await page.evaluate(() => {
        const hosts = [...document.querySelectorAll('[data-halo-owned="panel"]')];
        return {
          href: location.href,
          hostCount: hosts.length,
          hosts: hosts.map((host) => {
            const panel = host.shadowRoot && host.shadowRoot.querySelector('.halo-core-panel');
            const rect = panel ? panel.getBoundingClientRect() : null;
            const style = panel ? getComputedStyle(panel) : null;
            return {
              connected: host.isConnected,
              panelPresent: Boolean(panel),
              panelRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
              panelDisplay: style && style.display,
              panelVisibility: style && style.visibility,
              panelOpacity: style && style.opacity
            };
          })
        };
      });
      const afterRoute = await worker.evaluate(async (url) => {
        const [tab] = await chrome.tabs.query({ url: `${url}/*` });
        if (!tab || !Number.isInteger(tab.id)) return { error: 'fixture tab unavailable' };
        try { return await chrome.tabs.sendMessage(tab.id, { type: 'HALO_STATUS' }); }
        catch (error) { return { error: String(error) }; }
      }, origin);
      const evidence = { dom, beforeRoute, afterRoute };
      console.log('B05 ROUTE CLEANUP DIAGNOSTIC', JSON.stringify(evidence));

      if (dom.hostCount !== 0) {
        throw new Error(`B05 route cleanup left Halo panel host attached: ${JSON.stringify(evidence)}`);
      }
    });
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
