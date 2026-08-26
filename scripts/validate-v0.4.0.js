#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Packaging = require('./package-v0.4.0');

const RELEASE_VERSION = 'v0.4.0';
const EXTENSION_VERSION = '0.4.0';

const ACCEPTANCE_MAP = Object.freeze([
  Object.freeze({
    id: 'dynamic-dom',
    evidenceAny: Object.freeze(['tests/dynamic-dom-controller.test.js', 'tests/browser/dynamic-dom.e2e.test.js'])
  }),
  Object.freeze({
    id: 'reversible-idempotent-rendering',
    evidenceAny: Object.freeze(['tests/reversible-renderer.test.js', 'tests/browser/reversible-renderer.e2e.test.js'])
  }),
  Object.freeze({
    id: 'triggers',
    evidenceAny: Object.freeze(['tests/trigger-controller.test.js', 'tests/content-trigger-runtime.test.js', 'tests/browser/trigger-controller.e2e.test.js'])
  }),
  Object.freeze({
    id: 'sensitive-site-fail-closed',
    evidenceAny: Object.freeze(['tests/site-policy.test.js', 'tests/content-policy-lifecycle.test.js', 'tests/browser/sensitive-site.e2e.test.js'])
  }),
  Object.freeze({
    id: 'accessibility',
    evidenceAny: Object.freeze(['tests/accessibility-contract.test.js', 'tests/accessibility.test.js', 'tests/browser/accessibility.e2e.test.js'])
  }),
  Object.freeze({
    id: 'browser-fixture-matrix-20',
    evidenceAny: Object.freeze(['fixtures/browser', 'tests/browser/fixture-matrix.e2e.test.js'])
  }),
  Object.freeze({
    id: 'browser-performance',
    evidenceAny: Object.freeze(['scripts/profile-browser-runtime.js', 'docs/validation/v0.4.0-browser-performance.json'])
  }),
  Object.freeze({
    id: 'mv3-lifecycle',
    evidenceAny: Object.freeze(['tests/browser-service-worker-cdp.test.js', 'tests/browser/mv3-lifecycle.e2e.test.js'])
  }),
  Object.freeze({
    id: 'standalone-release-validation',
    evidenceAny: Object.freeze(['tests/release-validator-v0.4.0.test.js', 'scripts/validate-v0.4.0.js'])
  }),
  Object.freeze({
    id: 'package-integrity',
    evidenceAny: Object.freeze(['tests/release-packaging-v0.4.0.test.js', 'scripts/package-v0.4.0.js'])
  })
]);

const SOURCE_AUDIT_TARGETS = Object.freeze([
  'apps/extension/src',
  'apps/extension/manifest.json',
  'apps/extension/README.md',
  'packages',
  'scripts',
  'tests',
  'docs/releases',
  'docs/validation',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'package.json'
]);
const TEXT_EXTENSIONS = Object.freeze(new Set(['.js', '.json', '.md', '.css', '.html', '.yaml', '.yml', '.txt']));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function collectFiles(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) return [];
  if (stat.isFile()) return [target];
  if (!stat.isDirectory()) return [];
  const files = [];
  const pending = [target];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(next);
      else if (entry.isFile()) files.push(next);
    }
  }
  return files.sort();
}

function auditSourceTree(rootValue) {
  const root = path.resolve(rootValue);
  const files = [...new Set(SOURCE_AUDIT_TARGETS.flatMap((relative) => collectFiles(path.join(root, relative))))]
    .filter((filePath) => TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .sort();
  const issues = [];
  for (const filePath of files) {
    const relative = path.relative(root, filePath).split(path.sep).join('/');
    const source = fs.readFileSync(filePath, 'utf8');
    const lines = source.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].endsWith('\r') ? lines[index].slice(0, -1) : lines[index];
      if (/[ \t]+$/.test(line)) issues.push(Object.freeze({ code: 'TRAILING_WHITESPACE', path: relative, line: index + 1 }));
      if (/^(<<<<<<<|=======|>>>>>>>)(?:\s|$)/.test(line)) {
        issues.push(Object.freeze({ code: 'CONFLICT_MARKER', path: relative, line: index + 1 }));
      }
    }
  }
  return Object.freeze({ ok: issues.length === 0, filesChecked: files.length, issues: Object.freeze(issues) });
}

