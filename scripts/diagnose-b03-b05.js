'use strict';
// B05 causal probe: verify whether Chromium's Navigation API reports a
// main-world History API transition to the extension ISOLATED world.
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
  execFileSync('xdotool', ['windowfocus', '--sync', windowId], { stdio: 'inherit' });
  execFileSync('xdotool', ['key', '--window', windowId, '--clearmodifiers', 'alt+shift+h'], { stdio: 'inherit' });
}

(async () => {
  const extensionRoot = path.resolve(__dirname, '..', 'apps', 'extension');
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-navigation-probe-'));
  const context = await launchExtension({ extensionRoot, userDataDir, headless: false, executablePath: executable.path });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await withFixtureServer({
      '/probe.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><head><title>Halo B05 Navigation Probe</title></head><body><main><p id="selection">Selected local sentence.</p></main></body></html>'
      }
    }, async ({ origin }) => {
      const page = await context.newPage();
      await page.goto(origin + '/probe.html');
      await page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.getElementById('selection'));
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await page.bringToFront();
      pressNativeShortcut('Halo B05 Navigation Probe');
      await page.locator('[data-halo-owned="panel"] .halo-core-panel').waitFor({ state: 'visible', timeout: 5000 });

      const installed = await worker.evaluate(async (url) => {
        const [tab] = await chrome.tabs.query({ url: `${url}/*` });
        if (!tab || !Number.isInteger(tab.id)) throw new Error('fixture tab unavailable');
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'ISOLATED',
          func: () => {
            const supported = Boolean(globalThis.navigation && typeof globalThis.navigation.addEventListener === 'function');
            globalThis.__haloNavigationProbe = { supported, count: 0, urls: [] };
            if (supported) {
              globalThis.navigation.addEventListener('currententrychange', () => {
                globalThis.__haloNavigationProbe.count += 1;
                globalThis.__haloNavigationProbe.urls.push(String(location.href));
              });
            }
            return { ...globalThis.__haloNavigationProbe };
          }
        });
        return { tabId: tab.id, probe: results[0] && results[0].result };
      }, origin);
      console.log('B05 NAVIGATION PROBE installed', JSON.stringify(installed));

      await page.evaluate(() => history.pushState({ halo: 1 }, '', '/route-two'));
      await page.waitForTimeout(200);

      const observed = await worker.evaluate(async (tabId) => {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'ISOLATED',
          func: () => ({
            href: String(location.href),
            probe: globalThis.__haloNavigationProbe || null
          })
        });
        return results[0] && results[0].result;
      }, installed.tabId);
      console.log('B05 NAVIGATION PROBE observed', JSON.stringify(observed));

      if (!installed.probe || installed.probe.supported !== true) {
        throw new Error(`Navigation API unavailable in ISOLATED world: ${JSON.stringify({ installed, observed })}`);
      }
      if (!observed || !observed.probe || observed.probe.count < 1 || !observed.probe.urls.includes(`${origin}/route-two`)) {
        throw new Error(`Navigation API did not observe main-world pushState: ${JSON.stringify({ installed, observed })}`);
      }
    });
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
