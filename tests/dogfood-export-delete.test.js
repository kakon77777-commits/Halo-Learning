'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Contracts = require('../apps/extension/src/shared/dogfood-contracts');
const Store = require('../apps/extension/src/shared/dogfood-store');

const event = Contracts.normalizeLearningEvent({
  schema: 'LearningEvent/v1',
  eventId: 'event:jsonl:1',
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

test('export store contract excludes cache and migration internals', () => {
  assert.deepEqual(Store.EXPORT_STORE_NAMES, ['events', 'sources', 'sentences', 'profiles', 'analyses', 'settings']);
  assert.equal(Store.EXPORT_STORE_NAMES.includes('cache'), false);
  assert.equal(Store.EXPORT_STORE_NAMES.includes('migrations'), false);
});

test('JSONL export serializes only canonical events and cannot manufacture sentence text or URLs', () => {
  const jsonl = Store.serializeEventsJsonl([event]);
  assert.equal(jsonl.endsWith('\n'), true);
  const rows = jsonl.trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows, [event]);
  assert.equal(Object.hasOwn(rows[0], 'text'), false);
  assert.equal(Object.hasOwn(rows[0], 'fullUrl'), false);
});
