#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Legacy = require('./validate-v0.4.0');

const FINAL_ACCEPTANCE_MAP = Object.freeze([
  Object.freeze({ id: 'sensitive-site-product-security', evidenceAny: Object.freeze([
    'tests/browser/sensitive-site-product-security.e2e.test.js',
    'docs/validation/v0.4.0-final-release-scope-correction.md'
  ]) }),
  Object.freeze({ id: 'allowed-site-marking', evidenceAny: Object.freeze([
    'tests/browser/final-closure-allowed-marking.e2e.test.js'
  ]) }),
  Object.freeze({ id: 'ordinary-mv3-recovery', evidenceAny: Object.freeze([
    'tests/browser/final-closure-b06-mv3-recovery.e2e.test.js'
  ]) }),
  Object.freeze({ id: 'dynamic-dom-spa', evidenceAny: Object.freeze([
    'tests/browser/browser-runtime-matrix.e2e.test.js',
    'docs/validation/v0.4.0-b01-dynamic-child-insertion.md',
    'docs/validation/v0.4.0-b04-sentence-pipeline-chrome-isolation.md'
  ]) }),
  Object.freeze({ id: 'reversible-rendering', evidenceAny: Object.freeze([
    'tests/browser/reversible-renderer.e2e.test.js',
    'docs/validation/v0.4.0-b02-reversible-renderer-retention.md'
  ]) }),
  Object.freeze({ id: 'trigger-controller', evidenceAny: Object.freeze([
    'tests/browser/trigger-controller.e2e.test.js',
    'docs/validation/v0.4.0-b05-trigger-controller-panel.md'
  ]) }),
  Object.freeze({ id: 'accessibility', evidenceAny: Object.freeze([
    'tests/accessibility-contract.test.js',
    'tests/browser/accessibility.e2e.test.js'
  ]) }),
  Object.freeze({ id: 'runtime-performance', evidenceAny: Object.freeze([
    'docs/validation/v0.4.0-b07-runtime-performance.md',
    'docs/validation/v0.4.0-browser-shard-comparison.json'
  ]) }),
  Object.freeze({ id: 'package-integrity', evidenceAny: Object.freeze([
    'tests/release-packaging-v0.4.0.test.js',
    'scripts/package-v0.4.0.js'
  ]) })
]);

const RELEASE_DEBT = Object.freeze([
  Object.freeze({
    id: 'b06-deterministic-runtime-reload-continuity',
    classification: 'RELEASE-DEBT',
    evidence: 'docs/validation/v0.4.0-b06-mv3-reload-lifecycle.md'
  }),
  Object.freeze({
    id: 'legacy-combined-sensitive-site-allowed-network-canary',
    classification: 'RELEASE-DEBT',
    evidence: 'tests/browser/sensitive-site.e2e.test.js'
  })
]);

function parseCli(args) {
  let root = process.cwd();
  let mode = null;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--root') {
      if (index + 1 >= args.length) throw new TypeError('--root requires a directory');
      root = path.resolve(args[++index]);
    } else if (value === '--development' || value === '--standalone') {
      if (mode !== null) throw new TypeError('choose exactly one validation mode');
      mode = value.slice(2);
    } else {
      throw new TypeError(`unknown argument: ${value}`);
    }
  }
  if (!mode) throw new TypeError('choose exactly one of --development or --standalone');
  return Object.freeze({ root: path.resolve(root), mode });
}

function validateFinalAcceptance(rootValue) {
  const root = path.resolve(rootValue);
  const present = [];
  const missing = [];
  for (const item of FINAL_ACCEPTANCE_MAP) {
    const evidence = item.evidenceAny.filter((relative) => fs.existsSync(path.join(root, ...relative.split('/'))));
    if (evidence.length) present.push(Object.freeze({ id: item.id, evidence: Object.freeze(evidence) }));
    else missing.push(Object.freeze({ id: item.id, expectedAny: item.evidenceAny }));
  }
  if (missing.length) throw new Error(`missing final acceptance evidence: ${missing.map((item) => item.id).join(', ')}`);
  return Object.freeze(present);
}

function validateReleaseDebt(rootValue) {
  const root = path.resolve(rootValue);
  for (const debt of RELEASE_DEBT) {
    if (!fs.existsSync(path.join(root, ...debt.evidence.split('/')))) {
      throw new Error(`release debt evidence is missing: ${debt.id}`);
    }
  }
  return RELEASE_DEBT;
}

