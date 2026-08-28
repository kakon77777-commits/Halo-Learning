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
    if (globalThis.__haloProductSecurityInstrumentedExecuteScript) return true;
    const original = chrome.scripting.executeScript.bind(chrome.scripting);
    const wrapped = async (details) => {
      if (Array.isArray(details && details.files) && details.files.includes('src/content.js')) {
        await original({
          target: details.target,
          world: 'ISOLATED',
          func: () => {
            if (globalThis.__HALO_PRODUCT_SECURITY_PROBE__) return;
            globalThis.__HALO_PRODUCT_SECURITY_PROBE__ = {
              value: 0,
              textContent: 0,
              innerText: 0,
              selection: 0
            };
            const hostile = document.getElementById('hostile');
            if (hostile) {
              for (const name of ['value', 'textContent', 'innerText']) {
                Object.defineProperty(hostile, name, {
                  configurable: true,
                  get() {
                    globalThis.__HALO_PRODUCT_SECURITY_PROBE__[name] += 1;
                    throw new Error(`forbidden ${name} read`);
                  }
                });
              }
            }
            const nativeSelection = globalThis.getSelection;
            globalThis.getSelection = function () {
              globalThis.__HALO_PRODUCT_SECURITY_PROBE__.selection += 1;
              return nativeSelection.call(this);
            };
          }
        });
      }
      return original(details);
    };
    chrome.scripting.executeScript = wrapped;
    globalThis.__haloProductSecurityInstrumentedExecuteScript = true;
    return chrome.scripting.executeScript === wrapped;
  });
  assert.equal(installed, true, 'product-security instrumentation must install before Halo files');
}

