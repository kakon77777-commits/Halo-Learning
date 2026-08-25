const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const validatorPath = path.join(__dirname, '..', 'scripts', 'validate-v0.2.0.js');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function selectedSource(sourceId, locale) {
  return {
    sourceId,
    locale,
    selected: true,
    bundled: false,
    commercialUseAllowed: true,
    redistributionAllowed: true,
    officialSourceUrl: 'https://example.invalid/source',
    officialLicenseUrl: 'https://example.invalid/license',
    officialFormatUrl: 'https://example.invalid/format',
    licenseId: 'fixture-license',
    versionPolicy: 'pin exact fixture bytes',
    redistributionRequirements: ['retain notice'],
    verifiedAt: '2026-08-25'
  };
}

function dataset(locale) {
  return {
    datasetId: `fixture-${locale}`,
    locale,
    version: '1',
    source: { canonicalUrl: 'https://example.invalid/source' },
    license: {
      licenseId: 'fixture-license',
      redistributionNote: 'retain notice',
      verificationUrl: 'https://example.invalid/license'
    },
    hash: { algorithm: 'sha256', value: 'a'.repeat(64) },
    files: [{ path: 'fixture.dat', bytes: 1, sha256: 'b'.repeat(64) }]
  };
}

function createAuditFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-release-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeJson(path.join(root, 'docs', 'data-sources', 'source-records.json'), {
    schemaVersion: 1,
    sources: [selectedSource('fixture-en', 'en'), selectedSource('fixture-zh', 'zh-Hant')]
  });
  writeJson(path.join(root, 'dist', 'data-manifest.json'), {
    schemaVersion: 1,
    locales: ['en', 'zh-Hant'],
    datasets: [dataset('en'), dataset('zh-Hant')],
    releaseFixture: { syntheticOnly: true, upstreamCorpusBytesBundled: false }
  });
  writeJson(path.join(root, 'apps', 'extension', 'manifest.json'), {
    manifest_version: 3,
    version: '0.2.0',
    permissions: ['activeTab', 'scripting', 'storage']
  });
  fs.mkdirSync(path.join(root, 'apps', 'extension', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'extension', 'src', 'safe.js'), "'use strict';\n");
  fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), '# Fixture notices\n');
  return root;
}

function auditOnly(root) {
  return childProcess.spawnSync(process.execPath, [validatorPath, '--root', root, '--audit-only'], {
    encoding: 'utf8'
  });
}

test('release audit exits zero for complete local-only provenance fixture', (t) => {
  const root = createAuditFixture(t);
  const result = auditOnly(root);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
});

test('release audit exits nonzero when a dataset lacks license provenance', (t) => {
  const root = createAuditFixture(t);
  const manifestPath = path.join(root, 'dist', 'data-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  delete manifest.datasets[0].license;
  writeJson(manifestPath, manifest);
  const result = auditOnly(root);

  assert.notEqual(result.status, 0);
  assert.ok(JSON.parse(result.stdout).issues.some((issue) => issue.code === 'MISSING_PROVENANCE'));
});

test('release audit exits nonzero when executable source contains a remote URL', (t) => {
  const root = createAuditFixture(t);
  fs.writeFileSync(
    path.join(root, 'apps', 'extension', 'src', 'remote.js'),
    "fetch('https://remote.invalid/provider');\n"
  );
  const result = auditOnly(root);

  assert.notEqual(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.ok(report.issues.some((issue) => issue.code === 'REMOTE_EXECUTABLE_URL'));
  assert.equal(report.issues.some((issue) => String(issue.detail).includes('provider')), false);
});
