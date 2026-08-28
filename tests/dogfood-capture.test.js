'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Capture = require('../apps/extension/src/shared/dogfood-capture');

const profile = Object.freeze({
  profileId: 'halo-default-v0.3.0',
  profileRevision: 2,
  channels: Object.freeze({
    posLabel: true,
    posColor: true,
    lemma: false,
    morphology: false,
    glossHint: true,
    grammarRole: false,
    tenseAspect: false,
    chunk: false,
    learningState: false
  }),
  density: 0.65,
  triggerMode: 'hybrid'
});

function runtimeFixture() {
  let sequence = 0;
  return Capture.createCaptureRuntime({
    cryptoApi: globalThis.crypto,
    now: () => 1000,
    randomUUID: () => `uuid-${++sequence}`
  });
}

test('capture policy constants and event classifications are canonical', () => {
  assert.equal(Capture.CAPTURE_POLICY_VERSION, 'dogfood-capture-v1');
  assert.equal(Capture.SESSION_POLICY_VERSION, 'top-level-page-v1');
  assert.equal(Capture.EXPOSURE_POLICY_VERSION, 'exposure-v1');
  assert.equal(Capture.classifyEventType('sentence_exposed'), 'passive');
  assert.equal(Capture.classifyEventType('gloss_opened'), 'explicit-learning');
  assert.equal(Capture.classifyEventType('explanation_opened'), 'explicit-learning');
  assert.equal(Capture.classifyEventType('sentence_saved'), 'explicit-learning');
  assert.equal(Capture.classifyEventType('dogfood_note_created'), 'dogfood-note');
  assert.equal(Capture.classifyEventType('halo_applied'), 'ordinary');
  assert.throws(() => Capture.classifyEventType('pointer_moved'), /eventType/);
});

test('blocked capture is null, passive capture is sparse, explicit learning retains its sentence', async () => {
  const runtime = runtimeFixture();
  const session = runtime.startSession({ sourceRef: 'source:one' });
  assert.equal(runtime.currentSession().sessionId, session.sessionId);

  const passive = await runtime.prepare({
    eventType: 'sentence_exposed',
    policyDecision: { allow: true },
    sourceRef: 'source:one',
    language: 'en',
    sentenceText: 'The model learns.',
    profile,
    algorithmVersion: 'halo-semantic-v0.4'
  });
  assert.equal(passive.sentenceRecord, null);
  assert.equal(passive.event.interactionClass, 'passive');
  assert.equal(passive.event.sentenceRef, null);
  assert.match(passive.event.sentenceHash, /^sha256:[a-f0-9]{64}$/);

  const explicit = await runtime.prepare({
    eventType: 'gloss_opened',
    policyDecision: { allow: true },
    sourceRef: 'source:one',
    language: 'en',
    sentenceText: 'The model learns.',
    profile,
    algorithmVersion: 'halo-semantic-v0.4'
  });
  assert.equal(explicit.event.interactionClass, 'explicit-learning');
  assert.equal(explicit.sentenceRecord.text, 'The model learns.');
  assert.equal(explicit.event.sentenceRef, explicit.sentenceRecord.sentenceId);
  assert.equal(explicit.event.sentenceHash, explicit.sentenceRecord.textHash);

  const blocked = await runtime.prepare({
    eventType: 'sentence_exposed',
    policyDecision: { allow: false },
    sourceRef: 'source:one',
    language: 'en',
    sentenceText: 'Never persist me.',
    profile
  });
  assert.equal(blocked, null);
});

test('identical exposure within one session produces the same deterministic event id', async () => {
  const runtime = runtimeFixture();
  runtime.startSession({ sourceRef: 'source:one' });
  const input = {
    eventType: 'sentence_exposed',
    policyDecision: { allow: true },
    sourceRef: 'source:one',
    language: 'en',
    sentenceText: 'Repeated viewport callback.',
    profile
  };
  const first = await runtime.prepare(input);
  const second = await runtime.prepare(input);
  assert.equal(first.event.eventId, second.event.eventId);

  const nextSession = runtime.startSession({ sourceRef: 'source:one' });
  assert.notEqual(nextSession.sessionId, first.event.sessionId);
  const third = await runtime.prepare(input);
  assert.notEqual(third.event.eventId, first.event.eventId);
});

test('profile diff reports semantic transitions only', () => {
  const density = { ...profile, profileRevision: 3, density: 0.8 };
  assert.deepEqual(Capture.diffProfileEvents(profile, density), ['density_changed']);

  const channels = {
    ...profile,
    profileRevision: 3,
    channels: Object.freeze({ ...profile.channels, tenseAspect: true })
  };
  assert.deepEqual(Capture.diffProfileEvents(profile, channels), ['channels_changed']);

  const trigger = { ...profile, profileRevision: 3, triggerMode: 'explicit-only' };
  assert.deepEqual(Capture.diffProfileEvents(profile, trigger), ['trigger_mode_changed']);

  const revisionOnly = { ...profile, profileRevision: 3 };
  assert.deepEqual(Capture.diffProfileEvents(profile, revisionOnly), ['profile_changed']);
  assert.deepEqual(Capture.diffProfileEvents(profile, profile), []);
});
