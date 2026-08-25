const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  importWordNetFiles
} = require('../packages/lexical-data/en/wordnet-importer');

const nounText = [
  '  Synthetic WordNet-format fixture; not upstream corpus data.',
  '00001740 03 n 02 entity 0 physical_entity 0 000 | that which is perceived or known',
  '00005598 04 n 01 artifact 0 000 | a man-made object',
  'malformed record',
  ''
].join('\n');

const verbText = [
  '00002137 29 v 02 breathe 0 take_a_breath 0 000 00 | draw air into the lungs',
  ''
].join('\n');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function manifestFor(files) {
  const descriptors = files
    .map((file) => ({
      role: file.role,
      path: file.path,
      bytes: Buffer.byteLength(file.content),
      sha256: sha256(file.content)
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    schemaVersion: 1,
    datasetId: 'princeton-wordnet-3.0-synthetic',
    name: 'Synthetic Princeton WordNet 3.0 format fixture',
    locale: 'en',
    version: '3.0-synthetic.1',
    source: {
      publisher: 'Halo Learning test fixtures',
      canonicalUrl: 'https://wordnet.princeton.edu/documentation/wndb5wn',
      acquiredAt: '2026-08-25T00:00:00.000Z',
      retrievalMode: 'synthetic-fixture'
    },
    license: {
      schemaVersion: 1,
      licenseId: 'LicenseRef-Halo-Synthetic-Fixture',
      name: 'Halo Learning synthetic test fixture',
      url: 'https://halo-learning.local/licenses/synthetic-fixture',
      commercialUse: 'allowed',
      redistribution: 'allowed',
      attributionRequired: false,
      shareAlike: false,
      redistributionNote: 'Synthetic records only; contains no Princeton WordNet corpus data.',
      verifiedAt: '2026-08-25',
      verificationUrl: 'https://wordnet.princeton.edu/documentation/wndb5wn'
    },
    hash: { algorithm: 'sha256', value: sha256(canonical(descriptors)) },
    files: descriptors,
    bundled: true,
    redistributionNote: 'Only synthetic format fixtures are bundled.'
  };
}

function inputFiles() {
  return [
    { role: 'noun', path: 'data.noun', content: nounText },
    { role: 'verb', path: 'data.verb', content: verbText }
  ];
}

test('WordNet importer emits exact normalized entries with field-level provenance', () => {
  const files = inputFiles();
  const result = importWordNetFiles(files, manifestFor(files));

  assert.equal(result.entries.length, 5);
  assert.equal(result.rejected.length, 1);
  assert.deepEqual(
    result.entries.map(({ surface, pos }) => [surface, pos]),
    [
      ['artifact', 'n'],
      ['breathe', 'v'],
      ['entity', 'n'],
      ['physical entity', 'n'],
      ['take a breath', 'v']
    ]
  );

  const collocation = result.entries.find((entry) => entry.surface === 'take a breath');
  assert.equal(collocation.normalizedSurface, 'take a breath');
  assert.equal(collocation.source.recordRef, 'data.verb:00002137');
  assert.equal(collocation.source.lineNumber, 1);
  assert.deepEqual(collocation.glosses, [{
    text: 'draw air into the lungs',
    locale: 'en',
    ref: 'data.verb:1#gloss'
  }]);
  assert.equal(collocation.provenance.fieldOrigins.pos, 'source:data.verb:1:ss_type');
  assert.ok(collocation.provenance.transformations.includes('wordnet-underscores-to-spaces:v1'));
  assert.ok(Object.isFrozen(collocation));

  assert.deepEqual(result.rejected, [{
    path: 'data.noun',
    lineNumber: 4,
    code: 'MALFORMED_CORE_FIELDS',
    recordRef: 'data.noun:4'
  }]);
});

test('WordNet importer is deterministic across file input order', () => {
  const files = inputFiles();
  const first = importWordNetFiles(files, manifestFor(files));
  const second = importWordNetFiles([...files].reverse(), manifestFor(files));

  assert.deepEqual(second.entries, first.entries);
  assert.deepEqual(second.rejected, first.rejected);
  assert.deepEqual(second.receiptDraft, first.receiptDraft);
});

test('WordNet importer normalizes adjective satellite and rejects unsupported synset types', () => {
  const files = [{
    role: 'adjective',
    path: 'data.adj',
    content: [
      '00000001 00 s 01 satellite 0 000 | an adjective satellite',
      '00000002 00 q 01 invented 0 000 | an unsupported type',
      ''
    ].join('\n')
  }];
  const result = importWordNetFiles(files, manifestFor(files));

  assert.equal(result.entries[0].pos, 'adj');
  assert.deepEqual(result.rejected, [{
    path: 'data.adj',
    lineNumber: 2,
    code: 'UNSUPPORTED_SYNSET_TYPE',
    recordRef: 'data.adj:00000002'
  }]);
});

test('WordNet importer fails closed before parsing when an input hash is wrong', () => {
  const files = inputFiles();
  const manifest = manifestFor(files);
  manifest.files[0].sha256 = '0'.repeat(64);

  assert.throws(() => importWordNetFiles(files, manifest), /sha256/i);
});

test('bundled synthetic WordNet fixture matches its byte-level manifest', () => {
  const fixtureDir = path.join(__dirname, '..', 'fixtures', 'lexical', 'wordnet-3.0-synthetic');
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'dataset-manifest.json'), 'utf8'));
  const files = manifest.files.map((file) => ({
    role: file.role,
    path: file.path,
    content: fs.readFileSync(path.join(fixtureDir, file.path))
  }));
  const result = importWordNetFiles(files, manifest);

  assert.equal(result.entries.length, 5);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.receiptDraft.inputHash.value, manifest.hash.value);
});
