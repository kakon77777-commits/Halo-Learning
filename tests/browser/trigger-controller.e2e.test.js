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

async function activateFixture(worker, origin) {
  return worker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url: `${url}/*` });
    if (!tabs.length || !Number.isInteger(tabs[0].id)) throw new Error('fixture tab unavailable');
    await chrome.tabs.update(tabs[0].id, { active: true });
    return tabs[0].id;
  }, origin);
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

test('installed MV3 extension verifies popup, command, modes, dismissal, menu registration, restart, and reinjection', async () => {
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-trigger-controller-'));
  let context;
  try {
    context = await launchExtension({ extensionRoot, userDataDir, headless: true, executablePath: executable.path });
    const worker = await extensionWorker(context);
    const match = /^chrome-extension:\/\/([^/]+)\//.exec(worker.url());
    assert.ok(match, `real extension worker URL expected, got ${worker.url()}`);
    const extensionId = match[1];

    await withFixtureServer({
      '/triggers.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><body><main><p id="lesson">The model learns quickly.</p><a id="normal-link" href="#native-link">Ordinary navigation</a><p id="selection">Selected local sentence.</p></main></body></html>'
      }
    }, async ({ origin }) => {
      const page = await context.newPage();
      await page.goto(`${origin}/triggers.html`);
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/src/popup.html`);
      await popup.waitForSelector('#applyButton:not([disabled])');

      // Playwright cannot automate Chromium's native context-menu surface. This
      // verifies registration through the installed worker's real Chrome API and
      // intentionally does not claim native context-menu click delivery.
      await assert.doesNotReject(() => worker.evaluate(() => new Promise((resolve, reject) => {
        let attempts = 0;
        const verify = () => chrome.contextMenus.update('halo-analyze-selection', {}, () => {
          const error = chrome.runtime.lastError;
          if (!error) resolve();
          else if (++attempts < 20) setTimeout(verify, 25);
          else reject(new Error(error.message));
        });
        verify();
      })));

      async function applyMode(mode) {
        await popup.selectOption('#triggerMode', mode);
        await activateFixture(worker, origin);
        await popup.click('#applyButton');
        await page.waitForSelector('#lesson [data-halo-owned="token"]');
      }

      await applyMode('hybrid');
      let token = page.locator('#lesson [data-halo-owned="token"]').first();
      await token.click();
      await page.waitForSelector('[data-halo-owned="panel"]');
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-halo-owned="panel"]', { state: 'detached' });

      const nativeLink = await page.evaluate(() => {
        const link = document.getElementById('normal-link');
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        link.dispatchEvent(event);
        return { prevented: event.defaultPrevented, hash: location.hash };
      });
      assert.deepEqual(nativeLink, { prevented: false, hash: '#native-link' });

      await token.click();
      await page.evaluate(() => {
        const tokenNode = document.querySelector('#lesson [data-halo-owned="token"]');
        tokenNode.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
        document.querySelector('[data-halo-owned="panel"]').dispatchEvent(
          new PointerEvent('pointerover', { bubbles: true, relatedTarget: tokenNode })
        );
      });
      await page.waitForTimeout(240);
      assert.equal(await page.locator('[data-halo-owned="panel"]').count(), 1);
      await page.evaluate(() => document.querySelector('[data-halo-owned="panel"]').dispatchEvent(
        new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body })
      ));
      await page.waitForSelector('[data-halo-owned="panel"]', { state: 'detached' });

      for (const mode of ['adaptive-hover', 'hybrid']) {
        await applyMode(mode);
        token = page.locator('#lesson [data-halo-owned="token"]').first();
        await token.hover();
        await page.waitForSelector('[data-halo-owned="panel"]', { timeout: 1600 });
        await page.keyboard.press('Escape');
      }

      await applyMode('explicit-only');
      token = page.locator('#lesson [data-halo-owned="token"]').first();
      await token.hover();
      await page.waitForTimeout(1100);
      assert.equal(await page.locator('[data-halo-owned="panel"]').count(), 0);
      await page.evaluate(() => document.querySelector('#lesson [data-halo-owned="token"]').dispatchEvent(
        new PointerEvent('pointerover', { bubbles: true, altKey: true })
      ));
      await page.waitForSelector('[data-halo-owned="panel"]');
      await page.keyboard.press('Escape');

      await selectFixture(page);
      await activateFixture(worker, origin);
      await popup.click('#analyzeSelectionButton');
      await page.waitForSelector('[data-halo-owned="panel"]');
      assert.equal(await page.locator('[data-halo-owned="panel"]').count(), 1);
      assert.equal(await page.evaluate(() => document.querySelector('[data-halo-owned="panel"]').shadowRoot.querySelector('.halo-core-body').textContent), 'Selected local sentence.');
      await page.keyboard.press('Escape');

      await selectFixture(page);
      await page.bringToFront();
      await page.keyboard.press('Alt+Shift+H');
      await page.waitForSelector('[data-halo-owned="panel"]');
      await page.keyboard.press('Escape');

      for (let index = 0; index < 2; index += 1) {
        await selectFixture(page);
        await activateFixture(worker, origin);
        await popup.click('#analyzeSelectionButton');
      }
      assert.equal(await page.locator('[data-halo-owned="panel"]').count(), 1);
      await page.keyboard.press('Escape');

      const closed = new Promise((resolve) => worker.once('close', resolve));
      await worker.evaluate(() => self.close());
      await closed;
      const restartedPromise = context.waitForEvent('serviceworker');
      await selectFixture(page);
      await page.bringToFront();
      await page.keyboard.press('Alt+Shift+H');
      const restarted = await restartedPromise;
      assert.match(restarted.url(), new RegExp(`^chrome-extension://${extensionId}/`));
      await page.waitForSelector('[data-halo-owned="panel"]');
    });
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
