const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const Validator = require('../scripts/validate-v0.3.0');
const Packaging = require('../scripts/package-v0.3.0');

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-v030-validator-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('v0.3 validator requires an explicit development or standalone mode', () => {
  assert.equal(Validator.parseCli(['--development']).mode, 'development');
  assert.equal(Validator.parseCli(['--standalone']).mode, 'standalone');
  assert.equal(Validator.parseCli(['--root', '/tmp/example', '--standalone']).root, '/tmp/example');
  assert.throws(() => Validator.parseCli([]), /development.*standalone/i);
  assert.throws(() => Validator.parseCli(['--development', '--standalone']), /exactly one/i);
});

test('standalone hygiene uses source audit without invoking Git and rejects Git worktrees', (t) => {
  const root = temporaryRoot(t);
  fs.writeFileSync(path.join(root, 'README.md'), '# Standalone\n');

  const report = Validator.validateHygiene(root, 'standalone');
  assert.equal(report.mode, 'standalone-source-audit');
  assert.equal(report.gitWorktree, false);
  const gitRoot = temporaryRoot(t);
  const initialized = childProcess.spawnSync('git', ['init', '--quiet'], { cwd: gitRoot, encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.throws(
    () => Validator.validateHygiene(gitRoot, 'standalone'),
    /must not be inside a Git worktree/i
  );
});

test('runtime artifact validation fails closed for a missing or corrupt packaged index', (t) => {
  const root = temporaryRoot(t);
  writeJson(path.join(root, 'dist', 'data-manifest-v0.3.0.json'), {
    schemaVersion: 1,
    release: 'v0.3.0',
    locales: ['en', 'zh-Hant'],
    datasets: [],
    index: {
      path: 'apps/extension/data/lexical-runtime-index.json',
      hash: { algorithm: 'sha256', value: 'a'.repeat(64) },
      entryCount: 0,
      rejectedCount: 0
    },
    receipts: { path: 'dist/lexical-v0.3.0/build-receipts.json', count: 0 }
  });

  assert.throws(() => Validator.validateRuntimeArtifact(root), /runtime index.*missing/i);
  fs.mkdirSync(path.join(root, 'apps', 'extension', 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'extension', 'data', 'lexical-runtime-index.json'), '{"corrupt":true}\n');
  assert.throws(() => Validator.validateRuntimeArtifact(root), /runtime index.*invalid/i);
});

test('release fallback simulation retains safe English and Traditional-Chinese semantics', () => {
  const report = Validator.validateFallbackSimulation();

  assert.equal(report.mode, 'degraded');
  assert.equal(report.fallbackActivated, true);
  assert.equal(report.englishPos, 'n');
  assert.equal(report.chinesePos, 'v');
  assert.equal(report.unknownPos, 'x');
});

test('extension manifest gate permits only the v0.3 local MV3 permission boundary', (t) => {
  const root = temporaryRoot(t);
  const manifestPath = path.join(root, 'apps', 'extension', 'manifest.json');
  writeJson(manifestPath, {
    manifest_version: 3,
    version: '0.3.0',
    permissions: ['activeTab', 'scripting', 'storage'],
    background: { service_worker: 'src/service-worker.js' }
  });

  assert.equal(Validator.validateExtensionManifest(root).version, '0.3.0');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = ['https://example.invalid/*'];
  writeJson(manifestPath, manifest);
  assert.throws(() => Validator.validateExtensionManifest(root), /host permissions/i);
});

test('extension ZIP validation compares the exact inventory and every packaged byte to source', (t) => {
  const root = temporaryRoot(t);
  const extension = path.join(root, 'apps', 'extension');
  fs.mkdirSync(path.join(extension, 'src'), { recursive: true });
  fs.mkdirSync(path.join(extension, 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data', 'corpora', 'princeton-wordnet-3.0'), { recursive: true });
  writeJson(path.join(extension, 'manifest.json'), { manifest_version: 3, version: '0.3.0' });
  fs.writeFileSync(path.join(extension, 'README.md'), '# Extension\n');
  fs.writeFileSync(path.join(extension, 'src', 'service-worker.js'), "'use strict';\n");
  fs.writeFileSync(path.join(extension, 'src', 'content.js'), "'use strict';\n");
  fs.writeFileSync(path.join(extension, 'src', 'popup.html'), '<!doctype html>\n');
  fs.writeFileSync(path.join(extension, 'data', 'lexical-runtime-index.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), '# Notices\n');
  fs.writeFileSync(path.join(root, 'data', 'corpora', 'princeton-wordnet-3.0', 'LICENSE'), 'WordNet license\n');
  Packaging.packageExtension(root);

  assert.equal(Validator.validateExtensionZip(root).version, '0.3.0');
  fs.writeFileSync(path.join(extension, 'src', 'content.js'), "'use strict';\n// changed after packaging\n");
  assert.throws(() => Validator.validateExtensionZip(root), /differs from.*source|byte/i);
});
