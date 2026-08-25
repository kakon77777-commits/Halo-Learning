const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const Packaging = require('../scripts/package-v0.3.0');

test('extension package has a flat MV3 root and excludes development fixtures', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-v030-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'apps', 'extension', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps', 'extension', 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps', 'extension', 'test-fixtures'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data', 'corpora', 'princeton-wordnet-3.0'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'extension', 'manifest.json'), '{"manifest_version":3,"version":"0.3.0"}\n');
  fs.writeFileSync(path.join(root, 'apps', 'extension', 'README.md'), '# Extension\n');
  fs.writeFileSync(path.join(root, 'apps', 'extension', 'src', 'service-worker.js'), "'use strict';\n");
  fs.writeFileSync(path.join(root, 'apps', 'extension', 'data', 'lexical-runtime-index.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'apps', 'extension', 'test-fixtures', 'demo.html'), '<p>fixture</p>\n');
  fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), '# Data notices\n');
  fs.writeFileSync(path.join(root, 'data', 'corpora', 'princeton-wordnet-3.0', 'LICENSE'), 'WordNet license\n');

  const report = Packaging.packageExtension(root);
  const listing = childProcess.spawnSync('unzip', ['-Z1', path.join(root, report.path)], { encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  assert.deepEqual(listing.stdout.trim().split(/\r?\n/), [
    'LICENSES/WordNet-3.0.txt',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'data/lexical-runtime-index.json',
    'manifest.json',
    'src/service-worker.js'
  ]);
});

test('source release inventory is explicit and cannot include Git metadata or release ZIP recursion', () => {
  assert.ok(Packaging.SOURCE_INCLUDE_PATHS.includes('data'));
  assert.ok(Packaging.SOURCE_INCLUDE_PATHS.includes('tests'));
  assert.equal(Packaging.SOURCE_INCLUDE_PATHS.includes('.git'), false);
  assert.equal(Packaging.SOURCE_INCLUDE_PATHS.includes('releases'), false);
  assert.throws(() => Packaging.assertSafeEntry('../escape'), /unsafe archive entry/i);
  assert.throws(() => Packaging.assertSafeEntry('.git/config'), /Git metadata/i);
});