function validateSelectedRuntime(rootValue) {
  const root = path.resolve(rootValue);
  const dataManifest = JSON.parse(fs.readFileSync(path.join(root, 'apps/extension/data/lexical-v0.4.0/data-manifest.json'), 'utf8'));
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'apps/extension/data/lexical-v0.4.0/build-receipt.json'), 'utf8'));
  const comparison = JSON.parse(fs.readFileSync(path.join(root, 'docs/validation/v0.4.0-browser-shard-comparison.json'), 'utf8'));
  if (dataManifest.selectionStatus !== 'selected-by-browser-comparison' || dataManifest.bucketCount !== 64) {
    throw new Error('production lexical runtime is not the selected 64-bucket runtime');
  }
  if (!comparison.selection || comparison.selection.status !== 'selected' || comparison.selection.selectedBucketCount !== 64) {
    throw new Error('browser comparison evidence does not select 64 buckets');
  }
  const selected = comparison.candidates.find((candidate) => candidate.bucketCount === 64);
  if (!selected || selected.manifestHash.value !== dataManifest.manifest.hash.value ||
      selected.manifestRootHash.value !== dataManifest.manifest.rootHash.value) {
    throw new Error('production lexical runtime hashes are not bound to the selected comparison candidate');
  }
  const shardCount = receipt.statistics && receipt.statistics.shardCount;
  if (receipt.bucketCount !== 64 || receipt.deterministic !== true || shardCount !== 128) {
    throw new Error('production lexical build receipt is not the deterministic selected 64-bucket runtime');
  }
  return Object.freeze({
    bucketCount: 64,
    shardCount,
    deterministic: true,
    manifestHash: dataManifest.manifest.hash.value,
    manifestRootHash: dataManifest.manifest.rootHash.value
  });
}

function validateFinalRelease(rootValue, mode) {
  const root = path.resolve(rootValue);
  const hygiene = Legacy.validateHygiene(root, mode);
  const packageMetadata = Legacy.validatePackageMetadata(root);
  const syntax = Legacy.validateJavaScriptSyntax(root);
  const manifest = Legacy.validateExtensionManifest(root);
  const privacySecurity = Legacy.validatePrivacySecurity(root);
  if (!privacySecurity.ok) throw new Error(`privacy/security issues: ${JSON.stringify(privacySecurity.issues)}`);
  const acceptance = validateFinalAcceptance(root);
  const releaseDebt = validateReleaseDebt(root);
  const selectedRuntime = validateSelectedRuntime(root);

  const nodeFiles = Legacy.listNodeRegressionTests(root);
  if (!nodeFiles.length) throw new Error('Node regression test set is empty');
  const nodeRegression = Legacy.runNodeTestCommand(root, process.execPath, ['--test', ...nodeFiles], 'final full Node regression');

  let packageIntegrity;
  if (mode === 'development') {
    packageIntegrity = Object.freeze({
      extension: Legacy.validateExtensionZip(root),
      source: Legacy.validateSourcePackage(root, mode),
      manifest: Legacy.validatePackageManifest(root)
    });
  } else {
    packageIntegrity = Legacy.validateSourcePackage(root, mode);
  }

  return Object.freeze({
    schemaVersion: 1,
    reportFormat: 'HaloLearningV040FinalReleaseValidator/v1',
    release: Legacy.RELEASE_VERSION,
    mode,
    ok: true,
    generatedAt: new Date().toISOString(),
    classification: Object.freeze({
      productBlockers: Object.freeze([]),
      evidenceBlockers: Object.freeze(['B08 until canonical envelope publication']),
      releaseDebt
    }),
    gates: Object.freeze([
      'source-hygiene',
      'scope-correct-final-acceptance-map',
      'local-only-mv3-manifest',
      'privacy-security-static',
      'selected-production-lexical-runtime',
      'fresh-node-regression',
      mode === 'development' ? 'release-package-integrity' : 'standalone-no-git-validation'
    ]),
    hygiene,
    packageMetadata,
    syntax,
    manifest,
    privacySecurity,
    acceptance,
    selectedRuntime,
    nodeRegression,
    packageIntegrity
  });
}

function main() {
  const options = parseCli(process.argv.slice(2));
  const report = validateFinalRelease(options.root, options.mode);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  FINAL_ACCEPTANCE_MAP,
  RELEASE_DEBT,
  parseCli,
  validateFinalAcceptance,
  validateReleaseDebt,
  validateSelectedRuntime,
  validateFinalRelease
});