function parseCli(args) {
  let root = process.cwd();
  let mode = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--root') {
      if (index + 1 >= args.length) throw new TypeError('--root requires a directory');
      root = path.resolve(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--development' || arg === '--standalone') {
      const candidate = arg.slice(2);
      if (mode !== null) throw new TypeError('choose exactly one of --development or --standalone');
      mode = candidate;
      continue;
    }
    throw new TypeError(`unknown argument: ${arg}`);
  }
  if (mode === null) throw new TypeError('choose exactly one of --development or --standalone');
  return Object.freeze({ root, mode });
}

function parseNodeTestSummary(outputValue) {
  const output = String(outputValue || '');
  const fields = ['tests', 'pass', 'fail', 'skipped', 'todo'];
  const values = {};
  const missing = [];
  for (const field of fields) {
    const match = output.match(new RegExp(`^(?:#|ℹ|i)\\s+${field}\\s+(\\d+)\\s*$`, 'm'));
    if (match) values[field] = Number.parseInt(match[1], 10);
    else {
      values[field] = 'unknown';
      missing.push(field);
    }
  }
  if (missing.length) {
    return Object.freeze({
      status: 'unknown',
      ...values,
      reason: `missing node:test summary fields: ${missing.join(', ')}`
    });
  }
  return Object.freeze({ status: 'known', ...values });
}

function runStage(label, fn, options) {
  const emit = options && typeof options.emit === 'function'
    ? options.emit
    : (line) => process.stderr.write(`${line}\n`);
  emit(`[v0.4] START ${label}`);
  try {
    const result = fn();
    emit(`[v0.4] PASS ${label}`);
    return result;
  } catch (error) {
    emit(`[v0.4] FAIL ${label}: ${error.message}`);
    throw error;
  }
}

function runCommand(rootValue, command, args, label, options) {
  const result = childProcess.spawnSync(command, args, {
    cwd: path.resolve(rootValue),
    encoding: 'utf8',
    env: options && options.env ? options.env : process.env,
    maxBuffer: 100 * 1024 * 1024
  });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const evidence = `${result.stdout || ''}\n${result.stderr || ''}`.trim().slice(-12000);
    throw new Error(`${label} failed with exit ${result.status}:\n${evidence}`);
  }
  return result;
}

function runNodeTestCommand(rootValue, command, args, label, options) {
  const env = { ...process.env, ...((options && options.env) || {}) };
  delete env.NODE_TEST_CONTEXT;
  const result = runCommand(rootValue, command, args, label, { ...(options || {}), env });
  const summary = parseNodeTestSummary(`${result.stdout || ''}\n${result.stderr || ''}`);
  if (summary.status !== 'known') {
    throw new Error(`${label}: unable to parse machine-readable test totals (${summary.reason})`);
  }
  if (summary.fail !== 0 || summary.pass + summary.skipped + summary.todo < summary.tests) {
    throw new Error(`${label}: parsed test totals indicate incomplete/failed execution: ${JSON.stringify(summary)}`);
  }
  return summary;
}

function validateHygiene(rootValue, mode) {
  const root = path.resolve(rootValue);
  if (!['development', 'standalone'].includes(mode)) throw new TypeError('hygiene mode must be development or standalone');
  const audit = auditSourceTree(root);
  if (!audit.ok) throw new Error(`source audit failed: ${JSON.stringify(audit.issues)}`);

  if (mode === 'standalone') {
    const gitMetadataPresent = fs.existsSync(path.join(root, '.git'));
    if (gitMetadataPresent) throw new Error('standalone release contains prohibited Git metadata');
    return Object.freeze({
      mode: 'standalone-source-audit',
      gitInvoked: false,
      gitMetadataPresent: false,
      filesChecked: audit.filesChecked
    });
  }

  runCommand(root, 'git', ['diff', '--check'], 'git diff whitespace audit');
  runCommand(root, 'git', ['diff', '--cached', '--check'], 'staged git diff whitespace audit');
  const status = runCommand(root, 'git', ['status', '--porcelain', '--untracked-files=all'], 'git cleanliness check').stdout.trim();
  if (status) throw new Error('development Git worktree is not clean');
  return Object.freeze({
    mode: 'development-git-audit',
    gitInvoked: true,
    clean: true,
    filesChecked: audit.filesChecked
  });
}

