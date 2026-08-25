#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeCorpusBuildReceipt, normalizeDatasetManifest } = require('../packages/contracts/lexical-contracts');
const { auditSourceRecords } = require('../packages/lexical-data/source-gate');
const { loadRuntimeLexicalIndex } = require('../packages/lexical-index/runtime-lexical-index');
const SourceAudit = require('./audit-source-tree');
const Packaging = require('./package-v0.3.0');

const RELEASE_VERSION = 'v0.3.0';
const EXTENSION_VERSION = '0.3.0';
const DATA_MANIFEST_PATH = 'dist/data-manifest-v0.3.0.json';
const EXTENSION_ZIP_PATH = 'dist/halo-learning-magic-hand-v0.3.0.zip';
const SOURCE_ZIP_PATH = 'releases/Halo_Learning_v0.3.0_Semantic_Annotation_Engine_Release.zip';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveInside(root, relativePath) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath) || relativePath.includes('..')) {
    throw new TypeError(`unsafe repository-relative path: ${relativePath}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new TypeError(`path escapes release root: ${relativePath}`);
  }
  return resolved;
}

function walkFiles(root, predicate) {
  if (!fs.existsSync(root)) return [];
  const output = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && predicate(target)) output.push(target);
    }
  }
  return output.sort();
}

function run(command, args, options) {
  const settings = options || {};
  const result = childProcess.spawnSync(command, args, {
    cwd: settings.cwd,
    encoding: settings.encoding === undefined ? 'utf8' : settings.encoding,
    env: settings.env || process.env,
    maxBuffer: settings.maxBuffer || 100 * 1024 * 1024
  });
  if (result.status !== 0) {
    const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : (result.stdout || '');
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : (result.stderr || '');
    const evidence = `${stdout}\n${stderr}`.trim().slice(-8000);
    throw new Error(`${settings.label || command} failed with exit ${result.status}:\n${evidence}`);
  }
  return result;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function validateRuntimeArtifact(rootValue) {
  const root = path.resolve(rootValue);
  const manifestPath = path.join(root, DATA_MANIFEST_PATH);
  if (!fs.existsSync(manifestPath)) throw new Error('runtime data manifest is missing');
  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch (_error) {
    throw new Error('runtime data manifest is invalid JSON');
  }
  const indexPath = resolveInside(root, manifest.index && manifest.index.path);
  if (!fs.existsSync(indexPath)) throw new Error('runtime index is missing');
  let runtimeIndex;
  try {
    runtimeIndex = loadRuntimeLexicalIndex(fs.readFileSync(indexPath, 'utf8'));
  } catch (_error) {
    throw new Error('runtime index is invalid or corrupt');
  }
  if (manifest.release !== RELEASE_VERSION || JSON.stringify(manifest.locales) !== JSON.stringify(['en', 'zh-Hant'])) {
    throw new Error('runtime data manifest release or locale scope is invalid');
  }
  if (!manifest.index || runtimeIndex.hash.value !== manifest.index.hash.value ||
      manifest.index.entryCount !== 331903 || manifest.index.rejectedCount !== 0) {
    throw new Error('runtime index evidence does not match the v0.3.0 manifest');
  }
  if (!Array.isArray(manifest.datasets) || manifest.datasets.length !== 2) {
    throw new Error('runtime data manifest must contain exactly two datasets');
  }
  const datasets = manifest.datasets.map(normalizeDatasetManifest);
  if (JSON.stringify(datasets.map((item) => item.locale).sort()) !== JSON.stringify(['en', 'zh-Hant'])) {
    throw new Error('runtime data manifest dataset locale scope is invalid');
  }
  for (const dataset of datasets) {
    if (!dataset.bundled || dataset.source.retrievalMode !== 'verified-release' || !dataset.releaseIdentity || !dataset.formatVersion) {
      throw new Error(`dataset is not a pinned verified release: ${dataset.datasetId}`);
    }
    const corpusRoot = path.join(root, 'data', 'corpora', dataset.datasetId);
    const canonicalManifestPath = path.join(corpusRoot, 'dataset-manifest.json');
    const acquisitionPath = path.join(corpusRoot, 'acquisition-receipt.json');
    if (!fs.existsSync(canonicalManifestPath) || !fs.existsSync(acquisitionPath)) {
      throw new Error(`dataset provenance evidence is missing: ${dataset.datasetId}`);
    }
    const canonical = normalizeDatasetManifest(readJson(canonicalManifestPath));
    if (JSON.stringify(canonical) !== JSON.stringify(dataset)) {
      throw new Error(`dataset manifest projection differs from canonical evidence: ${dataset.datasetId}`);
    }
    const acquisition = readJson(acquisitionPath);
    if (acquisition.datasetId !== dataset.datasetId || acquisition.releaseIdentity !== dataset.releaseIdentity ||
        acquisition.formatVersion !== dataset.formatVersion || acquisition.transport.revision !== dataset.source.transport.revision) {
      throw new Error(`acquisition receipt mismatch: ${dataset.datasetId}`);
    }
    for (const descriptor of dataset.files) {
      const filePath = resolveInside(corpusRoot, descriptor.path);
      if (!fs.existsSync(filePath)) throw new Error(`verified corpus file is missing: ${dataset.datasetId}/${descriptor.path}`);
      const stat = fs.statSync(filePath);
      if (stat.size !== descriptor.bytes || sha256File(filePath) !== descriptor.sha256) {
        throw new Error(`verified corpus hash mismatch: ${dataset.datasetId}/${descriptor.path}`);
      }
    }
  }
  const receiptPath = resolveInside(root, manifest.receipts.path);
  const receiptDocument = readJson(receiptPath);
  const receipts = receiptDocument.receipts.map(normalizeCorpusBuildReceipt);
  if (receipts.length !== manifest.receipts.count || receiptDocument.indexHash.value !== runtimeIndex.hash.value ||
      receipts.some((receipt) => receipt.outputHash.value !== runtimeIndex.hash.value || receipt.rejectedCount !== 0)) {
    throw new Error('runtime build receipt evidence does not match the index');
  }
  auditSourceRecords(readJson(path.join(root, 'docs', 'data-sources', 'source-records.json')));
  return Object.freeze({
    indexId: runtimeIndex.indexId,
    hash: runtimeIndex.hash.value,
    entryCount: manifest.index.entryCount,
    rejectedCount: manifest.index.rejectedCount,
    datasets: Object.freeze(datasets.map((dataset) => Object.freeze({
      datasetId: dataset.datasetId,
      version: dataset.version,
      releaseIdentity: dataset.releaseIdentity,
      formatVersion: dataset.formatVersion,
      license: dataset.license.licenseId,
      hash: dataset.hash.value
    })))
  });
}

function validateFallbackSimulation() {
  const Dictionary = require('../apps/extension/src/shared/dictionary-provider');
  const RuntimeDictionary = require('../apps/extension/src/shared/runtime-dictionary-provider');
  const Semantic = require('../apps/extension/src/shared/semantic-annotations');
  const provider = RuntimeDictionary.createProviderChain({
    runtimeIndex: null,
    bootstrapProvider: Dictionary.createBootstrapDictionaryProvider(),
    failureCode: 'CORPUS_UNAVAILABLE'
  });
  const engine = Semantic.createSemanticEngine({ provider });
  const generatedAt = '2026-08-25T00:00:00.000Z';
  const english = engine.annotateText('language', { languageMode: 'en', generatedAt }).tokens[0];
  const chinese = engine.annotateText('學習', { languageMode: 'zh-Hant', generatedAt }).tokens[0];
  const unknown = engine.annotateText('Qzxv', { languageMode: 'en', generatedAt }).tokens[0];
  const status = provider.status();
  if (status.mode !== 'degraded' || !status.fallbackActivated || english.simplifiedPos !== 'n' ||
      chinese.simplifiedPos !== 'v' || unknown.simplifiedPos !== 'x') {
    throw new Error('bootstrap fallback simulation failed');
  }
  return Object.freeze({
    mode: status.mode,
    fallbackActivated: status.fallbackActivated,
    failureCode: status.failures[0].code,
    englishPos: english.simplifiedPos,
    chinesePos: chinese.simplifiedPos,
    unknownPos: unknown.simplifiedPos
  });
}

function validateExtensionManifest(rootValue) {
  const manifestPath = path.join(path.resolve(rootValue), 'apps', 'extension', 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('extension manifest is missing');
  const manifest = readJson(manifestPath);
  if (manifest.manifest_version !== 3 || manifest.version !== EXTENSION_VERSION) {
    throw new Error('extension manifest version is invalid');
  }
  const permissions = Array.isArray(manifest.permissions) ? [...manifest.permissions].sort() : [];
  if (JSON.stringify(permissions) !== JSON.stringify(['activeTab', 'scripting', 'storage'])) {
    throw new Error('extension permission scope is invalid');
  }
  if (manifest.host_permissions !== undefined) throw new Error('extension host permissions are prohibited');
  if (!manifest.background || manifest.background.service_worker !== 'src/service-worker.js') {
    throw new Error('extension local semantic service worker is missing');
  }
  return Object.freeze({ version: manifest.version, manifestVersion: manifest.manifest_version, permissions: Object.freeze(permissions) });
}

function validateHygiene(rootValue, mode) {
  const root = path.resolve(rootValue);
  if (!['development', 'standalone'].includes(mode)) throw new TypeError('hygiene mode must be development or standalone');
  const sourceAudit = SourceAudit.auditSourceTree(root);
  if (!sourceAudit.ok) throw new Error(`package/source audit failed: ${JSON.stringify(sourceAudit.issues)}`);
  const gitWorktree = SourceAudit.isInsideGitWorktree(root);
  if (mode === 'standalone') {
    if (gitWorktree) throw new Error('standalone validation root must not be inside a Git worktree');
    return Object.freeze({ mode: 'standalone-source-audit', gitWorktree: false, filesChecked: sourceAudit.filesChecked });
  }
  if (!gitWorktree) throw new Error('development validation requires a Git worktree');
  run('git', ['diff', '--check'], { cwd: root, label: 'git diff whitespace audit' });
  run('git', ['diff', '--cached', '--check'], { cwd: root, label: 'staged git diff whitespace audit' });
  const status = run('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: root,
    label: 'git cleanliness check'
  }).stdout.trim();
  if (status) throw new Error('development Git worktree is not clean');
  return Object.freeze({ mode: 'development-git-audit', gitWorktree: true, clean: true, filesChecked: sourceAudit.filesChecked });
}

function validateExtensionZip(rootValue) {
  const root = path.resolve(rootValue);
  const zipPath = path.join(root, EXTENSION_ZIP_PATH);
  if (!fs.existsSync(zipPath)) throw new Error('v0.3.0 extension ZIP is missing');
  run('unzip', ['-tqq', zipPath], { cwd: root, label: 'extension ZIP integrity' });
  const listing = validateZipBytes(root, zipPath, Packaging.extensionPackageEntries(root), 'extension ZIP');
  const zippedManifest = JSON.parse(run('unzip', ['-p', zipPath, 'manifest.json'], {
    cwd: root,
    label: 'extension ZIP manifest'
  }).stdout);
  if (zippedManifest.version !== EXTENSION_VERSION || zippedManifest.manifest_version !== 3) {
    throw new Error('extension ZIP manifest version is invalid');
  }
  return Object.freeze({ path: EXTENSION_ZIP_PATH, entries: listing.length, bytes: fs.statSync(zipPath).size, version: zippedManifest.version });
}

function validateZipBytes(root, zipPath, expectedEntries, label) {
  const listing = run('unzip', ['-Z1', zipPath], { cwd: root, label: `${label} listing` })
    .stdout.trim().split(/\r?\n/).filter(Boolean);
  const actual = [...listing].sort((left, right) => left.localeCompare(right, 'en'));
  const expected = expectedEntries.map((entry) => entry.archivePath);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} inventory differs from the canonical source inventory`);
  }
  const extractedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-v030-zip-verify-'));
  try {
    run('unzip', ['-qq', zipPath, '-d', extractedRoot], { cwd: root, label: `${label} extraction` });
    for (const entry of expectedEntries) {
      const extractedPath = path.join(extractedRoot, entry.archivePath);
      if (!fs.existsSync(extractedPath) || !fs.lstatSync(extractedPath).isFile()) {
        throw new Error(`${label} entry is not a regular file: ${entry.archivePath}`);
      }
      if (!fs.readFileSync(extractedPath).equals(fs.readFileSync(entry.sourcePath))) {
        throw new Error(`${label} entry differs from its canonical source bytes: ${entry.archivePath}`);
      }
    }
  } finally {
    fs.rmSync(extractedRoot, { recursive: true, force: true });
  }
  return Object.freeze(listing);
}

