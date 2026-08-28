#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DOGFOOD_VERSION = 'v0.5.0-dogfood';
const EXTENSION_OUTPUT = 'dist/halo-learning-magic-hand-v0.5.0-dogfood.zip';
const CANONICAL_MTIME = new Date('2026-08-28T00:00:00.000Z');
const PROHIBITED_PARTS = Object.freeze(new Set(['.git', 'node_modules', 'test-fixtures']));
const DOGFOOD_BUILD_TEXT = Object.freeze([
  'Halo Learning v0.5.0',
  'LOCAL DOGFOOD — NOT PUBLIC v0.5 RELEASE',
  'milestone: local-dogfood-build',
  'public_release_ready: false',
  'v0_6_design_status: provisional',
  ''
].join('\n'));

function safeRelative(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) {
    throw new TypeError(`unsafe archive entry: ${value}`);
  }
  const normalized = value.split(path.sep).join('/');
  const parts = normalized.split('/');
  if (parts.includes('..') || parts.some((part) => PROHIBITED_PARTS.has(part))) {
    throw new TypeError(`prohibited archive entry: ${normalized}`);
  }
  return normalized;
}

function collectFiles(rootValue) {
  const root = path.resolve(rootValue);
  if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory()) {
    throw new Error(`package input is missing: ${root}`);
  }
  const files = [];
  const visit = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (PROHIBITED_PARTS.has(entry.name)) continue;
      const target = path.join(directory, entry.name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) throw new Error(`symbolic links are not permitted in dogfood packages: ${target}`);
      if (stat.isDirectory()) visit(target);
      else if (stat.isFile()) files.push(safeRelative(path.relative(root, target)));
    }
  };
  visit(root);
  return Object.freeze(files.sort((left, right) => left.localeCompare(right)));
}

function copyTree(sourceRootValue, targetRootValue) {
  const sourceRoot = path.resolve(sourceRootValue);
  const targetRoot = path.resolve(targetRootValue);
  for (const relative of collectFiles(sourceRoot)) {
    const source = path.join(sourceRoot, ...relative.split('/'));
    const target = path.join(targetRoot, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  }
}

function normalizeTimes(rootValue) {
  const root = path.resolve(rootValue);
  for (const relative of collectFiles(root)) {
    const target = path.join(root, ...relative.split('/'));
    fs.utimesSync(target, CANONICAL_MTIME, CANONICAL_MTIME);
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeZip(stagingRootValue, outputPathValue) {
  const stagingRoot = path.resolve(stagingRootValue);
  const outputPath = path.resolve(outputPathValue);
  const files = [...collectFiles(stagingRoot)];
  if (!files.length) throw new Error('dogfood package staging tree is empty');
  normalizeTimes(stagingRoot);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp-${process.pid}.zip`;
  fs.rmSync(temporary, { force: true });
  const result = childProcess.spawnSync('zip', ['-X', '-q', '-9', temporary, ...files], {
    cwd: stagingRoot,
    encoding: 'utf8',
    env: { ...process.env, TZ: 'UTC' },
    maxBuffer: 100 * 1024 * 1024
  });
  if (result.error) {
    fs.rmSync(temporary, { force: true });
    throw new Error(`zip creation could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fs.rmSync(temporary, { force: true });
    throw new Error(`zip creation failed with exit ${result.status}: ${(result.stderr || '').trim()}`);
  }
  fs.rmSync(outputPath, { force: true });
  fs.renameSync(temporary, outputPath);
  return Object.freeze({ files: files.length, bytes: fs.statSync(outputPath).size, sha256: sha256(outputPath) });
}

function packageDogfood(rootValue) {
  const root = path.resolve(rootValue);
  const extensionRoot = path.join(root, 'apps', 'extension');
  if (!fs.existsSync(extensionRoot) || !fs.lstatSync(extensionRoot).isDirectory()) {
    throw new Error(`extension source is missing: ${extensionRoot}`);
  }
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-v050-dogfood-package-'));
  try {
    copyTree(extensionRoot, stagingRoot);
    fs.writeFileSync(path.join(stagingRoot, 'DOGFOOD_BUILD.txt'), DOGFOOD_BUILD_TEXT, 'utf8');

    const notices = path.join(root, 'THIRD_PARTY_NOTICES.md');
    if (fs.existsSync(notices) && fs.lstatSync(notices).isFile()) {
      fs.copyFileSync(notices, path.join(stagingRoot, 'THIRD_PARTY_NOTICES.md'), fs.constants.COPYFILE_EXCL);
    }
    const wordNetLicense = path.join(root, 'data', 'corpora', 'princeton-wordnet-3.0', 'LICENSE');
    if (fs.existsSync(wordNetLicense) && fs.lstatSync(wordNetLicense).isFile()) {
      fs.mkdirSync(path.join(stagingRoot, 'LICENSES'), { recursive: true });
      fs.copyFileSync(wordNetLicense, path.join(stagingRoot, 'LICENSES', 'WordNet-3.0.txt'), fs.constants.COPYFILE_EXCL);
    }

    const outputPath = path.join(root, ...EXTENSION_OUTPUT.split('/'));
    const archive = writeZip(stagingRoot, outputPath);
    return Object.freeze({
      version: DOGFOOD_VERSION,
      path: EXTENSION_OUTPUT,
      publicReleaseReady: false,
      ...archive
    });
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    if (process.argv.length !== 2) throw new TypeError('usage: node scripts/package-v0.5.0-dogfood.js');
    process.stdout.write(`${JSON.stringify(packageDogfood(process.cwd()), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  DOGFOOD_VERSION,
  EXTENSION_OUTPUT,
  CANONICAL_MTIME,
  DOGFOOD_BUILD_TEXT,
  collectFiles,
  packageDogfood
});
