(function (root, factory) {
  const storeModule = typeof module === 'object' && module.exports ? require('./dogfood-store') : root.HaloDogfoodStore;
  const dataServiceModule = typeof module === 'object' && module.exports ? require('./dogfood-data-service') : root.HaloDogfoodDataService;
  const contractsModule = typeof module === 'object' && module.exports ? require('./dogfood-contracts') : root.HaloDogfoodContracts;
  const sourceModule = typeof module === 'object' && module.exports ? require('./dogfood-source') : root.HaloDogfoodSource;
  const projectorModule = typeof module === 'object' && module.exports ? require('./dogfood-projector') : root.HaloDogfoodProjector;
  const api = factory(root, storeModule, dataServiceModule, contractsModule, sourceModule, projectorModule);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDogfoodWorkerTransport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Store, DataService, Contracts, Source, Projector) {
  'use strict';

  const CAPTURE_TYPE = 'HALO_DOGFOOD_CAPTURE';
  const STATUS_TYPE = 'HALO_DOGFOOD_STATUS';

  function exactMessage(message, keys) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
    const names = Object.keys(message).sort();
    return names.length === keys.length && names.every((name, index) => name === keys[index]);
  }

  function createDogfoodWorkerTransport(options) {
    const settings = options || {};
    const getService = settings.getService;
    const authorizeSender = settings.authorizeSender;
    if (typeof getService !== 'function') throw new TypeError('getService: required');
    if (typeof authorizeSender !== 'function') throw new TypeError('authorizeSender: required');

    async function handleMessage(message, sender) {
      if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
      if (message.type === CAPTURE_TYPE) {
        if (!exactMessage(message, ['envelope', 'type'])) return Object.freeze({ accepted: false, error: 'INVALID_DOGFOOD_CAPTURE' });
        let authorized = false;
        try { authorized = await authorizeSender(sender); } catch (_error) { authorized = false; }
        if (authorized !== true) return Object.freeze({ accepted: false, error: 'SENSITIVE_SITE_BLOCKED' });
        const service = await getService();
        const result = await service.persistCapture(message.envelope);
        return Object.freeze({ accepted: true, result });
      }
      if (message.type === STATUS_TYPE) {
        if (!exactMessage(message, ['type'])) return null;
        const service = await getService();
        return service.status();
      }
      return null;
    }

    return Object.freeze({ handleMessage });
  }

  function createBrowserService(options) {
    const settings = options || {};
    const indexedDBApi = settings.indexedDB;
    const getCurrentProfile = settings.getCurrentProfile;
    if (!Store || typeof Store.openHaloDogfoodStore !== 'function') throw new Error('dogfood store unavailable');
    if (!DataService || typeof DataService.createDogfoodDataService !== 'function') throw new Error('dogfood data service unavailable');
    if (!indexedDBApi || typeof indexedDBApi.open !== 'function') throw new TypeError('indexedDB: required');
    if (typeof getCurrentProfile !== 'function') throw new TypeError('getCurrentProfile: required');
    return Store.openHaloDogfoodStore({ indexedDB: indexedDBApi }).then((repository) => DataService.createDogfoodDataService({
      repository,
      contracts: Contracts,
      sourceModule: Source,
      projector: Projector,
      cryptoApi: settings.cryptoApi || root.crypto,
      randomUUID: settings.randomUUID,
      now: settings.now,
      getCurrentProfile
    }));
  }

  function initializeBrowser(options) {
    const settings = options || {};
    const chromeApi = settings.chrome || root.chrome;
    if (!chromeApi || !chromeApi.runtime || !chromeApi.runtime.onMessage ||
        typeof chromeApi.runtime.onMessage.addListener !== 'function') return null;
    if (root.__HALO_DOGFOOD_WORKER_TRANSPORT_INITIALIZED__) {
      return root.__HALO_DOGFOOD_WORKER_TRANSPORT_INITIALIZED__;
    }
    if (typeof settings.authorizeSender !== 'function') throw new TypeError('authorizeSender: required');
    let servicePromise = null;
    const getService = () => {
      if (!servicePromise) {
        servicePromise = createBrowserService({
          indexedDB: settings.indexedDB || root.indexedDB,
          cryptoApi: settings.cryptoApi || root.crypto,
          randomUUID: settings.randomUUID,
          now: settings.now,
          getCurrentProfile: settings.getCurrentProfile
        });
      }
      return servicePromise;
    };
    const transport = createDogfoodWorkerTransport({ getService, authorizeSender: settings.authorizeSender });
    chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || ![CAPTURE_TYPE, STATUS_TYPE].includes(message.type)) return false;
      transport.handleMessage(message, sender).then(sendResponse).catch(() => {
        if (message.type === STATUS_TYPE) {
          sendResponse({ schemaVersion: 1, mode: 'storage-degraded', captureEnabled: true, lastErrorCode: 'INDEXEDDB_UNAVAILABLE' });
        } else {
          sendResponse({ accepted: false, error: 'DOGFOOD_STORAGE_UNAVAILABLE' });
        }
      });
      return true;
    });
    root.__HALO_DOGFOOD_WORKER_TRANSPORT_INITIALIZED__ = transport;
    return transport;
  }

  return Object.freeze({ CAPTURE_TYPE, STATUS_TYPE, createDogfoodWorkerTransport, initializeBrowser });
});
