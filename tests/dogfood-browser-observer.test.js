'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Observer = require('../apps/extension/src/shared/dogfood-browser-observer');

function profile() {
  return Object.freeze({
    profileId: 'halo-default-v0.3.0', profileRevision: 2, enabled: true,
    languageMode: 'both', triggerMode: 'hybrid', density: 0.65,
    channels: Object.freeze({ posLabel: true, posColor: true, glossHint: true }),
    sitePolicy: Object.freeze({ schemaVersion: 1, userDenylist: Object.freeze([]) })
  });
}

test('installer observes existing module boundaries without changing their return values', async () => {
  const calls = [];
  const listeners = [];
  const rootNode = {};
  const planItem = Object.freeze({ marked: true, start: 4, end: 9 });
  const records = Object.freeze([{ start: 0, end: 17, text: 'The model learns.', language: 'en' }]);
  const settings = profile();
  const root = {
    location: { href: 'https://example.com/read' },
    document: {
      addEventListener(type, listener, options) { listeners.push([type, listener, options]); },
      removeEventListener() {}
    },
    HaloSettings: {
      normalizeSettings(value) { return value; },
      migrateSettings(value) { return value; },
      CHANNEL_NAMES: Object.freeze(['posLabel', 'posColor', 'glossHint'])
    },
    HaloSentencePipeline: {
      buildSentenceRecords(element) { assert.equal(element, rootNode); return records; }
    },
    HaloProjection: {
      createMarkingPlan(tokens, value) { assert.deepEqual(tokens, ['token']); assert.equal(value, settings); return Object.freeze([planItem]); }
    },
    HaloDynamicDomController: {
      createDynamicDomController(options) { calls.push(['dynamic', options.policyOnly]); return { marker: 'controller' }; }
    },
    HaloSemanticAnnotations: { ENGINE: { version: 'halo-semantic-v0.4' } },
    HaloSitePolicy: { classifySite: () => Object.freeze({ allow: true }) },
    chrome: {
      runtime: {
        onMessage: { addListener(listener) { listeners.push(['runtime-message', listener]); } },
        sendMessage: async () => ({ accepted: true, result: { status: 'ok' } })
      },
      storage: { onChanged: { addListener(listener) { listeners.push(['storage-change', listener]); } } }
    }
  };
  const client = {};
  for (const name of ['startPageSession', 'recordApply', 'recordRemove', 'recordExposure', 'recordExplicitOpen', 'saveSentence', 'createNote', 'recordProfileDiff', 'routeChanged']) {
    client[name] = async (value) => { calls.push([name, value]); return { status: 'ok' }; };
  }

  const runtime = Observer.installDogfoodBrowserObservation({ root, client });
  assert.ok(runtime);
  assert.equal(root.__HALO_DOGFOOD_OBSERVATION_RUNTIME__, runtime);
  assert.equal(root.HaloSettings.normalizeSettings(settings), settings);
  assert.equal(root.HaloSentencePipeline.buildSentenceRecords(rootNode), records);
  assert.deepEqual(root.HaloProjection.createMarkingPlan(['token'], settings), [planItem]);
  const controller = root.HaloDynamicDomController.createDynamicDomController({ policyOnly: false });
  assert.equal(controller.marker, 'controller');
  await runtime.flush();
  assert.equal(calls.filter(([name]) => name === 'startPageSession').length, 1);
  assert.equal(calls.filter(([name]) => name === 'recordApply').length, 1);
  assert.ok(listeners.some(([type]) => type === 'click'));
  assert.ok(listeners.some(([type]) => type === 'runtime-message'));
  assert.ok(listeners.some(([type]) => type === 'storage-change'));
});

test('policy-only dynamic controller does not create a dogfood session', async () => {
  const calls = [];
  const settings = profile();
  const root = {
    location: { href: 'https://bank.example/account' },
    document: { addEventListener() {}, removeEventListener() {} },
    HaloSettings: { normalizeSettings: (value) => value, migrateSettings: (value) => value },
    HaloSentencePipeline: { buildSentenceRecords: () => [] },
    HaloProjection: { createMarkingPlan: () => [] },
    HaloDynamicDomController: { createDynamicDomController: () => ({}) },
    HaloSemanticAnnotations: { ENGINE: { version: 'halo-semantic-v0.4' } },
    HaloSitePolicy: { classifySite: () => Object.freeze({ allow: false }) },
    chrome: {
      runtime: { onMessage: { addListener() {} }, sendMessage: async () => null },
      storage: { onChanged: { addListener() {} } }
    }
  };
  const client = {};
  for (const name of ['startPageSession', 'recordApply', 'recordRemove', 'recordExposure', 'recordExplicitOpen', 'saveSentence', 'createNote', 'recordProfileDiff', 'routeChanged']) {
    client[name] = async (value) => { calls.push([name, value]); };
  }
  const runtime = Observer.installDogfoodBrowserObservation({ root, client });
  root.HaloSettings.normalizeSettings(settings);
  root.HaloDynamicDomController.createDynamicDomController({ policyOnly: true });
  await runtime.flush();
  assert.deepEqual(calls, []);
});
