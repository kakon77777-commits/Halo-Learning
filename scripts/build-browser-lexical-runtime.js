#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildRuntimeArtifacts } = require('./build-lexical-runtime');
const {
  BUILDER,
  buildBrowserLexicalArtifacts
} = require('../packages/lexical-index/browser-lexical-shards');
const { verifyBrowserShardComparison } = require('./profile-browser-runtime');

const CANONICAL_BUILD_TIME = '2026-08-25T00:00:00.000Z';
const DEFAULT_SELECTION_FILE = 'docs/validation/v0.4.0-browser-shard-comparison.json';
const CANONICAL_EXTENSION_ROOT = 'apps/extension/data/lexical-v0.4.0';
const CANONICAL_DIST_ROOT = 'dist/lexical-v0.4.0';

function runtimeEntries(document) {
  return [
    ...document.englishRows.map((row) => ({ locale: 'en', row, gloss: document.glosses[row[6]] })),
    ...document.chineseRows.map((row) => ({ locale: 'zh-Hant', row, gloss: document.glosses[row[6]] }))
  ];
}

function buildBrowserRuntimeArtifacts(options) {
  const settings = options || {};
  const bucketCount = settings.bucketCount;
  if (![64, 128].includes(bucketCount)) throw new TypeError('bucketCount: must be the 64 or 128 candidate');
  const builtAt = settings.builtAt || CANONICAL_BUILD_TIME;
  const runtime = buildRuntimeArtifacts({
    englishDir: settings.englishDir,
    chineseDir: settings.chineseDir,
    builtAt
  });
  const source = JSON.parse(runtime.serializedIndex);
  const shardArtifacts = buildBrowserLexicalArtifacts(runtimeEntries(source), {
    bucketCount,
    builtAt,
    sourceIndex: { format: source.indexFormat, hash: source.hash },
    datasets: source.datasets,
    morphologyRows: source.morphologyRows,
    rejectedCount: runtime.statistics.rejectedCount
  });
  const dataManifest = Object.freeze({
    schemaVersion: 1,
    release: 'v0.4.0',
    generatedAt: builtAt,
    selectionStatus: settings.selectionStatus || 'candidate-unselected',
    bucketCount,
    locales: Object.freeze(['en', 'zh-Hant']),
    manifest: Object.freeze({
      path: 'manifest.json',
      format: shardArtifacts.manifest.manifestFormat,
      rootHash: shardArtifacts.manifest.rootHash,
      hash: shardArtifacts.manifest.hash,
      shardCount: shardArtifacts.manifest.statistics.shardCount
    }),
    sourceIndex: shardArtifacts.manifest.sourceIndex,
    datasets: shardArtifacts.manifest.datasets,
    statistics: shardArtifacts.manifest.statistics,
    limitation: settings.selectionStatus === 'selected-by-browser-comparison'
      ? null
      : 'Unselected profiling candidate. Node build and size diagnostics are not Chromium evidence.'
  });
  const buildReceipt = Object.freeze({
    schemaVersion: 1,
    receiptFormat: 'BrowserLexicalBuildReceipt/v1',
    builder: BUILDER,
    builtAt,
    bucketCount,
    sourceIndexHash: shardArtifacts.manifest.sourceIndex.hash,
    manifestRootHash: shardArtifacts.manifest.rootHash,
    manifestHash: shardArtifacts.manifest.hash,
    deterministic: true,
    statistics: shardArtifacts.manifest.statistics
  });
  const files = {
    'manifest.json': `${shardArtifacts.serializedManifest}\n`,
    'data-manifest.json': `${JSON.stringify(dataManifest, null, 2)}\n`,
    'build-receipt.json': `${JSON.stringify(buildReceipt, null, 2)}\n`
  };
  for (const [relativePath, serialized] of Object.entries(shardArtifacts.serializedShards)) {
    files[relativePath] = `${serialized}\n`;
  }
  return Object.freeze({
    manifest: shardArtifacts.manifest,
    dataManifest,
    buildReceipt,
    files: Object.freeze(files),
    statistics: Object.freeze({
      ...shardArtifacts.manifest.statistics,
      totalBytes: Object.values(files).reduce((total, value) => total + Buffer.byteLength(value), 0),
      maximumShardBytes: Math.max(...Object.entries(files)
        .filter(([name]) => name.startsWith('shards/'))
        .map(([, value]) => Buffer.byteLength(value)))
    })
  });
}

