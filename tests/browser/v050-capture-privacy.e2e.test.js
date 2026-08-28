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

async function activateFixture(extensionPage, origin) {
  return extensionPage.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url: `${url}/*` });
    if (!tabs.length || !Number.isInteger(tabs[0].id)) throw new Error('fixture tab unavailable');
    await chrome.tabs.update(tabs[0].id, { active: true });
    return tabs[0].id;
  }, origin);
}

async function selectLesson(page) {
  await page.evaluate(() => {
    const lesson = document.getElementById('lesson');
    if (!lesson) throw new Error('lesson fixture unavailable');
    const range = document.createRange();
    range.selectNodeContents(lesson);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

async function grantActiveTab(page) {
  await selectLesson(page);
  await page.bringToFront();
  await page.keyboard.press('Alt+Shift+H');
  const panel = page.locator('[data-halo-owned="panel"]').locator('.halo-core-panel');
  try {
    await panel.waitFor({ state: 'visible', timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.locator('[data-halo-owned="panel"]').waitFor({ state: 'detached', timeout: 5000 });
  } catch (_error) {
    // Sensitive pages intentionally fail closed and therefore may not open a panel.
  }
}

async function directApply(extensionPage, tabId) {
  return extensionPage.evaluate(async (targetTabId) => {
    const stored = await chrome.storage.local.get('haloSettings');
    const settings = HaloSettings.migrateSettings(stored && stored.haloSettings);
    await HaloBrowserEntry.injectPackagedRuntime({ chrome, tabId: targetTabId });
    return chrome.tabs.sendMessage(targetTabId, { type: 'HALO_APPLY_MARKING', settings });
  }, tabId);
}

async function removeMarking(extensionPage, tabId) {
  return extensionPage.evaluate(
    (targetTabId) => chrome.tabs.sendMessage(targetTabId, { type: 'HALO_REMOVE_MARKING' }),
    tabId
  );
}

async function readDogfoodDataset(worker) {
  return worker.evaluate(async () => {
    const name = globalThis.HaloDogfoodStorageSchema && HaloDogfoodStorageSchema.DATABASE_NAME;
    if (!name) throw new Error('dogfood storage schema is unavailable in installed worker');
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('dogfood database open failed'));
      request.onblocked = () => reject(new Error('dogfood database open blocked'));
    });
    try {
      const transaction = database.transaction(['events', 'sources', 'sentences'], 'readonly');
      const readAll = (storeName) => new Promise((resolve, reject) => {
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error || new Error(`${storeName} read failed`));
      });
      const [events, sources, sentences] = await Promise.all([
        readAll('events'), readAll('sources'), readAll('sentences')
      ]);
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error || new Error('dogfood read transaction aborted'));
        transaction.onerror = () => {};
      });
      return { events, sources, sentences };
    } finally {
      database.close();
    }
  });
}

