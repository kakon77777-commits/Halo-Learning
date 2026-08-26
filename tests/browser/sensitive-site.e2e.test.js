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

async function activeTabId(worker, url) {
  return worker.evaluate(async (fixtureUrl) => {
    const [tab] = await chrome.tabs.query({ url: fixtureUrl });
    if (!tab || !Number.isInteger(tab.id)) throw new Error('fixture tab unavailable');
    await chrome.tabs.update(tab.id, { active: true });
    return tab.id;
  }, url);
}

async function statusFor(worker, tabId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const status = await worker.evaluate(async (id) => {
      try { return await chrome.tabs.sendMessage(id, { type: 'HALO_STATUS' }); } catch (_error) { return null; }
    }, tabId);
    if (status) return status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Halo content status unavailable');
}

async function invokeCommand(page, worker, url, expectBlocked) {
  const tabId = await activeTabId(worker, url);
  await page.bringToFront();
  await page.keyboard.press('Alt+Shift+H');
  let status;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    status = await statusFor(worker, tabId);
    if (!expectBlocked || status.lastError === 'SENSITIVE_PAGE_BLOCKED') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { tabId, status };
}

function zeroWork(status) {
  assert.equal(status.active, false);
  assert.equal(status.textNodesVisited, 0);
  assert.equal(status.semanticTokens, 0);
  assert.equal(status.markedTokens, 0);
  assert.equal(Object.hasOwn(status, 'sentences'), false);
  assert.equal(Object.hasOwn(status, 'selection'), false);
  assert.equal(status.lastError, 'SENSITIVE_PAGE_BLOCKED');
  assert.equal(status.policyDecision.allow, false);
}

