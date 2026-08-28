'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const DogfoodContent = require('../apps/extension/src/shared/dogfood-content');

const ALLOW = Object.freeze({ allow: true });

function profile() {
  return {
    profileId: 'halo-default-v0.3.0',
    profileRevision: 9,
    density: 0.65,
    triggerMode: 'hybrid',
    channels: { posLabel: true, glossHint: true }
  };
}

test('SourceRef language stays page-session stable while event language follows the sentence', async () => {
  const sent = [];
  let sequence = 0;
  const client = DogfoodContent.createDogfoodContentClient({
    cryptoApi: webcrypto,
    randomUUID: () => `uuid-${++sequence}`,
    now: () => Date.parse('2026-08-29T00:10:00.000Z') + sequence,
    sendMessage: async (message) => { sent.push(message); return { accepted: true, result: { status: 'inserted' } }; }
  });

  await client.startPageSession({
    url: 'https://example.com/read',
    language: 'both',
    policyDecision: ALLOW
  });
  await client.recordExposure({
    sentenceText: 'The model learns.',
    language: 'en',
    policyDecision: ALLOW,
    profile: profile(),
    algorithmVersion: 'halo-semantic-v0.4'
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].envelope.source.language, 'both');
  assert.equal(sent[0].envelope.event.language, 'en');
  assert.equal(sent[0].envelope.source.sourceId, client.currentPage().sourceId);
});
