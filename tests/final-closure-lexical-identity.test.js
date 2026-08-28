'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Content = require('../apps/extension/src/content');
const ServiceWorker = require('../apps/extension/src/service-worker');
const Progressive = require('../apps/extension/src/shared/progressive-runtime');
const Contracts = require('../packages/contracts/semantic-contracts');
const Dictionary = require('../apps/extension/src/shared/dictionary-provider');
const Semantic = require('../apps/extension/src/shared/semantic-annotations');
const Grammar = require('../apps/extension/src/shared/grammar-annotations');
const ShardedProvider = require('../apps/extension/src/shared/sharded-dictionary-provider');

const GENERATED_AT = '2026-08-28T09:00:00.000Z';

function bootstrapProvider() {
  return Dictionary.createDictionaryProvider([
    { surface: 'The', lang: 'en', lemma: 'the', pos: 'det', confidence: 0.99, source: 'bootstrap' },
    { surface: 'model', lang: 'en', lemma: 'model', pos: 'n', confidence: 0.99, source: 'bootstrap' }
  ], { id: 'closure-bootstrap', version: '0.4.0-bootstrap', license: 'test-only' });
}

function item(lexicalVersion) {
  const value = {
    rootId: 'root-1:s0',
    rootRevision: 1,
    text: 'The model.',
    languageMode: 'en',
    semanticVersion: Semantic.ENGINE.version,
    grammarVersion: Grammar.ALGORITHM.version,
    profileRevision: 'profile-7',
    lexicalVersion
  };
  value.analysisKey = Progressive.createAnalysisKey(value);
  return value;
}

function request(lexicalVersion) {
  return {
    type: 'HALO_ENRICH_BATCH',
    requestId: 'request-closure',
    pageEpoch: 1,
    items: [item(lexicalVersion)]
  };
}

function networkActivity() {
  return {
    schemaVersion: 1,
    scope: 'worker-lifetime',
    lifetimeId: 'worker-closure',
    fetchAttempts: 2
  };
}

function annotation(provider) {
  return Semantic.createSemanticEngine({ provider }).annotateText('The model.', {
    languageMode: 'en',
    generatedAt: GENERATED_AT
  });
}

test('dictionary status exposes the canonical lexical identity used by the worker', async () => {
  const provider = bootstrapProvider();
  const service = ServiceWorker.createShardSemanticService({
    loadShardRuntime: async () => ({
      runtime: null,
      lexicalVersion: 'manifest-root-closure',
      bootstrapProvider: provider,
      status: () => ({ mode: 'ready', fallbackActivated: false, failures: [] })
    }),
    semanticModule: Semantic,
    grammarModule: Grammar,
    shardedProviderModule: ShardedProvider
  });
  const status = await service.handleMessage({ type: 'HALO_DICTIONARY_STATUS' }, {});
  assert.equal(status.lexicalVersion, 'manifest-root-closure');
  assert.equal(status.mode, 'ready');
});

test('worker recomputes a truthful analysis key when a ready shard request falls back to bootstrap identity', async () => {
  const provider = bootstrapProvider();
  const runtime = {
    requiredShardIds() { return ['en-00']; },
    status() { return { failures: [] }; },
    async withEnsuredShards() {
      throw Object.assign(new Error('fixture shard failed'), { code: 'SHARD_HASH_MISMATCH' });
    }
  };
  const service = ServiceWorker.createShardSemanticService({
    loadShardRuntime: async () => ({
      runtime,
      lexicalVersion: 'manifest-root-closure',
      bootstrapProvider: provider,
      status: () => ({ mode: 'ready', fallbackActivated: false, failures: [] })
    }),
    semanticModule: Semantic,
    grammarModule: Grammar,
    shardedProviderModule: ShardedProvider,
    networkActivityCounter: { status: () => networkActivity() },
    now: () => GENERATED_AT
  });
  const req = request('manifest-root-closure');
  const response = await service.handleMessage(req, { tab: { id: 7 } });
  const result = response.results[0];
  const expectedBootstrapVersion = `${provider.id}@${provider.version}`;
  const expectedKey = Progressive.createAnalysisKey({ ...req.items[0], lexicalVersion: expectedBootstrapVersion });
  assert.equal(result.phase, 'bootstrap');
  assert.equal(result.lexicalVersion, expectedBootstrapVersion);
  assert.equal(result.analysisKey, expectedKey);
  assert.notEqual(result.analysisKey, req.items[0].analysisKey);
});

test('content accepts only a truthful bootstrap identity transition and still rejects a lexical identity swap', () => {
  const provider = bootstrapProvider();
  const req = request('manifest-root-closure');
  const bootstrapVersion = `${provider.id}@${provider.version}`;
  const bootstrapKey = Progressive.createAnalysisKey({ ...req.items[0], lexicalVersion: bootstrapVersion });
  const base = {
    schemaVersion: Contracts.SEMANTIC_SCHEMA_VERSION,
    requestId: req.requestId,
    pageEpoch: req.pageEpoch,
    status: { mode: 'degraded', networkActivity: networkActivity() }
  };
  const truthfulBootstrap = {
    ...base,
    results: [{
      schemaVersion: Contracts.SEMANTIC_SCHEMA_VERSION,
      requestId: req.requestId,
      pageEpoch: req.pageEpoch,
      rootId: req.items[0].rootId,
      rootRevision: req.items[0].rootRevision,
      analysisKey: bootstrapKey,
      phase: 'bootstrap',
      annotationSet: annotation(provider),
      lexicalVersion: bootstrapVersion,
      generatedAt: GENERATED_AT
    }]
  };
  const accepted = Content.validateEnrichmentResponse(truthfulBootstrap, req, Contracts, Progressive);
  assert.ok(accepted, 'explicit bootstrap fallback with a recomputable lexical identity must validate');
  assert.equal(accepted.results[0].analysisKey, bootstrapKey);

  const dishonestLexical = {
    ...truthfulBootstrap,
    status: { mode: 'ready', networkActivity: networkActivity() },
    results: [{ ...truthfulBootstrap.results[0], phase: 'lexical' }]
  };
  assert.equal(
    Content.validateEnrichmentResponse(dishonestLexical, req, Contracts, Progressive),
    null,
    'lexical phase may not silently change the requested lexical identity'
  );
});
