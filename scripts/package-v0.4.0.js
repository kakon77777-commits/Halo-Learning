#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RELEASE_VERSION = 'v0.4.0';
const EXTENSION_OUTPUT = 'dist/halo-learning-magic-hand-v0.4.0.zip';
const SOURCE_OUTPUT = 'releases/Halo_Learning_v0.4.0_Browser_Runtime_UX_Release.zip';
const PACKAGE_MANIFEST_OUTPUT = 'dist/halo-learning-v0.4.0-package-manifest.json';
const CANONICAL_MTIME = new Date('2026-08-26T00:00:00.000Z');
const SOURCE_INCLUDE_PATHS = Object.freeze([
  '.gitattributes',
  '.gitignore',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'package.json',
  'package-lock.json',
  'apps',
  'packages',
  'scripts',
  'tests',
  'fixtures',
  'data',
  'docs',
  'dist'
]);
const EXTENSION_EXCLUDED_TOP_LEVEL = Object.freeze(new Set(['test-fixtures']));

function assertSafeEntry(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/).includes('..')) {
    throw new TypeError(`unsafe archive entry: ${relativePath}`);
  }
  const parts = relativePath.split(/[\\/]/);
  if (parts.includes('.git')) throw new TypeError(`Git metadata is prohibited: ${relativePath}`);
  return relativePath;
}

function collectRelativeFiles(rootValue) {
  const root = path.resolve(rootValue);
  if (!fs.existsSync(root)) throw new Error(`release input is missing: ${root}`);
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error(`symbolic links are not permitted in release packages: ${root}`);
  if (stat.isFile()) return Object.freeze(['']);
  if (!stat.isDirectory()) throw new Error(`release input is not a regular file or directory: ${root}`);

  const output = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      const targetStat = fs.lstatSync(target);
      if (targetStat.isSymbolicLink()) {
        throw new Error(`symbolic links are not permitted in release packages: ${target}`);
      }
      if (targetStat.isDirectory()) pending.push(target);
      else if (targetStat.isFile()) {
        output.push(assertSafeEntry(path.relative(root, target).split(path.sep).join('/')));
      }
    }
  }
  return Object.freeze(output.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
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
  const sorted = [...entries].sort((left, right) => (left.archivePath < right.archivePath ? -1 : left.archivePath > right.archivePath ? 1 : 0));
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].archivePath === sorted[index].archivePath) {
      throw new Error(`duplicate archive entry: ${sorted[index].archivePath}`);
    }
  }
  return Object.freeze(sorted.map((entry) => Object.freeze({ sourcePath: entry.sourcePath, archivePath: entry.archivePath })));
}

function extensionPackageEntries(rootValue) {
  const root = path.resolve(rootValue);
  const extensionRoot = path.join(root, 'apps', 'extension');
  if (!fs.existsSync(extensionRoot) || !fs.lstatSync(extensionRoot).isDirectory()) {
    throw new Error(`release input is missing: ${extensionRoot}`);
  }
  const entries = [];
  for (const entry of fs.readdirSync(extensionRoot, { withFileTypes: true })) {
    if (EXTENSION_EXCLUDED_TOP_LEVEL.has(entry.name)) continue;
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    entries.push(...packageEntriesForPath(path.join(extensionRoot, entry.name), entry.name));
  }
  entries.push(...packageEntriesForPath(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'THIRD_PARTY_NOTICES.md'));
  entries.push(...packageEntriesForPath(
    path.join(root, 'data', 'corpora', 'princeton-wordnet-3.0', 'LICENSE'),
    'LICENSES/WordNet-3.0.txt'
  ));
  return normalizePackageEntries(entries);
}

function sourceEntryAllowed(archivePath) {
  const parts = archivePath.split('/');
  if (archivePath === PACKAGE_MANIFEST_OUTPUT) return false;
  if (parts.includes('.git') || parts.includes('node_modules') || parts.includes('.worktrees') || parts.includes('worktrees')) return false;
  if (parts[0] === 'releases') return false;
  if (/\.zip$/i.test(archivePath)) return false;
  if (parts.some((part) => part === '.DS_Store' || /\.tmp(?:-|$)/i.test(part))) return false;
  return true;
}

