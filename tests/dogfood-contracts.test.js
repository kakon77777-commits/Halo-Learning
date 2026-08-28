'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Contracts = require('../apps/extension/src/shared/dogfood-contracts');

function eventFixture(eventType, overrides = {}) {
  return {
    schema: 'LearningEvent/v1',
    eventId: `event:${eventType}:1`,
    timestamp: '2026-08-28T14:00:00.000Z',
    eventType,
    sessionId: 'session:one',
    sessionPolicyVersion: 'top-level-page-v1',
    sourceRef: 'source:one',
    language: 'en',
    sentenceRef: null,
    sentenceHash: null,
    interactionClass: eventType.startsWith('dogfood_note_') ? 'dogfood-note' : 'ordinary',
    capturePolicyVersion: 'dogfood-capture-v1',
    profileId: 'halo-default-v0.3.0',
    profileRevision: 4,
    uiContext: { activeChannels: ['posLabel'], density: 0.65, triggerMode: 'hybrid' },
    algorithmVersion: 'halo-semantic-v0.4',
    refersToEventId: null,
    detail: { noteText: null },
    ...overrides
  };
}

test('LearningEvent/v1 rejects learner-state fields', () => {
  const event = Contracts.normalizeLearningEvent(eventFixture('profile_changed'));
  assert.equal(event.schema, 'LearningEvent/v1');
  assert.throws(() => Contracts.normalizeLearningEvent({ ...event, mastery: 0.8 }), /not allowed/);
  assert.throws(() => Contracts.normalizeLearningEvent({ ...event, confidence: 0.9 }), /not allowed/);
});

test('note create/revise carries bounded note text and revisions link to an earlier event', () => {
  const created = eventFixture('dogfood_note_created', {
    eventId: 'event:note:1',
    detail: { noteText: 'Tense labels are too noisy here.' }
  });
  assert.equal(Contracts.normalizeLearningEvent(created).detail.noteText, 'Tense labels are too noisy here.');
  const revised = eventFixture('dogfood_note_revised', {
    eventId: 'event:note:2',
    refersToEventId: 'event:note:1',
    detail: { noteText: 'Tense labels are too noisy on articles.' }
  });
  assert.equal(Contracts.normalizeLearningEvent(revised).refersToEventId, 'event:note:1');
});
