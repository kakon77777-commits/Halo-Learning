#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  normalizeCorpusBuildReceipt,
  normalizeDatasetManifest
} = require('../packages/contracts/lexical-contracts');
const { auditSourceRecords } = require('../packages/lexical-data/source-gate');
const { loadLexicalIndex } = require('../packages/lexical-index/lexical-index');

const RELEASE_VERSION = 'v0.2.0';
const EXTENSION_VERSION = '0.2.0';
const EXECUTABLE_ROOTS = Object.freeze([
  ['apps', 'extension', 'src'],
  ['packages'],
  ['scripts']
]);

function issue(code, detail) {
  return Object.freeze({ code, detail });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isSha256(value) {
  return value && value.algorithm === 'sha256' && /^[a-f0-9]{64}$/.test(value.value || '');
}

function isHttps(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch (_error) {
    return false;
  }
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

function auditSelectedSources(root, issues) {
  const sourcePath = path.join(root, 'docs', 'data-sources', 'source-records.json');
  if (!fs.existsSync(sourcePath)) {
    issues.push(issue('MISSING_SOURCE_RECORDS', 'docs/data-sources/source-records.json'));
    return;
  }
  let records;
  try {
    records = readJson(sourcePath);
  } catch (_error) {
    issues.push(issue('INVALID_SOURCE_RECORDS', 'docs/data-sources/source-records.json'));
    return;
  }
  const selected = Array.isArray(records.sources) ? records.sources.filter((record) => record && record.selected) : [];
  for (const locale of ['en', 'zh-Hant']) {
    const matches = selected.filter((record) => record.locale === locale);
    if (matches.length !== 1) {
      issues.push(issue('SOURCE_SELECTION_COUNT', locale));
      continue;
    }
    const record = matches[0];
    const complete = record.commercialUseAllowed === true &&
      record.redistributionAllowed === true && record.bundled === false &&
      isHttps(record.officialSourceUrl) && isHttps(record.officialLicenseUrl) && isHttps(record.officialFormatUrl) &&
      typeof record.licenseId === 'string' && record.licenseId &&
      typeof record.versionPolicy === 'string' && record.versionPolicy &&
      Array.isArray(record.redistributionRequirements) && record.redistributionRequirements.length > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(record.verifiedAt || '');
    if (!complete) issues.push(issue('MISSING_SOURCE_PROVENANCE', record.sourceId || locale));
  }
}

function auditDataManifest(root, issues) {
  const manifestPath = path.join(root, 'dist', 'data-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    issues.push(issue('MISSING_DATA_MANIFEST', 'dist/data-manifest.json'));
    return;
  }
  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch (_error) {
    issues.push(issue('INVALID_DATA_MANIFEST', 'dist/data-manifest.json'));
    return;
  }
  if (!Array.isArray(manifest.locales) || JSON.stringify(manifest.locales) !== JSON.stringify(['en', 'zh-Hant'])) {
    issues.push(issue('LOCALE_SCOPE_MISMATCH', 'dist/data-manifest.json'));
  }
  const datasets = Array.isArray(manifest.datasets) ? manifest.datasets : [];
  for (const locale of ['en', 'zh-Hant']) {
    if (datasets.filter((dataset) => dataset && dataset.locale === locale).length !== 1) {
      issues.push(issue('DATASET_LOCALE_COUNT', locale));
    }
  }
  for (const dataset of datasets) {
    const complete = dataset && typeof dataset.datasetId === 'string' && dataset.datasetId &&
      typeof dataset.version === 'string' && dataset.version &&
      dataset.source && isHttps(dataset.source.canonicalUrl) &&
      dataset.license && typeof dataset.license.licenseId === 'string' && dataset.license.licenseId &&
      typeof dataset.license.redistributionNote === 'string' && dataset.license.redistributionNote &&
      isHttps(dataset.license.verificationUrl) && isSha256(dataset.hash) &&
      Array.isArray(dataset.files) && dataset.files.length > 0 &&
      dataset.files.every((file) => Number.isInteger(file.bytes) && file.bytes >= 0 && /^[a-f0-9]{64}$/.test(file.sha256 || ''));
    if (!complete) issues.push(issue('MISSING_PROVENANCE', dataset && dataset.datasetId ? dataset.datasetId : 'unknown-dataset'));
  }
  if (!manifest.releaseFixture || manifest.releaseFixture.syntheticOnly !== true ||
      manifest.releaseFixture.upstreamCorpusBytesBundled !== false) {
    issues.push(issue('UNVERIFIED_CORPUS_BOUNDARY', 'dist/data-manifest.json'));
  }
}

function auditExecutableSources(root, issues) {
  const remotePattern = /https?:\/\//;
  const secretPattern = /(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|api[_-]?key\s*[:=]\s*['"][^'"]+)/i;
  for (const parts of EXECUTABLE_ROOTS) {
    const base = path.join(root, ...parts);
    for (const filePath of walkFiles(base, (target) => target.endsWith('.js'))) {
      const source = fs.readFileSync(filePath, 'utf8');
      const relative = path.relative(root, filePath).split(path.sep).join('/');
      if (remotePattern.test(source)) issues.push(issue('REMOTE_EXECUTABLE_URL', relative));
      if (secretPattern.test(source)) issues.push(issue('SECRET_PATTERN', relative));
    }
  }
}

function auditExtensionManifest(root, issues) {
  const manifestPath = path.join(root, 'apps', 'extension', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    issues.push(issue('MISSING_EXTENSION_MANIFEST', 'apps/extension/manifest.json'));
    return;
  }
  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch (_error) {
    issues.push(issue('INVALID_EXTENSION_MANIFEST', 'apps/extension/manifest.json'));
    return;
  }
  if (manifest.manifest_version !== 3 || manifest.version !== EXTENSION_VERSION) {
    issues.push(issue('EXTENSION_VERSION_MISMATCH', 'apps/extension/manifest.json'));
  }
  const permissions = Array.isArray(manifest.permissions) ? [...manifest.permissions].sort() : [];
  if (JSON.stringify(permissions) !== JSON.stringify(['activeTab', 'scripting', 'storage'])) {
    issues.push(issue('EXTENSION_PERMISSION_SCOPE', 'apps/extension/manifest.json'));
  }
  if (manifest.host_permissions !== undefined) issues.push(issue('HOST_PERMISSIONS_PRESENT', 'apps/extension/manifest.json'));
}

function auditReleaseTree(rootValue) {
  const root = path.resolve(rootValue);
  const issues = [];
  auditSelectedSources(root, issues);
  auditDataManifest(root, issues);
  auditExecutableSources(root, issues);
  auditExtensionManifest(root, issues);
  if (!fs.existsSync(path.join(root, 'THIRD_PARTY_NOTICES.md'))) {
    issues.push(issue('MISSING_THIRD_PARTY_NOTICES', 'THIRD_PARTY_NOTICES.md'));
  }
  return Object.freeze({ ok: issues.length === 0, issues: Object.freeze(issues) });
}

function run(command, args, options) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env || process.env,
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.status !== 0) {
    const evidence = `${result.stdout || ''}\n${result.stderr || ''}`.trim().slice(-6000);
    throw new Error(`${options.label} failed with exit ${result.status}:\n${evidence}`);
  }
  return result;
}

function assertEqualFile(left, right, label) {
  if (!fs.readFileSync(left).equals(fs.readFileSync(right))) {
    throw new Error(`${label} differs from the deterministic fixture build`);
  }
}

function validateDataArtifacts(root) {
  const dataManifest = readJson(path.join(root, 'dist', 'data-manifest.json'));
  const manifests = dataManifest.datasets.map(normalizeDatasetManifest);
  const indexPath = path.join(root, 'dist', dataManifest.index.path);
  const index = loadLexicalIndex(fs.readFileSync(indexPath, 'utf8'));
  if (index.hash.value !== dataManifest.index.hash.value || index.entries.length !== dataManifest.index.entryCount) {
    throw new Error('data manifest index evidence does not match the verified index');
  }
  const receiptPath = path.join(root, 'dist', dataManifest.receipts.path);
  const receiptDocument = readJson(receiptPath);
  const receipts = receiptDocument.receipts.map(normalizeCorpusBuildReceipt);
  if (receipts.length !== manifests.length || receiptDocument.indexHash.value !== index.hash.value) {
    throw new Error('build receipt count or index hash does not match the data manifest');
  }
  const manifestHashById = new Map(manifests.map((manifest) => [manifest.datasetId, manifest.hash.value]));
  for (const receipt of receipts) {
    if (manifestHashById.get(receipt.datasetId) !== receipt.inputHash.value || receipt.outputHash.value !== index.hash.value) {
      throw new Error(`build receipt hash mismatch for ${receipt.datasetId}`);
    }
  }
  auditSourceRecords(readJson(path.join(root, 'docs', 'data-sources', 'source-records.json')));
  return Object.freeze({ indexHash: index.hash.value, entryCount: index.entries.length, receiptCount: receipts.length });
}

function validateExtensionZip(root) {
  const zipPath = path.join(root, 'dist', 'halo-learning-magic-hand-v0.2.0.zip');
  if (!fs.existsSync(zipPath)) throw new Error('v0.2.0 extension ZIP is missing');
  const listing = run('unzip', ['-Z1', zipPath], { cwd: root, label: 'extension ZIP listing' })
    .stdout.trim().split(/\r?\n/).filter(Boolean);
  if (!listing.includes('manifest.json') || listing.some((entry) => entry.startsWith('/') || entry.includes('..') || entry.includes('\\'))) {
    throw new Error('extension ZIP root layout is invalid');
  }
  const manifest = JSON.parse(run('unzip', ['-p', zipPath, 'manifest.json'], {
    cwd: root,
    label: 'extension ZIP manifest read'
  }).stdout);
  if (manifest.version !== EXTENSION_VERSION || manifest.manifest_version !== 3) {
    throw new Error('extension ZIP manifest version is invalid');
  }
  return Object.freeze({ path: path.relative(root, zipPath), entries: listing.length, version: manifest.version });
}

function validateWorkbench(root) {
  const workbook = path.join(root, 'docs', 'workbench', 'Halo_Learning_v0.1.0_to_v1.0_Workbench.xlsx');
  const workflow = path.join(root, 'docs', 'workbench', 'Halo_Learning_v0.1.0_to_v1.0_Workflow.md');
  if (!fs.existsSync(workbook) || !fs.existsSync(workflow)) throw new Error('workbench deliverables are missing');
  const listing = run('unzip', ['-Z1', workbook], { cwd: root, label: 'workbook container audit' }).stdout;
  if (!listing.includes('xl/workbook.xml')) throw new Error('workbench XLSX container is invalid');
  const markdown = fs.readFileSync(workflow, 'utf8');
  if (!/\| v0\.2\.0 \|[^\n]*\| Complete \|/.test(markdown)) throw new Error('workflow v0.2.0 release status is not Complete');
  for (let task = 1; task <= 8; task += 1) {
    const taskId = `V020-${String(task).padStart(2, '0')}`;
    const line = markdown.split(/\r?\n/).find((value) => value.includes(`| ${taskId} |`));
    if (!line || !line.includes('| Complete |')) throw new Error(`workflow ${taskId} is not Complete`);
  }
  if (!/\| v0\.3\.0 \|[^\n]*\| Not Started \|/.test(markdown)) throw new Error('workflow v0.3.0 scope was changed');
  return Object.freeze({ workbook: path.relative(root, workbook), workflow: path.relative(root, workflow) });
}

function validateRelease(rootValue) {
  const root = path.resolve(rootValue);
  const audit = auditReleaseTree(root);
  if (!audit.ok) throw new Error(`release tree audit failed: ${JSON.stringify(audit.issues)}`);

  const testFiles = walkFiles(path.join(root, 'tests'), (target) => target.endsWith('.test.js'))
    .map((filePath) => path.relative(root, filePath));
  const fullTests = run(process.execPath, ['--test', ...testFiles], {
    cwd: root,
    label: 'full test suite'
  });
  const testsMatch = /ℹ tests (\d+)/.exec(fullTests.stdout);
  const testCount = testsMatch ? Number(testsMatch[1]) : null;

  const jsFiles = EXECUTABLE_ROOTS.flatMap((parts) => walkFiles(path.join(root, ...parts), (target) => target.endsWith('.js')));
  for (const filePath of jsFiles) {
    run(process.execPath, ['--check', filePath], { cwd: root, label: `parse check ${path.relative(root, filePath)}` });
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-v020-release-gate-'));
  try {
    const buildOut = path.join(tempRoot, 'build');
    run(process.execPath, [
      'scripts/build-lexical-data.js',
      '--en-dir', 'fixtures/lexical/wordnet-3.0-synthetic',
      '--zh-file', 'fixtures/lexical/cc-cedict-synthetic/cedict_ts.u8',
      '--out', buildOut
    ], {
      cwd: root,
      env: { ...process.env, SOURCE_DATE_EPOCH: '1787616000' },
      label: 'deterministic lexical fixture build'
    });
    assertEqualFile(path.join(buildOut, 'data-manifest.json'), path.join(root, 'dist', 'data-manifest.json'), 'data-manifest.json');
    assertEqualFile(
      path.join(buildOut, 'lexical-fixture', 'lexical-index.json'),
      path.join(root, 'dist', 'lexical-fixture', 'lexical-index.json'),
      'lexical-index.json'
    );
    assertEqualFile(
      path.join(buildOut, 'lexical-fixture', 'build-receipts.json'),
      path.join(root, 'dist', 'lexical-fixture', 'build-receipts.json'),
      'build-receipts.json'
    );

    const freshBenchmarkPath = path.join(tempRoot, 'benchmark.json');
    const benchmarkRun = run(process.execPath, [
      '--expose-gc', 'scripts/benchmark-lexical-index.js', '--json-out', freshBenchmarkPath
    ], { cwd: root, label: 'lexical index benchmark' });
    const freshBenchmark = JSON.parse(benchmarkRun.stdout);
    const committedBenchmark = readJson(path.join(root, 'docs', 'validation', 'v0.2.0-index-benchmark.json'));
    if (!freshBenchmark.allPassed || !committedBenchmark.allPassed ||
        freshBenchmark.benchmarkId !== committedBenchmark.benchmarkId) {
      throw new Error('lexical index benchmark evidence is missing or failed');
    }

    const data = validateDataArtifacts(root);
    const extensionZip = validateExtensionZip(root);
    const workbench = validateWorkbench(root);
    run('git', ['diff', '--check'], { cwd: root, label: 'git diff whitespace audit' });

    return Object.freeze({
      release: RELEASE_VERSION,
      ok: true,
      gates: Object.freeze([
        'full-tests',
        'javascript-parse',
        'local-only-security-audit',
        'deterministic-data-build',
        'synthetic-index-benchmark',
        'manifest-license-provenance',
        'fail-soft-regression',
        'extension-zip-root-version',
        'workbench-status-boundary',
        'git-diff-check'
      ]),
      tests: Object.freeze({ passed: testCount, failed: 0 }),
      executableFilesChecked: jsFiles.length,
      data,
      benchmark: freshBenchmark.measurements,
      extensionZip,
      workbench
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function parseCli(args) {
  let root = path.resolve(__dirname, '..');
  let auditOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--audit-only') auditOnly = true;
    else if (args[index] === '--root' && args[index + 1]) {
      root = path.resolve(args[index + 1]);
      index += 1;
    } else {
      throw new TypeError('usage: validate-v0.2.0.js [--root <dir>] [--audit-only]');
    }
  }
  return Object.freeze({ root, auditOnly });
}

if (require.main === module) {
  try {
    const settings = parseCli(process.argv.slice(2));
    const report = settings.auditOnly ? auditReleaseTree(settings.root) : validateRelease(settings.root);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ auditReleaseTree, validateRelease });