function validateSourcePackage(rootValue, mode) {
  if (mode !== 'development') return Object.freeze({ validatedBy: 'extracted-standalone-root' });
  const root = path.resolve(rootValue);
  const zipPath = path.join(root, SOURCE_ZIP_PATH);
  if (!fs.existsSync(zipPath)) throw new Error('v0.3.0 standalone source release ZIP is missing');
  run('unzip', ['-tqq', zipPath], { cwd: root, label: 'source release ZIP integrity' });
  const listing = validateZipBytes(root, zipPath, Packaging.sourcePackageEntries(root), 'source release ZIP');
  return Object.freeze({ path: SOURCE_ZIP_PATH, entries: listing.length, bytes: fs.statSync(zipPath).size, gitMetadataPresent: false });
}

function validateWorkbench(rootValue) {
  const root = path.resolve(rootValue);
  const workbook = path.join(root, 'docs', 'workbench', 'Halo_Learning_v0.1.0_to_v1.0_Workbench.xlsx');
  const workflow = path.join(root, 'docs', 'workbench', 'Halo_Learning_v0.1.0_to_v1.0_Workflow.md');
  if (!fs.existsSync(workbook) || !fs.existsSync(workflow)) throw new Error('v0.3.0 workbench evidence is missing');
  const workbookListing = run('unzip', ['-Z1', workbook], { cwd: root, label: 'workbench XLSX integrity' }).stdout;
  if (!workbookListing.includes('xl/workbook.xml')) throw new Error('workbench XLSX is invalid');
  const markdown = fs.readFileSync(workflow, 'utf8');
  if (!/\| v0\.3\.0 \|[^\n]*\| Complete \|/.test(markdown)) throw new Error('workflow v0.3.0 is not Complete');
  for (let task = 1; task <= 8; task += 1) {
    const taskId = `V030-${String(task).padStart(2, '0')}`;
    const row = markdown.split(/\r?\n/).find((line) => line.includes(`| ${taskId} |`));
    if (!row || !row.includes('| Complete |')) throw new Error(`workflow ${taskId} is not Complete`);
  }
  if (!/\| v0\.4\.0 \|[^\n]*\| Not Started \|/.test(markdown)) throw new Error('workflow v0.4.0 boundary was changed');
  return Object.freeze({ workbook: path.relative(root, workbook), workflow: path.relative(root, workflow) });
}