function validateExtensionManifest(rootValue) {
  const root = path.resolve(rootValue);
  const manifestPath = path.join(root, 'apps', 'extension', 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('extension manifest is missing');
  const manifest = readJson(manifestPath);
  if (manifest.manifest_version !== 3 || manifest.version !== EXTENSION_VERSION) {
    throw new Error(`extension manifest must be MV3 version ${EXTENSION_VERSION}`);
  }
  const permissions = Array.isArray(manifest.permissions) ? [...manifest.permissions].sort() : [];
  if (JSON.stringify(permissions) !== JSON.stringify(['activeTab', 'contextMenus', 'scripting', 'storage'])) {
    throw new Error('extension permission scope is invalid');
  }
  if (manifest.host_permissions !== undefined) throw new Error('extension host permissions are prohibited');
  if (!manifest.background || manifest.background.service_worker !== 'src/service-worker.js') {
    throw new Error('extension local service worker is missing');
  }
  return Object.freeze({ version: manifest.version, manifestVersion: manifest.manifest_version, permissions: Object.freeze(permissions) });
}

function validateAcceptanceMap(rootValue) {
  const root = path.resolve(rootValue);
  const present = [];
  const missing = [];
  for (const item of ACCEPTANCE_MAP) {
    const found = item.evidenceAny.filter((relative) => fs.existsSync(path.join(root, ...relative.split('/'))));
    if (found.length) present.push(Object.freeze({ id: item.id, evidence: Object.freeze(found) }));
    else missing.push(Object.freeze({ id: item.id, expectedAny: item.evidenceAny }));
  }
  return Object.freeze({ ok: missing.length === 0, present: Object.freeze(present), missing: Object.freeze(missing) });
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function validatePackageMetadata(rootValue) {
  const root = path.resolve(rootValue);
  const packagePath = path.join(root, 'package.json');
  if (!fs.existsSync(packagePath)) throw new Error('package.json is missing');
  const document = readJson(packagePath);
  const scripts = document.scripts || {};
  if (document.version !== EXTENSION_VERSION ||
      scripts.validate !== 'node scripts/validate-v0.4.0.js --development' ||
      scripts['validate:standalone'] !== 'node scripts/validate-v0.4.0.js --standalone' ||
      scripts['package:release'] !== 'node scripts/package-v0.4.0.js') {
    throw new Error('package.json does not expose the v0.4.0 release metadata boundary');
  }
  return Object.freeze({ name: document.name, version: document.version });
}

function sortedArchivePaths(values) {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function validateZipBytes(rootValue, zipPath, expectedEntries, label) {
  const root = path.resolve(rootValue);
  const listingResult = runCommand(root, 'unzip', ['-Z1', zipPath], `${label} listing`);
  const actual = sortedArchivePaths(listingResult.stdout.trim().split(/\r?\n/).filter(Boolean));
  const expected = sortedArchivePaths(expectedEntries.map((entry) => entry.archivePath));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} inventory differs from the canonical source inventory`);
  }
  const extractedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-v040-zip-verify-'));
  try {
    runCommand(root, 'unzip', ['-qq', zipPath, '-d', extractedRoot], `${label} extraction`);
    for (const entry of expectedEntries) {
      const extractedPath = path.join(extractedRoot, ...entry.archivePath.split('/'));
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
  return Object.freeze(actual);
}

function validateExtensionZip(rootValue) {
  const root = path.resolve(rootValue);
  const zipPath = path.join(root, ...Packaging.EXTENSION_OUTPUT.split('/'));
  if (!fs.existsSync(zipPath)) throw new Error('v0.4.0 extension ZIP is missing');
  runCommand(root, 'unzip', ['-tqq', zipPath], 'extension ZIP integrity');
  const listing = validateZipBytes(root, zipPath, Packaging.extensionPackageEntries(root), 'extension ZIP');
  const manifestResult = runCommand(root, 'unzip', ['-p', zipPath, 'manifest.json'], 'extension ZIP manifest');
  const manifest = JSON.parse(manifestResult.stdout);
  if (manifest.manifest_version !== 3 || manifest.version !== EXTENSION_VERSION) {
    throw new Error('extension ZIP manifest version is invalid');
  }
  return Object.freeze({
    path: Packaging.EXTENSION_OUTPUT,
    entries: listing.length,
    bytes: fs.statSync(zipPath).size,
    version: manifest.version,
    sha256: sha256File(zipPath)
  });
}

function validateSourcePackage(rootValue, mode) {
  if (mode === 'standalone') {
    return Object.freeze({ validatedBy: 'extracted-standalone-root', gitRequired: false });
  }
  if (mode !== 'development') throw new TypeError('source package validation mode must be development or standalone');
  const root = path.resolve(rootValue);
  const zipPath = path.join(root, ...Packaging.SOURCE_OUTPUT.split('/'));
  if (!fs.existsSync(zipPath)) throw new Error('v0.4.0 standalone source release ZIP is missing');
  runCommand(root, 'unzip', ['-tqq', zipPath], 'source release ZIP integrity');
  const listing = validateZipBytes(root, zipPath, Packaging.sourcePackageEntries(root), 'source release ZIP');
  return Object.freeze({
    path: Packaging.SOURCE_OUTPUT,
    entries: listing.length,
    bytes: fs.statSync(zipPath).size,
    sha256: sha256File(zipPath),
    gitMetadataPresent: false
  });
}

function validatePackageManifest(rootValue) {
  const root = path.resolve(rootValue);
  const manifestPath = path.join(root, ...Packaging.PACKAGE_MANIFEST_OUTPUT.split('/'));
  if (!fs.existsSync(manifestPath)) throw new Error('v0.4.0 package manifest is missing');
  const manifest = readJson(manifestPath);
  if (manifest.schemaVersion !== 1 || manifest.release !== RELEASE_VERSION || manifest.hashAlgorithm !== 'sha256') {
    throw new Error('v0.4.0 package manifest metadata is invalid');
  }
  for (const name of ['extension', 'source']) {
    const descriptor = manifest[name];
    if (!descriptor || typeof descriptor.path !== 'string' || !/^[a-f0-9]{64}$/.test(descriptor.sha256 || '')) {
      throw new Error(`${name} package manifest descriptor is invalid`);
    }
    if (name === 'source' && descriptor.gitMetadataPresent !== false) {
      throw new Error('source package manifest must record Git metadata as absent');
    }
    const filePath = path.join(root, ...descriptor.path.split('/'));
    if (!fs.existsSync(filePath)) throw new Error(`${name} package referenced by manifest is missing`);
    if (sha256File(filePath) !== descriptor.sha256) throw new Error(`${name} package hash mismatch`);
  }
  return Object.freeze({
    release: manifest.release,
    hashAlgorithm: manifest.hashAlgorithm,
    extension: Object.freeze({ path: manifest.extension.path, sha256: manifest.extension.sha256 }),
    source: Object.freeze({ path: manifest.source.path, sha256: manifest.source.sha256 })
  });
}

function listNodeRegressionTests(rootValue) {
  const root = path.resolve(rootValue);
  const testsRoot = path.join(root, 'tests');
  if (!fs.existsSync(testsRoot)) return Object.freeze([]);
  return Object.freeze(fs.readdirSync(testsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
    .map((entry) => `tests/${entry.name}`)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
}

function listBrowserE2ETests(rootValue) {
  const root = path.resolve(rootValue);
  const browserRoot = path.join(root, 'tests', 'browser');
  if (!fs.existsSync(browserRoot)) return Object.freeze([]);
  return Object.freeze(fs.readdirSync(browserRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.e2e.test.js'))
    .map((entry) => `tests/browser/${entry.name}`)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
}

function validateJavaScriptSyntax(rootValue) {
  const root = path.resolve(rootValue);
  const files = [
    ...collectFiles(path.join(root, 'apps', 'extension', 'src')),
    ...collectFiles(path.join(root, 'packages')),
    ...collectFiles(path.join(root, 'scripts'))
  ].filter((filePath) => filePath.endsWith('.js'))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  for (const filePath of files) {
    const relative = path.relative(root, filePath).split(path.sep).join('/');
    runCommand(root, process.execPath, ['--check', filePath], `syntax check ${relative}`);
  }
  return Object.freeze({ filesChecked: files.length });
}

function validateBrowserPerformanceEvidence(rootValue) {
  const root = path.resolve(rootValue);
  const profilerPath = path.join(root, 'scripts', 'profile-browser-runtime.js');
  const baselineRelative = 'docs/validation/v0.4.0-browser-baseline.json';
  const comparisonRelative = 'docs/validation/v0.4.0-browser-shard-comparison.json';
  const baselinePath = path.join(root, ...baselineRelative.split('/'));
  const comparisonPath = path.join(root, ...comparisonRelative.split('/'));
  if (!fs.existsSync(profilerPath) || !fs.existsSync(baselinePath) || !fs.existsSync(comparisonPath)) {
    throw new Error('browser performance evidence or profiler is missing');
  }
  runCommand(root, process.execPath, [
    'scripts/profile-browser-runtime.js', '--verify', '--output', baselinePath
  ], 'browser baseline evidence verification');
  runCommand(root, process.execPath, [
    'scripts/profile-browser-runtime.js', '--verify', '--compare-buckets', '64,128', '--output', comparisonPath
  ], 'browser shard comparison evidence verification');
  return Object.freeze({
    baseline: baselineRelative,
    shardComparison: comparisonRelative
  });
}

function validatePrivacySecurity(rootValue) {
  const root = path.resolve(rootValue);
  const sourceRoot = path.join(root, 'apps', 'extension', 'src');
  const files = collectFiles(sourceRoot).filter((filePath) => path.extname(filePath).toLowerCase() === '.js');
  const issues = [];
  const checks = Object.freeze([
    Object.freeze({ code: 'REMOTE_NETWORK_LITERAL', regex: /(?:fetch\s*\(|XMLHttpRequest\s*\(|WebSocket\s*\(|EventSource\s*\()[\s\S]{0,160}?['"]https?:\/\//i }),
    Object.freeze({ code: 'REMOTE_CODE_LITERAL', regex: /https?:\/\/[^'"\s]+\.(?:js|mjs)(?:[?#'"\s]|$)/i }),
    Object.freeze({ code: 'COOKIE_ACCESS', regex: /\bdocument\.cookie\b|\bchrome\.cookies\b/i }),
    Object.freeze({ code: 'HISTORY_ACCESS', regex: /\bchrome\.history\b/i }),
    Object.freeze({ code: 'DYNAMIC_CODE_EXECUTION', regex: /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\([^)]*\)\s*\{/ }),
    Object.freeze({ code: 'REMOTE_SCRIPT_ELEMENT', regex: /createElement\s*\(\s*['"]script['"]\s*\)[\s\S]{0,500}?(?:\.src\s*=|setAttribute\s*\(\s*['"]src['"])/i })
  ]);
  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    const relative = path.relative(root, filePath).split(path.sep).join('/');
    for (const check of checks) {
      if (check.regex.test(source)) issues.push(Object.freeze({ code: check.code, path: relative }));
    }
  }
  return Object.freeze({ ok: issues.length === 0, filesChecked: files.length, issues: Object.freeze(issues) });
}

function validateRelease(rootValue, mode, options) {
  const root = path.resolve(rootValue);
  if (!['development', 'standalone'].includes(mode)) throw new TypeError('release validation mode must be development or standalone');
  const emit = options && typeof options.emit === 'function'
    ? options.emit
    : (line) => process.stderr.write(`${line}\n`);
  const stage = (label, fn) => runStage(label, fn, { emit });

  const hygiene = stage('source hygiene', () => validateHygiene(root, mode));
  const acceptanceMap = stage('acceptance evidence map', () => {
    const result = validateAcceptanceMap(root);
    if (!result.ok) throw new Error(`missing acceptance evidence: ${result.missing.map((item) => item.id).join(', ')}`);
    return result;
  });
  const packageMetadata = stage('package metadata', () => validatePackageMetadata(root));
  const syntax = stage('shipped JavaScript syntax', () => validateJavaScriptSyntax(root));
  const manifest = stage('extension manifest', () => validateExtensionManifest(root));
  const privacySecurity = stage('privacy/security static gate', () => {
    const result = validatePrivacySecurity(root);
    if (!result.ok) throw new Error(`privacy/security issues: ${JSON.stringify(result.issues)}`);
    return result;
  });

  const nodeTestFiles = listNodeRegressionTests(root);
  if (!nodeTestFiles.length) throw new Error('Node regression test set is empty');
  const nodeRegression = stage('full Node regression', () =>
    runNodeTestCommand(root, process.execPath, ['--test', ...nodeTestFiles], 'full Node regression'));

  const browserTestFiles = listBrowserE2ETests(root);
  if (!browserTestFiles.length) throw new Error('real Chromium E2E test set is empty');
  const browserE2E = stage('real Chromium E2E', () =>
    runNodeTestCommand(root, process.execPath, ['--test', ...browserTestFiles], 'real Chromium E2E'));

  const browserPerformance = stage('browser performance evidence', () => validateBrowserPerformanceEvidence(root));

  let packageIntegrity;
  if (mode === 'development') {
    packageIntegrity = stage('release package integrity', () => Object.freeze({
      extension: validateExtensionZip(root),
      source: validateSourcePackage(root, mode),
      manifest: validatePackageManifest(root)
    }));
  } else {
    packageIntegrity = stage('standalone extracted-root integrity', () => validateSourcePackage(root, mode));
  }

  return Object.freeze({
    release: RELEASE_VERSION,
    mode,
    ok: true,
    generatedAt: new Date().toISOString(),
    gates: Object.freeze([
      'source-hygiene',
      'acceptance-map',
      'package-metadata',
      'shipped-javascript-syntax',
      'local-only-mv3-manifest',
      'privacy-security-static',
      'fresh-node-regression',
      'real-chromium-e2e',
      'browser-performance-evidence',
      mode === 'development' ? 'release-package-integrity' : 'standalone-no-git-validation'
    ]),
    hygiene,
    acceptanceMap,
    packageMetadata,
    syntax,
    manifest,
    privacySecurity,
    tests: Object.freeze({ nodeRegression, browserE2E }),
    browserPerformance,
    packageIntegrity
  });
}

function main(options) {
  return validateRelease(options.root, options.mode);
}

if (require.main === module) {
  try {
    const options = parseCli(process.argv.slice(2));
    const report = main(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  RELEASE_VERSION,
  EXTENSION_VERSION,
  ACCEPTANCE_MAP,
  parseCli,
  parseNodeTestSummary,
  runStage,
  runCommand,
  runNodeTestCommand,
  auditSourceTree,
  validateHygiene,
  validateExtensionManifest,
  validateAcceptanceMap,
  validatePrivacySecurity,
  validatePackageMetadata,
  validateExtensionZip,
  validateSourcePackage,
  validatePackageManifest,
  listNodeRegressionTests,
  listBrowserE2ETests,
  validateJavaScriptSyntax,
  validateBrowserPerformanceEvidence,
  validateRelease,
  main
});
