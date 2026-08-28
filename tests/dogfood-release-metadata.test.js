'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

test('root package metadata identifies v0.5 dogfood without replacing historical v0.4 commands', () => {
  assert.equal(packageJson.version, '0.5.0');
  assert.equal(packageJson.devDependencies.playwright, '1.62.1');
  assert.equal(packageJson.scripts['package:release'], 'node scripts/package-v0.4.0.js');
  assert.equal(packageJson.scripts['dogfood:test'], 'node --test tests/dogfood-*.test.js');
  assert.equal(packageJson.scripts['dogfood:browser'], 'node --test --test-concurrency=1 tests/browser/v050-*.e2e.test.js');
  assert.equal(packageJson.scripts['dogfood:package'], 'node scripts/package-v0.5.0-dogfood.js');
});

test('package lock root metadata matches v0.5 without dependency drift', () => {
  assert.equal(packageLock.version, '0.5.0');
  assert.equal(packageLock.packages[''].version, '0.5.0');
  assert.equal(packageLock.packages[''].devDependencies.playwright, '1.62.1');
  assert.equal(packageLock.packages['node_modules/playwright'].version, '1.62.1');
  assert.equal(packageLock.packages['node_modules/playwright-core'].version, '1.62.1');
});
