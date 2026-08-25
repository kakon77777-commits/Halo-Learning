'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Progressive = require('../apps/extension/src/shared/progressive-runtime');

const GENERATED_AT = '2026-08-26T08:00:00.000Z';

function annotationSet(label) {
  return Object.freeze({
    schemaVersion: 1,
    setId: `annotation-set:${label}`,
    generatedAt: GENERATED_AT,
    tokens: Object.freeze([])
  });
}

function fixtureOptions(overrides) {
  const settings = overrides || {};
  return {
    bootstrapEngine: {
      annotateText: (text) => annotationSet(`bootstrap:${text}`)
    },
    enrichBatch: settings.enrichBatch || (async (request) => ({
      annotationSet: annotationSet(`lexical:${request.text}`),
      lexicalVersion: request.lexicalVersion
    })),
    semanticVersion: 'semantic-v3',
    grammarVersion: 'grammar-v3',
    initialPageEpoch: 1,
    now: () => GENERATED_AT
  };
}

function fixtureRequest(rootId, rootRevision, overrides) {
  const settings = overrides || {};
  const input = {
    text: settings.text || 'The model learns.',
    languageMode: settings.languageMode || 'en',
    semanticVersion: 'semantic-v3',
    grammarVersion: 'grammar-v3',
    profileRevision: settings.profileRevision || 'profile-7',
    lexicalVersion: settings.lexicalVersion || 'manifest-root-1'
  };
  return {
    requestId: settings.requestId || `request-${rootId}-${rootRevision}`,
    pageEpoch: settings.pageEpoch || 1,
    rootId,
    rootRevision,
    text: input.text,
    languageMode: input.languageMode,
    profileRevision: input.profileRevision,
    lexicalVersion: input.lexicalVersion,
    analysisKey: settings.analysisKey || Progressive.createAnalysisKey(input),
    generatedAt: GENERATED_AT
  };
}

test('analysis key changes for every semantic input version and is stable for identical input', () => {
  const input = {
    text: 'The model learns.',
    languageMode: 'en',
    semanticVersion: 'semantic-v3',
    grammarVersion: 'grammar-v3',
    profileRevision: 'profile-7',
    lexicalVersion: 'manifest-root-1'
  };
  const first = Progressive.createAnalysisKey(input);
  const second = Progressive.createAnalysisKey({ ...input });

  assert.equal(first, second);
  for (const [field, value] of [
    ['text', 'The model learns!'],
    ['languageMode', 'both'],
    ['semanticVersion', 'semantic-v4'],
    ['grammarVersion', 'grammar-v4'],
    ['profileRevision', 'profile-8'],
    ['lexicalVersion', 'manifest-root-2']
  ]) {
    assert.notEqual(Progressive.createAnalysisKey({ ...input, [field]: value }), first, field);
  }
});

test('one analysis revision permits one bootstrap and one lexical reconciliation', async () => {
  const runtime = Progressive.createProgressiveSemanticRuntime(fixtureOptions());
  const request = fixtureRequest('root-1', 1);
  const first = await runtime.bootstrap(request);
  const duplicateBootstrap = await runtime.bootstrap(request);
  const enriched = await runtime.enrich(request);
  const duplicateEnrichment = await runtime.enrich(request);

  assert.equal(first.phase, 'bootstrap');
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.analysisKey, request.analysisKey);
  assert.equal(first.annotationSet.setId, 'annotation-set:bootstrap:The model learns.');
  assert.equal(duplicateBootstrap.status, 'duplicate');
  assert.equal(Object.hasOwn(duplicateBootstrap, 'annotationSet'), false);
  assert.equal(enriched.phase, 'lexical');
  assert.equal(enriched.lexicalVersion, 'manifest-root-1');
  assert.equal(enriched.annotationSet.setId, 'annotation-set:lexical:The model learns.');
  assert.equal(duplicateEnrichment.status, 'duplicate');
  assert.equal(Object.hasOwn(duplicateEnrichment, 'annotationSet'), false);
});

