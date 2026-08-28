'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Runtime = require('../apps/extension/src/shared/dogfood-runtime');

const ALLOW = Object.freeze({ allow: true });
const BLOCK = Object.freeze({ allow: false });

function profile(overrides = {}) {
  return Object.freeze({
    profileId: 'halo-default-v0.3.0',
    profileRevision: 7,
    languageMode: 'both',
    triggerMode: 'hybrid',
    density: 0.65,
    channels: Object.freeze({ posLabel: true, posColor: true, lemma: false, morphology: false, glossHint: true, grammarRole: false, tenseAspect: false, chunk: false, learningState: false }),
    sitePolicy: Object.freeze({ schemaVersion: 1, userDenylist: Object.freeze([]) }),
    ...overrides
  });
}

function fixture(policyDecision = ALLOW) {
  const calls = [];
  const client = {};
  for (const name of ['startPageSession', 'recordApply', 'recordRemove', 'recordExposure', 'recordExplicitOpen', 'saveSentence', 'createNote', 'recordProfileDiff', 'routeChanged']) {
    client[name] = async (value) => { calls.push([name, value]); return { status: 'ok' }; };
  }
  const windowLike = {
    location: { href: 'https://Example.com/read/ch1?token=secret#paragraph' },
    document: {},
    crypto: { randomUUID: () => 'runtime-uuid' }
  };
  const runtime = Runtime.createDogfoodObservationRuntime({
    client,
    windowLike,
    sitePolicyModule: { classifySite: () => policyDecision },
    maxContexts: 4
  });
  return { runtime, client, calls, windowLike };
}

test('render instrumentation binds exact sentence context to a private observation key and emits passive exposure once', async () => {
  const { runtime, calls } = fixture();
  const root = {};
  const planItem = {};
  const settings = profile();
  await runtime.applyAllowedProfile(settings);
  runtime.rememberSentenceRecords(root, [
    { start: 0, end: 17, text: 'The model learns.', language: 'en' }
  ]);
  runtime.rememberPlan([planItem], settings, 'halo-semantic-v0.4');

  const request = runtime.instrumentRenderRequest({
    rootId: 'root-1',
    rootRevision: 1,
    root,
    fragments: [{
      boundaryKey: '4:9:0',
      renderPlan: planItem,
      start: 4,
      end: 9,
      text: 'model'
    }]
  });
  await runtime.flush();

  assert.match(request.fragments[0].observationKey, /^obs:/);
  const context = runtime.contextForObservation(request.fragments[0].observationKey);
  assert.equal(context.sentenceText, 'The model learns.');
  assert.equal(context.language, 'en');
  assert.equal(context.sourceUrl, 'https://Example.com/read/ch1?token=secret#paragraph');
  assert.equal(context.profileId, settings.profileId);
  assert.deepEqual(context.activeChannels, ['glossHint', 'posColor', 'posLabel']);
  assert.equal(context.density, 0.65);
  assert.equal(context.triggerMode, 'hybrid');
  assert.equal(context.algorithmVersion, 'halo-semantic-v0.4');

  assert.equal(calls.filter(([name]) => name === 'recordExposure').length, 1);
  const exposure = calls.find(([name]) => name === 'recordExposure')[1];
  assert.equal(exposure.sentenceText, 'The model learns.');
  assert.equal(exposure.policyDecision.allow, true);
  assert.equal(exposure.sourceUrl, 'https://Example.com/read/ch1?token=secret#paragraph');

  runtime.instrumentRenderRequest({
    rootId: 'root-1', rootRevision: 1, root,
    fragments: [{ boundaryKey: '4:9:0', renderPlan: planItem, start: 4, end: 9, text: 'model' }]
  });
  await runtime.flush();
  assert.equal(calls.filter(([name]) => name === 'recordExposure').length, 1, 'same observation is exposed once before store-level coalescing');
});

