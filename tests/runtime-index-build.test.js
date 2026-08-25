const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANONICAL_BUILD_TIME,
  buildRuntimeArtifacts,
  publishRuntimeArtifacts
} = require('../scripts/build-lexical-runtime');
const { loadRuntimeLexicalIndex } = require('../packages/lexical-index/runtime-lexical-index');

const root = path.join(__dirname, '..');

function fixtureOptions() {
  return {
    englishDir: path.join(root, 'fixtures/lexical/wordnet-3.0-synthetic'),
    chineseDir: path.join(root, 'fixtures/lexical/cc-cedict-synthetic'),
    builtAt: CANONICAL_BUILD_TIME
  };
}

test('runtime build emits deterministic index, build receipts, and provenance manifest', () => {
  const first = buildRuntimeArtifacts(fixtureOptions());
  const second = buildRuntimeArtifacts(fixtureOptions());
  const index = loadRuntimeLexicalIndex(first.serializedIndex);

  assert.equal(second.serializedIndex, first.serializedIndex);
  assert.deepEqual(second.receiptsDocument, first.receiptsDocument);
  assert.equal(index.statistics.englishRowCount, 5);
  assert.equal(index.statistics.chineseRowCount, 4);
  assert.equal(first.dataManifest.release, 'v0.3.0');
  assert.equal(first.dataManifest.index.hash.value, index.hash.value);
  assert.equal(first.dataManifest.index.entryCount, 9);
  assert.equal(first.dataManifest.sourceInputs.upstreamCorpusBytesBundled, true);
  assert.equal(first.dataManifest.sourceInputs.verifiedReleaseOnly, false);
  assert.deepEqual(
    first.receiptsDocument.receipts.map((receipt) => receipt.importer.version),
    ['1.1.0', '1.1.0']
  );
  assert.ok(first.receiptsDocument.receipts.every((receipt) => receipt.builtAt === CANONICAL_BUILD_TIME));
});

test('runtime artifact publication is atomic and verify mode never repairs a mismatch', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-runtime-build-'));
  const artifacts = buildRuntimeArtifacts(fixtureOptions());
  try {
    const written = publishRuntimeArtifacts(artifacts, { projectRoot: outputRoot, mode: 'write' });
    assert.deepEqual(written.paths.map((value) => path.relative(outputRoot, value)), [
      'apps/extension/data/lexical-runtime-index.json',
      'dist/lexical-v0.3.0/build-receipts.json',
      'dist/lexical-v0.3.0/runtime-index-manifest.json',
      'dist/data-manifest-v0.3.0.json'
    ]);
    assert.doesNotThrow(() => publishRuntimeArtifacts(artifacts, { projectRoot: outputRoot, mode: 'verify' }));

    fs.writeFileSync(written.paths[0], '{"corrupt":true}\n');
    assert.throws(
      () => publishRuntimeArtifacts(artifacts, { projectRoot: outputRoot, mode: 'verify' }),
      /does not match/i
    );
    assert.equal(fs.readFileSync(written.paths[0], 'utf8'), '{"corrupt":true}\n');
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('runtime build fails before publication when a corpus byte is not declared by its manifest', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-runtime-corrupt-'));
  try {
    const englishDir = path.join(fixtureRoot, 'en');
    const chineseDir = path.join(fixtureRoot, 'zh');
    fs.cpSync(path.join(root, 'fixtures/lexical/wordnet-3.0-synthetic'), englishDir, { recursive: true });
    fs.cpSync(path.join(root, 'fixtures/lexical/cc-cedict-synthetic'), chineseDir, { recursive: true });
    fs.appendFileSync(path.join(chineseDir, 'cedict_ts.u8'), '未驗證 未验证 [wei4 yan4 zheng4] /unverified/\n');

    assert.throws(
      () => buildRuntimeArtifacts({ englishDir, chineseDir, builtAt: CANONICAL_BUILD_TIME }),
      /sha256|provided input/i
    );
    assert.equal(fs.existsSync(path.join(fixtureRoot, 'apps')), false);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
