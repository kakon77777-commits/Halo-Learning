#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXTENSION_OUTPUT = 'dist/halo-learning-magic-hand-v0.3.0.zip';
const SOURCE_OUTPUT = 'releases/Halo_Learning_v0.3.0_Semantic_Annotation_Engine_Release.zip';
const CANONICAL_MTIME = new Date('2026-08-25T00:00:00.000Z');
const SOURCE_INCLUDE_PATHS = Object.freeze([
  '.gitattributes',
  '.gitignore',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'package.json',
  'apps',
  'packages',
  'scripts',
  'tests',
  'fixtures',
  'data',
  'docs',
  'dist'
]);

function assertSafeEntry(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/).includes('..')) {
    throw new TypeError(`unsafe archive entry: ${relativePath}`);
  }
  if (relativePath.split(/[\\/]/).includes('.git')) throw new TypeError(`Git metadata is prohibited: ${relativePath}`);
  return relativePath;
}

function collectRelativeFiles(rootValue) {
  const root = path.resolve(rootValue);
  const output = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symbolic links are not permitted in release packages: ${target}`);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) output.push(assertSafeEntry(path.relative(root, target).split(path.sep).join('/')));
    }
  }
  return output.sort();
}

function copyPath(source, target) {
  if (!fs.existsSync(source)) throw new Error(`release input is missing: ${source}`);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`symbolic links are not permitted in release packages: ${source}`);
  if (stat.isDirectory()) fs.cpSync(source, target, { recursive: true, errorOnExist: true });
  else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  }
}

function packageEntriesForPath(sourcePathValue, archivePathValue) {
  const sourcePath = path.resolve(sourcePathValue);
  const archivePath = assertSafeEntry(archivePathValue.split(path.sep).join('/'));
  if (!fs.existsSync(sourcePath)) throw new Error(`release input is missing: ${sourcePath}`);
  const stat = fs.lstatSync(sourcePath);
  if (stat.isSymbolicLink()) throw new Error(`symbolic links are not permitted in release packages: ${sourcePath}`);
  if (stat.isFile()) return [{ sourcePath, archivePath }];
  if (!stat.isDirectory()) throw new Error(`release input is not a regular file or directory: ${sourcePath}`);
  return collectRelativeFiles(sourcePath).map((relativePath) => ({
    sourcePath: path.join(sourcePath, relativePath),
    archivePath: assertSafeEntry(path.posix.join(archivePath, relativePath))
  }));
}

function normalizePackageEntries(entries) {
  const sorted = [...entries].sort((left, right) => left.archivePath.localeCompare(right.archivePath, 'en'));
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].archivePath === sorted[index].archivePath) {
      throw new Error(`duplicate archive entry: ${sorted[index].archivePath}`);
    }
  }
  return Object.freeze(sorted.map((entry) => Object.freeze(entry)));
}

function extensionPackageEntries(rootValue) {
  const root = path.resolve(rootValue);
  const extensionRoot = path.join(root, 'apps', 'extension');
  return normalizePackageEntries([
    ...packageEntriesForPath(path.join(extensionRoot, 'README.md'), 'README.md'),
    ...packageEntriesForPath(path.join(extensionRoot, 'manifest.json'), 'manifest.json'),
    ...packageEntriesForPath(path.join(extensionRoot, 'src'), 'src'),
    ...packageEntriesForPath(path.join(extensionRoot, 'data'), 'data'),
    ...packageEntriesForPath(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'THIRD_PARTY_NOTICES.md'),
    ...packageEntriesForPath(
      path.join(root, 'data', 'corpora', 'princeton-wordnet-3.0', 'LICENSE'),
      'LICENSES/WordNet-3.0.txt'
    )
  ]);
}

function sourcePackageEntries(rootValue) {
  const root = path.resolve(rootValue);
  const entries = [];
  for (const relative of SOURCE_INCLUDE_PATHS) {
    assertSafeEntry(relative);
    entries.push(...packageEntriesForPath(path.join(root, relative), relative));
  }
  return normalizePackageEntries(entries);
}

function copyPackageEntries(entries, targetRoot) {
  for (const entry of entries) {
    const target = path.join(targetRoot, entry.archivePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(entry.sourcePath, target, fs.constants.COPYFILE_EXCL);
  }
}

function normalizeTimes(root) {
  for (const relativePath of collectRelativeFiles(root)) {
    fs.utimesSync(path.join(root, relativePath), CANONICAL_MTIME, CANONICAL_MTIME);
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeZip(stagingRoot, targetPath) {
  const files = collectRelativeFiles(stagingRoot);
  if (!files.length) throw new Error('release package staging tree is empty');
  normalizeTimes(stagingRoot);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporary = `${targetPath}.tmp-${process.pid}.zip`;
  fs.rmSync(temporary, { force: true });
  const result = childProcess.spawnSync('zip', ['-X', '-q', '-9', temporary, ...files], {
    cwd: stagingRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.status !== 0) {
    fs.rmSync(temporary, { force: true });
    throw new Error(`zip creation failed with exit ${result.status}: ${(result.stderr || '').trim()}`);
  }
  fs.renameSync(temporary, targetPath);
  return Object.freeze({ files: files.length, bytes: fs.statSync(targetPath).size, sha256: sha256(targetPath) });
}

function packageExtension(rootValue) {
  const root = path.resolve(rootValue);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-v030-extension-package-'));
  try {
    copyPackageEntries(extensionPackageEntries(root), tempRoot);
    const targetPath = path.join(root, EXTENSION_OUTPUT);
    const zip = writeZip(tempRoot, targetPath);
    return Object.freeze({ path: EXTENSION_OUTPUT, ...zip });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function packageSourceRelease(rootValue) {
  const root = path.resolve(rootValue);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-v030-source-package-'));
  try {
    copyPackageEntries(sourcePackageEntries(root), tempRoot);
    const targetPath = path.join(root, SOURCE_OUTPUT);
    const zip = writeZip(tempRoot, targetPath);
    return Object.freeze({ path: SOURCE_OUTPUT, gitMetadataPresent: false, ...zip });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function packageRelease(rootValue) {
  const root = path.resolve(rootValue);
  const extension = packageExtension(root);
  const source = packageSourceRelease(root);
  return Object.freeze({ release: 'v0.3.0', extension, source });
}

if (require.main === module) {
  try {
    if (process.argv.length !== 2) throw new TypeError('usage: node scripts/package-v0.3.0.js');
    process.stdout.write(`${JSON.stringify(packageRelease(process.cwd()), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  EXTENSION_OUTPUT,
  SOURCE_OUTPUT,
  SOURCE_INCLUDE_PATHS,
  assertSafeEntry,
  collectRelativeFiles,
  extensionPackageEntries,
  sourcePackageEntries,
  packageExtension,
  packageSourceRelease,
  packageRelease
});
