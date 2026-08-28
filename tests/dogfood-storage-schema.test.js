'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Schema = require('../apps/extension/src/shared/dogfood-storage-schema');

const EXPECTED_STORES = [
  ['profiles', 'profileKey'],
  ['sources', 'sourceId'],
  ['sentences', 'sentenceId'],
  ['analyses', 'analysisId'],
  ['events', 'eventId'],
  ['settings', 'key'],
  ['cache', 'cacheKey'],
  ['migrations', 'migrationId']
];

const EXPECTED_INDEXES = {
  profiles: [],
  sources: [['byDomain', 'domain']],
  sentences: [['bySource', 'sourceRef'], ['byCapturedAt', 'capturedAt']],
  analyses: [],
  events: [
    ['byTimestamp', 'timestamp'],
    ['bySource', 'sourceRef'],
    ['bySession', 'sessionId'],
    ['byType', 'eventType'],
    ['byInteraction', 'interactionClass']
  ],
  settings: [],
  cache: [['byExpiresAt', 'expiresAt']],
  migrations: []
};

test('v0.5 database identity and eight canonical stores are frozen', () => {
  assert.equal(Schema.DATABASE_NAME, 'halo-learning-local');
  assert.equal(Schema.DATABASE_VERSION, 1);
  assert.equal(Object.isFrozen(Schema.DATABASE_SCHEMA), true);
  assert.deepEqual(
    Schema.DATABASE_SCHEMA.stores.map((value) => [value.name, value.keyPath]),
    EXPECTED_STORES
  );
  assert.deepEqual(
    Object.fromEntries(Schema.DATABASE_SCHEMA.stores.map((store) => [
      store.name,
      store.indexes.map((index) => [index.name, index.keyPath])
    ])),
    EXPECTED_INDEXES
  );
});

test('migration registry begins with the one v0.5 non-destructive database transition', () => {
  assert.deepEqual(Schema.MIGRATIONS, [
    { id: 'v0.5.0-db-1', from: 0, to: 1 }
  ]);
  assert.equal(Object.isFrozen(Schema.MIGRATIONS), true);
  assert.equal(typeof Schema.applyUpgrade, 'function');
});