function resolveInside(root, relativePath) {
  const base = path.resolve(root);
  const resolved = path.resolve(base, relativePath);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new TypeError(`artifact path escapes output root: ${relativePath}`);
  }
  return resolved;
}

function inventory(root) {
  const result = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else result.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  }
  walk(root);
  return result.sort();
}

function publishCandidateTree(artifacts, options) {
  const settings = options || {};
  const mode = settings.mode;
  const outputRoot = path.resolve(settings.outputRoot || '');
  if (!['write', 'verify'].includes(mode)) throw new TypeError('mode: must be write or verify');
  if (!settings.outputRoot) throw new TypeError('outputRoot: is required');
  const expectedNames = Object.keys(artifacts.files).sort();
  if (mode === 'verify') {
    if (!fs.existsSync(outputRoot) || !fs.statSync(outputRoot).isDirectory()) {
      throw new Error(`browser shard tree does not match deterministic build: ${outputRoot} is missing`);
    }
    const actualNames = inventory(outputRoot);
    if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
      throw new Error('browser shard tree does not match deterministic build: inventory differs');
    }
    for (const relativePath of expectedNames) {
      if (fs.readFileSync(resolveInside(outputRoot, relativePath), 'utf8') !== artifacts.files[relativePath]) {
        throw new Error(`browser shard tree does not match deterministic build: ${relativePath}`);
      }
    }
    return Object.freeze({ mode, outputRoot, fileCount: expectedNames.length });
  }

  if (fs.existsSync(outputRoot)) throw new Error(`browser shard output already exists: ${outputRoot}`);
  fs.mkdirSync(path.dirname(outputRoot), { recursive: true });
  const stagingRoot = `${outputRoot}.tmp-${process.pid}`;
  if (fs.existsSync(stagingRoot)) throw new Error(`browser shard staging path already exists: ${stagingRoot}`);
  try {
    fs.mkdirSync(stagingRoot);
    for (const relativePath of expectedNames) {
      const target = resolveInside(stagingRoot, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, artifacts.files[relativePath], { flag: 'wx' });
    }
    fs.renameSync(stagingRoot, outputRoot);
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
  return Object.freeze({ mode, outputRoot, fileCount: expectedNames.length });
}

function publishSelectedTrees(artifacts, options) {
  const settings = options || {};
  const projectRoot = path.resolve(settings.projectRoot || '');
  const mode = settings.mode;
  if (!settings.projectRoot) throw new TypeError('projectRoot: is required');
  if (!['write', 'verify'].includes(mode)) throw new TypeError('mode: must be write or verify');
  const extensionRoot = path.join(projectRoot, CANONICAL_EXTENSION_ROOT);
  const distRoot = path.join(projectRoot, CANONICAL_DIST_ROOT);
  const distArtifacts = Object.freeze({
    files: Object.freeze(Object.fromEntries(
      Object.entries(artifacts.files).filter(([relativePath]) => !relativePath.startsWith('shards/'))
    ))
  });
  if (mode === 'verify') {
    publishCandidateTree(artifacts, { outputRoot: extensionRoot, mode });
    publishCandidateTree(distArtifacts, { outputRoot: distRoot, mode });
    return Object.freeze({ mode, extensionRoot, distRoot });
  }

  if (fs.existsSync(extensionRoot) || fs.existsSync(distRoot)) {
    throw new Error('selected browser shard output already exists');
  }
  const extensionStage = `${extensionRoot}.stage-${process.pid}`;
  const distStage = `${distRoot}.stage-${process.pid}`;
  let extensionPublished = false;
  let distPublished = false;
  try {
    publishCandidateTree(artifacts, { outputRoot: extensionStage, mode: 'write' });
    publishCandidateTree(distArtifacts, { outputRoot: distStage, mode: 'write' });
    fs.renameSync(extensionStage, extensionRoot);
    extensionPublished = true;
    fs.renameSync(distStage, distRoot);
    distPublished = true;
  } catch (error) {
    fs.rmSync(extensionStage, { recursive: true, force: true });
    fs.rmSync(distStage, { recursive: true, force: true });
    if (extensionPublished) fs.rmSync(extensionRoot, { recursive: true, force: true });
    if (distPublished) fs.rmSync(distRoot, { recursive: true, force: true });
    throw error;
  }
  return Object.freeze({ mode, extensionRoot, distRoot });
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new TypeError(`${name} requires a value`);
  return args[index + 1];
}

