const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const Packaging = require('../scripts/package-v0.4.0');

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-v040-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function buildExtensionFixture(root) {
  write(path.join(root, 'apps/extension/manifest.json'), '{"manifest_version":3,"version":"0.4.0"}\n');
  write(path.join(root, 'apps/extension/README.md'), '# Extension\n');
  write(path.join(root, 'apps/extension/src/service-worker.js'), "'use strict';\n");
  write(path.join(root, 'apps/extension/src/content.js'), "'use strict';\n");
  write(path.join(root, 'apps/extension/data/lexical-runtime-index.json'), '{}\n');
  write(path.join(root, 'apps/extension/assets/icon.txt'), 'icon fixture\n');
  write(path.join(root, 'apps/extension/test-fixtures/demo.html'), '<p>dev fixture</p>\n');
  write(path.join(root, 'THIRD_PARTY_NOTICES.md'), '# Notices\n');
  write(path.join(root, 'data/corpora/princeton-wordnet-3.0/LICENSE'), 'WordNet license\n');
}

test('v0.4 extension package has a flat MV3 root, includes runtime assets, and excludes development fixtures', (t) => {
  const root = temporaryRoot(t);
  buildExtensionFixture(root);
  const report = Packaging.packageExtension(root);
  const listing = childProcess.spawnSync('unzip', ['-Z1', path.join(root, report.path)], { encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  assert.deepEqual(listing.stdout.trim().split(/\r?\n/), [
    'LICENSES/WordNet-3.0.txt',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'assets/icon.txt',
    'data/lexical-runtime-index.json',
    'manifest.json',
    'src/content.js',
    'src/service-worker.js'
  ]);
});

test('v0.4 package inventory is deterministic across repeated builds', (t) => {
  const root = temporaryRoot(t);
  buildExtensionFixture(root);
  const first = Packaging.packageExtension(root);
  const firstBytes = fs.readFileSync(path.join(root, first.path));
  const firstHash = crypto.createHash('sha256').update(firstBytes).digest('hex');
  const second = Packaging.packageExtension(root);
  const secondBytes = fs.readFileSync(path.join(root, second.path));
  const secondHash = crypto.createHash('sha256').update(secondBytes).digest('hex');
  assert.equal(firstHash, secondHash);
});

test('source release inventory is explicit and excludes Git metadata, node_modules, release recursion, and generated ZIPs', (t) => {
  const root = temporaryRoot(t);
  for (const relative of Packaging.SOURCE_INCLUDE_PATHS) {
    const target = path.join(root, relative);
    if (path.extname(relative)) write(target, 'fixture\n');
    else fs.mkdirSync(target, { recursive: true });
  }
  write(path.join(root, 'apps/extension/src/content.js'), "'use strict';\n");
  write(path.join(root, 'dist/runtime.json'), '{}\n');
  write(path.join(root, 'dist/old-release.zip'), 'not a real zip\n');
  write(path.join(root, 'releases/recursive.zip'), 'nope\n');
  write(path.join(root, 'node_modules/pkg/index.js'), 'junk\n');
  write(path.join(root, '.git/config'), '[core]\n');

  const entries = Packaging.sourcePackageEntries(root).map((entry) => entry.archivePath);
  assert.ok(entries.includes('apps/extension/src/content.js'));
  assert.ok(entries.includes('dist/runtime.json'));
  assert.equal(entries.some((entry) => entry.startsWith('.git/')), false);
  assert.equal(entries.some((entry) => entry.startsWith('node_modules/')), false);
  assert.equal(entries.some((entry) => entry.startsWith('releases/')), false);
  assert.equal(entries.some((entry) => entry.endsWith('.zip')), false);
});

test('unsafe paths and symbolic links fail closed', (t) => {
  assert.throws(() => Packaging.assertSafeEntry('../escape'), /unsafe archive entry/i);
  assert.throws(() => Packaging.assertSafeEntry('.git/config'), /Git metadata/i);

  const root = temporaryRoot(t);
  buildExtensionFixture(root);
  const linkPath = path.join(root, 'apps/extension/src/link.js');
  fs.symlinkSync(path.join(root, 'apps/extension/src/content.js'), linkPath);
  assert.throws(() => Packaging.extensionPackageEntries(root), /symbolic links/i);
});

test('packageRelease writes verifiable SHA-256 sidecar metadata for extension and source bundles', (t) => {
  const root = temporaryRoot(t);
  buildExtensionFixture(root);
  const requiredFiles = {
    '.gitattributes': '* text=auto\n',
    '.gitignore': 'node_modules/\n',
    'README.md': '# Halo\n',
    'package.json': '{"name":"halo-learning","version":"0.4.0"}\n',
    'package-lock.json': '{"lockfileVersion":3}\n',
    'packages/contracts/example.js': "'use strict';\n",
    'scripts/example.js': "'use strict';\n",
    'tests/example.test.js': "'use strict';\n",
    'fixtures/example.txt': 'fixture\n',
    'docs/validation/example.md': '# evidence\n',
    'dist/runtime.json': '{}\n'
  };
  for (const [relative, content] of Object.entries(requiredFiles)) write(path.join(root, relative), content);

  const report = Packaging.packageRelease(root);
  const manifestPath = path.join(root, Packaging.PACKAGE_MANIFEST_OUTPUT);
  assert.equal(fs.existsSync(manifestPath), true);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.release, 'v0.4.0');
  assert.equal(manifest.extension.sha256, report.extension.sha256);
  assert.equal(manifest.source.sha256, report.source.sha256);
  assert.match(manifest.extension.sha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.source.sha256, /^[0-9a-f]{64}$/);
});

test('full packageRelease is deterministic across repeated runs and never packages its previous sidecar', (t) => {
  const root = temporaryRoot(t);
  buildExtensionFixture(root);
  const requiredFiles = {
    '.gitattributes': '* text=auto\n',
    '.gitignore': 'node_modules/\n',
    'README.md': '# Halo\n',
    'package.json': '{"name":"halo-learning","version":"0.4.0"}\n',
    'package-lock.json': '{"lockfileVersion":3}\n',
    'packages/contracts/example.js': "'use strict';\n",
    'scripts/example.js': "'use strict';\n",
    'tests/example.test.js': "'use strict';\n",
    'fixtures/example.txt': 'fixture\n',
    'docs/validation/example.md': '# evidence\n',
    'dist/runtime.json': '{}\n'
  };
  for (const [relative, content] of Object.entries(requiredFiles)) write(path.join(root, relative), content);

  const first = Packaging.packageRelease(root);
  const second = Packaging.packageRelease(root);
  assert.equal(second.extension.sha256, first.extension.sha256);
  assert.equal(second.source.sha256, first.source.sha256);

  const listing = childProcess.spawnSync('unzip', ['-Z1', path.join(root, second.source.path)], { encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  assert.equal(listing.stdout.includes(Packaging.PACKAGE_MANIFEST_OUTPUT), false);
});
