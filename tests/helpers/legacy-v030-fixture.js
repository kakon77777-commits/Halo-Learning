'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function createLegacyV030Fixture(rootValue) {
  const root = path.resolve(rootValue);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-v030-fixture-'));
  const stagingRoot = path.join(temporaryRoot, 'extension');
  const archivePath = path.join(temporaryRoot, 'halo-learning-magic-hand-v0.3.0-fixture.zip');

  fs.mkdirSync(path.join(stagingRoot, 'data'), { recursive: true });
  fs.mkdirSync(path.join(stagingRoot, 'src', 'shared'), { recursive: true });

  const currentManifest = JSON.parse(fs.readFileSync(
    path.join(root, 'apps', 'extension', 'manifest.json'),
    'utf8'
  ));
  fs.writeFileSync(
    path.join(stagingRoot, 'manifest.json'),
    `${JSON.stringify({ ...currentManifest, version: '0.3.0' }, null, 2)}\n`
  );
  fs.copyFileSync(
    path.join(root, 'apps', 'extension', 'src', 'shared', 'runtime-index-browser.js'),
    path.join(stagingRoot, 'src', 'shared', 'runtime-index-browser.js')
  );
  fs.copyFileSync(
    path.join(root, 'apps', 'extension', 'data', 'lexical-runtime-index.json'),
    path.join(stagingRoot, 'data', 'lexical-runtime-index.json')
  );

  const zip = childProcess.spawnSync('zip', [
    '-X', '-q', '-9', archivePath,
    'manifest.json',
    'src/shared/runtime-index-browser.js',
    'data/lexical-runtime-index.json'
  ], {
    cwd: stagingRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  if (zip.error) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw zip.error;
  }
  if (zip.status !== 0) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw new Error(`legacy v0.3 fixture ZIP creation failed: ${(zip.stderr || '').trim()}`);
  }

  return Object.freeze({
    archivePath,
    dispose() {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
}

module.exports = Object.freeze({ createLegacyV030Fixture });