function parseCommandLine(args) {
  const modes = ['--write', '--verify'].filter((value) => args.includes(value));
  if (modes.length !== 1) throw new TypeError('Use exactly one of --write or --verify');
  const bucketValue = argumentValue(args, '--buckets');
  const explicitSelectionFile = argumentValue(args, '--selection-file');
  const outputRoot = argumentValue(args, '--output-root');
  const selectionFile = explicitSelectionFile || (!bucketValue && modes[0] === '--verify'
    ? DEFAULT_SELECTION_FILE
    : null);
  if (Boolean(bucketValue) === Boolean(selectionFile)) {
    throw new TypeError('Use exactly one of --buckets or --selection-file');
  }
  if (bucketValue && !outputRoot) {
    throw new TypeError('--output-root is required for an unselected bucket candidate');
  }
  const bucketCount = bucketValue ? Number(bucketValue) : null;
  if (bucketValue && ![64, 128].includes(bucketCount)) throw new TypeError('--buckets must be 64 or 128');
  return Object.freeze({
    mode: modes[0].slice(2),
    bucketCount,
    selectionFile: selectionFile ? path.resolve(selectionFile) : null,
    outputRoot: outputRoot ? path.resolve(outputRoot) : null
  });
}

function readSelectedComparison(selectionFile) {
  const evidence = JSON.parse(fs.readFileSync(selectionFile, 'utf8'));
  verifyBrowserShardComparison(evidence);
  const value = evidence && evidence.selection && evidence.selection.selectedBucketCount;
  if (evidence.selection.status !== 'selected' || ![64, 128].includes(value)) {
    throw new Error('comparison evidence has no benchmark-selected 64/128 bucket count');
  }
  return evidence;
}

function selectedBucketCount(selectionFile) {
  return readSelectedComparison(selectionFile).selection.selectedBucketCount;
}

function assertSelectedArtifactBinding(artifacts, evidence) {
  const selected = evidence.selection.selectedBucketCount;
  const candidate = evidence.candidates.find((value) => value.bucketCount === selected);
  const sameHash = (left, right) => left && right &&
    left.algorithm === right.algorithm && left.value === right.value;
  if (!candidate || artifacts.manifest.bucketCount !== selected ||
      !sameHash(candidate.manifestHash, artifacts.manifest.hash) ||
      !sameHash(candidate.manifestRootHash, artifacts.manifest.rootHash)) {
    throw new Error('selected comparison evidence does not match freshly rebuilt artifacts');
  }
  return true;
}

function buildTimeFromEnvironment(environment) {
  const raw = environment.SOURCE_DATE_EPOCH;
  if (raw === undefined || raw === '') return CANONICAL_BUILD_TIME;
  if (!/^\d+$/.test(raw)) throw new TypeError('SOURCE_DATE_EPOCH must be whole Unix seconds');
  const result = new Date(Number(raw) * 1000);
  if (Number.isNaN(result.getTime())) throw new TypeError('SOURCE_DATE_EPOCH is outside the supported range');
  return result.toISOString();
}

function main(args, environment) {
  const command = parseCommandLine(args);
  const projectRoot = process.cwd();
  const selected = Boolean(command.selectionFile);
  const comparison = selected ? readSelectedComparison(command.selectionFile) : null;
  const bucketCount = command.bucketCount || comparison.selection.selectedBucketCount;
  const artifacts = buildBrowserRuntimeArtifacts({
    englishDir: path.join(projectRoot, 'data/corpora/princeton-wordnet-3.0'),
    chineseDir: path.join(projectRoot, 'data/corpora/cc-cedict-v1-2026-08-24'),
    builtAt: buildTimeFromEnvironment(environment),
    bucketCount,
    selectionStatus: selected ? 'selected-by-browser-comparison' : 'candidate-unselected'
  });
  if (selected) assertSelectedArtifactBinding(artifacts, comparison);
  if (!selected) {
    publishCandidateTree(artifacts, { outputRoot: command.outputRoot, mode: command.mode });
  } else {
    publishSelectedTrees(artifacts, { projectRoot, mode: command.mode });
  }
  process.stdout.write(`${JSON.stringify({ mode: command.mode, selected, bucketCount, ...artifacts.statistics })}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2), process.env);
  } catch (error) {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  CANONICAL_BUILD_TIME,
  DEFAULT_SELECTION_FILE,
  CANONICAL_EXTENSION_ROOT,
  CANONICAL_DIST_ROOT,
  buildBrowserRuntimeArtifacts,
  publishCandidateTree,
  publishSelectedTrees,
  parseCommandLine,
  readSelectedComparison,
  selectedBucketCount,
  assertSelectedArtifactBinding,
  buildTimeFromEnvironment,
  main
});
