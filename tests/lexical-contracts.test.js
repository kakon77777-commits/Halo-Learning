const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const contractsPath = path.join(__dirname, '..', 'packages', 'contracts', 'lexical-contracts.js');

function loadContracts() {
  return require(contractsPath);
}

function licenseFixture() {
  return {
    schemaVersion: 1,
    licenseId: 'WordNet',
    name: 'Princeton WordNet License',
    url: 'https://wordnet.princeton.edu/documentation/wnlicens7wn',
    commercialUse: 'allowed',
    redistribution: 'allowed-with-notice',
    attributionRequired: true,
    shareAlike: false,
    redistributionNote: 'Preserve the copyright, license, and disclaimer on every copy.',
    verifiedAt: '2026-08-25',
    verificationUrl: 'https://wordnet.princeton.edu/documentation/wnlicens7wn'
  };
}

function datasetFixture() {
  return {
    schemaVersion: 1,
    datasetId: 'princeton-wordnet-3.0-fixture',
    name: 'Princeton WordNet 3.0 synthetic fixture',
    locale: 'en',
    version: '3.0-fixture.1',
    source: {
      publisher: 'Halo Learning test fixture',
      canonicalUrl: 'https://wordnet.princeton.edu/',
      acquiredAt: '2026-08-25T00:00:00.000Z',
      retrievalMode: 'synthetic-fixture'
    },
    license: licenseFixture(),
    hash: { algorithm: 'sha256', value: 'a'.repeat(64) },
    files: [
      { role: 'data.noun', path: 'data.noun', bytes: 120, sha256: 'b'.repeat(64) }
    ],
    bundled: false,
    redistributionNote: 'No upstream WordNet records are bundled.'
  };
}

function lexicalEntryFixture() {
  return {
    schemaVersion: 1,
    entryId: 'wn30:00001740-n:entity',
    locale: 'en',
    surface: 'entity',
    normalizedSurface: 'entity',
    lemma: 'entity',
    pos: 'n',
    posConfidence: 1,
    glosses: [{ text: 'that which is perceived to exist', locale: 'en', ref: 'wn30:00001740-n' }],
    glossRefs: ['wn30:00001740-n'],
    aliases: [],
    source: {
      datasetId: 'princeton-wordnet-3.0-fixture',
      version: '3.0-fixture.1',
      recordRef: 'data.noun:00001740',
      lineNumber: 1
    },
    provenance: {
      fieldOrigins: { surface: 'source', lemma: 'source', pos: 'source', glosses: 'source' },
      transformations: ['underscore-to-space']
    }
  };
}

test('lexical contracts round-trip valid values without losing provenance', () => {
  const Contracts = loadContracts();
  const manifest = Contracts.normalizeDatasetManifest(JSON.parse(JSON.stringify(datasetFixture())));
  const entry = Contracts.normalizeLexicalEntry(JSON.parse(JSON.stringify(lexicalEntryFixture())));

  assert.equal(manifest.locale, 'en');
  assert.equal(manifest.license.licenseId, 'WordNet');
  assert.equal(manifest.hash.value.length, 64);
  assert.equal(entry.source.recordRef, 'data.noun:00001740');
  assert.deepEqual(entry.glossRefs, ['wn30:00001740-n']);
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(entry), true);
});

test('dataset manifests reject unscoped locale and malformed SHA-256', () => {
  const Contracts = loadContracts();
  assert.throws(
    () => Contracts.normalizeDatasetManifest({ ...datasetFixture(), locale: 'fr' }),
    /locale/
  );
  assert.throws(
    () => Contracts.normalizeDatasetManifest({ ...datasetFixture(), hash: { algorithm: 'sha256', value: 'abc' } }),
    /hash\.value/
  );
});

test('license records require explicit commercial and redistribution decisions', () => {
  const Contracts = loadContracts();
  const missingCommercial = { ...licenseFixture() };
  delete missingCommercial.commercialUse;
  assert.throws(() => Contracts.normalizeLicenseRecord(missingCommercial), /commercialUse/);

  const invalidRedistribution = { ...licenseFixture(), redistribution: 'unknown' };
  assert.throws(() => Contracts.normalizeLicenseRecord(invalidRedistribution), /redistribution/);
});

test('lexical entries reject invented certainty and missing field provenance', () => {
  const Contracts = loadContracts();
  assert.throws(
    () => Contracts.normalizeLexicalEntry({ ...lexicalEntryFixture(), posConfidence: 1.2 }),
    /posConfidence/
  );
  const missingOrigins = lexicalEntryFixture();
  missingOrigins.provenance = { transformations: [] };
  assert.throws(() => Contracts.normalizeLexicalEntry(missingOrigins), /fieldOrigins/);
});

test('corpus build receipts preserve input/output hashes and deterministic counts', () => {
  const Contracts = loadContracts();
  const receipt = Contracts.normalizeCorpusBuildReceipt({
    schemaVersion: 1,
    receiptId: 'receipt:fixture:1',
    datasetId: 'princeton-wordnet-3.0-fixture',
    datasetVersion: '3.0-fixture.1',
    importer: { id: 'halo-wordnet-importer', version: '0.2.0' },
    inputHash: { algorithm: 'sha256', value: 'c'.repeat(64) },
    outputHash: { algorithm: 'sha256', value: 'd'.repeat(64) },
    entryCount: 2,
    rejectedCount: 1,
    builtAt: '2026-08-25T00:00:00.000Z',
    reproducibility: { canonicalOrder: true, deterministicIndexHash: true }
  });
  assert.equal(receipt.entryCount, 2);
  assert.equal(receipt.rejectedCount, 1);
  assert.equal(receipt.reproducibility.deterministicIndexHash, true);
});