async function isolatedProbe(worker, tabId) {
  const [result] = await worker.evaluate(async (id) => chrome.scripting.executeScript({
    target: { tabId: id },
    world: 'ISOLATED',
    func: () => globalThis.__HALO_PRODUCT_SECURITY_PROBE__ || null
  }), tabId);
  return result && result.result;
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

async function invokeBlockedCommand(page, worker) {
  await page.bringToFront();
  const tabId = await currentActiveTabId(worker);
  await page.keyboard.press('Alt+Shift+H');
  let status = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    status = await statusFor(worker, tabId);
    if (status.lastError === 'SENSITIVE_PAGE_BLOCKED') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { tabId, status };
}

function assertZeroPrivateWork(status, category, label) {
  assert.equal(status.active, false, `${label}: runtime must stay inactive`);
  assert.equal(status.textNodesVisited, 0, `${label}: text extraction must not start`);
  assert.equal(status.semanticTokens, 0, `${label}: semantic work must not start`);
  assert.equal(status.markedTokens, 0, `${label}: rendering must not start`);
  assert.equal(Object.hasOwn(status, 'sentences'), false, `${label}: sentence payload must not exist`);
  assert.equal(Object.hasOwn(status, 'selection'), false, `${label}: selection payload must not exist`);
  assert.equal(status.lastError, 'SENSITIVE_PAGE_BLOCKED', `${label}: must fail closed`);
  assert.equal(status.policyDecision.allow, false, `${label}: policy must deny`);
  assert.equal(status.policyDecision.category, category, `${label}: category mismatch`);
  assert.equal(status.cleanupPending, false, `${label}: cleanup must be complete`);
  assert.deepEqual(status.remainingArtifacts, { wrapperCount: 0, panelCount: 0 }, `${label}: no UI residue`);
  assert.equal(status.boundaryCounters.textRunExtractions, 0, `${label}: text-run boundary must stay zero`);
  assert.equal(status.boundaryCounters.sentenceRecords, 0, `${label}: sentence boundary must stay zero`);
  assert.equal(status.boundaryCounters.selectionReads, 0, `${label}: selection boundary must stay zero`);
  assert.equal(status.boundaryCounters.semanticMessages, 0, `${label}: semantic boundary must stay zero`);
  assert.equal(status.boundaryCounters.rendererCalls, 0, `${label}: renderer boundary must stay zero`);
  assert.equal(status.boundaryCounters.networkRequests, 0, `${label}: content lifetime network delta must stay zero`);
}

function assertProbeUntouched(probe, label) {
  assert.deepEqual(probe, {
    value: 0,
    textContent: 0,
    innerText: 0,
    selection: 0
  }, `${label}: private DOM/selection probe must remain untouched`);
}

function assertNoWorkerNetworkIncrease(before, after, label) {
  assert.deepEqual(after, before, `${label}: worker fetch activity must not increase`);
}

test('v0.4 product security: installed MV3 fails closed on sensitive sites before private extraction', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  assert.equal(Object.hasOwn(manifest, 'host_permissions'), false, 'canonical v0.4 manifest must remain host-permission-free');
  assert.deepEqual(manifest.permissions, ['activeTab', 'contextMenus', 'scripting', 'storage']);

  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-b03-product-security-'));
  let context;
  try {
    context = await launchExtension({ extensionRoot, userDataDir, headless: true, executablePath: executable.path });
    const worker = await extensionWorker(context);
    assert.match(worker.url(), /^chrome-extension:\/\/[^/]+\/src\/service-worker\.js$/u);
    await installIsolatedInstrumentation(worker);

    const sensitiveDocument = '<!doctype html><html lang="en"><body><main><p>PRIVATE_SENTINEL_B03</p><input id="hostile" autocomplete="off"></main></body></html>';
    await context.route(/^https:\/\/(?:chase\.com|www\.paypal\.com|vault\.bitwarden\.com|outlook\.live\.com|discord\.com|myaccount\.uhc\.com|secure\.ssa\.gov|console\.aws\.amazon\.com|console\.cloud\.google\.com|portal\.azure\.com)(?:[:/]|$)/u,
      (route) => route.fulfill({ status: 200, contentType: 'text/html', body: sensitiveDocument }));

    await withFixtureServer({
      '/fixture.html': { contentType: 'text/html', body: sensitiveDocument },
      '/login': { contentType: 'text/html', body: sensitiveDocument },
      '/personal-data': { contentType: 'text/html', body: sensitiveDocument },
      '/secrets': { contentType: 'text/html', body: sensitiveDocument }
    }, async ({ port }) => {
      const page = await context.newPage();
      let networkBaseline = await workerNetworkActivity(worker);
      assert.equal(networkBaseline.schemaVersion, 1);
      assert.equal(networkBaseline.scope, 'worker-lifetime');

      const serviceMatrix = [
        ['banking', 'https://chase.com/personal/checking'],
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
        const { tabId, status } = await invokeBlockedCommand(page, worker);
        assertZeroPrivateWork(status, category, url);
        assert.equal(JSON.stringify(status).includes('PRIVATE_SENTINEL_B03'), false, `${url}: status must not expose private content`);
        assertProbeUntouched(await isolatedProbe(worker, tabId), url);
        assert.equal(await page.locator('[data-halo-owned]').count(), 0, `${url}: Halo DOM artifacts must stay absent`);
        const after = await workerNetworkActivity(worker);
        assertNoWorkerNetworkIncrease(networkBaseline, after, url);
        networkBaseline = after;
      }

      const localMatrix = [
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

      for (const [category, url] of localMatrix) {
        await page.goto(url);
        const { tabId, status } = await invokeBlockedCommand(page, worker);
        assertZeroPrivateWork(status, category, url);
        assert.equal(JSON.stringify(status).includes('PRIVATE_SENTINEL_B03'), false, `${url}: status must not expose private content`);
        assertProbeUntouched(await isolatedProbe(worker, tabId), url);
        assert.equal(await page.locator('[data-halo-owned]').count(), 0, `${url}: Halo DOM artifacts must stay absent`);
        const after = await workerNetworkActivity(worker);
        assertNoWorkerNetworkIncrease(networkBaseline, after, url);
        networkBaseline = after;
      }

      const passwordUrl = `http://public.localhost:${port}/fixture.html`;
      await page.goto(passwordUrl);
      await page.evaluate(() => document.getElementById('hostile').setAttribute('type', 'password'));
      const password = await invokeBlockedCommand(page, worker);
      assertZeroPrivateWork(password.status, 'sensitive-form', passwordUrl);
      assert.equal(JSON.stringify(password.status).includes('PRIVATE_SENTINEL_B03'), false, 'password form status must not expose private content');
      assertProbeUntouched(await isolatedProbe(worker, password.tabId), passwordUrl);
      assert.equal(await page.locator('[data-halo-owned]').count(), 0);
      assertNoWorkerNetworkIncrease(networkBaseline, await workerNetworkActivity(worker), passwordUrl);
    });
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
