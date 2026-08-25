'use strict';

const { canonicalJson, sha256Hex } = require('../lexical-data/shared/build-utils');

const SCHEMA_VERSION = 1;
const MANIFEST_FORMAT = 'halo-browser-lexical-manifest-v1';
const SHARD_FORMAT = 'halo-browser-lexical-shard-v1';
const BUILDER = Object.freeze({ id: 'halo-browser-lexical-builder', version: '1.0.0' });
const ROUTING = Object.freeze({
  en: Object.freeze({ id: 'fnv1a-normalized-surface', version: '1.0.0' }),
  'zh-Hant': Object.freeze({ id: 'fnv1a-first-code-point', version: '1.0.0' })
});
const LOCALES = Object.freeze(['en', 'zh-Hant']);

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
}

function compareRows(left, right) {
  return compareUtf8(canonicalJson(left), canonicalJson(right));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function hash(value) {
  return Object.freeze({ algorithm: 'sha256', value: sha256Hex(value) });
}

function normalizeBucketCount(value) {
  if (!Number.isInteger(value) || value < 1 || value > 4096) {
    throw new TypeError('bucketCount: must be an integer from 1 through 4096');
  }
  return value;
}

function fnv1a(value) {
  let result = 0x811c9dc5;
  for (const byte of Buffer.from(value, 'utf8')) {
    result ^= byte;
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result;
}

function routeEnglishSurface(surface, bucketCount) {
  if (typeof surface !== 'string' || !surface) throw new TypeError('surface: must be a non-empty string');
  const normalized = surface.normalize('NFC').toLocaleLowerCase('en-US');
  return fnv1a(normalized) % normalizeBucketCount(bucketCount);
}

function routeChineseSurface(surface, bucketCount) {
  if (typeof surface !== 'string' || !surface) throw new TypeError('surface: must be a non-empty string');
  const first = [...surface.normalize('NFC')][0];
  return fnv1a(first) % normalizeBucketCount(bucketCount);
}

function normalizedHash(value, path) {
  if (!value || value.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(value.value || '')) {
    throw new TypeError(`${path}: must be a SHA-256 hash`);
  }
  return Object.freeze({ algorithm: 'sha256', value: value.value });
}

function normalizeSourceIndex(value) {
  if (!value || typeof value.format !== 'string' || !value.format) {
    throw new TypeError('options.sourceIndex: must identify the canonical source index');
  }
  return Object.freeze({ format: value.format, hash: normalizedHash(value.hash, 'options.sourceIndex.hash') });
}

function normalizeDatasets(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError('options.datasets: must be a non-empty array');
  }
  const result = values.map((value, index) => {
    if (!value || typeof value.datasetId !== 'string' || !value.datasetId ||
        typeof value.version !== 'string' || !value.version || !LOCALES.includes(value.locale)) {
      throw new TypeError(`options.datasets[${index}]: has invalid identity`);
    }
    return value;
  }).sort((left, right) => compareUtf8(left.datasetId, right.datasetId) || compareUtf8(left.version, right.version));
  return deepFreeze(result);
}

function cloneRow(value, length, path) {
  if (!Array.isArray(value) || value.length !== length) throw new TypeError(`${path}: has an invalid tuple shape`);
  return value.slice();
}

function shardId(locale, bucket, bucketCount) {
  const width = String(bucketCount - 1).length;
  return `${locale}-${String(bucket).padStart(width, '0')}`;
}

function shardPath(locale, bucket, bucketCount) {
  const width = String(bucketCount - 1).length;
  return `shards/${locale}/${String(bucket).padStart(width, '0')}.json`;
}

function normalizeInputs(entryValues, options, bucketCount) {
  if (!Array.isArray(entryValues)) throw new TypeError('entries: must be an array');
  const settings = options || {};
  const lexical = entryValues.map((entry, index) => {
    if (!entry || !LOCALES.includes(entry.locale) || typeof entry.gloss !== 'string' || !entry.gloss) {
      throw new TypeError(`entries[${index}]: must be an English or Traditional-Chinese lexical row`);
    }
    const row = cloneRow(entry.row, entry.locale === 'en' ? 8 : 9, `entries[${index}].row`);
    if (typeof row[0] !== 'string' || !row[0]) throw new TypeError(`entries[${index}].row: surface is invalid`);
    const bucket = entry.locale === 'en'
      ? routeEnglishSurface(row[0], bucketCount)
      : routeChineseSurface(row[0], bucketCount);
    return { locale: entry.locale, bucket, row, gloss: entry.gloss };
  });
  lexical.sort((left, right) => compareUtf8(left.locale, right.locale) ||
    left.bucket - right.bucket || compareRows(left.row, right.row) || compareUtf8(left.gloss, right.gloss));

  const morphology = (settings.morphologyRows || []).map((value, index) => {
    const row = cloneRow(value, 5, `options.morphologyRows[${index}]`);
    if (typeof row[0] !== 'string' || !row[0]) {
      throw new TypeError(`options.morphologyRows[${index}]: inflected surface is invalid`);
    }
    return { bucket: routeEnglishSurface(row[0], bucketCount), row };
  });
  morphology.sort((left, right) => left.bucket - right.bucket || compareRows(left.row, right.row));
  return { lexical, morphology };
}

function serializeBrowserLexicalManifest(manifest) {
  if (!manifest || manifest.manifestFormat !== MANIFEST_FORMAT) {
    throw new TypeError('manifest: must be a BrowserLexicalManifest/v1 document');
  }
  return canonicalJson(manifest);
}

function serializeBrowserLexicalShard(shard) {
  if (!shard || shard.shardFormat !== SHARD_FORMAT) {
    throw new TypeError('shard: must be a BrowserLexicalShard/v1 document');
  }
  return canonicalJson(shard);
}

function buildBrowserLexicalArtifacts(entryValues, options) {
  const settings = options || {};
  const bucketCount = normalizeBucketCount(settings.bucketCount);
  if (typeof settings.builtAt !== 'string' || Number.isNaN(Date.parse(settings.builtAt))) {
    throw new TypeError('options.builtAt: must be an ISO 8601 timestamp');
  }
  const sourceIndex = normalizeSourceIndex(settings.sourceIndex);
  const datasets = normalizeDatasets(settings.datasets);
  const { lexical, morphology } = normalizeInputs(entryValues, settings, bucketCount);
  const rowCounts = {
    english: lexical.filter((entry) => entry.locale === 'en').length,
    traditionalChinese: lexical.filter((entry) => entry.locale === 'zh-Hant').length,
    morphology: morphology.length
  };
  const statistics = deepFreeze({
    lexicalRowCount: lexical.length,
    englishRowCount: rowCounts.english,
    chineseRowCount: rowCounts.traditionalChinese,
    morphologyRowCount: rowCounts.morphology,
    rejectedCount: Number.isInteger(settings.rejectedCount) ? settings.rejectedCount : 0,
    shardCount: bucketCount * LOCALES.length
  });
  const rootPayload = deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    manifestFormat: MANIFEST_FORMAT,
    builder: BUILDER,
    builtAt: settings.builtAt,
    bucketCount,
    locales: LOCALES,
    routing: ROUTING,
    sourceIndex,
    datasets,
    statistics
  });
  const rootHash = hash(canonicalJson(rootPayload));
  const serializedShards = {};
  const descriptors = [];

  for (const locale of LOCALES) {
    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
      const rows = lexical.filter((entry) => entry.locale === locale && entry.bucket === bucket);
      const glosses = [...new Set(rows.map((entry) => entry.gloss))].sort(compareUtf8);
      const glossIndexes = new Map(glosses.map((gloss, index) => [gloss, index]));
      const lexicalRows = rows.map((entry) => {
        const row = entry.row.slice();
        row[6] = glossIndexes.get(entry.gloss);
        return row;
      }).sort(compareRows);
      const morphologyRows = locale === 'en'
        ? morphology.filter((entry) => entry.bucket === bucket).map((entry) => entry.row.slice()).sort(compareRows)
        : [];
      const id = shardId(locale, bucket, bucketCount);
      const relativePath = shardPath(locale, bucket, bucketCount);
      const shardStatistics = deepFreeze({
        lexicalRowCount: lexicalRows.length,
        morphologyRowCount: morphologyRows.length,
        glossCount: glosses.length
      });
      const payload = deepFreeze({
        schemaVersion: SCHEMA_VERSION,
        shardFormat: SHARD_FORMAT,
        shardId: id,
        locale,
        bucketCount,
        bucket,
        routing: ROUTING[locale],
        manifestRoot: rootHash,
        glosses,
        lexicalRows,
        morphologyRows,
        statistics: shardStatistics
      });
      const document = deepFreeze({ ...payload, hash: hash(canonicalJson(payload)) });
      const serialized = serializeBrowserLexicalShard(document);
      serializedShards[relativePath] = serialized;
      descriptors.push(deepFreeze({
        id,
        locale,
        bucket,
        path: relativePath,
        bytes: Buffer.byteLength(serialized),
        rowCounts: Object.freeze({
          lexical: lexicalRows.length,
          morphology: morphologyRows.length,
          glosses: glosses.length
        }),
        hash: document.hash
      }));
    }
  }

  const manifestPayload = deepFreeze({ ...rootPayload, rootHash, shards: descriptors });
  const manifest = deepFreeze({ ...manifestPayload, hash: hash(canonicalJson(manifestPayload)) });
  return Object.freeze({
    manifest,
    shards: Object.freeze(serializedShards),
    serializedManifest: serializeBrowserLexicalManifest(manifest),
    serializedShards: Object.freeze(serializedShards)
  });
}

module.exports = Object.freeze({
  SCHEMA_VERSION,
  MANIFEST_FORMAT,
  SHARD_FORMAT,
  BUILDER,
  ROUTING,
  routeEnglishSurface,
  routeChineseSurface,
  buildBrowserLexicalArtifacts,
  serializeBrowserLexicalManifest,
  serializeBrowserLexicalShard
});