test('installed MV3 sensitive-site matrix blocks before extraction and cleans dynamic, SPA, and denylist transitions', async () => {
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-sensitive-site-'));
  let context;
  try {
    context = await launchExtension({ extensionRoot, userDataDir, headless: true, executablePath: executable.path });
    const worker = await extensionWorker(context);
    const match = /^chrome-extension:\/\/([^/]+)\//.exec(worker.url());
    assert.ok(match, `real extension worker URL expected, got ${worker.url()}`);
    const extensionId = match[1];

    await withFixtureServer({
      '/fixture.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><body><main><p id="lesson">The public model learns quickly.</p><input id="hostile" autocomplete="off"><button id="outside">Outside</button></main><script>globalThis.__privacyReads={value:0,text:0,selection:0};const input=document.getElementById("hostile");Object.defineProperty(input,"value",{get(){__privacyReads.value+=1;throw new Error("private value")}});Object.defineProperty(input,"textContent",{get(){__privacyReads.text+=1;throw new Error("private text")}});const nativeSelection=globalThis.getSelection;globalThis.getSelection=function(){__privacyReads.selection+=1;return nativeSelection.call(this)}</script></body></html>'
      },
      '/login': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><body><main><p id="lesson">Authentication fixture.</p><input id="hostile"></main><script>globalThis.__privacyReads={value:0,text:0,selection:0};const input=document.getElementById("hostile");Object.defineProperty(input,"value",{get(){__privacyReads.value+=1;throw new Error("private value")}});Object.defineProperty(input,"textContent",{get(){__privacyReads.text+=1;throw new Error("private text")}});const nativeSelection=globalThis.getSelection;globalThis.getSelection=function(){__privacyReads.selection+=1;return nativeSelection.call(this)}</script></body></html>'
      },
      '/personal-data': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><body><main><p id="lesson">Government fixture.</p><input id="hostile"></main><script>globalThis.__privacyReads={value:0,text:0,selection:0};const input=document.getElementById("hostile");Object.defineProperty(input,"value",{get(){__privacyReads.value+=1;throw new Error("private value")}});Object.defineProperty(input,"textContent",{get(){__privacyReads.text+=1;throw new Error("private text")}});const nativeSelection=globalThis.getSelection;globalThis.getSelection=function(){__privacyReads.selection+=1;return nativeSelection.call(this)}</script></body></html>'
      },
      '/secrets': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><body><main><p id="lesson">Developer fixture.</p><input id="hostile"></main><script>globalThis.__privacyReads={value:0,text:0,selection:0};const input=document.getElementById("hostile");Object.defineProperty(input,"value",{get(){__privacyReads.value+=1;throw new Error("private value")}});Object.defineProperty(input,"textContent",{get(){__privacyReads.text+=1;throw new Error("private text")}});const nativeSelection=globalThis.getSelection;globalThis.getSelection=function(){__privacyReads.selection+=1;return nativeSelection.call(this)}</script></body></html>'
      },
      '/public.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><body><main id="content"><p id="lesson">The public model learns quickly.</p></main></body></html>'
      }
    }, async ({ port }) => {
      const page = await context.newPage();
      const sensitiveMatrix = [
        ['banking', `http://bank.localhost:${port}/fixture.html`],
        ['payment-checkout', `http://pay.localhost:${port}/fixture.html`],
        ['password-manager', `http://bitwarden.localhost:${port}/fixture.html`],
        ['authentication', `http://public.localhost:${port}/login`],
        ['webmail', `http://mail.localhost:${port}/fixture.html`],
        ['private-messaging', `http://chat.localhost:${port}/fixture.html`],
        ['medical-insurance', `http://health.localhost:${port}/fixture.html`],
        ['government-personal-data', `http://government.localhost:${port}/personal-data`],
        ['developer-secrets', `http://cloud.localhost:${port}/secrets`]
      ];
      for (const [category, url] of sensitiveMatrix) {
        const requests = [];
        const observeRequest = (request) => {
          if (['fetch', 'xhr'].includes(request.resourceType())) requests.push(request.url());
        };
        await page.goto(url);
        page.on('request', observeRequest);
        const { status } = await invokeCommand(page, worker, url, true);
        zeroWork(status);
        assert.equal(status.policyDecision.category, category, url);
        assert.equal(await page.locator('[data-halo-owned="token"]').count(), 0);
        assert.equal(await page.locator('[data-halo-owned="panel"]').count(), 0);
        assert.deepEqual(await page.evaluate(() => __privacyReads), { value: 0, text: 0, selection: 0 });
        assert.deepEqual(requests, []);
        page.off('request', observeRequest);
      }

      const passwordUrl = `http://public.localhost:${port}/fixture.html`;
      await page.goto(passwordUrl);
      await page.evaluate(() => document.getElementById('hostile').setAttribute('type', 'password'));
      const passwordResult = await invokeCommand(page, worker, passwordUrl, true);
      zeroWork(passwordResult.status);
      assert.equal(passwordResult.status.policyDecision.category, 'sensitive-form');
      assert.deepEqual(await page.evaluate(() => __privacyReads), { value: 0, text: 0, selection: 0 });

      const publicUrl = `http://public.localhost:${port}/public.html`;
      await page.goto(publicUrl);
      const publicCommand = await invokeCommand(page, worker, publicUrl);
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/src/popup.html`);
      await popup.waitForSelector('#applyButton:not([disabled])');
      await activeTabId(worker, publicUrl);
      await popup.click('#applyButton');
      await page.waitForSelector('#lesson [data-halo-owned="token"]');

      await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = 'dynamic-password';
        document.getElementById('content').appendChild(input);
      });
      await page.waitForTimeout(50);
      assert.ok(await page.locator('#lesson [data-halo-owned="token"]').count() > 0);
      await page.evaluate(() => {
        document.getElementById('dynamic-password').setAttribute('autocomplete', 'current-password');
      });
      await page.waitForFunction(() => document.querySelectorAll('[data-halo-owned]').length === 0);
      zeroWork(await statusFor(worker, publicCommand.tabId));

      await page.evaluate(() => document.getElementById('dynamic-password').remove());
      await page.waitForSelector('#lesson [data-halo-owned="token"]');
      assert.equal((await statusFor(worker, publicCommand.tabId)).lastError, null);

      await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = 'inserted-password';
        input.setAttribute('type', 'password');
        document.getElementById('content').appendChild(input);
      });
      await page.waitForFunction(() => document.querySelectorAll('[data-halo-owned]').length === 0);
      zeroWork(await statusFor(worker, publicCommand.tabId));
      await page.evaluate(() => document.getElementById('inserted-password').remove());
      await page.waitForSelector('#lesson [data-halo-owned="token"]');

      await page.evaluate(() => history.pushState({}, '', '/checkout'));
      await page.waitForFunction(() => document.querySelectorAll('[data-halo-owned]').length === 0);
      const spaStatus = await statusFor(worker, publicCommand.tabId);
      zeroWork(spaStatus);
      assert.equal(spaStatus.policyDecision.category, 'payment-checkout');

      await page.goto(publicUrl);
      await invokeCommand(page, worker, publicUrl);
      await activeTabId(worker, publicUrl);
      await popup.reload();
      await popup.waitForSelector('#blockSiteButton:not([disabled])');
      await popup.click('#applyButton');
      await page.waitForSelector('#lesson [data-halo-owned="token"]');
      await popup.click('#blockSiteButton');
      await page.waitForFunction(() => document.querySelectorAll('[data-halo-owned]').length === 0);
      const deniedStatus = await statusFor(worker, publicCommand.tabId);
      zeroWork(deniedStatus);
      assert.equal(deniedStatus.policyDecision.category, 'user-denylist');

      const denylistMatrix = await popup.evaluate((fixturePort) => {
        const denylist = HaloSitePolicy.normalizeDenylist(['public.localhost']);
        const scan = [];
        const decide = (url) => HaloSitePolicy.classifySite({
          url, userDenylist: denylist, sensitiveAttributes: scan
        }).allow;
        return {
          exact: decide(`http://public.localhost:${fixturePort}/public.html`),
          subdomain: decide(`http://sub.public.localhost:${fixturePort}/public.html`),
          suffixTrick: decide(`http://public.localhost.attacker.test:${fixturePort}/public.html`)
        };
      }, port);
      assert.deepEqual(denylistMatrix, { exact: false, subdomain: false, suffixTrick: true });
      assert.equal(await page.locator('[data-halo-owned="panel"]').count(), 0);
    });
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
