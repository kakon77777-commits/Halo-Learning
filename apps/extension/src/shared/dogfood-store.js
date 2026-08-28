(function (root, factory) {
  const schemaModule = typeof module === 'object' && module.exports
    ? require('./dogfood-storage-schema')
    : root.HaloDogfoodStorageSchema;
  const contractsModule = typeof module === 'object' && module.exports
    ? require('./dogfood-contracts')
    : root.HaloDogfoodContracts;
  const api = factory(schemaModule, contractsModule);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDogfoodStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Schema, Contracts) {
  'use strict';

  const DEFAULT_PREFERENCES = Object.freeze({
    key: 'dogfood.preferences',
    schemaVersion: 1,
    captureEnabled: true,
    retention: Object.freeze({
      passiveDays: 30,
      ordinaryDays: 90,
      explicitDays: null,
      dogfoodNoteDays: null
    })
  });

  function cloneJson(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
      transaction.onerror = () => {};
    });
  }

  async function initializePreferences(database) {
    const transaction = database.transaction(['settings'], 'readwrite');
    const store = transaction.objectStore('settings');
    const existing = await requestPromise(store.get(DEFAULT_PREFERENCES.key));
    if (existing === undefined) store.add(cloneJson(DEFAULT_PREFERENCES));
    await transactionDone(transaction);
  }

  async function openDatabase(indexedDBApi, databaseName, databaseVersion, now) {
    return new Promise((resolve, reject) => {
      const request = indexedDBApi.open(databaseName, databaseVersion);
      request.onupgradeneeded = (event) => {
        try {
          Schema.applyUpgrade({
            database: request.result,
            transaction: request.transaction,
            oldVersion: event.oldVersion,
            newVersion: event.newVersion,
            now
          });
        } catch (error) {
          try { request.transaction.abort(); } catch (_ignored) {}
          reject(error);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
  }

  function openHaloDogfoodStore(options) {
    const settings = options || {};
    const indexedDBApi = settings.indexedDB;
    if (!indexedDBApi || typeof indexedDBApi.open !== 'function') {
      return Promise.reject(new TypeError('indexedDB: required'));
    }
    const databaseName = typeof settings.databaseName === 'string' && settings.databaseName
      ? settings.databaseName
      : Schema.DATABASE_NAME;
    const databaseVersion = settings.databaseVersion === undefined
      ? Schema.DATABASE_VERSION
      : settings.databaseVersion;
    if (!Number.isInteger(databaseVersion) || databaseVersion < 1) {
      return Promise.reject(new TypeError('databaseVersion: positive integer required'));
    }
    const now = typeof settings.now === 'function' ? settings.now : () => Date.now();

    return openDatabase(indexedDBApi, databaseName, databaseVersion, now).then(async (database) => {
      await initializePreferences(database);
      let closed = false;

      function ensureOpen() {
        if (closed) throw new Error('dogfood store is closed');
      }

      function schemaStatus() {
        ensureOpen();
        return Object.freeze({
          databaseName: database.name,
          databaseVersion: database.version,
          storeNames: Object.freeze(Array.from(database.objectStoreNames))
        });
      }

      async function getSetting(key) {
        ensureOpen();
        if (typeof key !== 'string' || !key) throw new TypeError('setting key: required');
        const transaction = database.transaction(['settings'], 'readonly');
        const result = await requestPromise(transaction.objectStore('settings').get(key));
        await transactionDone(transaction);
        return result === undefined ? null : cloneJson(result);
      }

      async function putSetting(value) {
        ensureOpen();
        if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.key !== 'string' || !value.key) {
          throw new TypeError('setting: canonical keyed object required');
        }
        const transaction = database.transaction(['settings'], 'readwrite');
        transaction.objectStore('settings').put(cloneJson(value));
        await transactionDone(transaction);
        return cloneJson(value);
      }

      async function appendEvent(value) {
        ensureOpen();
        const event = Contracts.normalizeLearningEvent(value);
        const transaction = database.transaction(['events'], 'readwrite');
        const store = transaction.objectStore('events');
        const existing = await requestPromise(store.get(event.eventId));
        if (existing !== undefined) {
          await transactionDone(transaction);
          return Object.freeze({ status: 'duplicate', eventId: event.eventId });
        }
        store.add(cloneJson(event));
        await transactionDone(transaction);
        return Object.freeze({ status: 'inserted', eventId: event.eventId });
      }

      function close() {
        if (closed) return false;
        closed = true;
        database.close();
        return true;
      }

      return Object.freeze({
        schemaStatus,
        appendEvent,
        getSetting,
        putSetting,
        close
      });
    });
  }

  return Object.freeze({
    DEFAULT_PREFERENCES,
    openHaloDogfoodStore
  });
});
