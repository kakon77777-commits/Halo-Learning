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

async function currentActiveTabId(worker) {
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !Number.isInteger(tab.id)) throw new Error('active fixture tab unavailable');
    return tab.id;
  });
}

async function activateTab(worker, tabId) {
  await worker.evaluate(async (id) => chrome.tabs.update(id, { active: true }), tabId);
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

async function installIsolatedInstrumentation(worker) {
  const installed = await worker.evaluate(() => {
    if (globalThis.__haloInstrumentedExecuteScript) return true;
    const original = chrome.scripting.executeScript.bind(chrome.scripting);
    const wrapped = async (details) => {
      if (Array.isArray(details && details.files) && details.files.includes('src/content.js')) {
        await original({
          target: details.target,
          world: 'ISOLATED',
          func: () => {
            if (globalThis.__HALO_ISOLATED_PROBE__) return;
            globalThis.__HALO_ISOLATED_PROBE__ = {
              value: 0,
              textContent: 0,
              innerText: 0,
              selection: 0,
              rendererRemoveFailures: 0
            };
            const hostile = document.getElementById('hostile');
            if (hostile) {
              for (const name of ['value', 'textContent', 'innerText']) {
                Object.defineProperty(hostile, name, {
                  configurable: true,
                  get() {
                    globalThis.__HALO_ISOLATED_PROBE__[name] += 1;
                    throw new Error(`forbidden ${name} read`);
                  }
                });
              }
            }
            const nativeSelection = globalThis.getSelection;
            globalThis.getSelection = function () {
              globalThis.__HALO_ISOLATED_PROBE__.selection += 1;
              return nativeSelection.call(this);
            };
            let rendererModule;
            Object.defineProperty(globalThis, 'HaloReversibleRenderer', {
              configurable: true,
              get() { return rendererModule; },
              set(api) {
                rendererModule = Object.freeze({
                  ...api,
                  createReversibleRenderer(options) {
                    const renderer = api.createReversibleRenderer(options);
                    return Object.freeze({
                      ...renderer,
                      removeAll() {
                        if (globalThis.__HALO_FAIL_RENDERER_REMOVE__) {
                          globalThis.__HALO_ISOLATED_PROBE__.rendererRemoveFailures += 1;
                          throw new Error('instrumented transactional cleanup failure');
                        }
                        return renderer.removeAll();
                      }
                    });
                  }
                });
              }
            });
            const nativeSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
            chrome.runtime.sendMessage = async function (message) {
              const response = await nativeSendMessage(message);
              if (message && message.type === 'HALO_ENRICH_BATCH' && globalThis.__HALO_HOLD_SEMANTIC__) {
                await new Promise((resolve) => { globalThis.__HALO_RELEASE_SEMANTIC__ = resolve; });
              }
              return response;
            };
          }
        });
      }
      return original(details);
    };
    chrome.scripting.executeScript = wrapped;
    globalThis.__haloInstrumentedExecuteScript = true;
    return chrome.scripting.executeScript === wrapped;
  });
  assert.equal(installed, true, 'service-worker scripting instrumentation must install before Halo files');
}

async function isolatedProbe(worker, tabId) {
  const [result] = await worker.evaluate(async (id) => chrome.scripting.executeScript({
    target: { tabId: id },
    world: 'ISOLATED',
    func: () => globalThis.__HALO_ISOLATED_PROBE__ || null
  }), tabId);
  return result && result.result;
}

async function setIsolatedFlag(worker, tabId, name, value) {
  await worker.evaluate(async ({ id, key, next }) => chrome.scripting.executeScript({
    target: { tabId: id },
    world: 'ISOLATED',
    func: ([flag, flagValue]) => { globalThis[flag] = flagValue; },
    args: [[key, next]]
  }), { id: tabId, key: name, next: value });
}

async function releaseHeldSemantic(worker, tabId) {
  await worker.evaluate(async (id) => chrome.scripting.executeScript({
    target: { tabId: id },
    world: 'ISOLATED',
    func: () => {
      const release = globalThis.__HALO_RELEASE_SEMANTIC__;
      globalThis.__HALO_HOLD_SEMANTIC__ = false;
      globalThis.__HALO_RELEASE_SEMANTIC__ = null;
      if (typeof release === 'function') release();
    }
  }), tabId);
}

async function setWorkerStorageFailure(worker, enabled) {
  await worker.evaluate((next) => {
    if (!globalThis.__haloOriginalStorageGet) {
      globalThis.__haloOriginalStorageGet = chrome.storage.local.get.bind(chrome.storage.local);
      chrome.storage.local.get = async (...args) => {
        if (globalThis.__HALO_FAIL_POLICY_STORAGE__) throw new Error('instrumented storage failure');
        return globalThis.__haloOriginalStorageGet(...args);
      };
    }
    globalThis.__HALO_FAIL_POLICY_STORAGE__ = next;
  }, enabled);
}

async function workerNetworkActivity(worker) {
  return worker.evaluate(async () => {
    const service = globalThis.__HALO_SEMANTIC_SERVICE_INITIALIZED__;
    if (!service || typeof service.handleMessage !== 'function') {
      throw new Error('production semantic service status is unavailable');
    }
    const status = await service.handleMessage({ type: 'HALO_DICTIONARY_STATUS' }, {});
    return status && status.networkActivity;
  });
}

function noWorkerNetworkIncrease(before, after, label) {
  assert.deepEqual(after, before, `${label}: worker-lifetime fetch attempts must not increase`);
}

async function invokeCommand(page, worker, url, expectBlocked) {
  await page.bringToFront();
  const tabId = await currentActiveTabId(worker);
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
  assert.equal(status.cleanupPending, false);
  assert.deepEqual(status.remainingArtifacts, { wrapperCount: 0, panelCount: 0 });
  assert.equal(status.boundaryCounters.textRunExtractions, 0);
  assert.equal(status.boundaryCounters.sentenceRecords, 0);
  assert.equal(status.boundaryCounters.selectionReads, 0);
  assert.equal(status.boundaryCounters.semanticMessages, 0);
  assert.equal(status.boundaryCounters.rendererCalls, 0);
  assert.equal(status.boundaryCounters.networkRequests, 0);
  assert.equal(status.boundaryCounterScope.lifetime, 'content-script-lifetime');
  assert.equal(status.boundaryCounterScope.networkRequests, 'observed-worker-fetch-attempts');
  assert.equal(status.boundaryCounterScope.sourceLifetime, 'worker-lifetime');
}

function noNewPrivateWork(before, after) {
  for (const name of ['textRunExtractions', 'sentenceRecords', 'selectionReads', 'semanticMessages', 'networkRequests']) {
    assert.equal(after.boundaryCounters[name], before.boundaryCounters[name], name);
  }
}

function blockedAndClean(status) {
  assert.equal(status.active, false);
  assert.equal(status.markedTokens, 0);
  assert.equal(status.lastError, 'SENSITIVE_PAGE_BLOCKED');
  assert.equal(status.policyDecision.allow, false);
  assert.equal(status.cleanupPending, false);
  assert.deepEqual(status.remainingArtifacts, { wrapperCount: 0, panelCount: 0 });
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
    await installIsolatedInstrumentation(worker);

    const serviceFixture = '<!doctype html><html lang="en"><body><main><p>Public learning text.</p><input id="hostile" autocomplete="off"></main></body></html>';
    await context.route(/^https:\/\/(?:chase\.com|secure\.chase\.com|www\.paypal\.com|vault\.bitwarden\.com|outlook\.live\.com|discord\.com|myaccount\.uhc\.com|secure\.ssa\.gov|console\.aws\.amazon\.com|console\.cloud\.google\.com|portal\.azure\.com)(?:[:/]|$)/u,
      (route) => route.fulfill({ status: 200, contentType: 'text/html', body: serviceFixture }));

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
      const canaryUrl = `http://public.localhost:${port}/public.html`;
      await page.goto(canaryUrl);
      const canaryCommand = await invokeCommand(page, worker, canaryUrl, false);
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/src/popup.html`);
      await popup.waitForSelector('#applyButton:not([disabled])');
      await activateTab(worker, canaryCommand.tabId);
      await popup.click('#applyButton');
      await page.waitForSelector('#lesson [data-halo-owned="token"]');
      const canaryStatus = await statusFor(worker, canaryCommand.tabId);
      assert.ok(canaryStatus.boundaryCounters.networkRequests > 1,
        'allowed lexical marking must observe manifest plus shard fetch attempts');
      assert.equal(canaryStatus.boundaryCounterScope.lifetime, 'content-script-lifetime');
      assert.equal(canaryStatus.boundaryCounterScope.networkRequests, 'observed-worker-fetch-attempts');
      assert.equal(canaryStatus.boundaryCounterScope.sourceLifetime, 'worker-lifetime');
      let sensitiveNetworkBaseline = await workerNetworkActivity(worker);
      assert.equal(sensitiveNetworkBaseline.schemaVersion, 1);
      assert.equal(sensitiveNetworkBaseline.scope, 'worker-lifetime');
      assert.ok(sensitiveNetworkBaseline.fetchAttempts > 1,
        'production worker status must observe the same allowed lexical fetch canary');
      assert.equal(canaryStatus.boundaryCounters.networkRequests, sensitiveNetworkBaseline.fetchAttempts);
      await popup.click('#removeButton');
      await page.waitForFunction(() => document.querySelectorAll('[data-halo-owned]').length === 0);

      const serviceMatrix = [
        ['banking', 'https://chase.com/personal/checking'],
        ['banking', 'https://secure.chase.com/web/auth/dashboard'],
        ['payment-checkout', 'https://www.paypal.com/checkoutnow'],
        ['password-manager', 'https://vault.bitwarden.com/#/vault'],
        ['webmail', 'https://outlook.live.com/mail/0/inbox'],
        ['private-messaging', 'https://discord.com/channels/123/456'],
        ['medical-insurance', 'https://myaccount.uhc.com/member/claims'],
        ['government-personal-data', 'https://secure.ssa.gov/myaccount/'],
        ['developer-secrets', 'https://console.aws.amazon.com/secretsmanager/listsecrets'],
        ['developer-secrets', 'https://console.cloud.google.com/security/secret-manager'],
        ['developer-secrets', 'https://portal.azure.com/#view/Microsoft_Azure_KeyVault/SecretListBlade']
      ];
      for (const [category, url] of serviceMatrix) {
        await page.goto(url);
        const { tabId, status } = await invokeCommand(page, worker, url, true);
        zeroWork(status);
        assert.equal(status.policyDecision.category, category, url);
        assert.deepEqual(await isolatedProbe(worker, tabId), {
          value: 0,
          textContent: 0,
          innerText: 0,
          selection: 0,
          rendererRemoveFailures: 0
        });
        const afterNetwork = await workerNetworkActivity(worker);
        noWorkerNetworkIncrease(sensitiveNetworkBaseline, afterNetwork, url);
        sensitiveNetworkBaseline = afterNetwork;
      }
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
        const { tabId, status } = await invokeCommand(page, worker, url, true);
        zeroWork(status);
        assert.equal(status.policyDecision.category, category, url);
        assert.equal(await page.locator('[data-halo-owned="token"]').count(), 0);
        assert.equal(await page.locator('[data-halo-owned="panel"]').count(), 0);
        assert.deepEqual(await isolatedProbe(worker, tabId), {
          value: 0,
          textContent: 0,
          innerText: 0,
          selection: 0,
          rendererRemoveFailures: 0
        });
        assert.deepEqual(requests, []);
        page.off('request', observeRequest);
        const afterNetwork = await workerNetworkActivity(worker);
        noWorkerNetworkIncrease(sensitiveNetworkBaseline, afterNetwork, url);
        sensitiveNetworkBaseline = afterNetwork;
      }

      const passwordUrl = `http://public.localhost:${port}/fixture.html`;
      await page.goto(passwordUrl);
      await page.evaluate(() => document.getElementById('hostile').setAttribute('type', 'password'));
      const passwordResult = await invokeCommand(page, worker, passwordUrl, true);
      zeroWork(passwordResult.status);
      assert.equal(passwordResult.status.policyDecision.category, 'sensitive-form');
      assert.deepEqual(await isolatedProbe(worker, passwordResult.tabId), {
        value: 0,
        textContent: 0,
        innerText: 0,
        selection: 0,
        rendererRemoveFailures: 0
      });
      const afterPasswordNetwork = await workerNetworkActivity(worker);
      noWorkerNetworkIncrease(sensitiveNetworkBaseline, afterPasswordNetwork, passwordUrl);
      sensitiveNetworkBaseline = afterPasswordNetwork;

      const publicUrl = `http://public.localhost:${port}/public.html`;
      await page.goto(publicUrl);
      const publicCommand = await invokeCommand(page, worker, publicUrl);
      await popup.reload();
      await popup.waitForSelector('#applyButton:not([disabled])');
      await activateTab(worker, publicCommand.tabId);
      await popup.click('#applyButton');
      await page.waitForSelector('#lesson [data-halo-owned="token"]');

      await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = 'dynamic-password';
        document.getElementById('content').appendChild(input);
      });
      await page.waitForTimeout(50);
      assert.ok(await page.locator('#lesson [data-halo-owned="token"]').count() > 0);
      const beforeSensitiveAttribute = await statusFor(worker, publicCommand.tabId);
      const beforeSensitiveWorkerNetwork = await workerNetworkActivity(worker);
      await setIsolatedFlag(worker, publicCommand.tabId, '__HALO_FAIL_RENDERER_REMOVE__', true);
      await page.evaluate(() => {
        document.getElementById('dynamic-password').setAttribute('autocomplete', 'current-password');
      });
      await page.waitForFunction(() => document.querySelectorAll('[data-halo-owned="token"]').length > 0);
      let cleanupFailure;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        cleanupFailure = await statusFor(worker, publicCommand.tabId);
        if (cleanupFailure.cleanupPending) break;
        await page.waitForTimeout(25);
      }
      assert.equal(cleanupFailure.cleanupPending, true);
      assert.ok(cleanupFailure.remainingArtifacts.wrapperCount > 0);
      assert.ok((await isolatedProbe(worker, publicCommand.tabId)).rendererRemoveFailures > 0);
      noNewPrivateWork(beforeSensitiveAttribute, cleanupFailure);

      await setIsolatedFlag(worker, publicCommand.tabId, '__HALO_FAIL_RENDERER_REMOVE__', false);
      await page.evaluate(() => document.getElementById('dynamic-password').setAttribute('role', 'group'));
      await page.waitForFunction(() => document.querySelectorAll('[data-halo-owned]').length === 0);
      const cleanupRetried = await statusFor(worker, publicCommand.tabId);
      blockedAndClean(cleanupRetried);
      noNewPrivateWork(cleanupFailure, cleanupRetried);
      noWorkerNetworkIncrease(
        beforeSensitiveWorkerNetwork,
        await workerNetworkActivity(worker),
        'dynamic sensitive attribute transition'
      );

      await page.evaluate(() => document.getElementById('dynamic-password').remove());
      await page.waitForSelector('#lesson [data-halo-owned="token"]');
      assert.equal((await statusFor(worker, publicCommand.tabId)).lastError, null);
      const beforeInsertedNetwork = await workerNetworkActivity(worker);

      await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = 'inserted-password';
        input.setAttribute('type', 'password');
        document.getElementById('content').appendChild(input);
      });
      await page.waitForFunction(() => document.querySelectorAll('[data-halo-owned]').length === 0);
      blockedAndClean(await statusFor(worker, publicCommand.tabId));
      const afterInsertedNetwork = await workerNetworkActivity(worker);
      noWorkerNetworkIncrease(
        beforeInsertedNetwork,
        afterInsertedNetwork,
        'dynamic sensitive form insertion'
      );
      await page.evaluate(() => document.getElementById('inserted-password').remove());
      await page.waitForSelector('#lesson [data-halo-owned="token"]');
      const beforeSpaNetwork = await workerNetworkActivity(worker);

      await page.evaluate(() => history.pushState({}, '', '/checkout'));
      await page.waitForFunction(() => document.querySelectorAll('[data-halo-owned]').length === 0);
      const spaStatus = await statusFor(worker, publicCommand.tabId);
      blockedAndClean(spaStatus);
      assert.equal(spaStatus.policyDecision.category, 'payment-checkout');
      noWorkerNetworkIncrease(
        beforeSpaNetwork,
        await workerNetworkActivity(worker),
        'public-to-sensitive SPA route'
      );

      await page.goto(publicUrl);
      await invokeCommand(page, worker, publicUrl);
      await activateTab(worker, publicCommand.tabId);
      await popup.reload();
      await popup.waitForSelector('#blockSiteButton:not([disabled])');
      await popup.click('#applyButton');
      await page.waitForSelector('#lesson [data-halo-owned="token"]');
      const beforeDenylistNetwork = await workerNetworkActivity(worker);
      await popup.click('#blockSiteButton');
      await page.waitForFunction(() => document.querySelectorAll('[data-halo-owned]').length === 0);
      const deniedStatus = await statusFor(worker, publicCommand.tabId);
      blockedAndClean(deniedStatus);
      assert.equal(deniedStatus.policyDecision.category, 'user-denylist');
      const deniedWorkerNetwork = await workerNetworkActivity(worker);
      noWorkerNetworkIncrease(
        beforeDenylistNetwork,
        deniedWorkerNetwork,
        'denylist allowed-to-blocked transition'
      );
      sensitiveNetworkBaseline = deniedWorkerNetwork;

      const subdomainUrl = `http://sub.public.localhost:${port}/public.html`;
      await page.goto(subdomainUrl);
      const subdomain = await invokeCommand(page, worker, subdomainUrl, true);
      zeroWork(subdomain.status);
      assert.equal(subdomain.status.policyDecision.category, 'user-denylist');
      const afterSubdomainNetwork = await workerNetworkActivity(worker);
      noWorkerNetworkIncrease(
        sensitiveNetworkBaseline,
        afterSubdomainNetwork,
        'denylist subdomain'
      );
      sensitiveNetworkBaseline = afterSubdomainNetwork;

      const suffixTrickUrl = `http://public.localhost.attacker.localhost:${port}/public.html`;
      await page.goto(suffixTrickUrl);
      const suffixTrick = await invokeCommand(page, worker, suffixTrickUrl, false);
      assert.equal(suffixTrick.status.lastError, null);
      assert.equal(suffixTrick.status.boundaryCounters.selectionReads, 1);
      assert.equal(await page.locator('[data-halo-owned]').count(), 0);
      const afterSuffixTrickNetwork = await workerNetworkActivity(worker);
      noWorkerNetworkIncrease(
        sensitiveNetworkBaseline,
        afterSuffixTrickNetwork,
        'denylist suffix-trick allow decision without marking'
      );
      sensitiveNetworkBaseline = afterSuffixTrickNetwork;

      await page.goto(publicUrl);
      const exactAgain = await invokeCommand(page, worker, publicUrl, true);
      zeroWork(exactAgain.status);
      const afterExactAgainNetwork = await workerNetworkActivity(worker);
      noWorkerNetworkIncrease(
        sensitiveNetworkBaseline,
        afterExactAgainNetwork,
        'denylist exact host on fresh page'
      );
      await activateTab(worker, exactAgain.tabId);
      await popup.reload();
      await popup.waitForSelector('#allowSiteButton:not([disabled])');
      await popup.click('#allowSiteButton');
      await popup.click('#applyButton');
      await page.waitForSelector('#lesson [data-halo-owned="token"]');
      assert.equal((await statusFor(worker, exactAgain.tabId)).cleanupPending, false);
      assert.equal(await page.locator('[data-halo-owned="panel"]').count(), 0);

      await popup.click('#removeButton');
      await page.waitForFunction(() => document.querySelectorAll('[data-halo-owned]').length === 0);
      const beforeStorageFailure = await statusFor(worker, exactAgain.tabId);
      const beforeStorageFailureNetwork = await workerNetworkActivity(worker);
      await setWorkerStorageFailure(worker, true);
      await popup.click('#applyButton');
      let storageFailure;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        storageFailure = await statusFor(worker, exactAgain.tabId);
        if (storageFailure.lastError === 'LOCAL_MARKING_ERROR') break;
        await page.waitForTimeout(25);
      }
      assert.equal(storageFailure.lastError, 'LOCAL_MARKING_ERROR');
      assert.ok(storageFailure.boundaryCounters.semanticMessages > beforeStorageFailure.boundaryCounters.semanticMessages);
      assert.equal(
        storageFailure.boundaryCounters.networkRequests,
        beforeStorageFailure.boundaryCounters.networkRequests,
        'authorization failure must not observe a worker fetch attempt'
      );
      noWorkerNetworkIncrease(
        beforeStorageFailureNetwork,
        await workerNetworkActivity(worker),
        'storage authorization failure'
      );
      assert.equal(await page.locator('[data-halo-owned="token"]').count(), 0);
      await setWorkerStorageFailure(worker, false);
      await popup.waitForSelector('#applyButton:not([disabled])');
      await popup.click('#applyButton');
      await page.waitForSelector('#lesson [data-halo-owned="token"]');

      await popup.waitForSelector('#removeButton:not([disabled])');
      await popup.click('#removeButton');
      await page.waitForFunction(() => document.querySelectorAll('[data-halo-owned]').length === 0);
      const beforeHeldResponse = await statusFor(worker, exactAgain.tabId);
      await setIsolatedFlag(worker, exactAgain.tabId, '__HALO_HOLD_SEMANTIC__', true);
      await popup.waitForSelector('#applyButton:not([disabled])');
      await popup.click('#applyButton');
      let heldResponse;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        heldResponse = await statusFor(worker, exactAgain.tabId);
        if (heldResponse.boundaryCounters.semanticMessages > beforeHeldResponse.boundaryCounters.semanticMessages) break;
        await page.waitForTimeout(25);
      }
      assert.ok(heldResponse.boundaryCounters.semanticMessages > beforeHeldResponse.boundaryCounters.semanticMessages);
      const beforeSensitiveStaleReleaseNetwork = await workerNetworkActivity(worker);
      await page.evaluate(() => history.pushState({}, '', '/checkout'));
      let blockedBeforeRelease;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        blockedBeforeRelease = await statusFor(worker, exactAgain.tabId);
        if (blockedBeforeRelease.lastError === 'SENSITIVE_PAGE_BLOCKED' &&
            blockedBeforeRelease.policyDecision.category === 'payment-checkout') break;
        await page.waitForTimeout(25);
      }
      blockedAndClean(blockedBeforeRelease);
      await releaseHeldSemantic(worker, exactAgain.tabId);
      await page.waitForTimeout(100);
      const afterStaleRelease = await statusFor(worker, exactAgain.tabId);
      blockedAndClean(afterStaleRelease);
      noNewPrivateWork(blockedBeforeRelease, afterStaleRelease);
      noWorkerNetworkIncrease(
        beforeSensitiveStaleReleaseNetwork,
        await workerNetworkActivity(worker),
        'stale response release after sensitive SPA transition'
      );
    });
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
