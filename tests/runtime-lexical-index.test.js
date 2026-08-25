const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { importWordNetFiles } = require('../packages/lexical-data/en/wordnet-importer');
const { importCcCedict } = require('../packages/lexical-data/zh/cc-cedict-importer');
const {
  RuntimeLexicalIndexIntegrityError,
  buildRuntimeLexicalIndex,
  loadRuntimeLexicalIndex,
  serializeRuntimeLexicalIndex
} = require('../packages/lexical-index/runtime-lexical-index');

const root = path.join(__dirname, '..');

function loadManifest(relativeDir) {
  return JSON.parse(fs.readFileSync(path.join(root, relativeDir, 'dataset-manifest.json'), 'utf8'));
}

function fixtureDataset() {
  const enDir = path.join(root, 'fixtures/lexical/wordnet-3.0-synthetic');
  const zhDir = path.join(root, 'fixtures/lexical/cc-cedict-synthetic');
  const enManifest = loadManifest('fixtures/lexical/wordnet-3.0-synthetic');
  const zhManifest = loadManifest('fixtures/lexical/cc-cedict-synthetic');
  const enFiles = enManifest.files.map((descriptor) => ({
    role: descriptor.role,
    path: descriptor.path,
    content: fs.readFileSync(path.join(enDir, descriptor.path))
  }));
  const en = importWordNetFiles(enFiles, enManifest);
  const zh = importCcCedict(
    fs.readFileSync(path.join(zhDir, zhManifest.files[0].path)),
    zhManifest
  );
  return {
    entries: [...en.entries, ...zh.entries],
    datasetManifests: [enManifest, zhManifest],
    morphologyExceptions: [{
      inflected: 'entities',
      lemmas: ['entity'],
      pos: 'n',
      source: {
        datasetId: enManifest.datasetId,
        version: enManifest.version,
        recordRef: 'noun.exc:1',
        lineNumber: 1
      }
    }]
  };
}

function buildFixture(entriesTransform) {
  const fixture = fixtureDataset();
  const entries = entriesTransform ? entriesTransform(fixture.entries) : fixture.entries;
  return buildRuntimeLexicalIndex(entries, {
    indexId: 'halo-runtime-fixture-v1',
    builtAt: '2026-08-25T00:00:00.000Z',
    datasetManifests: fixture.datasetManifests,
    morphologyExceptions: fixture.morphologyExceptions
  });
}

