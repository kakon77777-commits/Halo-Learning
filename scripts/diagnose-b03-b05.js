'use strict';
// B05 causal round 1: exercise the native extension shortcut through an OS-level X11 key event.
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
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await withFixtureServer({
      '/diagnostic.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><head><title>Halo B05 Diagnostic</title></head><body><main><p id="lesson">The public model learns quickly.</p><p id="selection">Selected local sentence.</p></main></body></html>'
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
      pressNativeShortcut('Halo B05 Diagnostic');
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const panel = await page.locator('[data-halo-owned="panel"]').count();
        if (panel) break;
        await page.waitForTimeout(25);
      }
      const afterKeyboard = await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        try { return { tab, status: await chrome.tabs.sendMessage(tab.id, { type: 'HALO_STATUS' }) }; }
        catch (error) { return { tab, error: String(error) }; }
      });
      const panelCount = await page.locator('[data-halo-owned="panel"]').count();
      console.log('DIAG after-native-keyboard', JSON.stringify(afterKeyboard));
      console.log('DIAG panel-after-native-keyboard', panelCount);
      if (panelCount !== 1) throw new Error(`B05 native shortcut expected exactly one panel, received ${panelCount}`);
    });
  } finally {
    await context.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