function validateReleaseRecords(rootValue) {
  const root = path.resolve(rootValue);
  const qualityPath = path.join(root, 'docs', 'validation', 'v0.3.0-semantic-quality.json');
  const validationPath = path.join(root, 'docs', 'VALIDATION_REPORT_v0.3.0.md');
  const evidencePath = path.join(root, 'docs', 'releases', 'v0.3.0-task-evidence.yaml');
  if (!fs.existsSync(qualityPath) || !fs.existsSync(validationPath) || !fs.existsSync(evidencePath)) {
    throw new Error('v0.3.0 release evidence is incomplete');
  }
  const quality = readJson(qualityPath);
  if (!quality.gate || quality.gate.pass !== true) throw new Error('semantic quality release gate is not passing');
  const evidence = fs.readFileSync(evidencePath, 'utf8');
  for (let task = 1; task <= 8; task += 1) {
    if (!new RegExp(`task_id: V030-${String(task).padStart(2, '0')}[\\s\\S]*?status: complete`).test(evidence)) {
      throw new Error(`task evidence V030-${String(task).padStart(2, '0')} is incomplete`);
    }
  }
  return Object.freeze({
    qualityReport: path.relative(root, qualityPath),
    validationReport: path.relative(root, validationPath),
    taskEvidence: path.relative(root, evidencePath),
    englishPosMacroF1: quality.quality.englishPosMacroF1,
    chinesePosMacroF1: quality.quality.chinesePosMacroF1,
    chineseSegmentationF1: quality.quality.chineseSegmentationTokenSpan.f1
  });
}

