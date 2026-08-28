'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchExtension, resolveChromiumExecutable } = require('./helpers/extension-harness');
const { withFixtureServer } = require('./helpers/fixture-server');
const { stopExtensionServiceWorker } = require('./helpers/service-worker-cdp');

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

async function waitForVisiblePanel(page) {
  const panel = page.locator('[data-halo-owned="panel"]').locator('.halo-core-panel');
  await panel.waitFor({ state: 'visible', timeout: 5000 });
  return panel;
}

async function runAndObserveWorkerRecovery(session, scriptUrl, action, timeoutMs = 5000) {
  let listener;
  let timer;
  const running = new Promise((resolve, reject) => {
    listener = (event) => {
      const match = (event && Array.isArray(event.versions) ? event.versions : []).find((version) =>
        version && version.scriptURL === scriptUrl && version.status === 'activated' &&
        version.runningStatus === 'running' && typeof version.versionId === 'string');
      if (match) resolve(match);
    };
    session.on('ServiceWorker.workerVersionUpdated', listener);
    timer = setTimeout(() => reject(new Error('restarted extension worker did not become activated/running')), timeoutMs);
  });
  try {
    await session.send('ServiceWorker.enable');
    await action();
    return await running;
  } finally {
    clearTimeout(timer);
    session.off('ServiceWorker.workerVersionUpdated', listener);
  }
}

async function dictionaryNetworkStatus(extensionPage) {
  return extensionPage.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'HALO_DICTIONARY_STATUS' });
    if (!response || !response.networkActivity) throw new Error('dictionary network status unavailable');
    return response.networkActivity;
  });
}

test('final closure: ordinary MV3 worker stop/restart wakes through the installed command path and creates a fresh Halo runtime lifetime', async () => {
  const canonicalManifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  assert.equal(Object.hasOwn(canonicalManifest, 'host_permissions'), false, 'production manifest must remain host-permission-free');

  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-final-b06-'));
  let context;
  try {
    context = await launchExtension({ extensionRoot, userDataDir, headless: true, executablePath: executable.path });
    const workerBefore = await extensionWorker(context);
    const workerUrl = workerBefore.url();
    const match = /^chrome-extension:\/\/([^/]+)\//.exec(workerUrl);
    assert.ok(match, `real extension worker URL expected, got ${workerUrl}`);
    const extensionId = match[1];
    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/popup.html`);
    await extensionPage.waitForSelector('#applyButton:not([disabled])');

    await withFixtureServer({
      '/restart.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><body><main><p id="selection">Selected local sentence for MV3 recovery.</p></main></body></html>'
      }
    }, async ({ origin }) => {
      const page = await context.newPage();
      await page.goto(`${origin}/restart.html`);
      await selectFixture(page);
      await page.bringToFront();
      await page.keyboard.press('Alt+Shift+H');
      await waitForVisiblePanel(page);
      const before = await dictionaryNetworkStatus(extensionPage);
      assert.equal(before.schemaVersion, 1);
      assert.equal(before.scope, 'worker-lifetime');
      assert.match(before.lifetimeId, /^worker-/u);
      await page.keyboard.press('Escape');

      const cdp = await context.newCDPSession(page);
      await stopExtensionServiceWorker({ session: cdp, scriptUrl: workerUrl });

      const recoveredVersion = await runAndObserveWorkerRecovery(cdp, workerUrl, async () => {
        await selectFixture(page);
        await page.bringToFront();
        await page.keyboard.press('Alt+Shift+H');
        await waitForVisiblePanel(page);
      });
      assert.equal(recoveredVersion.scriptURL, workerUrl);
      assert.equal(recoveredVersion.status, 'activated');
      assert.equal(recoveredVersion.runningStatus, 'running');
      assert.equal(await page.locator('[data-halo-owned="panel"]').count(), 1);

      const after = await dictionaryNetworkStatus(extensionPage);
      assert.equal(after.schemaVersion, 1);
      assert.equal(after.scope, 'worker-lifetime');
      assert.match(after.lifetimeId, /^worker-/u);
      assert.notEqual(after.lifetimeId, before.lifetimeId, 'worker restart must create a distinct Halo runtime lifetime');
      assert.ok(context.serviceWorkers().some((candidate) => candidate.url() === workerUrl), 'same installed worker script must be running after recovery');
    });
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
