'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { withFixtureServer } = require('./helpers/fixture-server');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const shared = (name) => path.join(repositoryRoot, 'apps', 'extension', 'src', 'shared', name);

const EXPECTED_STORE_NAMES = [
  'analyses', 'cache', 'events', 'migrations', 'profiles', 'sentences', 'settings', 'sources'
];

test('v0.5 repository opens real IndexedDB and event append is idempotent/append-only', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await withFixtureServer({
      '/idb.html': { contentType: 'text/html', body: '<!doctype html><html><body>Halo IDB fixture</body></html>' }
    }, async ({ origin }) => {
      const page = await browser.newPage();
      await page.goto(`${origin}/idb.html`);
      await page.addScriptTag({ path: shared('dogfood-contracts.js') });
      await page.addScriptTag({ path: shared('dogfood-storage-schema.js') });
      await page.addScriptTag({ path: shared('dogfood-store.js') });

      const result = await page.evaluate(async () => {
        const databaseName = `halo-learning-local-test-${Date.now()}`;
        const store = await HaloDogfoodStore.openHaloDogfoodStore({ indexedDB, databaseName });
        const schema = store.schemaStatus();
        const event = HaloDogfoodContracts.normalizeLearningEvent({
          schema: 'LearningEvent/v1',
          eventId: 'event:idempotent:1',
          timestamp: '2026-08-28T14:00:00.000Z',
          eventType: 'sentence_exposed',
          sessionId: 'session:one',
          sessionPolicyVersion: 'top-level-page-v1',
          sourceRef: 'source:one',
          language: 'en',
          sentenceRef: null,
          sentenceHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          interactionClass: 'passive',
          capturePolicyVersion: 'dogfood-capture-v1',
          profileId: 'halo-default-v0.3.0',
          profileRevision: 1,
          uiContext: { activeChannels: ['posLabel'], density: 0.65, triggerMode: 'hybrid' },
          algorithmVersion: 'halo-semantic-v0.4',
          refersToEventId: null,
          detail: { noteText: null }
        });
        const first = await store.appendEvent(event);
        const second = await store.appendEvent(event);
        const preferences = await store.getSetting('dogfood.preferences');
        const hasUpdateEvent = typeof store.updateEvent;
        store.close();
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase(databaseName);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error('test database deletion blocked'));
        });
        return { schema, first, second, preferences, hasUpdateEvent };
      });

      assert.deepEqual([...result.schema.storeNames].sort(), EXPECTED_STORE_NAMES);
      assert.deepEqual([result.first.status, result.second.status], ['inserted', 'duplicate']);
      assert.equal(result.hasUpdateEvent, 'undefined');
      assert.deepEqual(result.preferences, {
        key: 'dogfood.preferences',
        schemaVersion: 1,
        captureEnabled: true,
        retention: { passiveDays: 30, ordinaryDays: 90, explicitDays: null, dogfoodNoteDays: null }
      });
    });
  } finally {
    await browser.close();
  }
});
