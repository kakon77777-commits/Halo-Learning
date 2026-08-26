'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Contracts = require('../packages/contracts/semantic-contracts');
const Dictionary = require('../apps/extension/src/shared/dictionary-provider');
const Semantic = require('../apps/extension/src/shared/semantic-annotations');
const Grammar = require('../apps/extension/src/shared/grammar-annotations');
const ShardedProvider = require('../apps/extension/src/shared/sharded-dictionary-provider');
const Progressive = require('../apps/extension/src/shared/progressive-runtime');
const ServiceWorker = require('../apps/extension/src/service-worker');

const extensionRoot = path.join(__dirname, '..', 'apps', 'extension');
const GENERATED_AT = '2026-08-26T08:00:00.000Z';

function entry(surface, lemma, pos) {
  return Object.freeze({
    surface,
    normalizedSurface: surface.toLowerCase(),
    language: 'en',
    lemma,
    simplifiedPos: pos,
    posConfidence: 1,
    lexicalRef: `fixture:${lemma}`,
    glossRef: `fixture:${lemma}#gloss`,
    gloss: `${lemma} gloss`,
    datasetRef: {
      datasetId: 'service-fixture',
      datasetVersion: '1',
      recordRef: `fixture:${lemma}`
    },
    provenance: ['dataset:service-fixture@1']
  });
}

function bootstrapProvider() {
  return Dictionary.createDictionaryProvider([
    { surface: 'The', lang: 'en', lemma: 'the', pos: 'det', confidence: 0.99, source: 'bootstrap' },
    { surface: 'model', lang: 'en', lemma: 'model', pos: 'x', confidence: 0.2, source: 'bootstrap' },
    { surface: 'learns', lang: 'en', lemma: 'learns', pos: 'x', confidence: 0.2, source: 'bootstrap' },
    { surface: '學習', lang: 'zh', lemma: '學習', pos: 'v', confidence: 0.94, source: 'bootstrap' }
  ], { id: 'service-bootstrap', version: '0.4.0-bootstrap', license: 'test-only' });
}

function lexicalShard() {
  const values = new Map([
    ['model', [entry('model', 'model', 'n')]],
    ['learns', [entry('learns', 'learn', 'v')]]
  ]);
  return Object.freeze({
    id: 'en-00',
    locale: 'en',
    lookup(surface, language) {
      return language === 'en' ? Object.freeze(values.get(String(surface).toLowerCase()) || []) : Object.freeze([]);
    },
    lookupMorphology() {
      return Object.freeze([]);
    }
  });
}

function fixtureRuntime(options) {
  const settings = options || {};
  const ensured = [];
  return {
    ensured,
    requiredShardIds(texts, languageMode) {
      if (typeof settings.requiredShardIds === 'function') return settings.requiredShardIds(texts, languageMode);
      return languageMode === 'en' || languageMode === 'both' ? ['en-00'] : [];
    },
    async ensureShards(ids, loadOptions) {
      if (settings.rejectLegacy) throw new Error('non-atomic shard loading is forbidden');
      ensured.push([...ids]);
      if (typeof settings.ensureShards === 'function') return settings.ensureShards(ids, loadOptions);
      return Object.freeze([lexicalShard()]);
    },
    withPinnedShards(_ids, callback) {
      return callback(Object.freeze([lexicalShard()]));
    },
    async withEnsuredShards(ids, loadOptions, callback) {
      ensured.push([...ids]);
      if (typeof settings.ensureShards === 'function') await settings.ensureShards(ids, loadOptions);
      return callback(Object.freeze([lexicalShard()]));
    },
    status() {
      return Object.freeze({
        bucketCount: 64,
        residentCount: 1,
        failures: Object.freeze(settings.failures || [])
      });
    }
  };
}