function validatePackageMetadata(rootValue) {
  const packageDocument = readJson(path.join(path.resolve(rootValue), 'package.json'));
  if (packageDocument.version !== EXTENSION_VERSION || !packageDocument.scripts ||
      packageDocument.scripts.validate !== 'node scripts/validate-v0.3.0.js --development' ||
      packageDocument.scripts['validate:standalone'] !== 'node scripts/validate-v0.3.0.js --standalone') {
    throw new Error('package metadata does not expose the v0.3.0 validation boundary');
  }
  return Object.freeze({ name: packageDocument.name, version: packageDocument.version });
}

function validateRelease(rootValue, mode) {
  const root = path.resolve(rootValue);
  const hygiene = validateHygiene(root, mode);
  const testFiles = walkFiles(path.join(root, 'tests'), (target) => target.endsWith('.test.js'))
    .map((filePath) => path.relative(root, filePath));
  const tests = run(process.execPath, ['--test', ...testFiles], { cwd: root, label: 'full test suite' });
  const countMatch = /[\u2139i]\s+tests\s+(\d+)/.exec(tests.stdout);
  const testCount = countMatch ? Number(countMatch[1]) : null;
  const jsFiles = [
    ...walkFiles(path.join(root, 'apps', 'extension', 'src'), (target) => target.endsWith('.js')),
    ...walkFiles(path.join(root, 'packages'), (target) => target.endsWith('.js')),
    ...walkFiles(path.join(root, 'scripts'), (target) => target.endsWith('.js')),
    ...walkFiles(path.join(root, 'tests'), (target) => target.endsWith('.js'))
  ];
  for (const filePath of jsFiles) {
    run(process.execPath, ['--check', filePath], { cwd: root, label: `syntax check ${path.relative(root, filePath)}` });
  }
  run(process.execPath, ['--max-old-space-size=2048', 'scripts/build-lexical-runtime.js', '--verify'], {
    cwd: root,
    label: 'verified lexical runtime rebuild'
  });
  run(process.execPath, ['--max-old-space-size=1024', 'scripts/run-semantic-quality.js', '--verify'], {
    cwd: root,
    label: 'semantic quality harness'
  });
  const packageMetadata = validatePackageMetadata(root);
  const extensionManifest = validateExtensionManifest(root);
  const runtime = validateRuntimeArtifact(root);
  const fallback = validateFallbackSimulation();
  const extensionZip = validateExtensionZip(root);
  const sourcePackage = validateSourcePackage(root, mode);
  const workbench = validateWorkbench(root);
  const evidence = validateReleaseRecords(root);
  return Object.freeze({
    release: RELEASE_VERSION,
    mode,
    ok: true,
    gates: Object.freeze([
      'fresh-full-tests',
      'shipped-javascript-syntax',
      'verified-corpus-provenance-license-hashes',
      'deterministic-runtime-index',
      'semantic-quality-thresholds',
      'semantic-projection-regression',
      'bootstrap-fallback-simulation',
      'local-only-extension-manifest',
      'extension-package-integrity',
      mode === 'development' ? 'git-cleanliness-development' : 'package-source-audit-standalone',
      'workbench-release-boundary',
      'release-evidence'
    ]),
    tests: { passed: testCount, failed: 0 },
    javascriptFilesChecked: jsFiles.length,
    packageMetadata,
    extensionManifest,
    runtime,
    fallback,
    extensionZip,
    sourcePackage,
    hygiene,
    workbench,
    evidence
  });
}

function parseCli(args) {
  let root = path.resolve(__dirname, '..');
  let mode = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--root' && args[index + 1]) {
      root = path.resolve(args[index + 1]);
      index += 1;
    } else if (args[index] === '--development' || args[index] === '--standalone') {
      if (mode) throw new TypeError('select exactly one validation mode');
      mode = args[index].slice(2);
    } else {
      throw new TypeError('usage: node scripts/validate-v0.3.0.js [--root <dir>] --development|--standalone');
    }
  }
  if (!mode) throw new TypeError('validation mode must be --development or --standalone');
  return Object.freeze({ root, mode });
}

if (require.main === module) {
  try {
    const settings = parseCli(process.argv.slice(2));
    const report = validateRelease(settings.root, settings.mode);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  RELEASE_VERSION,
  EXTENSION_VERSION,
  DATA_MANIFEST_PATH,
  EXTENSION_ZIP_PATH,
  SOURCE_ZIP_PATH,
  parseCli,
  validateRuntimeArtifact,
  validateFallbackSimulation,
  validateExtensionManifest,
  validateHygiene,
  validateExtensionZip,
  validateSourcePackage,
  validateWorkbench,
  validateReleaseRecords,
  validateRelease
});
