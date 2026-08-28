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

function extensionIdFrom(worker) {
  const match = /^chrome-extension:\/\/([^/]+)\//u.exec(worker.url());
  assert.ok(match, `installed extension worker expected, got ${worker.url()}`);
  return match[1];
}

async function openDashboard(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options.html`);
  await page.waitForSelector('body[data-dashboard-ready="true"]', { timeout: 10000 });
  return page;
}

async function seedPersistentDogfood(page) {
  return page.evaluate(async () => {
    const { service } = HaloDogfoodDashboard;
    const enSource = HaloDogfoodContracts.normalizeSourceRef({
      schema: 'SourceRef/v1', sourceId: 'source:acceptance-en', domain: 'example.com',
      normalizedPathHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      pathNormalizationVersion: 'path-v1', fullUrl: 'https://example.com/read?return=1#saved', language: 'en'
    });
    const enSentence = HaloDogfoodContracts.normalizeSentenceRecord({
      schema: 'SentenceRecord/v1', sentenceId: 'sentence:acceptance-en', text: 'The model learns quickly.', language: 'en',
      textHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', sourceRef: enSource.sourceId,
      captureReason: 'sentence_saved', capturedAt: '2026-08-28T12:00:00.000Z', algorithmVersion: null,
      profileId: null, profileRevision: null
    });
    const enEvent = HaloDogfoodContracts.normalizeLearningEvent({
      schema: 'LearningEvent/v1', eventId: 'event:acceptance-en', timestamp: '2026-08-28T12:00:00.000Z',
      eventType: 'sentence_saved', sessionId: 'session:acceptance-en', sessionPolicyVersion: 'top-level-page-v1',
      sourceRef: enSource.sourceId, language: 'en', sentenceRef: enSentence.sentenceId, sentenceHash: enSentence.textHash,
      interactionClass: 'explicit-learning', capturePolicyVersion: 'dogfood-capture-v1', profileId: null, profileRevision: null,
      uiContext: null, algorithmVersion: null, refersToEventId: null, detail: { noteText: null }
    });
    await service.persistCapture({ source: enSource, event: enEvent, sentenceRecord: enSentence });

    const zhSource = HaloDogfoodContracts.normalizeSourceRef({
      schema: 'SourceRef/v1', sourceId: 'source:acceptance-zh', domain: 'zh.example',
      normalizedPathHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      pathNormalizationVersion: 'path-v1', fullUrl: null, language: 'zh-Hant'
    });
    const zhEvent = HaloDogfoodContracts.normalizeLearningEvent({
      schema: 'LearningEvent/v1', eventId: 'event:acceptance-zh', timestamp: '2026-08-29T12:00:00.000Z',
      eventType: 'sentence_exposed', sessionId: 'session:acceptance-zh', sessionPolicyVersion: 'top-level-page-v1',
      sourceRef: zhSource.sourceId, language: 'zh-Hant', sentenceRef: null,
      sentenceHash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      interactionClass: 'passive', capturePolicyVersion: 'dogfood-capture-v1', profileId: null, profileRevision: null,
      uiContext: null, algorithmVersion: null, refersToEventId: null, detail: { noteText: null }
    });
    await service.persistCapture({ source: zhSource, event: zhEvent, sentenceRecord: null });
    await service.createStandaloneNote('Persistent browser dogfood note.');
    await HaloDogfoodDashboard.refresh();
    const replay = await service.replay();
    const data = await HaloDogfoodDashboard.repository.readReplayDataset();
    return {
      hash: replay.report.projectionHash,
      eventTypes: data.events.map((event) => event.eventType),
      languages: data.events.map((event) => event.language),
      sentences: data.sentences.map((sentence) => sentence.text),
      noteText: replay.projection.notes.map((note) => note.text),
      overview: replay.projection.overview
    };
  });
}

async function readDashboardState(page) {
  return page.evaluate(async () => {
    const replay = await HaloDogfoodDashboard.service.replay();
    const data = await HaloDogfoodDashboard.repository.readReplayDataset();
    return {
      hash: replay.report.projectionHash,
      events: data.events,
      sentences: data.sentences,
      notes: replay.projection.notes,
      overview: replay.projection.overview
    };
  });
}

async function invokeCommand(page, expectPanel) {
  await page.evaluate(() => {
    const lesson = document.getElementById('lesson');
    const range = document.createRange();
    range.selectNodeContents(lesson);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.bringToFront();
  await page.keyboard.press('Alt+Shift+H');
  const panel = page.locator('[data-halo-owned="panel"]').locator('.halo-core-panel');
  if (expectPanel) {
    await panel.waitFor({ state: 'visible', timeout: 10000 });
    await page.keyboard.press('Escape');
    await page.locator('[data-halo-owned="panel"]').waitFor({ state: 'detached', timeout: 5000 });
  } else {
    await page.waitForTimeout(300);
  }
}

async function activeTabId(extensionPage, page) {
  await page.bringToFront();
  return extensionPage.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !Number.isInteger(tab.id)) throw new Error('active tab unavailable');
    return tab.id;
  });
}

async function directApply(extensionPage, tabId) {
  return extensionPage.evaluate(async (id) => {
    const stored = await chrome.storage.local.get('haloSettings');
    const settings = HaloSettings.migrateSettings(stored && stored.haloSettings);
    await HaloBrowserEntry.injectPackagedRuntime({ chrome, tabId: id });
    return chrome.tabs.sendMessage(id, { type: 'HALO_APPLY_MARKING', settings });
  }, tabId);
}

async function directRemove(extensionPage, tabId) {
  return extensionPage.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'HALO_REMOVE_MARKING' }), tabId);
}

test('v0.5 dogfood persists through full browser restart and deterministic replay survives before scoped deletes', async () => {
  const executable = resolveChromiumExecutable({ environment: process.env, exists: fs.existsSync, playwrightExecutable: chromium.executablePath() });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-v050-persistent-'));
  let context = null;
  try {
    context = await launchExtension({ extensionRoot, userDataDir, headless: true, executablePath: executable.path });
    let worker = await extensionWorker(context);
    const extensionId = extensionIdFrom(worker);
    const dashboard = await openDashboard(context, extensionId);
    const before = await seedPersistentDogfood(dashboard);
    assert.ok(before.eventTypes.includes('sentence_saved'));
    assert.ok(before.languages.includes('zh-Hant'));
    assert.ok(before.sentences.includes('The model learns quickly.'));
    assert.ok(before.noteText.includes('Persistent browser dogfood note.'));
    const beforeHash = before.hash;
    await context.close();
    context = null;

    context = await launchExtension({ extensionRoot, userDataDir, headless: true, executablePath: executable.path });
    worker = await extensionWorker(context);
    assert.equal(extensionIdFrom(worker), extensionId, 'same unpacked extension should keep the same extension origin');
    const reopened = await openDashboard(context, extensionId);
    const after = await readDashboardState(reopened);
    assert.equal(after.hash, beforeHash, 'replay projection hash must survive a full Chromium restart');
    assert.ok(after.events.some((event) => event.language === 'en'));
    assert.ok(after.events.some((event) => event.language === 'zh-Hant'));
    assert.ok(after.sentences.some((sentence) => sentence.text === 'The model learns quickly.'));
    assert.ok(after.notes.some((note) => note.text === 'Persistent browser dogfood note.'));
    assert.equal(Number(await reopened.getByTestId('overview-event-count').textContent()), after.overview.eventCount);

    await reopened.evaluate(async () => {
      await HaloDogfoodDashboard.service.deleteByScope({ kind: 'domain', domain: 'example.com' });
      await HaloDogfoodDashboard.refresh();
    });
    let deleted = await readDashboardState(reopened);
    assert.equal(deleted.events.some((event) => event.sourceRef === 'source:acceptance-en'), false);
    assert.equal(deleted.events.some((event) => event.sourceRef === 'source:acceptance-zh'), true);

    await reopened.evaluate(async () => {
      await HaloDogfoodDashboard.service.deleteByScope({
        kind: 'time-range', from: '2026-08-29T00:00:00.000Z', to: '2026-08-29T23:59:59.999Z'
      });
      await HaloDogfoodDashboard.refresh();
    });
    deleted = await readDashboardState(reopened);
    assert.equal(deleted.events.some((event) => event.sourceRef === 'source:acceptance-zh'), false);

    await reopened.evaluate(async () => {
      await HaloDogfoodDashboard.service.createStandaloneNote('Delete-all sentinel note.');
      await HaloDogfoodDashboard.service.deleteByScope({ kind: 'all-dogfood' });
      await HaloDogfoodDashboard.refresh();
    });
    deleted = await readDashboardState(reopened);
    assert.equal(deleted.events.length, 0);
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('dogfood storage degradation never becomes a marking or Remove dependency and never falls back to remote fetch', async () => {
  const executable = resolveChromiumExecutable({ environment: process.env, exists: fs.existsSync, playwrightExecutable: chromium.executablePath() });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-v050-degraded-'));
  let context;
  try {
    context = await launchExtension({ extensionRoot, userDataDir, headless: true, executablePath: executable.path });
    const worker = await extensionWorker(context);
    const extensionId = extensionIdFrom(worker);
    const degradedProbe = await worker.evaluate(() => {
      globalThis.__haloDogfoodFetches = 0;
      const originalFetch = globalThis.fetch;
      if (typeof originalFetch === 'function') {
        globalThis.fetch = function () {
          globalThis.__haloDogfoodFetches += 1;
          return originalFetch.apply(this, arguments);
        };
      }
      const originalOpen = indexedDB.open.bind(indexedDB);
      globalThis.__haloOriginalIndexedDBOpen = originalOpen;
      indexedDB.open = function () { throw new Error('forced dogfood IndexedDB open failure'); };
      return true;
    });
    assert.equal(degradedProbe, true);

    await withFixtureServer({
      '/ordinary.html': { contentType: 'text/html', body: '<!doctype html><html lang="en"><body><main><p id="lesson">The model learns quickly.</p></main></body></html>' },
      '/sensitive.html': { contentType: 'text/html', body: '<!doctype html><html lang="en"><body><main><p id="lesson">Private account sentence.</p><input type="password"></main></body></html>' }
    }, async ({ origin }) => {
      const page = await context.newPage();
      await page.goto(`${origin}/ordinary.html`);
      await invokeCommand(page, true);
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/src/popup.html`);
      await popup.waitForSelector('#applyButton:not([disabled])');
      const tabId = await activeTabId(popup, page);
      const applied = await directApply(popup, tabId);
      assert.equal(applied.lastError, null, 'marking path must remain healthy when dogfood storage is unavailable');
      await page.waitForSelector('#lesson [data-halo-owned="token"]', { timeout: 10000 });
      const degraded = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'HALO_DOGFOOD_STATUS' }));
      assert.equal(degraded.mode, 'storage-degraded');
      assert.equal(degraded.lastErrorCode, 'INDEXEDDB_UNAVAILABLE');
      const textBeforeRemove = await page.locator('#lesson').textContent();
      await directRemove(popup, tabId);
      await page.waitForSelector('#lesson [data-halo-owned="token"]', { state: 'detached', timeout: 10000 });
      assert.equal(await page.locator('#lesson').textContent(), textBeforeRemove);
      const fetches = await worker.evaluate(() => globalThis.__haloDogfoodFetches || 0);
      assert.equal(fetches, 0, 'dogfood storage failure must not trigger a remote fallback');
    });
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
