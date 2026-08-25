const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { importWordNetFiles } = require('../packages/lexical-data/en/wordnet-importer');
const { importCcCedict } = require('../packages/lexical-data/zh/cc-cedict-importer');
const {
  LexicalIndexIntegrityError,
  buildLexicalIndex,
  loadLexicalIndex,
  serializeLexicalIndex
} = require('../packages/lexical-index/lexical-index');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fixtureEntries() {
  const fixtureRoot = path.join(__dirname, '..', 'fixtures', 'lexical');
  const wordnetDir = path.join(fixtureRoot, 'wordnet-3.0-synthetic');
  const wordnetManifest = readJson(path.join(wordnetDir, 'dataset-manifest.json'));
  const wordnetFiles = wordnetManifest.files.map((file) => ({
    role: file.role,
    path: file.path,
    content: fs.readFileSync(path.join(wordnetDir, file.path))
  }));
  const cedictDir = path.join(fixtureRoot, 'cc-cedict-synthetic');
  const cedictManifest = readJson(path.join(cedictDir, 'dataset-manifest.json'));
  const cedictText = fs.readFileSync(path.join(cedictDir, cedictManifest.files[0].path));
  return [
    ...importWordNetFiles(wordnetFiles, wordnetManifest).entries,
    ...importCcCedict(cedictText, cedictManifest).entries
  ];
}

function withSecondArtifactSense(entries) {
  const artifact = entries.find((entry) => entry.surface === 'artifact');
  return [...entries, {
    ...artifact,
    entryId: `${artifact.entryId}:second-sense`,
    glosses: [{ text: 'an observed result of a process', locale: 'en', ref: 'synthetic:artifact#gloss' }],
    glossRefs: ['synthetic:artifact#gloss'],
    source: {
      ...artifact.source,
      recordRef: 'synthetic:artifact:second-sense',
      lineNumber: 99
    },
    provenance: {
      ...artifact.provenance,
      fieldOrigins: {
        ...artifact.provenance.fieldOrigins,
        glosses: 'synthetic:artifact:second-sense#gloss'
      }
    }
  }];
}

test('lexical index preserves duplicate senses and normalizes English case only', () => {
  const index = buildLexicalIndex(withSecondArtifactSense(fixtureEntries()));

  assert.equal(index.lookup('ARTIFACT', 'en').length, 2);
  assert.equal(index.lookup('artifact', 'en').length, 2);
  assert.equal(index.lookup('學習', 'zh-Hant').length, 1);
  assert.equal(index.lookup('学习', 'zh-Hant').length, 0);
  assert.deepEqual(index.lookup('artifact', 'fr'), []);
  assert.ok(Object.isFrozen(index.lookup('artifact', 'en')));
});

test('Traditional Chinese longest match returns exact UTF-16 source offsets and all senses', () => {
  const index = buildLexicalIndex(fixtureEntries());
  const match = index.longestMatch('我愛魔法手標記', 2, 'zh-Hant');

  assert.equal(match.surface, '魔法手');
  assert.equal(match.start, 2);
  assert.equal(match.end, 5);
  assert.equal(match.entries.length, 1);
  assert.equal(index.longestMatch('我愛魔法手標記', 3, 'zh-Hant'), null);
});

test('index bytes and hash are stable across source entry order', () => {
  const entries = withSecondArtifactSense(fixtureEntries());
  const forward = buildLexicalIndex(entries, { indexId: 'fixture-v1' });
  const reverse = buildLexicalIndex([...entries].reverse(), { indexId: 'fixture-v1' });

  assert.equal(reverse.hash.value, forward.hash.value);
  assert.equal(serializeLexicalIndex(reverse), serializeLexicalIndex(forward));
  assert.deepEqual(reverse.sourceDatasets, [
    'cc-cedict-synthetic@synthetic.1',
    'princeton-wordnet-3.0-synthetic@3.0-synthetic.1'
  ]);
});

test('serialized indexes reload with integrity and without renderer projection state', () => {
  const built = buildLexicalIndex(fixtureEntries());
  const serialized = serializeLexicalIndex(built);
  const loaded = loadLexicalIndex(serialized);

  assert.equal(loaded.hash.value, built.hash.value);
  assert.equal(loaded.lookup('breathe', 'en')[0].pos, 'v');
  for (const entry of loaded.entries) {
    assert.equal(Object.hasOwn(entry, 'color'), false);
    assert.equal(Object.hasOwn(entry, 'labelPosition'), false);
    assert.equal(Object.hasOwn(entry, 'renderPlan'), false);
  }
});

test('lexical index rejects payload or hash tampering', () => {
  const serialized = serializeLexicalIndex(buildLexicalIndex(fixtureEntries()));
  const tamperedPayload = JSON.parse(serialized);
  tamperedPayload.entries[0].glosses[0].text = 'tampered';
  assert.throws(
    () => loadLexicalIndex(JSON.stringify(tamperedPayload)),
    (error) => error instanceof LexicalIndexIntegrityError && error.code === 'HASH_MISMATCH'
  );

  const tamperedHash = JSON.parse(serialized);
  tamperedHash.hash.value = '0'.repeat(64);
  assert.throws(() => loadLexicalIndex(JSON.stringify(tamperedHash)), LexicalIndexIntegrityError);
});
