'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const Packager = require('../scripts/package-v0.5.0-dogfood');

const repositoryRoot = path.resolve(__dirname, '..');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function unzipList(filePath) {
  const result = childProcess.spawnSync('unzip', ['-Z1', filePath], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`unzip listing failed: ${result.stderr}`);
  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

function unzipText(filePath, entry) {
  const result = childProcess.spawnSync('unzip', ['-p', filePath, entry], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`unzip read failed for ${entry}: ${result.stderr}`);
  return result.stdout;
}

test('v0.5 DOGFOOD extension package is deterministic, local-only, complete, and never public-release-ready', () => {
  assert.equal(Packager.DOGFOOD_VERSION, 'v0.5.0-dogfood');
  assert.equal(Packager.EXTENSION_OUTPUT, 'dist/halo-learning-magic-hand-v0.5.0-dogfood.zip');
  assert.equal(Packager.CANONICAL_MTIME.toISOString(), '2026-08-28T00:00:00.000Z');

  const first = Packager.packageDogfood(repositoryRoot);
  const output = path.join(repositoryRoot, ...Packager.EXTENSION_OUTPUT.split('/'));
  assert.equal(first.path, Packager.EXTENSION_OUTPUT);
  assert.equal(fs.existsSync(output), true);
  const firstHash = sha256(output);

  const second = Packager.packageDogfood(repositoryRoot);
  const secondHash = sha256(output);
  assert.equal(second.path, Packager.EXTENSION_OUTPUT);
  assert.equal(secondHash, firstHash, 'two canonical DOGFOOD builds must be byte-identical');
  assert.equal(second.sha256, secondHash);

  const entries = unzipList(output);
  const required = [
    'manifest.json',
    'DOGFOOD_BUILD.txt',
    'src/options.html',
    'src/options.css',
    'src/options.js',
    'src/popup-dogfood.js',
    'src/worker-entry.js',
    'src/shared/dogfood-contracts.js',
    'src/shared/dogfood-source.js',
    'src/shared/dogfood-capture.js',
    'src/shared/dogfood-content.js',
    'src/shared/dogfood-storage-schema.js',
    'src/shared/dogfood-store.js',
    'src/shared/dogfood-projector.js',
    'src/shared/dogfood-data-service.js',
    'src/shared/dogfood-worker-transport.js',
    'src/shared/dogfood-renderer.js',
    'src/shared/dogfood-runtime.js',
    'src/shared/dogfood-browser-observer.js'
  ];
  for (const entry of required) assert.ok(entries.includes(entry), `${entry} must be packaged`);
  assert.equal(entries.some((entry) => /(^|\/)node_modules\//u.test(entry)), false);
  assert.equal(entries.some((entry) => /(^|\/)\.git(?:\/|$)/u.test(entry)), false);
  assert.equal(entries.some((entry) => /(^|\/)test-fixtures(?:\/|$)/u.test(entry)), false);

  const manifest = JSON.parse(unzipText(output, 'manifest.json'));
  assert.equal(manifest.version, '0.5.0');
  assert.equal(manifest.options_page, 'src/options.html');
  assert.deepEqual(manifest.permissions, ['activeTab', 'contextMenus', 'scripting', 'storage']);
  assert.equal(Object.hasOwn(manifest, 'host_permissions'), false);

  const label = unzipText(output, 'DOGFOOD_BUILD.txt');
  assert.match(label, /LOCAL DOGFOOD — NOT PUBLIC v0\.5 RELEASE/u);
  assert.match(label, /public_release_ready:\s*false/u);
  assert.doesNotMatch(label, /public_release_ready:\s*true/u);
});
