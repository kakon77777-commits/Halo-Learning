'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Contracts = require('../apps/extension/src/shared/dogfood-contracts');
const Projector = require('../apps/extension/src/shared/dogfood-projector');

function event(eventType, overrides = {}) {
  const interactionClass = eventType === 'sentence_exposed'
    ? 'passive'
    : (['gloss_opened', 'explanation_opened', 'sentence_saved'].includes(eventType)
      ? 'explicit-learning'
      : (eventType.startsWith('dogfood_note_') ? 'dogfood-note' : 'ordinary'));
  return Contracts.normalizeLearningEvent({
    schema: 'LearningEvent/v1',
    eventId: `event:${eventType}:${overrides.serial || '1'}`,
    timestamp: overrides.timestamp || '2026-08-28T14:00:00.000Z',
    eventType,
    sessionId: overrides.sessionId || 'session:one',
    sessionPolicyVersion: 'top-level-page-v1',
    sourceRef: overrides.sourceRef || 'source:one',
    language: overrides.language || 'en',
    sentenceRef: overrides.sentenceRef === undefined ? null : overrides.sentenceRef,
    sentenceHash: overrides.sentenceHash === undefined ? null : overrides.sentenceHash,
    interactionClass,
    capturePolicyVersion: 'dogfood-capture-v1',
    profileId: 'halo-default-v0.3.0',
    profileRevision: 2,
    uiContext: { activeChannels: ['posLabel', 'posColor'], density: 0.65, triggerMode: 'hybrid' },
    algorithmVersion: 'halo-semantic-v0.4',
    refersToEventId: overrides.refersToEventId === undefined ? null : overrides.refersToEventId,
    detail: { noteText: overrides.noteText === undefined ? null : overrides.noteText }
  });
}

const attachments = {
  sources: [
    {
      schema: 'SourceRef/v1', sourceId: 'source:one', domain: 'example.com',
      normalizedPathHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      pathNormalizationVersion: 'path-v1', fullUrl: null, language: 'en'
    }
  ],
  sentences: [
    {
      schema: 'SentenceRecord/v1', sentenceId: 'sentence:one', text: 'The model learns.', language: 'en',
      textHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      sourceRef: 'source:one', captureReason: 'sentence_saved', capturedAt: '2026-08-28T14:00:01.000Z',
      algorithmVersion: 'halo-semantic-v0.4', profileId: 'halo-default-v0.3.0', profileRevision: 2
    },
    {
      schema: 'SentenceRecord/v1', sentenceId: 'sentence:two', text: 'Another sentence.', language: 'en',
      textHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      sourceRef: 'source:one', captureReason: 'sentence_saved', capturedAt: '2026-08-28T14:00:02.000Z',
      algorithmVersion: 'halo-semantic-v0.4', profileId: 'halo-default-v0.3.0', profileRevision: 2
    }
  ]
};

const events = [
  event('sentence_exposed', { serial: '1', timestamp: '2026-08-28T14:00:00.000Z' }),
  event('sentence_saved', { serial: '1', timestamp: '2026-08-28T14:00:01.000Z', sentenceRef: 'sentence:one' }),
  event('sentence_saved', { serial: '2', timestamp: '2026-08-28T14:00:02.000Z', sentenceRef: 'sentence:two' }),
  event('sentence_unsaved', { serial: '1', timestamp: '2026-08-28T14:00:03.000Z', sentenceRef: 'sentence:one' }),
  event('dogfood_note_created', { serial: '1', timestamp: '2026-08-28T14:00:04.000Z', noteText: 'Too noisy.' }),
  event('dogfood_note_revised', {
    serial: '1', timestamp: '2026-08-28T14:00:05.000Z',
    refersToEventId: 'event:dogfood_note_created:1', noteText: 'Tense labels are too noisy.'
  }),
  event('dogfood_note_created', { serial: '2', timestamp: '2026-08-28T14:00:06.000Z', noteText: 'Remove me.' }),
  event('dogfood_note_removed', {
    serial: '1', timestamp: '2026-08-28T14:00:07.000Z',
    refersToEventId: 'event:dogfood_note_created:2', noteText: null
  })
];

test('projector is deterministic and emits only the six observational views', () => {
  const a = Projector.project(events, attachments);
  const b = Projector.project(JSON.parse(JSON.stringify(events)), JSON.parse(JSON.stringify(attachments)));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(Object.keys(a), ['overview', 'activity', 'sites', 'sessions', 'savedSentences', 'notes']);
  assert.equal(Object.hasOwn(a, 'mastery'), false);
  assert.equal(Object.hasOwn(a, 'confidence'), false);
  assert.equal(a.overview.eventCount, events.length);
  assert.equal(a.overview.explicitLearningSignals, 2);
});

test('saved sentences and notes fold append-only history without mutating events', () => {
  const projection = Projector.project(events, attachments);
  assert.deepEqual(projection.savedSentences.map((item) => item.sentenceId), ['sentence:two']);
  assert.equal(projection.notes.length, 1);
  assert.equal(projection.notes[0].text, 'Tense labels are too noisy.');
  assert.equal(projection.notes[0].rootEventId, 'event:dogfood_note_created:1');
  assert.equal(events[4].detail.noteText, 'Too noisy.');
});

test('replay report hashes the deterministic projection and records the event range', async () => {
  const projection = Projector.project(events, attachments);
  const report = await Projector.createReplayReport({ events, projection, skipped: [], cryptoApi: globalThis.crypto });
  assert.equal(report.schema, 'ReplayReport/v1');
  assert.equal(report.projectorVersion, 'dogfood-projector-v1');
  assert.equal(report.sourceEventCount, events.length);
  assert.deepEqual(report.eventRange, {
    from: '2026-08-28T14:00:00.000Z',
    to: '2026-08-28T14:00:07.000Z'
  });
  assert.match(report.projectionHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(report.success, true);
});