function sourcePackageEntries(rootValue) {
  const root = path.resolve(rootValue);
  const entries = [];
  for (const relative of SOURCE_INCLUDE_PATHS) {
    assertSafeEntry(relative);
    const sourcePath = path.join(root, relative);
    if (!fs.existsSync(sourcePath)) throw new Error(`release input is missing: ${sourcePath}`);
    entries.push(...packageEntriesForPath(sourcePath, relative));
  }
  return normalizePackageEntries(entries.filter((entry) => sourceEntryAllowed(entry.archivePath)));
}

function copyPackageEntries(entries, targetRoot) {
  for (const entry of entries) {
    const target = path.join(targetRoot, ...entry.archivePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(entry.sourcePath, target, fs.constants.COPYFILE_EXCL);
  }
}

function normalizeTimes(rootValue) {
  const root = path.resolve(rootValue);
  for (const relativePath of collectRelativeFiles(root)) {
    const target = path.join(root, relativePath);
    fs.utimesSync(target, CANONICAL_MTIME, CANONICAL_MTIME);
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeZip(stagingRootValue, targetPathValue) {
  const stagingRoot = path.resolve(stagingRootValue);
  const targetPath = path.resolve(targetPathValue);
  const files = [...collectRelativeFiles(stagingRoot)];
  if (!files.length) throw new Error('release package staging tree is empty');
  normalizeTimes(stagingRoot);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporary = `${targetPath}.tmp-${process.pid}.zip`;
  fs.rmSync(temporary, { force: true });
  const result = childProcess.spawnSync('zip', ['-X', '-q', '-9', temporary, ...files], {
    cwd: stagingRoot,
    encoding: 'utf8',
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
  fs.renameSync(temporary, targetPath);
  return Object.freeze({ files: files.length, bytes: fs.statSync(targetPath).size, sha256: sha256(targetPath) });
}

function packageExtension(rootValue) {
  const root = path.resolve(rootValue);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-v040-extension-package-'));
  try {
    const entries = extensionPackageEntries(root);
    copyPackageEntries(entries, tempRoot);
    const targetPath = path.join(root, ...EXTENSION_OUTPUT.split('/'));
    const zip = writeZip(tempRoot, targetPath);
    return Object.freeze({ path: EXTENSION_OUTPUT, ...zip });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function packageSourceRelease(rootValue) {
  const root = path.resolve(rootValue);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-v040-source-package-'));
  try {
    const entries = sourcePackageEntries(root);
    copyPackageEntries(entries, tempRoot);
    const targetPath = path.join(root, ...SOURCE_OUTPUT.split('/'));
    const zip = writeZip(tempRoot, targetPath);
    return Object.freeze({ path: SOURCE_OUTPUT, gitMetadataPresent: false, ...zip });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writePackageManifest(rootValue, report) {
  const root = path.resolve(rootValue);
  const manifestPath = path.join(root, ...PACKAGE_MANIFEST_OUTPUT.split('/'));
  const payload = {
    schemaVersion: 1,
    release: RELEASE_VERSION,
    generatedAt: CANONICAL_MTIME.toISOString(),
    hashAlgorithm: 'sha256',
    extension: {
      path: report.extension.path,
      files: report.extension.files,
      bytes: report.extension.bytes,
      sha256: report.extension.sha256
    },
    source: {
      path: report.source.path,
      files: report.source.files,
      bytes: report.source.bytes,
      sha256: report.source.sha256,
      gitMetadataPresent: false
    }
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`);
  return Object.freeze({ path: PACKAGE_MANIFEST_OUTPUT, sha256: sha256(manifestPath) });
}

function packageRelease(rootValue) {
  const root = path.resolve(rootValue);
  const extension = packageExtension(root);
  const source = packageSourceRelease(root);
  const report = { release: RELEASE_VERSION, extension, source };
  const manifest = writePackageManifest(root, report);
  return Object.freeze({ ...report, manifest });
}

if (require.main === module) {
  try {
    if (process.argv.length !== 2) throw new TypeError('usage: node scripts/package-v0.4.0.js');
    process.stdout.write(`${JSON.stringify(packageRelease(process.cwd()), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  RELEASE_VERSION,
  EXTENSION_OUTPUT,
  SOURCE_OUTPUT,
  PACKAGE_MANIFEST_OUTPUT,
  SOURCE_INCLUDE_PATHS,
  assertSafeEntry,
  collectRelativeFiles,
  extensionPackageEntries,
  sourcePackageEntries,
  packageExtension,
  packageSourceRelease,
  packageRelease
});
