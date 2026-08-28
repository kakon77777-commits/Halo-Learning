'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Runtime = require('../apps/extension/src/shared/dogfood-runtime');

const ALLOW = Object.freeze({ allow: true });

function profile() {
  return Object.freeze({
    profileId: 'halo-default-v0.3.0',
    profileRevision: 8,
    languageMode: 'both',
    triggerMode: 'hybrid',
    density: 0.65,
    channels: Object.freeze({ posLabel: true, glossHint: true }),
    sitePolicy: Object.freeze({ schemaVersion: 1, userDenylist: Object.freeze([]) })
  });
}

test('first exposure waits for asynchronous page session creation and is not lost', async () => {
  const calls = [];
  let releaseSession;
  const sessionGate = new Promise((resolve) => { releaseSession = resolve; });
  const client = {
    async startPageSession(value) {
      calls.push(['startPageSession:begin', value]);
      await sessionGate;
      calls.push(['startPageSession:end', value]);
      return { source: { sourceId: 'source:1' }, session: { sessionId: 'session:1' } };
    },
    async recordApply(value) { calls.push(['recordApply', value]); return { status: 'ok' }; },
    async recordExposure(value) { calls.push(['recordExposure', value]); return { status: 'ok' }; },
    async recordRemove() {}, async recordExplicitOpen() {}, async saveSentence() {}, async createNote() {},
    async recordProfileDiff() {}, async routeChanged() {}
  };
  const runtime = Runtime.createDogfoodObservationRuntime({
    client,
    windowLike: { location: { href: 'https://example.com/read' }, document: {} },
    sitePolicyModule: { classifySite: () => ALLOW }
  });
  const settings = profile();
  const root = {};
  const planItem = {};

  const applyPromise = runtime.applyAllowedProfile(settings);
  runtime.rememberSentenceRecords(root, [{ start: 0, end: 17, text: 'The model learns.', language: 'en' }]);
  runtime.rememberPlan([planItem], settings, 'halo-semantic-v0.4');
  const request = runtime.instrumentRenderRequest({
    rootId: 'root-1',
    rootRevision: 1,
    root,
    fragments: [{ boundaryKey: '4:9:0', renderPlan: planItem, start: 4, end: 9, text: 'model' }]
  });

  assert.match(request.fragments[0].observationKey, /^obs:/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.map(([name]) => name), ['startPageSession:begin']);

  releaseSession();
  await applyPromise;
  await runtime.flush();
  assert.deepEqual(calls.map(([name]) => name), [
    'startPageSession:begin',
    'startPageSession:end',
    'recordApply',
    'recordExposure'
  ]);
});
