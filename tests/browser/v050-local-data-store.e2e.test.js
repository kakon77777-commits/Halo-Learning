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

async function withIdbPage(callback) {
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
      await callback(page);
    });
  } finally {
    await browser.close();
  }
}

async function deleteDatabase(page, databaseName) {
  await page.evaluate(async (name) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('test database deletion blocked'));
    });
  }, databaseName);
}

test('v0.5 repository opens real IndexedDB and event append is idempotent/append-only', async () => {
  await withIdbPage(async (page) => {
    const databaseName = `halo-learning-local-test-${Date.now()}`;
    const result = await page.evaluate(async (name) => {
      const store = await HaloDogfoodStore.openHaloDogfoodStore({ indexedDB, databaseName: name });
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
      return { schema, first, second, preferences, hasUpdateEvent };
    }, databaseName);

    assert.deepEqual([...result.schema.storeNames].sort(), EXPECTED_STORE_NAMES);
    assert.deepEqual([result.first.status, result.second.status], ['inserted', 'duplicate']);
    assert.equal(result.hasUpdateEvent, 'undefined');
    assert.deepEqual(result.preferences, {
      key: 'dogfood.preferences',
      schemaVersion: 1,
      captureEnabled: true,
      retention: { passiveDays: 30, ordinaryDays: 90, explicitDays: null, dogfoodNoteDays: null }
    });
    await deleteDatabase(page, databaseName);
  });
});

