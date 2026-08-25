#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeCorpusBuildReceipt,
  normalizeDatasetManifest
} = require('../packages/contracts/lexical-contracts');
const { importWordNetFiles } = require('../packages/lexical-data/en/wordnet-importer');
const { importCcCedict } = require('../packages/lexical-data/zh/cc-cedict-importer');
const {
  buildRuntimeLexicalIndex,
  serializeRuntimeLexicalIndex
} = require('../packages/lexical-index/runtime-lexical-index');

const CANONICAL_BUILD_TIME = '2026-08-25T00:00:00.000Z';
const ARTIFACT_PATHS = Object.freeze([
  'apps/extension/data/lexical-runtime-index.json',
  'dist/lexical-v0.3.0/build-receipts.json',
  'dist/lexical-v0.3.0/runtime-index-manifest.json',
  'dist/data-manifest-v0.3.0.json'
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveInside(baseDir, relativePath) {
  if (path.isAbsolute(relativePath)) throw new TypeError(`manifest path must be relative: ${relativePath}`);
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, relativePath);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new TypeError(`manifest path escapes its dataset directory: ${relativePath}`);
  }
  return resolved;
}

function loadManifestFiles(directory) {
  const manifest = normalizeDatasetManifest(readJson(path.join(directory, 'dataset-manifest.json')));
  const files = manifest.files.map((descriptor) => ({
    role: descriptor.role,
    path: descriptor.path,
    content: fs.readFileSync(resolveInside(directory, descriptor.path))
  }));
  return Object.freeze({ manifest, files });
}

function receiptFor(result, index, builtAt) {
  const draft = result.receiptDraft;
  return normalizeCorpusBuildReceipt({
    schemaVersion: 1,
    receiptId: `${draft.datasetId}@${draft.datasetVersion}:${draft.importer.id}:${draft.inputHash.value.slice(0, 16)}`,
    datasetId: draft.datasetId,
    datasetVersion: draft.datasetVersion,
    importer: draft.importer,
    inputHash: draft.inputHash,
    outputHash: index.hash,
    entryCount: draft.entryCount,
    rejectedCount: draft.rejectedCount,
    builtAt,
    reproducibility: {
      canonicalOrder: draft.canonicalOrder,
      deterministicIndexHash: true
    }
  });
}

function buildRuntimeArtifacts(options) {
  const settings = options || {};
  const englishDir = path.resolve(settings.englishDir || 'data/corpora/princeton-wordnet-3.0');
  const chineseDir = path.resolve(settings.chineseDir || 'data/corpora/cc-cedict-v1-2026-08-24');
  const builtAt = settings.builtAt || CANONICAL_BUILD_TIME;
  if (Number.isNaN(Date.parse(builtAt))) throw new TypeError('builtAt: must be an ISO 8601 timestamp');

  const englishInput = loadManifestFiles(englishDir);
  const chineseInput = loadManifestFiles(chineseDir);
  if (englishInput.manifest.locale !== 'en') throw new TypeError('English corpus manifest must use locale en');
  if (chineseInput.manifest.locale !== 'zh-Hant') {
    throw new TypeError('Traditional-Chinese corpus manifest must use locale zh-Hant');
  }
  if (chineseInput.files.length !== 1 || chineseInput.files[0].role !== 'dictionary') {
    throw new TypeError('CC-CEDICT runtime build requires exactly one dictionary file');
  }

  const english = importWordNetFiles(englishInput.files, englishInput.manifest);
  const traditionalChinese = importCcCedict(chineseInput.files[0].content, chineseInput.manifest);
  const entries = [...english.entries, ...traditionalChinese.entries];
  const index = buildRuntimeLexicalIndex(entries, {
    indexId: 'halo-lexical-runtime-v0.3.0',
    builtAt,
    datasetManifests: [englishInput.manifest, chineseInput.manifest],
    morphologyExceptions: english.morphologyExceptions
  });
  const serializedIndex = serializeRuntimeLexicalIndex(index);
  const receipts = [
    receiptFor(english, index, builtAt),
    receiptFor(traditionalChinese, index, builtAt)
  ].sort((left, right) => left.datasetId.localeCompare(right.datasetId));
  const rejectedCount = english.rejected.length + traditionalChinese.rejected.length;
  const manifests = [englishInput.manifest, chineseInput.manifest]
    .sort((left, right) => left.datasetId.localeCompare(right.datasetId));
  const receiptsDocument = Object.freeze({
    schemaVersion: 1,
    release: 'v0.3.0',
    builtAt,
    indexPath: ARTIFACT_PATHS[0],
    indexHash: index.hash,
    receipts: Object.freeze(receipts)
  });
  const dataManifest = Object.freeze({
    schemaVersion: 1,
    release: 'v0.3.0',
    generatedAt: builtAt,
    locales: Object.freeze(['en', 'zh-Hant']),
    datasets: Object.freeze(manifests),
    index: Object.freeze({
      path: ARTIFACT_PATHS[0],
      indexId: index.indexId,
      format: index.indexFormat,
      hash: index.hash,
      entryCount: entries.length,
      rejectedCount,
      englishRowCount: index.statistics.englishRowCount,
      chineseRowCount: index.statistics.chineseRowCount,
      morphologyRowCount: index.statistics.morphologyRowCount,
      glossCount: index.statistics.glossCount,
      serializedBytes: Buffer.byteLength(serializedIndex)
    }),
    receipts: Object.freeze({ path: ARTIFACT_PATHS[1], count: receipts.length }),
    sourceInputs: Object.freeze({
      upstreamCorpusBytesBundled: manifests.every((manifest) => manifest.bundled),
      verifiedReleaseOnly: manifests.every((manifest) => manifest.source.retrievalMode === 'verified-release'),
      note: 'Runtime bytes are a deterministic compact projection rebuilt only from manifest-verified local corpus files.'
    })
  });
  return Object.freeze({
    serializedIndex,
    receiptsDocument,
    dataManifest,
    statistics: Object.freeze({
      entryCount: entries.length,
      rejectedCount,
      morphologyExceptionCount: english.morphologyExceptions.length,
      runtimeHash: index.hash.value,
      serializedBytes: Buffer.byteLength(serializedIndex)
    })
  });
}

