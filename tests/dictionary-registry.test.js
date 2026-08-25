const test = require('node:test');
const assert = require('node:assert/strict');

const { buildLexicalIndex, serializeLexicalIndex } = require('../packages/lexical-index/lexical-index');
const { createDictionaryRegistry } = require('../packages/lexical-index/dictionary-registry');

function lexicalEntry(overrides) {
  const values = overrides || {};
  const surface = values.surface || 'orbit';
  const locale = values.locale || 'en';
  return {
    schemaVersion: 1,
    entryId: values.entryId || `registry-fixture:${locale}:${surface}`,
    locale,
    surface,
    normalizedSurface: locale === 'en' ? surface.toLowerCase() : surface,
    lemma: surface,
    pos: values.pos || 'n',
    posConfidence: values.posConfidence === undefined ? 1 : values.posConfidence,
    glosses: [{ text: values.gloss || 'fixture gloss', locale: 'en', ref: 'registry-fixture#gloss' }],
    glossRefs: ['registry-fixture#gloss'],
    aliases: [],
    source: {
      datasetId: 'registry-fixture',
      version: '1',
      recordRef: `registry-fixture:${surface}`,
      lineNumber: values.lineNumber || 1,
      recordData: {}
    },
    provenance: {
      fieldOrigins: {
        surface: 'registry-fixture:surface',
        lemma: 'registry-fixture:lemma',
        pos: 'registry-fixture:pos',
        glosses: 'registry-fixture:glosses'
      },
      transformations: []
    }
  };
}

function serializedFixtureIndex() {
  return serializeLexicalIndex(buildLexicalIndex([
    lexicalEntry(),
    lexicalEntry({ surface: '魔法手', locale: 'zh-Hant', gloss: 'Magic Hand', lineNumber: 2 })
  ], { indexId: 'registry-fixture-v1' }));
}

function bootstrapProvider() {
  const calls = [];
  const provider = {
    id: 'bootstrap-fixture',
    calls,
    lookup(surface, lang) {
      calls.push({ surface, lang });
      if (surface.toLowerCase() === 'orbit' && lang === 'en') return { surface, lang, pos: 'x', source: 'bootstrap' };
      if (surface === '學習' && lang === 'zh') return { surface, lang, pos: 'v', source: 'bootstrap' };
      return null;
    }
  };
  return provider;
}

test('dictionary registry gives verified corpus entries precedence without mutating bootstrap provider', () => {
  const bootstrap = bootstrapProvider();
  const snapshot = { id: bootstrap.id, lookup: bootstrap.lookup, calls: bootstrap.calls };
  const registry = createDictionaryRegistry({
    bootstrapProvider: bootstrap,
    indexes: [serializedFixtureIndex()]
  });

  const found = registry.lookup('ORBIT', 'en');
  assert.equal(found.source.datasetId, 'registry-fixture');
  assert.equal(found.pos, 'n');
  assert.equal(bootstrap.calls.length, 0);
  assert.equal(bootstrap.id, snapshot.id);
  assert.equal(bootstrap.lookup, snapshot.lookup);
  assert.equal(bootstrap.calls, snapshot.calls);
});

test('dictionary registry starts and falls back when no corpus exists', () => {
  const bootstrap = bootstrapProvider();
  const registry = createDictionaryRegistry({ bootstrapProvider: bootstrap, indexes: [] });

  assert.equal(registry.lookup('學習', 'zh').source, 'bootstrap');
  assert.deepEqual(bootstrap.calls, [{ surface: '學習', lang: 'zh' }]);
  assert.deepEqual(registry.status(), {
    mode: 'bootstrap-only',
    indexCount: 0,
    failures: []
  });
});

test('corrupt corpus registration records a sanitized degraded status and preserves fallback', () => {
  const document = JSON.parse(serializedFixtureIndex());
  document.hash.value = '0'.repeat(64);
  const bootstrap = bootstrapProvider();
  const registry = createDictionaryRegistry({ bootstrapProvider: bootstrap });

  assert.deepEqual(registry.register(JSON.stringify(document)), { ok: false, code: 'HASH_MISMATCH' });
  assert.equal(registry.lookup('orbit', 'en').source, 'bootstrap');
  assert.deepEqual(registry.status(), {
    mode: 'degraded',
    indexCount: 0,
    failures: [{ code: 'HASH_MISMATCH' }]
  });
});

test('missing corpus input is recoverable and does not expose file or corpus content', () => {
  const registry = createDictionaryRegistry({
    bootstrapProvider: bootstrapProvider(),
    indexes: [undefined]
  });

  const status = registry.status();
  assert.equal(status.mode, 'degraded');
  assert.deepEqual(status.failures, [{ code: 'INVALID_DOCUMENT' }]);
  assert.equal(Object.hasOwn(status.failures[0], 'message'), false);
  assert.equal(Object.hasOwn(status.failures[0], 'path'), false);
});

test('dictionary registry exposes corpus longest-match and refuses locale scope expansion', () => {
  const bootstrap = bootstrapProvider();
  const registry = createDictionaryRegistry({ bootstrapProvider: bootstrap, indexes: [serializedFixtureIndex()] });

  const match = registry.longestMatch('這是魔法手', 2, 'zh');
  assert.equal(match.surface, '魔法手');
  assert.equal(match.start, 2);
  assert.equal(match.end, 5);
  assert.equal(registry.lookup('orbit', 'fr'), null);
  assert.equal(bootstrap.calls.length, 0);
});