test('compact runtime index reconstructs provider-neutral English lexical and gloss evidence', () => {
  const index = buildFixture();
  const matches = index.lookup('ENTITY', 'en');

  assert.equal(matches.length, 1);
  assert.equal(matches[0].surface, 'entity');
  assert.equal(matches[0].lemma, 'entity');
  assert.equal(matches[0].simplifiedPos, 'n');
  assert.equal(matches[0].posConfidence, 1);
  assert.match(matches[0].lexicalRef, /data\.noun:00001740/);
  assert.match(matches[0].glossRef, /data\.noun:2#gloss/);
  assert.match(matches[0].gloss, /perceived or known/);
  assert.deepEqual(matches[0].datasetRef, {
    datasetId: 'princeton-wordnet-3.0-synthetic',
    datasetVersion: '3.0-synthetic.1',
    recordRef: 'data.noun:00001740'
  });
  assert.equal(Object.isFrozen(matches[0]), true);
});

test('runtime index preserves distinct same-surface same-POS lexical senses and their gloss references', () => {
  const fixture = fixtureDataset();
  const original = fixture.entries.find((entry) => entry.locale === 'en' && entry.normalizedSurface === 'entity');
  const secondSense = JSON.parse(JSON.stringify(original));
  secondSense.entryId = `${original.entryId}:second-sense`;
  secondSense.source.recordRef = 'data.noun:99999999';
  secondSense.source.lineNumber = 999;
  secondSense.glosses[0].text = 'a second fixture sense';
  secondSense.glosses[0].ref = 'data.noun:999#gloss';
  secondSense.glossRefs = ['data.noun:999#gloss'];
  const index = buildRuntimeLexicalIndex([...fixture.entries, secondSense], {
    indexId: 'halo-runtime-multisense-fixture-v1',
    builtAt: '2026-08-25T00:00:00.000Z',
    datasetManifests: fixture.datasetManifests,
    morphologyExceptions: fixture.morphologyExceptions
  });

  const matches = index.lookup('entity', 'en');
  assert.equal(matches.length, 2);
  assert.deepEqual(new Set(matches.map((entry) => entry.lexicalRef)), new Set([
    original.source.recordRef,
    secondSense.source.recordRef
  ]));
  assert.deepEqual(new Set(matches.map((entry) => entry.glossRef)), new Set([
    original.glossRefs[0],
    secondSense.glossRefs[0]
  ]));
});

test('Traditional-Chinese runtime lookup retains counterpart evidence and deterministic longest match', () => {
  const index = buildFixture();
  const matches = index.lookup('學習', 'zh-Hant');
  const longest = index.longestMatch('我正在學習中文', 3, 'zh-Hant');

  assert.equal(matches[0].traditional, '學習');
  assert.equal(matches[0].simplified, '学习');
  assert.equal(matches[0].pinyin, 'xue2 xi2');
  assert.equal(matches[0].simplifiedPos, 'v');
  assert.equal(matches[0].posConfidence, 0.55);
  assert.equal(longest.surface, '學習');
  assert.equal(longest.start, 3);
  assert.equal(longest.end, 5);
  assert.equal(longest.entries[0].lexicalRef, matches[0].lexicalRef);
});

test('runtime morphology lookup preserves source-traceable exception evidence', () => {
  const index = buildFixture();
  assert.deepEqual(index.lookupMorphology('ENTITIES', 'en'), [{
    inflected: 'entities',
    lemma: 'entity',
    simplifiedPos: 'n',
    datasetRef: {
      datasetId: 'princeton-wordnet-3.0-synthetic',
      datasetVersion: '3.0-synthetic.1',
      recordRef: 'noun.exc:1'
    }
  }]);
});

test('compact runtime bytes are deterministic and exclude importer and renderer representations', () => {
  const forward = buildFixture();
  const reverse = buildFixture((entries) => [...entries].reverse());
  const serialized = serializeRuntimeLexicalIndex(forward);

  assert.equal(serializeRuntimeLexicalIndex(reverse), serialized);
  assert.equal(serialized.includes('recordData'), false);
  assert.equal(serialized.includes('fieldOrigins'), false);
  assert.equal(serialized.includes('colorClass'), false);
  assert.equal(serialized.includes('labelPosition'), false);
  assert.equal(serialized.includes('renderPlan'), false);
  assert.match(forward.hash.value, /^[a-f0-9]{64}$/);
});

test('runtime loader rejects malformed, tampered, and non-canonical documents before lookup', () => {
  const serialized = serializeRuntimeLexicalIndex(buildFixture());
  const tampered = JSON.parse(serialized);
  tampered.englishRows[0][1] = 'fabricated';

  assert.throws(
    () => loadRuntimeLexicalIndex(JSON.stringify(tampered)),
    (error) => error instanceof RuntimeLexicalIndexIntegrityError && error.code === 'HASH_MISMATCH'
  );
  assert.throws(
    () => loadRuntimeLexicalIndex('{bad json'),
    (error) => error instanceof RuntimeLexicalIndexIntegrityError && error.code === 'INVALID_JSON'
  );

  const reordered = JSON.parse(serialized);
  reordered.englishRows.reverse();
  const payload = { ...reordered };
  delete payload.hash;
  const { sha256Hex, canonicalJson } = require('../packages/lexical-data/shared/build-utils');
  reordered.hash.value = sha256Hex(canonicalJson(payload));
  assert.throws(
    () => loadRuntimeLexicalIndex(reordered),
    (error) => error instanceof RuntimeLexicalIndexIntegrityError && error.code === 'NON_CANONICAL_ORDER'
  );
});

test('runtime loader validates gloss canonical order using the same raw UTF-8 rule as the builder', () => {
  const fixture = fixtureDataset();
  const quoted = JSON.parse(JSON.stringify(fixture.entries.find((entry) => entry.locale === 'en')));
  quoted.entryId = `${quoted.entryId}:quoted`;
  quoted.surface = 'quotedfixture';
  quoted.normalizedSurface = 'quotedfixture';
  quoted.lemma = 'quotedfixture';
  quoted.source.recordRef = 'data.noun:quoted';
  quoted.glosses[0].text = '"A quoted gloss"';
  const parenthesized = JSON.parse(JSON.stringify(quoted));
  parenthesized.entryId = `${quoted.entryId}:parenthesized`;
  parenthesized.surface = 'parenthesizedfixture';
  parenthesized.normalizedSurface = 'parenthesizedfixture';
  parenthesized.lemma = 'parenthesizedfixture';
  parenthesized.source.recordRef = 'data.noun:parenthesized';
  parenthesized.glosses[0].text = '(a parenthesized gloss)';
  const index = buildRuntimeLexicalIndex([parenthesized, quoted], {
    indexId: 'gloss-order-fixture',
    builtAt: '2026-08-25T00:00:00.000Z',
    datasetManifests: fixture.datasetManifests,
    morphologyExceptions: []
  });

  assert.doesNotThrow(() => loadRuntimeLexicalIndex(serializeRuntimeLexicalIndex(index)));
});
