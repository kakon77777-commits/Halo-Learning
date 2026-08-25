const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeDatasetManifest } = require('../packages/contracts/lexical-contracts');

const root = path.join(__dirname, '..');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function loadDataset(relativeDir) {
  const directory = path.join(root, relativeDir);
  const manifest = normalizeDatasetManifest(JSON.parse(
    fs.readFileSync(path.join(directory, 'dataset-manifest.json'), 'utf8')
  ));
  const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'acquisition-receipt.json'), 'utf8'));
  return { directory, manifest, receipt };
}

test('bundled Princeton WordNet 3.0 bytes match the pinned upstream archive and per-file provenance', () => {
  const { directory, manifest, receipt } = loadDataset('data/corpora/princeton-wordnet-3.0');

  assert.equal(manifest.datasetId, 'princeton-wordnet-3.0');
  assert.equal(manifest.version, '3.0');
  assert.equal(manifest.releaseIdentity, 'Princeton-WordNet-3.0');
  assert.equal(manifest.formatVersion, 'WordNet-database-files-3.0');
  assert.equal(manifest.bundled, true);
  assert.equal(receipt.upstreamArtifact.sha256, '640db279c949a88f61f851dd54ebbb22d003f8b90b85267042ef85a3781d3a52');
  assert.equal(receipt.upstreamArtifact.bytes, 11537239);

  for (const file of manifest.files) {
    const bytes = fs.readFileSync(path.join(directory, file.path));
    assert.equal(bytes.byteLength, file.bytes, file.path);
    assert.equal(sha256(bytes), file.sha256, file.path);
  }
  assert.ok(manifest.attributionRequirements.length > 0);
  assert.ok(manifest.redistributionRequirements.length > 0);
});

test('bundled CC-CEDICT is the verified MDBG release in V1 edition, with mirror only as transport', () => {
  const { directory, manifest, receipt } = loadDataset('data/corpora/cc-cedict-v1-2026-08-24');
  const dictionary = manifest.files.find((file) => file.role === 'dictionary');
  const bytes = fs.readFileSync(path.join(directory, dictionary.path));

  assert.equal(manifest.datasetId, 'cc-cedict-v1-2026-08-24');
  assert.equal(manifest.version, '2026-08-24T05:05:01Z');
  assert.equal(manifest.releaseIdentity, 'MDBG-2026-08-24T05:05:01Z-124925');
  assert.equal(manifest.formatVersion, 'CC-CEDICT-V1');
  assert.equal(manifest.license.licenseId, 'CC-BY-SA-4.0');
  assert.equal(sha256(bytes), '27b881871e6ca5cacbc376e5b0fd0d60187e8940f9e6b2b7ac83d3c1f05bf5d4');
  assert.equal(receipt.transport.kind, 'pinned-public-mirror');
  assert.equal(receipt.transport.revision, '6514f6822e8dc582fb924a00e1afdf5bbc66fe62');
  assert.notEqual(receipt.transport.url, manifest.source.canonicalUrl);
  assert.match(bytes.subarray(0, 1024).toString('utf8'), /^#!\s+version=1/m);
  assert.match(bytes.subarray(0, 1024).toString('utf8'), /^#!\s+entries=124925/m);
});

test('verified corpus manifests fail closed if release or format identity is omitted', () => {
  const { manifest } = loadDataset('data/corpora/princeton-wordnet-3.0');
  const missingRelease = JSON.parse(JSON.stringify(manifest));
  delete missingRelease.releaseIdentity;
  const missingFormat = JSON.parse(JSON.stringify(manifest));
  delete missingFormat.formatVersion;

  assert.throws(() => normalizeDatasetManifest(missingRelease), /releaseIdentity/);
  assert.throws(() => normalizeDatasetManifest(missingFormat), /formatVersion/);
});