async function waitForDataset(worker, predicate, message, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await readDogfoodDataset(worker);
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${message}; latest=${JSON.stringify(latest)}`);
}

function eventCount(dataset, type, language) {
  return dataset.events.filter((event) => event && event.eventType === type &&
    (language === undefined || event.language === language)).length;
}

function eventOf(dataset, type, language) {
  return dataset.events.find((event) => event && event.eventType === type &&
    (language === undefined || event.language === language)) || null;
}

function sourceForEvent(dataset, event) {
  return event && dataset.sources.find((source) => source.sourceId === event.sourceRef) || null;
}

test('v0.5 installed dogfood capture is durable, privacy-minimized, explicit-retention-only, bilingual, and fail-closed', async () => {
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-v050-capture-privacy-'));
  let context;
  try {
    context = await launchExtension({ extensionRoot, userDataDir, headless: true, executablePath: executable.path });
    const worker = await extensionWorker(context);
    const match = /^chrome-extension:\/\/([^/]+)\//u.exec(worker.url());
    assert.ok(match, `real installed extension worker expected, got ${worker.url()}`);
    const extensionId = match[1];

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup.html`);
    await popup.waitForSelector('#applyButton:not([disabled])');
    const dogfoodStatus = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'HALO_DOGFOOD_STATUS' }));
    assert.equal(dogfoodStatus.schemaVersion, 1);
    assert.equal(dogfoodStatus.captureEnabled, true);

    await withFixtureServer({
      '/allowed-en.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><body><main><p id="lesson">The model learns quickly.</p></main></body></html>'
      },
      '/allowed-zh.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="zh-Hant"><body><main><p id="lesson">模型正在快速學習。</p></main></body></html>'
      },
      '/sensitive.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><body><main><p id="lesson">Private account sentence.</p><input type="password" value="secret"></main></body></html>'
      }
    }, async ({ origin }) => {
      const page = await context.newPage();

      const enUrl = `${origin}/allowed-en.html?token=secret-query#private-fragment`;
      await page.goto(enUrl);
      await grantActiveTab(page);
      let tabId = await activateFixture(popup, origin);
      const enApply = await directApply(popup, tabId);
      assert.equal(enApply.policyDecision.allow, true);
      await page.waitForSelector('#lesson [data-halo-owned="token"]', { timeout: 10000 });

      const passive = await waitForDataset(
        worker,
        (dataset) => eventCount(dataset, 'halo_applied') >= 1 && eventCount(dataset, 'sentence_exposed', 'en') === 1,
        'allowed English Apply/exposure did not reach durable IndexedDB'
      );
      assert.equal(passive.sentences.length, 0, 'passive exposure must not retain sentence text');
      const exposure = eventOf(passive, 'sentence_exposed', 'en');
      assert.ok(exposure);
      assert.equal(exposure.interactionClass, 'passive');
      assert.equal(exposure.sentenceRef, null);
      const ordinarySource = sourceForEvent(passive, exposure);
      assert.ok(ordinarySource);
      assert.equal(ordinarySource.fullUrl, null, 'ordinary observation must not retain the full URL');
      assert.equal(ordinarySource.domain, '127.0.0.1');
      assert.doesNotMatch(JSON.stringify(ordinarySource), /secret-query|private-fragment/);

      const token = page.locator('#lesson [data-halo-owned="token"]').first();
      await token.click();
      const saveButton = page.locator('[data-halo-owned="panel"] [data-halo-action="save-sentence"]');
      const noteButton = page.locator('[data-halo-owned="panel"] [data-halo-action="dogfood-note"]');
      await saveButton.waitFor({ state: 'visible', timeout: 5000 });
      await noteButton.waitFor({ state: 'visible', timeout: 5000 });
      await saveButton.click();
      await noteButton.click();
      const noteInput = page.locator('[data-halo-owned="panel"] .halo-dogfood-note-input');
      await noteInput.fill('The tense marker is noisy on this sentence.');
      await page.locator('[data-halo-owned="panel"] [data-halo-note-save]').click();

      const explicit = await waitForDataset(
        worker,
        (dataset) => eventCount(dataset, 'sentence_saved', 'en') >= 1 &&
          eventCount(dataset, 'dogfood_note_created', 'en') >= 1 && dataset.sentences.length >= 1,
        'explicit Save/Note did not reach durable IndexedDB'
      );
      assert.ok(explicit.events.some((event) => ['gloss_opened', 'explanation_opened'].includes(event.eventType)),
        'explicit token open must be observed');
      const saved = eventOf(explicit, 'sentence_saved', 'en');
      const note = eventOf(explicit, 'dogfood_note_created', 'en');
      assert.ok(saved && saved.sentenceRef, 'Save Sentence must retain a SentenceRecord reference');
      assert.ok(note && note.sentenceRef, 'contextual Dogfood Note must retain a SentenceRecord reference');
      assert.equal(note.detail.noteText, 'The tense marker is noisy on this sentence.');
      const sentence = explicit.sentences.find((value) => value.sentenceId === saved.sentenceRef);
      assert.ok(sentence);
      assert.equal(sentence.text, 'The model learns quickly.');
      const explicitSource = sourceForEvent(explicit, saved);
      assert.ok(explicitSource);
      assert.equal(explicitSource.fullUrl, enUrl, 'explicit return action may retain the exact local URL');

      await removeMarking(popup, tabId);
      await waitForDataset(worker, (dataset) => eventCount(dataset, 'halo_removed') >= 1,
        'allowed user Remove was not captured');

      const zhUrl = `${origin}/allowed-zh.html?view=1#zh-fragment`;
      await page.goto(zhUrl);
      await grantActiveTab(page);
      tabId = await activateFixture(popup, origin);
      const zhApply = await directApply(popup, tabId);
      assert.equal(zhApply.policyDecision.allow, true);
      await page.waitForSelector('#lesson [data-halo-owned="token"]', { timeout: 10000 });
      await waitForDataset(
        worker,
        (dataset) => eventCount(dataset, 'sentence_exposed', 'zh-Hant') >= 1,
        'allowed Traditional Chinese exposure did not reach durable IndexedDB'
      );

      let stable = await readDogfoodDataset(worker);
      await new Promise((resolve) => setTimeout(resolve, 250));
      stable = await waitForDataset(
        worker,
        (dataset) => dataset.events.length === stable.events.length,
        'dogfood event stream did not settle before sensitive-site check',
        3000
      );
      const eventCountBeforeSensitive = stable.events.length;

      const sensitiveUrl = `${origin}/sensitive.html`;
      await page.goto(sensitiveUrl);
      await grantActiveTab(page);
      tabId = await activateFixture(popup, origin);
      const blocked = await directApply(popup, tabId);
      assert.equal(blocked.policyDecision.allow, false);
      assert.equal(blocked.policyDecision.category, 'sensitive-form');
      await new Promise((resolve) => setTimeout(resolve, 500));
      const afterSensitive = await readDogfoodDataset(worker);
      assert.equal(afterSensitive.events.length, eventCountBeforeSensitive,
        'sensitive page must produce zero dogfood events');
      assert.equal(await page.locator('[data-halo-owned="token"]').count(), 0,
        'sensitive page must produce zero Halo marking artifacts');
    });
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