test('late result from an old page epoch is rejected without projection data', async () => {
  let resolveEnrichment;
  const runtime = Progressive.createProgressiveSemanticRuntime(fixtureOptions({
    enrichBatch: (request) => new Promise((resolve) => {
      resolveEnrichment = () => resolve({
        annotationSet: annotationSet(`lexical:${request.text}`),
        lexicalVersion: request.lexicalVersion
      });
    })
  }));
  const pending = runtime.enrich(fixtureRequest('root-1', 1));
  runtime.advancePageEpoch(2);
  resolveEnrichment();
  const result = await pending;

  assert.equal(result.status, 'stale');
  assert.equal(Object.hasOwn(result, 'annotationSet'), false);
});

test('late result from an old root revision is rejected without projection data', async () => {
  let resolveEnrichment;
  const runtime = Progressive.createProgressiveSemanticRuntime(fixtureOptions({
    enrichBatch: (request) => new Promise((resolve) => {
      if (request.rootRevision === 1) {
        resolveEnrichment = () => resolve({
          annotationSet: annotationSet(`lexical:${request.text}`),
          lexicalVersion: request.lexicalVersion
        });
        return;
      }
      resolve({
        annotationSet: annotationSet(`lexical:${request.text}`),
        lexicalVersion: request.lexicalVersion
      });
    })
  }));
  const pending = runtime.enrich(fixtureRequest('root-1', 1));
  const current = await runtime.enrich(fixtureRequest('root-1', 2));
  resolveEnrichment();
  const late = await pending;

  assert.equal(current.phase, 'lexical');
  assert.equal(late.status, 'stale');
  assert.equal(Object.hasOwn(late, 'annotationSet'), false);
});

test('cancelled enrichment is rejected without projection data', async () => {
  let resolveEnrichment;
  const runtime = Progressive.createProgressiveSemanticRuntime(fixtureOptions({
    enrichBatch: (request) => new Promise((resolve) => {
      resolveEnrichment = () => resolve({
        annotationSet: annotationSet(`lexical:${request.text}`),
        lexicalVersion: request.lexicalVersion
      });
    })
  }));
  const request = fixtureRequest('root-2', 3);
  const pending = runtime.enrich(request);
  assert.equal(runtime.cancel(request.requestId), true);
  resolveEnrichment();
  const result = await pending;

  assert.equal(result.status, 'cancelled');
  assert.equal(Object.hasOwn(result, 'annotationSet'), false);
  assert.equal(runtime.cancel('unknown-request'), false);
});

test('version-mismatched requests are invalid and never invoke an engine', async () => {
  let bootstrapCalls = 0;
  let enrichmentCalls = 0;
  const runtime = Progressive.createProgressiveSemanticRuntime(fixtureOptions({
    enrichBatch: async () => {
      enrichmentCalls += 1;
      return { annotationSet: annotationSet('unexpected'), lexicalVersion: 'manifest-root-1' };
    }
  }));
  const request = fixtureRequest('root-3', 1, { analysisKey: 'wrong-analysis-key' });
  runtime.status();
  const bootstrapRuntime = Progressive.createProgressiveSemanticRuntime({
    ...fixtureOptions(),
    bootstrapEngine: {
      annotateText() {
        bootstrapCalls += 1;
        return annotationSet('unexpected');
      }
    },
    enrichBatch: async () => {
      enrichmentCalls += 1;
      return { annotationSet: annotationSet('unexpected'), lexicalVersion: 'manifest-root-1' };
    }
  });

  const bootstrapResult = await bootstrapRuntime.bootstrap(request);
  const enrichResult = await runtime.enrich(request);

  assert.equal(bootstrapResult.status, 'invalid');
  assert.equal(enrichResult.status, 'invalid');
  assert.equal(Object.hasOwn(bootstrapResult, 'annotationSet'), false);
  assert.equal(Object.hasOwn(enrichResult, 'annotationSet'), false);
  assert.equal(bootstrapCalls, 0);
  assert.equal(enrichmentCalls, 0);
});
