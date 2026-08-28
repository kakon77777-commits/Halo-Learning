'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Observer = require('../apps/extension/src/shared/dogfood-browser-observer');

const PROFILE = Object.freeze({
  profileId: 'halo-default-v0.3.0', profileRevision: 2, enabled: true,
  languageMode: 'both', triggerMode: 'hybrid', density: 0.65,
  channels: Object.freeze({ posLabel: true, posColor: true, glossHint: true }),
  sitePolicy: Object.freeze({ schemaVersion: 1, userDenylist: Object.freeze([]) })
});

test('HALO_REMOVE_MARKING snapshots and queues halo_removed before v0.4 cleanup resets the session barrier', async () => {
  const calls = [];
  const runtimeListeners = [];
  let dynamicOptions = null;
  const root = {
    location: { href: 'https://example.com/read' },
    document: { addEventListener() {}, removeEventListener() {} },
    HaloSettings: {
      normalizeSettings: (value) => value,
      migrateSettings: (value) => value
    },
    HaloSentencePipeline: { buildSentenceRecords: () => [] },
    HaloProjection: { createMarkingPlan: () => [] },
    HaloDynamicDomController: {
      createDynamicDomController(options) {
        dynamicOptions = options;
        return { marker: 'controller' };
      }
    },
    HaloSemanticAnnotations: { ENGINE: { version: 'halo-semantic-v0.4' } },
    HaloSitePolicy: { classifySite: () => Object.freeze({ allow: true }) },
    chrome: {
      runtime: {
        onMessage: { addListener(listener) { runtimeListeners.push(listener); } },
        sendMessage: async () => ({ accepted: true, result: { status: 'ok' } })
      },
      storage: { onChanged: { addListener() {} } }
    }
  };
  const client = {};
  for (const name of ['startPageSession', 'recordApply', 'recordExposure', 'recordExplicitOpen', 'saveSentence', 'createNote', 'recordProfileDiff', 'routeChanged']) {
    client[name] = async (value) => { calls.push([name, value]); return { status: 'ok' }; };
  }
  client.recordRemove = async (value) => {
    calls.push(['recordRemove', value]);
    return { status: 'ok' };
  };

  const runtime = Observer.installDogfoodBrowserObservation({ root, client });
  root.HaloSettings.normalizeSettings(PROFILE);
  root.HaloDynamicDomController.createDynamicDomController({ policyOnly: false, onRouteCleanup() {} });
  await runtime.flush();
  assert.equal(calls.filter(([name]) => name === 'recordApply').length, 1);
  assert.equal(runtimeListeners.length, 1);
  assert.ok(dynamicOptions && typeof dynamicOptions.onRouteCleanup === 'function');

  runtimeListeners[0]({ type: 'HALO_REMOVE_MARKING' });
  dynamicOptions.onRouteCleanup({ epoch: 1, reason: 'cleanup' });
  await runtime.flush();
  await Promise.resolve();
  await runtime.flush();

  assert.equal(calls.filter(([name]) => name === 'recordRemove').length, 1,
    'user Remove must be captured before route cleanup invalidates the current page session');
  assert.equal(calls.find(([name]) => name === 'recordRemove')[1].sourceUrl, 'https://example.com/read');
});
