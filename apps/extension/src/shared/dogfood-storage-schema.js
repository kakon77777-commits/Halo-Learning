(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDogfoodStorageSchema = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DATABASE_NAME = 'halo-learning-local';
  const DATABASE_VERSION = 1;

  function frozenIndex(name, keyPath) {
    return Object.freeze({ name, keyPath });
  }

  function frozenStore(name, keyPath, indexes) {
    return Object.freeze({ name, keyPath, indexes: Object.freeze(indexes) });
  }

  const DATABASE_SCHEMA = Object.freeze({
    name: DATABASE_NAME,
    version: DATABASE_VERSION,
    stores: Object.freeze([
      frozenStore('profiles', 'profileKey', []),
      frozenStore('sources', 'sourceId', [frozenIndex('byDomain', 'domain')]),
      frozenStore('sentences', 'sentenceId', [
        frozenIndex('bySource', 'sourceRef'),
        frozenIndex('byCapturedAt', 'capturedAt')
      ]),
      frozenStore('analyses', 'analysisId', []),
      frozenStore('events', 'eventId', [
        frozenIndex('byTimestamp', 'timestamp'),
        frozenIndex('bySource', 'sourceRef'),
        frozenIndex('bySession', 'sessionId'),
        frozenIndex('byType', 'eventType'),
        frozenIndex('byInteraction', 'interactionClass')
      ]),
      frozenStore('settings', 'key', []),
      frozenStore('cache', 'cacheKey', [frozenIndex('byExpiresAt', 'expiresAt')]),
      frozenStore('migrations', 'migrationId', [])
    ])
  });

  const MIGRATIONS = Object.freeze([
    Object.freeze({ id: 'v0.5.0-db-1', from: 0, to: 1 })
  ]);

  function createStore(database, descriptor) {
    const store = database.createObjectStore(descriptor.name, { keyPath: descriptor.keyPath });
    for (const index of descriptor.indexes) store.createIndex(index.name, index.keyPath, { unique: false });
    return store;
  }

  function applyUpgrade(options) {
    const settings = options || {};
    const database = settings.database || settings.db;
    const transaction = settings.transaction;
    const oldVersion = Number(settings.oldVersion);
    const newVersion = settings.newVersion === null || settings.newVersion === undefined
      ? DATABASE_VERSION
      : Number(settings.newVersion);
    if (!database || typeof database.createObjectStore !== 'function') {
      throw new TypeError('database: IndexedDB database required');
    }
    if (!transaction || typeof transaction.objectStore !== 'function') {
      throw new TypeError('transaction: IndexedDB upgrade transaction required');
    }
    if (!Number.isInteger(oldVersion) || oldVersion < 0 ||
        !Number.isInteger(newVersion) || newVersion < oldVersion || newVersion > DATABASE_VERSION) {
      throw new TypeError('upgrade versions: invalid');
    }
    if (oldVersion === newVersion) return Object.freeze({ applied: Object.freeze([]) });
    if (oldVersion !== 0 || newVersion !== 1) throw new Error(`unsupported database migration ${oldVersion}->${newVersion}`);

    for (const store of DATABASE_SCHEMA.stores) createStore(database, store);
    const migration = MIGRATIONS[0];
    const now = typeof settings.now === 'function' ? settings.now : () => Date.now();
    const timestamp = new Date(Number(now())).toISOString();
    transaction.objectStore('migrations').put(Object.freeze({
      migrationId: migration.id,
      from: migration.from,
      to: migration.to,
      appliedAt: timestamp
    }));
    return Object.freeze({ applied: Object.freeze([migration.id]) });
  }

  return Object.freeze({
    DATABASE_NAME,
    DATABASE_VERSION,
    DATABASE_SCHEMA,
    MIGRATIONS,
    applyUpgrade
  });
});