test('v0.5 cache is versioned/expiring and retention prunes only bounded interaction classes with orphan GC', async () => {
  await withIdbPage(async (page) => {
    const databaseName = `halo-learning-local-retention-${Date.now()}`;
    const result = await page.evaluate(async (name) => {
      const nowMs = Date.parse('2026-08-28T12:00:00.000Z');
      const store = await HaloDogfoodStore.openHaloDogfoodStore({
        indexedDB,
        databaseName: name,
        now: () => nowMs
      });

      const textHash = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
      const contextHash = 'sha256:2222222222222222222222222222222222222222222222222222222222222222';
      const keyV1 = HaloDogfoodStore.cacheKeyFor(textHash, contextHash, 'algo-v1');
      const keyV2 = HaloDogfoodStore.cacheKeyFor(textHash, contextHash, 'algo-v2');
      await store.putCache(HaloDogfoodContracts.normalizeAnalysisCacheEntry({
        schema: 'AnalysisCacheEntry/v1',
        cacheKey: keyV1,
        textHash,
        contextHash,
        algorithmVersion: 'algo-v1',
        createdAt: '2026-08-28T11:00:00.000Z',
        expiresAt: '2026-08-28T13:00:00.000Z',
        value: { tokenCount: 3 }
      }));
      await store.putCache(HaloDogfoodContracts.normalizeAnalysisCacheEntry({
        schema: 'AnalysisCacheEntry/v1',
        cacheKey: HaloDogfoodStore.cacheKeyFor(textHash, contextHash, 'algo-expired'),
        textHash,
        contextHash,
        algorithmVersion: 'algo-expired',
        createdAt: '2026-08-28T10:00:00.000Z',
        expiresAt: '2026-08-28T11:00:00.000Z',
        value: { tokenCount: 1 }
      }));
      const cacheHit = await store.getCache({ textHash, contextHash, algorithmVersion: 'algo-v1' });
      const versionMiss = await store.getCache({ textHash, contextHash, algorithmVersion: 'algo-v2' });
      const expiredMiss = await store.getCache({ textHash, contextHash, algorithmVersion: 'algo-expired' });

      const sourceOld = HaloDogfoodContracts.normalizeSourceRef({
        schema: 'SourceRef/v1', sourceId: 'source:old', domain: 'old.example.com',
        normalizedPathHash: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
        pathNormalizationVersion: 'path-v1', fullUrl: null, language: 'en'
      });
      const sourceKeep = HaloDogfoodContracts.normalizeSourceRef({
        schema: 'SourceRef/v1', sourceId: 'source:keep', domain: 'keep.example.com',
        normalizedPathHash: 'sha256:4444444444444444444444444444444444444444444444444444444444444444',
        pathNormalizationVersion: 'path-v1', fullUrl: null, language: 'en'
      });
      await store.putSource(sourceOld);
      await store.putSource(sourceKeep);

      const sentenceOld = HaloDogfoodContracts.normalizeSentenceRecord({
        schema: 'SentenceRecord/v1', sentenceId: 'sentence:old', text: 'Old orphan.', language: 'en',
        textHash: 'sha256:5555555555555555555555555555555555555555555555555555555555555555',
        sourceRef: 'source:old', captureReason: 'sentence_saved', capturedAt: '2026-04-01T00:00:00.000Z',
        algorithmVersion: 'halo-semantic-v0.4', profileId: 'halo-default-v0.3.0', profileRevision: 1
      });
      const sentenceKeep = HaloDogfoodContracts.normalizeSentenceRecord({
        schema: 'SentenceRecord/v1', sentenceId: 'sentence:keep', text: 'Keep this.', language: 'en',
        textHash: 'sha256:6666666666666666666666666666666666666666666666666666666666666666',
        sourceRef: 'source:keep', captureReason: 'sentence_saved', capturedAt: '2026-01-01T00:00:00.000Z',
        algorithmVersion: 'halo-semantic-v0.4', profileId: 'halo-default-v0.3.0', profileRevision: 1
      });
      await store.putSentence(sentenceOld);
      await store.putSentence(sentenceKeep);
      await store.putAnalysis({ analysisId: 'analysis:old', sourceRef: 'source:old', sentenceRef: 'sentence:old', createdAt: '2026-04-01T00:00:00.000Z' });
      await store.putAnalysis({ analysisId: 'analysis:keep', sourceRef: 'source:keep', sentenceRef: 'sentence:keep', createdAt: '2026-01-01T00:00:00.000Z' });

      const makeEvent = (eventId, timestamp, eventType, interactionClass, sourceRef, sentenceRef = null, noteText = null) =>
        HaloDogfoodContracts.normalizeLearningEvent({
          schema: 'LearningEvent/v1', eventId, timestamp, eventType,
          sessionId: 'session:retention', sessionPolicyVersion: 'top-level-page-v1',
          sourceRef, language: 'en', sentenceRef,
          sentenceHash: sentenceRef === 'sentence:keep'
            ? 'sha256:6666666666666666666666666666666666666666666666666666666666666666'
            : null,
          interactionClass, capturePolicyVersion: 'dogfood-capture-v1',
          profileId: 'halo-default-v0.3.0', profileRevision: 1,
          uiContext: { activeChannels: ['posLabel'], density: 0.65, triggerMode: 'hybrid' },
          algorithmVersion: 'halo-semantic-v0.4', refersToEventId: null,
          detail: { noteText }
        });

      await store.appendEvent(makeEvent('event:passive:old', '2026-07-01T00:00:00.000Z', 'sentence_exposed', 'passive', 'source:old'));
      await store.appendEvent(makeEvent('event:ordinary:old', '2026-04-01T00:00:00.000Z', 'halo_applied', 'ordinary', 'source:old'));
      await store.appendEvent(makeEvent('event:explicit:keep', '2026-01-01T00:00:00.000Z', 'sentence_saved', 'explicit-learning', 'source:keep', 'sentence:keep'));
      await store.appendEvent(makeEvent('event:note:keep', '2026-01-02T00:00:00.000Z', 'dogfood_note_created', 'dogfood-note', 'source:keep', null, 'Keep this note.'));

      const pruned = await store.pruneRetention();
      const dataset = await store.readReplayDataset();
      store.close();
      return {
        keyV1,
        keyV2,
        cacheHit,
        versionMiss,
        expiredMiss,
        pruned,
        eventIds: dataset.events.map((item) => item.eventId).sort(),
        sourceIds: dataset.sources.map((item) => item.sourceId).sort(),
        sentenceIds: dataset.sentences.map((item) => item.sentenceId).sort(),
        analysisIds: dataset.analyses.map((item) => item.analysisId).sort()
      };
    }, databaseName);

    assert.notEqual(result.keyV1, result.keyV2);
    assert.equal(result.cacheHit.value.tokenCount, 3);
    assert.equal(result.versionMiss, null);
    assert.equal(result.expiredMiss, null);
    assert.equal(result.pruned.deleted.events, 2);
    assert.deepEqual(result.eventIds, ['event:explicit:keep', 'event:note:keep']);
    assert.deepEqual(result.sourceIds, ['source:keep']);
    assert.deepEqual(result.sentenceIds, ['sentence:keep']);
    assert.deepEqual(result.analysisIds, ['analysis:keep']);
    await deleteDatabase(page, databaseName);
  });
});