test('explicit token panel adds bounded Save/Note actions and routes retained context only through the client', async () => {
  const { runtime, calls } = fixture();
  const root = {};
  const token = {};
  const planItem = {};
  const settings = profile();
  await runtime.applyAllowedProfile(settings);
  runtime.rememberSentenceRecords(root, [{ start: 0, end: 17, text: 'The model learns.', language: 'en' }]);
  runtime.rememberPlan([planItem], settings, 'halo-semantic-v0.4');
  const request = runtime.instrumentRenderRequest({
    rootId: 'root-1', rootRevision: 1, root,
    fragments: [{ boundaryKey: '4:9:0', renderPlan: planItem, start: 4, end: 9, text: 'model' }]
  });
  const key = request.fragments[0].observationKey;
  runtime.setActiveRenderer({ observationKeyForToken: (value) => value === token ? key : null });
  runtime.noteExplicitToken(token);
  const model = runtime.preparePanelModel({ title: 'model', body: 'N · model gloss' });
  await runtime.flush();

  assert.equal(model.observationKey, key);
  assert.deepEqual(model.actions, [
    { id: 'save-sentence', label: 'Save sentence · 儲存句子' },
    { id: 'dogfood-note', label: 'Dogfood note · 體驗註記' }
  ]);
  assert.equal(calls.filter(([name]) => name === 'recordExplicitOpen').length, 1);
  assert.equal(calls.find(([name]) => name === 'recordExplicitOpen')[1].hasGloss, true);

  runtime.handlePanelAction({ id: 'save-sentence', value: null, observationKey: key });
  runtime.handlePanelAction({ id: 'dogfood-note', value: 'Tense label is noisy.', observationKey: key });
  await runtime.flush();
  assert.equal(calls.filter(([name]) => name === 'saveSentence').length, 1);
  assert.equal(calls.find(([name]) => name === 'saveSentence')[1].sentenceText, 'The model learns.');
  assert.equal(calls.find(([name]) => name === 'createNote')[1].noteText, 'Tense label is noisy.');
  assert.equal(calls.find(([name]) => name === 'createNote')[1].profile.profileRevision, 7);
});

test('root invalidation and route cleanup erase ephemeral sentence contexts', async () => {
  const { runtime } = fixture();
  const root = {};
  const planItem = {};
  const settings = profile();
  await runtime.applyAllowedProfile(settings);
  runtime.rememberSentenceRecords(root, [{ start: 0, end: 17, text: 'The model learns.', language: 'en' }]);
  runtime.rememberPlan([planItem], settings, 'halo-semantic-v0.4');
  const request = runtime.instrumentRenderRequest({
    rootId: 'root-1', rootRevision: 1, root,
    fragments: [{ boundaryKey: '4:9:0', renderPlan: planItem, start: 4, end: 9, text: 'model' }]
  });
  const key = request.fragments[0].observationKey;
  assert.ok(runtime.contextForObservation(key));
  runtime.clearRoots([root]);
  assert.equal(runtime.contextForObservation(key), null);

  runtime.rememberSentenceRecords(root, [{ start: 0, end: 17, text: 'The model learns.', language: 'en' }]);
  runtime.rememberPlan([planItem], settings, 'halo-semantic-v0.4');
  const next = runtime.instrumentRenderRequest({ rootId: 'root-1', rootRevision: 2, root, fragments: [{ boundaryKey: '4:9:0', renderPlan: planItem }] });
  assert.ok(runtime.contextForObservation(next.fragments[0].observationKey));
  await runtime.routeCleanup();
  assert.equal(runtime.contextForObservation(next.fragments[0].observationKey), null);
});

test('blocked policy produces no session, apply, exposure, explicit-open, save, or note calls', async () => {
  const { runtime, calls } = fixture(BLOCK);
  const root = {};
  const planItem = {};
  const settings = profile();
  assert.equal(await runtime.applyAllowedProfile(settings), null);
  runtime.rememberSentenceRecords(root, [{ start: 0, end: 12, text: 'Private text.', language: 'en' }]);
  runtime.rememberPlan([planItem], settings, 'halo-semantic-v0.4');
  const request = runtime.instrumentRenderRequest({ rootId: 'root-1', rootRevision: 1, root, fragments: [{ boundaryKey: '0:7:0', renderPlan: planItem }] });
  assert.equal(request.fragments[0].observationKey, undefined);
  await runtime.flush();
  assert.deepEqual(calls, []);
});