function artifactContents(artifacts) {
  return [
    `${artifacts.serializedIndex}\n`,
    `${JSON.stringify(artifacts.receiptsDocument, null, 2)}\n`,
    `${JSON.stringify(artifacts.dataManifest, null, 2)}\n`,
    `${JSON.stringify(artifacts.dataManifest, null, 2)}\n`
  ];
}

function publishRuntimeArtifacts(artifacts, options) {
  const settings = options || {};
  const projectRoot = path.resolve(settings.projectRoot || process.cwd());
  const mode = settings.mode;
  if (!['write', 'verify'].includes(mode)) throw new TypeError('mode: must be write or verify');
  const paths = ARTIFACT_PATHS.map((relativePath) => resolveInside(projectRoot, relativePath));
  const contents = artifactContents(artifacts);

  if (mode === 'verify') {
    for (let index = 0; index < paths.length; index += 1) {
      let actual;
      try {
        actual = fs.readFileSync(paths[index], 'utf8');
      } catch (_error) {
        throw new Error(`runtime artifact does not match: ${ARTIFACT_PATHS[index]} is missing`);
      }
      if (actual !== contents[index]) {
        throw new Error(`runtime artifact does not match deterministic build: ${ARTIFACT_PATHS[index]}`);
      }
    }
    return Object.freeze({ mode, paths: Object.freeze(paths) });
  }

  const staged = [];
  try {
    for (let index = 0; index < paths.length; index += 1) {
      fs.mkdirSync(path.dirname(paths[index]), { recursive: true });
      const temporary = `${paths[index]}.tmp-${process.pid}-${index}`;
      fs.writeFileSync(temporary, contents[index], { flag: 'wx' });
      staged.push({ temporary, target: paths[index] });
    }
    for (const item of staged) fs.renameSync(item.temporary, item.target);
  } catch (error) {
    for (const item of staged) fs.rmSync(item.temporary, { force: true });
    throw error;
  }
  return Object.freeze({ mode, paths: Object.freeze(paths) });
}

function buildTimeFromEnvironment(environment) {
  const raw = environment.SOURCE_DATE_EPOCH;
  if (raw === undefined || raw === '') return CANONICAL_BUILD_TIME;
  if (!/^\d+$/.test(raw)) throw new TypeError('SOURCE_DATE_EPOCH must be whole Unix seconds');
  const value = new Date(Number(raw) * 1000);
  if (Number.isNaN(value.getTime())) throw new TypeError('SOURCE_DATE_EPOCH is outside the supported date range');
  return value.toISOString();
}

function parseMode(args) {
  if (args.length !== 1 || !['--write', '--verify'].includes(args[0])) {
    throw new TypeError('usage: node scripts/build-lexical-runtime.js --write|--verify');
  }
  return args[0].slice(2);
}

function main(args, environment) {
  const mode = parseMode(args);
  const projectRoot = process.cwd();
  const artifacts = buildRuntimeArtifacts({
    englishDir: path.join(projectRoot, 'data/corpora/princeton-wordnet-3.0'),
    chineseDir: path.join(projectRoot, 'data/corpora/cc-cedict-v1-2026-08-24'),
    builtAt: buildTimeFromEnvironment(environment)
  });
  publishRuntimeArtifacts(artifacts, { projectRoot, mode });
  process.stdout.write(`${JSON.stringify({ mode, ...artifacts.statistics })}\n`);
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
  ARTIFACT_PATHS,
  buildRuntimeArtifacts,
  publishRuntimeArtifacts,
  buildTimeFromEnvironment,
  parseMode
});
