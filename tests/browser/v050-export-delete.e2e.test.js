'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { withFixtureServer } = require('./helpers/fixture-server');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const shared = (name) => path.join(repositoryRoot, 'apps', 'extension', 'src', 'shared', name);

async function loadModules(page) {
  for (const name of [
    'dogfood-contracts.js', 'dogfood-source.js', 'dogfood-projector.js',
    'dogfood-storage-schema.js', 'dogfood-store.js'
  ]) await page.addScriptTag({ path: shared(name) });
}

test('v0.5 export/import replay round-trip and scoped delete preserve local ownership', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await withFixtureServer({
      '/data.html': { contentType: 'text/html', body: '<!doctype html><html><body>dogfood data fixture</body></html>' }
    }, async ({ origin }) => {
      const page = await browser.newPage();
      await page.goto(`${origin}/data.html`);
      await loadModules(page);
      const result = await page.evaluate(async () => {
        const suffix = String(Date.now());
        const dbA = `halo-export-a-${suffix}`;
        const dbB = `halo-export-b-${suffix}`;
        const a = await HaloDogfoodStore.openHaloDogfoodStore({ indexedDB, databaseName: dbA, now: () => Date.parse('2026-09-10T00:00:00.000Z') });
        const b = await HaloDogfoodStore.openHaloDogfoodStore({ indexedDB, databaseName: dbB, now: () => Date.parse('2026-09-10T00:00:00.000Z') });

        const sourceExample = HaloDogfoodContracts.normalizeSourceRef({
          schema: 'SourceRef/v1', sourceId: 'source:example', domain: 'example.com',
          normalizedPathHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
          pathNormalizationVersion: 'path-v1', fullUrl: null, language: 'en'
        });
        const sourceOther = HaloDogfoodContracts.normalizeSourceRef({
          schema: 'SourceRef/v1', sourceId: 'source:other', domain: 'other.example',
          normalizedPathHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
          pathNormalizationVersion: 'path-v1', fullUrl: null, language: 'en'
        });
        const sentence = HaloDogfoodContracts.normalizeSentenceRecord({
          schema: 'SentenceRecord/v1', sentenceId: 'sentence:example', text: 'Retained explicit sentence.', language: 'en',
          textHash: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
          sourceRef: 'source:example', captureReason: 'sentence_saved', capturedAt: '2026-08-10T00:00:00.000Z',
          algorithmVersion: 'halo-semantic-v0.4', profileId: 'halo-default-v0.3.0', profileRevision: 2
        });
        const event = (eventId, timestamp, eventType, interactionClass, sourceRef, sentenceRef = null, noteText = null) =>
          HaloDogfoodContracts.normalizeLearningEvent({
            schema: 'LearningEvent/v1', eventId, timestamp, eventType,
            sessionId: 'session:roundtrip', sessionPolicyVersion: 'top-level-page-v1',
            sourceRef, language: 'en', sentenceRef,
            sentenceHash: sentenceRef ? sentence.textHash : null,
            interactionClass, capturePolicyVersion: 'dogfood-capture-v1',
            profileId: 'halo-default-v0.3.0', profileRevision: 2,
            uiContext: { activeChannels: ['posLabel'], density: 0.65, triggerMode: 'hybrid' },
            algorithmVersion: 'halo-semantic-v0.4', refersToEventId: null, detail: { noteText }
          });

        await a.putSource(sourceExample);
        await a.putSource(sourceOther);
        await a.putSentence(sentence);
        await a.appendEvent(event('event:save', '2026-08-10T00:00:00.000Z', 'sentence_saved', 'explicit-learning', 'source:example', 'sentence:example'));
        await a.appendEvent(event('event:other', '2026-08-20T00:00:00.000Z', 'sentence_exposed', 'passive', 'source:other'));
        await a.appendEvent(event('event:note', '2026-09-01T00:00:00.000Z', 'dogfood_note_created', 'dogfood-note', 'source:example', null, 'Keep note.'));
        const cacheKey = HaloDogfoodStore.cacheKeyFor(
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          'algo-v1'
        );
        await a.putCache(HaloDogfoodContracts.normalizeAnalysisCacheEntry({
          schema: 'AnalysisCacheEntry/v1', cacheKey,
          textHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          contextHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          algorithmVersion: 'algo-v1', createdAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-10-01T00:00:00.000Z', value: { ok: true }
        }));

        const bundle = await a.exportBundle();
        const jsonl = await a.exportEventsJsonl();
        const importResult = await b.importBundleIntoEmptyStore(bundle);
        const dataA = await a.readReplayDataset();
        const dataB = await b.readReplayDataset();
        const projectionA = HaloDogfoodProjector.project(dataA.events, dataA);
        const projectionB = HaloDogfoodProjector.project(dataB.events, dataB);
        const replayA = await HaloDogfoodProjector.createReplayReport({ events: dataA.events, projection: projectionA, skipped: [], cryptoApi: crypto });
        const replayB = await HaloDogfoodProjector.createReplayReport({ events: dataB.events, projection: projectionB, skipped: [], cryptoApi: crypto });

        const domainDelete = await b.deleteByScope({ kind: 'domain', domain: 'example.com' });
        const afterDomain = await b.readReplayDataset();
        const timeDelete = await a.deleteByScope({
          kind: 'time-range', from: '2026-08-15T00:00:00.000Z', to: '2026-08-25T23:59:59.999Z'
        });
        const afterTime = await a.readReplayDataset();
        const clearedCache = await a.clearAnalysisCache();
        const allDelete = await a.deleteByScope({ kind: 'all-dogfood' });
        const afterAll = await a.readReplayDataset();

        a.close();
        b.close();
        for (const name of [dbA, dbB]) await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error('database cleanup blocked'));
        });

        return {
          bundle,
          jsonl,
          importResult,
          replayHashes: [replayA.projectionHash, replayB.projectionHash],
          domainDelete,
          domainEventIds: afterDomain.events.map((item) => item.eventId).sort(),
          timeDelete,
          timeEventIds: afterTime.events.map((item) => item.eventId).sort(),
          clearedCache,
          allDelete,
          allCounts: {
            events: afterAll.events.length,
            sources: afterAll.sources.length,
            sentences: afterAll.sentences.length,
            analyses: afterAll.analyses.length
          }
        };
      });

      assert.equal(result.bundle.schema, 'ExportBundle/v1');
      assert.equal(Object.hasOwn(result.bundle, 'cache'), false);
      assert.equal(Object.hasOwn(result.bundle, 'migrations'), false);
      assert.equal(result.jsonl.trim().split('\n').length, 3);
      assert.equal(result.importResult.imported.events, 3);
      assert.equal(result.replayHashes[0], result.replayHashes[1]);
      assert.deepEqual(result.domainEventIds, ['event:other']);
      assert.equal(result.domainDelete.success, true);
      assert.deepEqual(result.timeEventIds, ['event:note', 'event:save']);
      assert.equal(result.timeDelete.success, true);
      assert.equal(result.clearedCache, 1);
      assert.deepEqual(result.allCounts, { events: 0, sources: 0, sentences: 0, analyses: 0 });
      assert.equal(result.allDelete.success, true);
    });
  } finally {
    await browser.close();
  }
});