function serviceFor(runtime, overrides) {
  const settings = overrides || {};
  return ServiceWorker.createShardSemanticService({
    loadShardRuntime: async () => settings.context || ({
      runtime,
      lexicalVersion: 'manifest-root-1',
      bootstrapProvider: bootstrapProvider(),
      status: () => ({ mode: 'ready', fallbackActivated: false, failures: [] })
    }),
    semanticModule: Semantic,
    grammarModule: Grammar,
    shardedProviderModule: ShardedProvider,
    now: () => GENERATED_AT
  });
}

function item(index, overrides) {
  const value = {
    rootId: `root-${index}`,
    rootRevision: 1,
    text: 'The model learns.',
    languageMode: 'en',
    semanticVersion: 'semantic-v3',
    grammarVersion: 'grammar-v3',
    profileRevision: 'profile-7',
    lexicalVersion: 'manifest-root-1',
    ...(overrides || {})
  };
  if (!value.analysisKey) {
    value.analysisKey = Progressive.createAnalysisKey({
      text: value.text,
      languageMode: value.languageMode,
      semanticVersion: value.semanticVersion,
      grammarVersion: value.grammarVersion,
      profileRevision: value.profileRevision,
      lexicalVersion: value.lexicalVersion
    });
  }
  return value;
}

function message(items, overrides) {
  return {
    type: 'HALO_ENRICH_BATCH',
    requestId: 'request-1',
    pageEpoch: 1,
    items,
    ...(overrides || {})
  };
}

test('shard enrichment returns versioned lexical results and rejects the legacy whole-index message', async () => {
  const runtime = fixtureRuntime({ rejectLegacy: true });
  const service = serviceFor(runtime);
  const response = await service.handleMessage(message([item(1)]), { tab: { id: 7 } });
  const ignored = await service.handleMessage({
    type: 'HALO_ANNOTATE_BATCH',
    texts: ['The model learns.']
  }, { tab: { id: 7 } });

  assert.equal(response.schemaVersion, 1);
  assert.equal(response.requestId, 'request-1');
  assert.equal(response.pageEpoch, 1);
  assert.equal(response.results.length, 1);
  assert.deepEqual(runtime.ensured, [['en-00']]);
  assert.equal(
    response.results[0].analysisKey,
    'ak1:eff7d1990f48f139614b45eed178ed768277183780542cc8712f5afb58313858'
  );
  assert.deepEqual(response.results[0], {
    schemaVersion: 1,
    requestId: 'request-1',
    pageEpoch: 1,
    rootId: 'root-1',
    rootRevision: 1,
    analysisKey: item(1).analysisKey,
    phase: 'lexical',
    annotationSet: response.results[0].annotationSet,
    lexicalVersion: 'manifest-root-1',
    generatedAt: GENERATED_AT
  });
  assert.doesNotThrow(() => Contracts.normalizeAnnotationSet(response.results[0].annotationSet));
  assert.equal(response.results[0].annotationSet.tokens[1].simplifiedPos, 'n');
  assert.equal(response.status.mode, 'ready');
  assert.equal(ignored, null);
});

test('missing canonical manifest fails soft to authored bootstrap without requesting the legacy index', async () => {
  const requested = [];
  const loadShardRuntime = ServiceWorker.createBrowserShardLoader({
    bootstrapProvider: bootstrapProvider(),
    readText: async (resourcePath) => {
      requested.push(resourcePath);
      throw new Error('/private/extension/path is unavailable');
    },
    shardModule: {
      loadBrowserLexicalManifest() {
        throw new Error('manifest loader must not receive missing bytes');
      }
    }
  });
  const context = await loadShardRuntime();
  const service = serviceFor(null, { context });
  const response = await service.handleMessage(message([item(1)]), { tab: { id: 7 } });

  assert.deepEqual(requested, ['data/lexical-v0.4.0/manifest.json']);
  assert.equal(context.runtime, null);
  assert.equal(response.results[0].phase, 'bootstrap');
  assert.equal(response.results[0].annotationSet.tokens[1].simplifiedPos, 'x');
  assert.equal(response.results[0].lexicalVersion, 'service-bootstrap@0.4.0-bootstrap');
  assert.deepEqual(response.status, {
    mode: 'degraded',
    fallbackActivated: true,
    failures: [{ code: 'MANIFEST_UNAVAILABLE' }]
  });
  assert.doesNotMatch(JSON.stringify(response), /private|extension\/path|lexical-runtime-index/i);
});

