'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const DogfoodContent = require('../apps/extension/src/shared/dogfood-content');
const BrowserEntry = require('../apps/extension/src/shared/browser-entry');

function profile(overrides = {}) {
  return {
    profileId: 'halo-default-v0.3.0',
    profileRevision: 4,
    density: 0.65,
    triggerMode: 'hybrid',
    channels: { posLabel: true, metaLabel: false, glossHint: true },
    ...overrides
  };
}

function clientFixture(overrides = {}) {
  const sent = [];
  const errors = [];
  let sequence = 0;
  const client = DogfoodContent.createDogfoodContentClient({
    cryptoApi: webcrypto,
    randomUUID: () => `uuid-${++sequence}`,
    now: () => Date.parse('2026-08-29T00:00:00.000Z') + sequence,
    sendMessage: async (message) => {
      sent.push(message);
      return { accepted: true, result: { status: 'appended' } };
    },
    onError: (code) => errors.push(code),
    ...overrides
  });
  return { client, sent, errors };
}

const ALLOW = Object.freeze({ allow: true });

test('passive exposure sends one privacy-minimized capture envelope without retained sentence text', async () => {
  const { client, sent, errors } = clientFixture();
  await client.startPageSession({
    url: 'https://Example.com/read/ch1?token=secret#paragraph',
    language: 'en',
    policyDecision: ALLOW
  });
  await client.recordExposure({
    sentenceText: 'The model learns.',
    language: 'en',
    policyDecision: ALLOW,
    profile: profile(),
    algorithmVersion: 'halo-semantic-v0.4'
  });

  assert.equal(errors.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'HALO_DOGFOOD_CAPTURE');
  assert.equal(sent[0].envelope.event.eventType, 'sentence_exposed');
  assert.equal(sent[0].envelope.event.interactionClass, 'passive');
  assert.equal(sent[0].envelope.sentenceRecord, null);
  assert.equal(sent[0].envelope.source.domain, 'example.com');
  assert.equal(sent[0].envelope.source.fullUrl, null);
  assert.doesNotMatch(JSON.stringify(sent[0]), /token=secret|#paragraph/);
});

test('explicit save retains sentence and exact return URL but never leaks through message fields outside the envelope', async () => {
  const { client, sent } = clientFixture();
  const url = 'https://example.com/read/ch1?view=1#paragraph';
  await client.startPageSession({ url, language: 'en', policyDecision: ALLOW });
  await client.saveSentence({
    sentenceText: 'The model learns.',
    language: 'en',
    sourceUrl: url,
    policyDecision: ALLOW,
    profile: profile(),
    algorithmVersion: 'halo-semantic-v0.4'
  });

  assert.deepEqual(Object.keys(sent[0]).sort(), ['envelope', 'type']);
  assert.equal(sent[0].envelope.event.eventType, 'sentence_saved');
  assert.equal(sent[0].envelope.event.interactionClass, 'explicit-learning');
  assert.equal(sent[0].envelope.sentenceRecord.text, 'The model learns.');
  assert.equal(sent[0].envelope.source.fullUrl, url);
});

test('capture transport failures are observation-only and never throw into the v0.4 runtime', async () => {
  const errors = [];
  const { client } = clientFixture({
    sendMessage: async () => { throw new Error('worker unavailable'); },
    onError: (code) => errors.push(code)
  });
  await client.startPageSession({ url: 'https://example.com/read', language: 'en', policyDecision: ALLOW });
  const result = await client.recordApply({
    language: 'en',
    policyDecision: ALLOW,
    profile: profile(),
    algorithmVersion: 'halo-semantic-v0.4'
  });
  assert.equal(result, null);
  assert.deepEqual(errors, ['DOGFOOD_CAPTURE_UNAVAILABLE']);
});

test('blocked policy produces zero page-capture messages', async () => {
  const { client, sent } = clientFixture();
  const blocked = Object.freeze({ allow: false });
  const session = await client.startPageSession({
    url: 'https://bank.example/account',
    language: 'en',
    policyDecision: blocked
  });
  const result = await client.recordExposure({
    sentenceText: 'Private account text.',
    language: 'en',
    policyDecision: blocked,
    profile: profile(),
    algorithmVersion: 'halo-semantic-v0.4'
  });
  assert.equal(session, null);
  assert.equal(result, null);
  assert.equal(sent.length, 0);
});

test('packaged content injection loads the dogfood client dependencies before content.js', () => {
  const files = BrowserEntry.INJECT_FILES;
  const contentIndex = files.indexOf('src/content.js');
  assert.ok(contentIndex > 0);
  for (const dependency of [
    'src/shared/dogfood-renderer.js',
    'src/shared/dogfood-contracts.js',
    'src/shared/dogfood-source.js',
    'src/shared/dogfood-capture.js',
    'src/shared/dogfood-content.js',
    'src/shared/dogfood-runtime.js',
    'src/shared/dogfood-browser-observer.js'
  ]) {
    const index = files.indexOf(dependency);
    assert.ok(index >= 0, `${dependency} must be packaged for content injection`);
    assert.ok(index < contentIndex, `${dependency} must load before content.js`);
  }
});
