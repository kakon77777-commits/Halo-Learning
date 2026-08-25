const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const buildScript = path.join(projectRoot, 'scripts', 'build-lexical-data.js');
const enFixture = path.join(projectRoot, 'fixtures', 'lexical', 'wordnet-3.0-synthetic');
const zhFixtureDir = path.join(projectRoot, 'fixtures', 'lexical', 'cc-cedict-synthetic');
const zhFixture = path.join(zhFixtureDir, 'cedict_ts.u8');

function runBuild(outDir, options) {
  const settings = options || {};
  return childProcess.spawnSync(process.execPath, [
    buildScript,
    '--en-dir', settings.enDir || enFixture,
    '--zh-file', settings.zhFile || zhFixture,
    '--out', outDir
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, SOURCE_DATE_EPOCH: settings.epoch || '1787616000' }
  });
}

function createTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-lexical-build-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('lexical build is deterministic for identical bytes while receipts retain build time', (t) => {
  const tempRoot = createTempRoot(t);
  const firstOut = path.join(tempRoot, 'first');
  const secondOut = path.join(tempRoot, 'second');
  const first = runBuild(firstOut, { epoch: '1787616000' });
  const second = runBuild(secondOut, { epoch: '1787702400' });

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  const firstIndex = fs.readFileSync(path.join(firstOut, 'lexical-fixture', 'lexical-index.json'));
  const secondIndex = fs.readFileSync(path.join(secondOut, 'lexical-fixture', 'lexical-index.json'));
  assert.deepEqual(secondIndex, firstIndex);

  const firstReceipts = JSON.parse(fs.readFileSync(path.join(firstOut, 'lexical-fixture', 'build-receipts.json'), 'utf8'));
  const secondReceipts = JSON.parse(fs.readFileSync(path.join(secondOut, 'lexical-fixture', 'build-receipts.json'), 'utf8'));
  assert.equal(firstReceipts.receipts.length, 2);
  assert.notEqual(secondReceipts.receipts[0].builtAt, firstReceipts.receipts[0].builtAt);
  assert.ok(firstReceipts.receipts.every((receipt) => receipt.outputHash.value === firstReceipts.indexHash.value));
  assert.deepEqual(firstReceipts.receipts.map((receipt) => receipt.rejectedCount), [2, 1]);
});

test('lexical build manifest carries source, version, license, file hashes, and synthetic-only boundary', (t) => {
  const tempRoot = createTempRoot(t);
  const outDir = path.join(tempRoot, 'out');
  const result = runBuild(outDir);
  assert.equal(result.status, 0, result.stderr);

  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'data-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.locales, ['en', 'zh-Hant']);
  assert.equal(manifest.datasets.length, 2);
  assert.ok(manifest.datasets.every((dataset) => dataset.source.canonicalUrl.startsWith('https://')));
  assert.ok(manifest.datasets.every((dataset) => dataset.version && dataset.hash.value.length === 64));
  assert.ok(manifest.datasets.every((dataset) => dataset.license.redistributionNote));
  assert.ok(manifest.datasets.every((dataset) => dataset.files.every((file) => file.sha256.length === 64)));
  assert.equal(manifest.releaseFixture.syntheticOnly, true);
  assert.equal(manifest.releaseFixture.upstreamCorpusBytesBundled, false);
  assert.equal(manifest.index.entryCount, 9);
  assert.equal(manifest.index.rejectedCount, 3);
});

test('lexical build refuses a hash mismatch without publishing a partial output', (t) => {
  const tempRoot = createTempRoot(t);
  const tamperedEn = path.join(tempRoot, 'tampered-en');
  fs.cpSync(enFixture, tamperedEn, { recursive: true });
  const manifestPath = path.join(tamperedEn, 'dataset-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files[0].sha256 = '0'.repeat(64);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const outDir = path.join(tempRoot, 'out');

  const result = runBuild(outDir, { enDir: tamperedEn });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sha256/i);
  assert.equal(fs.existsSync(outDir), false);
  assert.equal(fs.readdirSync(tempRoot).some((name) => name.startsWith('.out.tmp-')), false);
});

test('lexical build refuses to overwrite an existing output directory', (t) => {
  const tempRoot = createTempRoot(t);
  const outDir = path.join(tempRoot, 'existing');
  fs.mkdirSync(outDir);

  const result = runBuild(outDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already exists/i);
});
