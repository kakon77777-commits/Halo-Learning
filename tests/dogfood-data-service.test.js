'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Contracts = require('../apps/extension/src/shared/dogfood-contracts');
const Source = require('../apps/extension/src/shared/dogfood-source');
const Projector = require('../apps/extension/src/shared/dogfood-projector');
const DataService = require('../apps/extension/src/shared/dogfood-data-service');

function baseProfile() {
  return Object.freeze({
    profileId: 'halo-default-v0.3.0', profileRevision: 2,
    channels: Object.freeze({ posLabel: true, posColor: true, lemma: false, morphology: false, glossHint: false, grammarRole: false, tenseAspect: false, chunk: false, learningState: false }),
    density: 0.65, triggerMode: 'hybrid'
  });
}

function fixtureRepository(options = {}) {
  const calls = [];
  let preferences = {
    key: 'dogfood.preferences', schemaVersion: 1, captureEnabled: options.captureEnabled !== false,
    retention: { passiveDays: 30, ordinaryDays: 90, explicitDays: null, dogfoodNoteDays: null }
  };
  const events = new Map();
  const sentences = new Map();
  return {
    calls,
    async appendEvent(value) { calls.push(['event', value.eventType]); events.set(value.eventId, value); return { status: 'inserted', eventId: value.eventId }; },
    async putSource(value) { calls.push(['source', value.sourceId]); },
    async putSentence(value) { calls.push(['sentence', value.sentenceId]); sentences.set(value.sentenceId, value); },
    async putProfileSnapshot(value) { calls.push(['profile', value.profileKey]); },
    async getSetting() { return structuredClone(preferences); },
    async putSetting(value) { calls.push(['setting', value.captureEnabled]); preferences = structuredClone(value); return value; },
    async getEvent(eventId) { return events.get(eventId) || null; },
    async getSentence(sentenceId) { return sentences.get(sentenceId) || null; },
    async queryEvents() { return { items: [...events.values()], next: null }; },
    async querySources() { return []; },
    async querySentences() { return [...sentences.values()]; },
    async readReplayDataset() { return { events: [...events.values()], sources: [], sentences: [...sentences.values()], profiles: [], analyses: [], settings: [structuredClone(preferences)] }; },
    async estimateUsage() { return { bytes: 42 }; },
    async exportBundle() { return { schema: 'ExportBundle/v1' }; },
    async exportEventsJsonl() { return ''; },
    async deleteByScope(scope) { calls.push(['delete', scope.kind]); return { schema: 'DeleteReceipt/v1', success: true }; },
    async clearAnalysisCache() { calls.push(['clear-cache']); return 3; }
  };
}

function captureEnvelope() {
  const event = Contracts.normalizeLearningEvent({
    schema: 'LearningEvent/v1', eventId: 'event:capture:1', timestamp: '2026-08-28T14:00:00.000Z',
    eventType: 'gloss_opened', sessionId: 'session:one', sessionPolicyVersion: 'top-level-page-v1',
    sourceRef: 'source:one', language: 'en', sentenceRef: 'sentence:one',
    sentenceHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', interactionClass: 'explicit-learning',
    capturePolicyVersion: 'dogfood-capture-v1', profileId: 'halo-default-v0.3.0', profileRevision: 2,
    uiContext: { activeChannels: ['posLabel', 'posColor'], density: 0.65, triggerMode: 'hybrid' },
    algorithmVersion: 'halo-semantic-v0.4', refersToEventId: null, detail: { noteText: null }
  });
  const source = Contracts.normalizeSourceRef({
    schema: 'SourceRef/v1', sourceId: 'source:one', domain: 'example.com',
    normalizedPathHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    pathNormalizationVersion: 'path-v1', fullUrl: null, language: 'en'
  });
  const sentenceRecord = Contracts.normalizeSentenceRecord({
    schema: 'SentenceRecord/v1', sentenceId: 'sentence:one', text: 'The model learns.', language: 'en',
    textHash: event.sentenceHash, sourceRef: source.sourceId, captureReason: 'gloss_opened', capturedAt: event.timestamp,
    algorithmVersion: 'halo-semantic-v0.4', profileId: event.profileId, profileRevision: event.profileRevision
  });
  return { event, source, sentenceRecord };
}

test('persistCapture writes normalized source/sentence/profile before append-only event', async () => {
  const repository = fixtureRepository();
  const service = DataService.createDogfoodDataService({
    repository, contracts: Contracts, sourceModule: Source, projector: Projector,
    now: () => Date.parse('2026-08-28T14:00:00.000Z'), randomUUID: () => 'service-uuid', getCurrentProfile: async () => baseProfile()
  });
  const result = await service.persistCapture(captureEnvelope());
  assert.equal(result.status, 'inserted');
  assert.deepEqual(repository.calls.map((call) => call[0]), ['source', 'sentence', 'profile', 'event']);
  assert.deepEqual(service.status(), { schemaVersion: 1, mode: 'ready', captureEnabled: true, lastErrorCode: null });
});

test('capture-disabled page writes are no-op and pause/resume ordering is deterministic', async () => {
  const repository = fixtureRepository();
  let uuid = 0;
  const service = DataService.createDogfoodDataService({
    repository, contracts: Contracts, sourceModule: Source, projector: Projector,
    now: () => Date.parse('2026-08-28T14:00:00.000Z'), randomUUID: () => `uuid-${++uuid}`, getCurrentProfile: async () => baseProfile()
  });
  await service.setCaptureEnabled(false);
  const pauseKinds = repository.calls.map((call) => call[0]);
  assert.deepEqual(pauseKinds.slice(-3), ['source', 'event', 'setting']);
  const ignored = await service.persistCapture(captureEnvelope());
  assert.deepEqual(ignored, { status: 'capture-disabled' });
  const countAfterIgnored = repository.calls.length;
  await service.setCaptureEnabled(true);
  assert.deepEqual(repository.calls.slice(countAfterIgnored).map((call) => call[0]), ['setting', 'source', 'event']);
});

test('replay delegates deterministic projector without learner inference', async () => {
  const repository = fixtureRepository();
  const service = DataService.createDogfoodDataService({
    repository, contracts: Contracts, sourceModule: Source, projector: Projector,
    now: () => Date.parse('2026-08-28T14:00:00.000Z'), randomUUID: () => 'uuid-replay', getCurrentProfile: async () => baseProfile(), cryptoApi: globalThis.crypto
  });
  const replay = await service.replay();
  assert.equal(replay.report.schema, 'ReplayReport/v1');
  assert.equal(replay.projection.overview.eventCount, 0);
  assert.equal(Object.hasOwn(replay.projection, 'mastery'), false);
});

test('repository errors degrade dogfood observation without throwing from status', async () => {
  const repository = fixtureRepository();
  repository.putSource = async () => { const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error; };
  const service = DataService.createDogfoodDataService({
    repository, contracts: Contracts, sourceModule: Source, projector: Projector,
    now: () => Date.parse('2026-08-28T14:00:00.000Z'), randomUUID: () => 'uuid-error', getCurrentProfile: async () => baseProfile()
  });
  await assert.rejects(service.persistCapture(captureEnvelope()), /quota/);
  assert.deepEqual(service.status(), { schemaVersion: 1, mode: 'storage-degraded', captureEnabled: true, lastErrorCode: 'QUOTA_EXCEEDED' });
});
