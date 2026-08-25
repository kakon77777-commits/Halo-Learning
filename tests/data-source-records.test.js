const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const sourceGatePath = path.join(projectRoot, 'packages', 'lexical-data', 'source-gate.js');
const recordsPath = path.join(projectRoot, 'docs', 'data-sources', 'source-records.json');

function load() {
  return {
    SourceGate: require(sourceGatePath),
    records: JSON.parse(fs.readFileSync(recordsPath, 'utf8'))
  };
}

test('source gate selects one commercially redistributable target for each scoped locale', () => {
  const { SourceGate, records } = load();
  const audit = SourceGate.auditSourceRecords(records);

  assert.equal(audit.ok, true);
  assert.deepEqual(audit.selected.map((record) => record.sourceId), [
    'princeton-wordnet-3.0',
    'cc-cedict-verified-release'
  ]);
  assert.deepEqual(audit.selected.map((record) => record.locale), ['en', 'zh-Hant']);
  assert.ok(audit.selected.every((record) => record.commercialUseAllowed));
  assert.ok(audit.selected.every((record) => record.redistributionAllowed));
  assert.ok(audit.selected.every((record) => record.bundled === true));
});

test('selected source records retain official source, license, format, and acquisition policy evidence', () => {
  const { SourceGate, records } = load();
  const audit = SourceGate.auditSourceRecords(records);
  for (const record of audit.selected) {
    assert.match(record.officialSourceUrl, /^https:\/\//);
    assert.match(record.officialLicenseUrl, /^https:\/\//);
    assert.match(record.officialFormatUrl, /^https:\/\//);
    assert.ok(record.redistributionRequirements.length >= 1);
    assert.ok(record.versionPolicy.length >= 1);
    assert.equal(record.verifiedAt, '2026-08-25');
    assert.ok(record.upstreamVersion.length >= 1);
    assert.ok(record.releaseIdentity.length >= 1);
    assert.ok(record.formatVersion.length >= 1);
    assert.match(record.acquisitionReceipt, /^data\/corpora\//);
    assert.match(record.datasetManifest, /^data\/corpora\//);
    assert.match(record.sha256, /^[a-f0-9]{64}$/);
  }
});

test('CC-CEDICT release identity is distinct from its pinned V1 syntax identity', () => {
  const { SourceGate, records } = load();
  const cedict = SourceGate.auditSourceRecords(records).selected
    .find((record) => record.sourceId === 'cc-cedict-verified-release');

  assert.equal(cedict.upstreamVersion, '2026-08-24T05:05:01Z');
  assert.equal(cedict.releaseIdentity, 'MDBG-2026-08-24T05:05:01Z-124925');
  assert.equal(cedict.formatVersion, 'CC-CEDICT-V1');
  assert.notEqual(cedict.releaseIdentity, cedict.formatVersion);
  assert.equal(cedict.transport.kind, 'pinned-public-mirror');
  assert.equal(cedict.transport.revision, '6514f6822e8dc582fb924a00e1afdf5bbc66fe62');
});

test('source gate refuses a selected noncommercial or nonredistributable dataset', () => {
  const { SourceGate, records } = load();
  const tampered = JSON.parse(JSON.stringify(records));
  const cwn = tampered.sources.find((record) => record.sourceId === 'ntu-chinese-wordnet-2.0');
  cwn.selected = true;
  cwn.locale = 'zh-Hant';
  tampered.sources.find((record) => record.sourceId === 'cc-cedict-verified-release').selected = false;

  assert.throws(() => SourceGate.auditSourceRecords(tampered), /commercialUseAllowed/);
});

test('unselected rejected source keeps a written exclusion reason', () => {
  const { SourceGate, records } = load();
  const audit = SourceGate.auditSourceRecords(records);
  const cwn = audit.rejected.find((record) => record.sourceId === 'ntu-chinese-wordnet-2.0');
  assert.match(cwn.rejectionReason, /commercial/i);
  assert.match(cwn.rejectionReason, /redistribut/i);
});