test('corrupt required shard falls back to bootstrap with only a sanitized failure code', async () => {
  const error = Object.assign(new Error('corrupt bytes: secret payload'), { code: 'SHARD_HASH_MISMATCH' });
  const runtime = fixtureRuntime({
    failures: [{ code: 'SHARD_HASH_MISMATCH' }],
    ensureShards: async () => { throw error; }
  });
  const service = serviceFor(runtime);
  const response = await service.handleMessage(message([item(1)]), { tab: { id: 7 } });

  assert.equal(response.results[0].phase, 'bootstrap');
  assert.equal(response.results[0].annotationSet.tokens[1].simplifiedPos, 'x');
  assert.deepEqual(response.status, {
    mode: 'degraded',
    fallbackActivated: true,
    failures: [{ code: 'SHARD_HASH_MISMATCH' }]
  });
  assert.doesNotMatch(JSON.stringify(response), /secret|corrupt bytes/i);
});

test('enrichment validation enforces all four exact batch bounds', () => {
  const runtime = fixtureRuntime({
    requiredShardIds: (texts) => texts.map((text) => /^t\d+$/.test(text) ? `shard-${text}` : 'shard-content')
  });

  assert.equal(ServiceWorker.validateEnrichmentRequest(message(
    Array.from({ length: 24 }, (_, index) => item(index, { text: `t${index}` }))
  ), runtime).items.length, 24);
  assert.throws(() => ServiceWorker.validateEnrichmentRequest(message(
    Array.from({ length: 25 }, (_, index) => item(index, { text: `t${index}` }))
  ), runtime), /item limit/i);
  assert.equal(ServiceWorker.validateEnrichmentRequest(message([item(1, { text: 'a'.repeat(12000) })]), runtime)
    .totalCharacters, 12000);
  assert.throws(() => ServiceWorker.validateEnrichmentRequest(
    message([item(1, { text: 'a'.repeat(12001) })]), runtime
  ), /character limit/i);
  assert.equal(ServiceWorker.validateEnrichmentRequest(message([item(1, {
    text: Array.from({ length: 600 }, () => 'word').join(' ')
  })]), runtime).estimatedTokens, 600);
  assert.throws(() => ServiceWorker.validateEnrichmentRequest(message([item(1, {
    text: Array.from({ length: 601 }, () => 'word').join(' ')
  })]), runtime), /token limit/i);
  assert.equal(ServiceWorker.validateEnrichmentRequest(message(
    Array.from({ length: 24 }, (_, index) => item(index, { text: `t${index}` }))
  ), runtime).shardIds.length, 24);
  assert.throws(() => ServiceWorker.validateEnrichmentRequest(message(
    Array.from({ length: 24 }, (_, index) => item(index, {
      text: index === 23 ? 'extra-a extra-b' : `t${index}`
    }))
  ), {
    requiredShardIds: (texts) => texts[0] === 'extra-a extra-b'
      ? ['shard-extra-a', 'shard-extra-b']
      : [`shard-${texts[0]}`]
  }), /shard limit/i);
});

test('service boundary rejects stable-looking IDs that are not canonical analysis keys', () => {
  const runtime = fixtureRuntime();
  assert.throws(
    () => ServiceWorker.validateEnrichmentRequest(message([item(1, { analysisKey: 'analysis-1' })]), runtime),
    /canonical analysis key/i
  );
});

