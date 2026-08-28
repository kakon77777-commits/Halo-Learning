'use strict';

importScripts(
  'service-worker.js',
  'shared/dogfood-contracts.js',
  'shared/dogfood-source.js',
  'shared/dogfood-storage-schema.js',
  'shared/dogfood-store.js',
  'shared/dogfood-projector.js',
  'shared/dogfood-data-service.js',
  'shared/dogfood-worker-transport.js'
);

(function initializeDogfoodWorker(root) {
  if (!root.chrome || !root.chrome.storage || !root.chrome.storage.local ||
      !root.HaloSemanticService || typeof root.HaloSemanticService.createWorkerPolicyAuthorizer !== 'function' ||
      !root.HaloSettings || typeof root.HaloSettings.migrateSettings !== 'function' ||
      !root.HaloDogfoodWorkerTransport || typeof root.HaloDogfoodWorkerTransport.initializeBrowser !== 'function') {
    return;
  }

  const authorizeSender = root.HaloSemanticService.createWorkerPolicyAuthorizer({
    storage: root.chrome.storage.local
  });

  async function getCurrentProfile() {
    const stored = await root.chrome.storage.local.get('haloSettings');
    return root.HaloSettings.migrateSettings(stored && stored.haloSettings);
  }

  root.HaloDogfoodWorkerTransport.initializeBrowser({
    chrome: root.chrome,
    indexedDB: root.indexedDB,
    cryptoApi: root.crypto,
    authorizeSender,
    getCurrentProfile
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
