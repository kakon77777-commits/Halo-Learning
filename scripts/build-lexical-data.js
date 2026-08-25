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
  buildLexicalIndex,
  serializeLexicalIndex
} = require('../packages/lexical-index/lexical-index');

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--en-dir', '--zh-file', '--out'].includes(flag) || !value) {
      throw new TypeError('usage: --en-dir <dir> --zh-file <file> --out <dir>');
    }
    values[flag.slice(2)] = value;
  }
  for (const field of ['en-dir', 'zh-file', 'out']) {
    if (!values[field]) throw new TypeError(`--${field} is required`);
  }
  return Object.freeze({
    enDir: path.resolve(values['en-dir']),
    zhFile: path.resolve(values['zh-file']),
    outDir: path.resolve(values.out)
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveInside(baseDir, relativePath) {
  if (path.isAbsolute(relativePath)) throw new TypeError(`manifest file path must be relative: ${relativePath}`);
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, relativePath);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new TypeError(`manifest file path escapes its dataset directory: ${relativePath}`);
  }
  return resolved;
}

function buildTimestamp(environment) {
  const raw = environment.SOURCE_DATE_EPOCH;
  if (raw === undefined || raw === '') return new Date().toISOString();
  if (!/^\d+$/.test(raw)) throw new TypeError('SOURCE_DATE_EPOCH must be whole Unix seconds');
  const timestamp = new Date(Number(raw) * 1000);
  if (Number.isNaN(timestamp.getTime())) throw new TypeError('SOURCE_DATE_EPOCH is outside the supported date range');
  return timestamp.toISOString();
}

function loadEnglish(enDir) {
  const manifest = normalizeDatasetManifest(readJson(path.join(enDir, 'dataset-manifest.json')));
  const files = manifest.files.map((descriptor) => ({
    role: descriptor.role,
    path: descriptor.path,
    content: fs.readFileSync(resolveInside(enDir, descriptor.path))
  }));
  return Object.freeze({ manifest, result: importWordNetFiles(files, manifest) });
}

function loadTraditionalChinese(zhFile) {
  const datasetDir = path.dirname(zhFile);
  const manifest = normalizeDatasetManifest(readJson(path.join(datasetDir, 'dataset-manifest.json')));
  if (manifest.files.length !== 1 || resolveInside(datasetDir, manifest.files[0].path) !== zhFile) {
    throw new TypeError('CC-CEDICT manifest must describe the exact --zh-file path');
  }
  return Object.freeze({
    manifest,
    result: importCcCedict(fs.readFileSync(zhFile), manifest)
  });
}

function receiptFor(importResult, index, builtAt) {
  const draft = importResult.receiptDraft;
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

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

function publishAtomically(outDir, files) {
  const root = path.parse(outDir).root;
  if (outDir === root) throw new TypeError('output directory may not be a filesystem root');
  if (fs.existsSync(outDir)) throw new Error(`output directory already exists: ${outDir}`);
  const parent = path.dirname(outDir);
  fs.mkdirSync(parent, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(parent, `.${path.basename(outDir)}.tmp-`));
  try {
    const dataDir = path.join(tempDir, 'lexical-fixture');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, 'lexical-index.json'), files.serializedIndex, { flag: 'wx' });
    writeJson(path.join(dataDir, 'build-receipts.json'), files.receiptsDocument);
    writeJson(path.join(tempDir, 'data-manifest.json'), files.dataManifest);
    fs.renameSync(tempDir, outDir);
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function buildLexicalData(settings, environment) {
  const english = loadEnglish(settings.enDir);
  const traditionalChinese = loadTraditionalChinese(settings.zhFile);
  const datasets = [english, traditionalChinese];
  const entries = datasets.flatMap((dataset) => dataset.result.entries);
  const rejectedCount = datasets.reduce((total, dataset) => total + dataset.result.rejected.length, 0);
  const index = buildLexicalIndex(entries, { indexId: 'halo-lexical-data-v0.2.0' });
  const serializedIndex = serializeLexicalIndex(index);
  const builtAt = buildTimestamp(environment);
  const receipts = datasets
    .map((dataset) => receiptFor(dataset.result, index, builtAt))
    .sort((left, right) => left.datasetId.localeCompare(right.datasetId));
  const receiptsDocument = {
    schemaVersion: 1,
    indexPath: 'lexical-index.json',
    indexHash: index.hash,
    receipts
  };
  const normalizedManifests = datasets.map((dataset) => dataset.manifest);
  const dataManifest = {
    schemaVersion: 1,
    release: 'v0.2.0',
    generatedAt: builtAt,
    locales: ['en', 'zh-Hant'],
    datasets: normalizedManifests,
    index: {
      path: 'lexical-fixture/lexical-index.json',
      indexId: index.indexId,
      format: index.indexFormat,
      hash: index.hash,
      entryCount: index.entries.length,
      rejectedCount
    },
    receipts: {
      path: 'lexical-fixture/build-receipts.json',
      count: receipts.length
    },
    releaseFixture: {
      syntheticOnly: normalizedManifests.every((manifest) => manifest.source.retrievalMode === 'synthetic-fixture'),
      upstreamCorpusBytesBundled: false,
      note: 'Release output contains only Halo Learning synthetic format fixtures; no Princeton WordNet or CC-CEDICT corpus bytes.'
    }
  };
  publishAtomically(settings.outDir, { serializedIndex, receiptsDocument, dataManifest });
  return Object.freeze({
    outDir: settings.outDir,
    indexHash: index.hash.value,
    entryCount: index.entries.length,
    rejectedCount
  });
}

function main(args, environment) {
  const result = buildLexicalData(parseArgs(args), environment);
  process.stdout.write(`${JSON.stringify(result)}\n`);
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
  parseArgs,
  buildTimestamp,
  buildLexicalData
});