test('service boundary rejects a canonical key bound to different text before shard routing', () => {
  let routes = 0;
  const runtime = {
    requiredShardIds() {
      routes += 1;
      return [];
    }
  };
  const originalKey = item(1).analysisKey;

  assert.throws(
    () => ServiceWorker.validateEnrichmentRequest(message([
      item(1, { text: 'Different text.', analysisKey: originalKey })
    ]), runtime),
    /analysis key.*match/i
  );
  assert.equal(routes, 0);
});

test('service boundary rejects a canonical key bound to a different semantic version', () => {
  const originalKey = item(1).analysisKey;
  assert.throws(
    () => ServiceWorker.validateEnrichmentRequest(message([
      item(1, { semanticVersion: 'semantic-v4', analysisKey: originalKey })
    ]), fixtureRuntime()),
    /analysis key.*match/i
  );
});

test('cancellation is scoped by sender tab even when request IDs collide', async () => {
  const waiters = [];
  const runtime = fixtureRuntime({
    ensureShards: (_ids, loadOptions) => new Promise((resolve, reject) => {
      waiters.push({ resolve });
      loadOptions.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { code: 'ABORTED' }));
      }, { once: true });
    })
  });
  const service = serviceFor(runtime);
  const request = message([item(1)]);
  const first = service.handleMessage(request, { tab: { id: 11 } });
  const second = service.handleMessage(request, { tab: { id: 12 } });
  while (waiters.length < 2) await new Promise((resolve) => setImmediate(resolve));

  const wrongSender = await service.handleMessage({
    type: 'HALO_CANCEL_REQUEST', requestId: 'request-1'
  }, { tab: { id: 13 } });
  assert.equal(wrongSender.status, 'not-found');
  const cancelled = await service.handleMessage({
    type: 'HALO_CANCEL_REQUEST', requestId: 'request-1'
  }, { tab: { id: 11 } });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal((await first).status, 'cancelled');

  waiters[1].resolve(Object.freeze([lexicalShard()]));
  const completed = await second;
  assert.equal(completed.results[0].phase, 'lexical');
});

test('worker authorization rejects a blocked sender before reading enrichment text', async () => {
  let itemReads = 0;
  const service = ServiceWorker.createShardSemanticService({
    loadShardRuntime: async () => { throw new Error('must not load runtime'); },
    semanticModule: Semantic,
    grammarModule: Grammar,
    shardedProviderModule: ShardedProvider,
    authorizeSender: async (sender) => sender.tab.url !== 'https://bank.example/account'
  });
  const blockedMessage = {
    type: 'HALO_ENRICH_BATCH',
    requestId: 'blocked-request',
    pageEpoch: 1,
    get items() {
      itemReads += 1;
      throw new Error('private page text must not be read');
    }
  };

  const response = await service.handleMessage(blockedMessage, {
    tab: { id: 7, url: 'https://bank.example/account' }
  });
  assert.deepEqual(response, { error: 'SENSITIVE_SITE_BLOCKED' });
  assert.equal(itemReads, 0);
});

test('MV3 worker source loads only candidate-independent local shard modules', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  const serviceSource = fs.readFileSync(path.join(extensionRoot, 'src/service-worker.js'), 'utf8');

  assert.equal(manifest.background.service_worker, 'src/service-worker.js');
  assert.equal(Object.hasOwn(manifest, 'host_permissions'), false);
  assert.match(serviceSource, /runtime-shard-browser\.js/);
  assert.match(serviceSource, /progressive-runtime\.js/);
  assert.match(serviceSource, /sharded-dictionary-provider\.js/);
  assert.match(serviceSource, /withEnsuredShards/);
  assert.match(serviceSource, /data\/lexical-v0\.4\.0\/manifest\.json/);
  assert.doesNotMatch(serviceSource, /lexical-runtime-index\.json/);
  assert.doesNotMatch(serviceSource, /runtime-index-browser\.js/);
  assert.doesNotMatch(serviceSource, /https?:\/\//i);
});
