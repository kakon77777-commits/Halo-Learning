'use strict';

const { normalizeDatasetManifest, normalizeLexicalEntry, POS_TAGS } = require('../contracts/lexical-contracts');
const { canonicalJson, sha256Hex } = require('../lexical-data/shared/build-utils');

const SCHEMA_VERSION = 1;
const INDEX_FORMAT = 'halo-runtime-lexical-index-v1';
const BUILDER = Object.freeze({ id: 'halo-runtime-index-builder', version: '1.0.0' });
const EMPTY_RESULTS = Object.freeze([]);
const INDEX_DOCUMENTS = new WeakMap();

class RuntimeLexicalIndexIntegrityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RuntimeLexicalIndexIntegrityError';
    this.code = code;
  }
}

function integrityError(code, message) {
  return new RuntimeLexicalIndexIntegrityError(code, message);
}

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

function nonEmptyString(value, path) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${path}: must be a non-empty string`);
  return value.trim();
}

function timestamp(value, path) {
  const result = nonEmptyString(value, path);
  if (Number.isNaN(Date.parse(result)) || !/^\d{4}-\d{2}-\d{2}T/.test(result)) {
    throw new TypeError(`${path}: must be an ISO 8601 timestamp`);
  }
  return result;
}

function normalizeManifests(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError('options.datasetManifests: must be a non-empty array');
  }
  const manifests = values.map(normalizeDatasetManifest).sort((left, right) =>
    compareUtf8(left.datasetId, right.datasetId) || compareUtf8(left.version, right.version));
  const seen = new Set();
  for (const manifest of manifests) {
    const key = `${manifest.datasetId}\u0000${manifest.version}`;
    if (seen.has(key)) throw new TypeError('options.datasetManifests: duplicate dataset identity');
    seen.add(key);
  }
  return Object.freeze(manifests);
}

function normalizeMorphologyExceptions(values, datasetIndexes, manifests) {
  if (values === undefined) return Object.freeze([]);
  if (!Array.isArray(values)) throw new TypeError('options.morphologyExceptions: must be an array');
  const rows = [];
  values.forEach((value, index) => {
    const path = `options.morphologyExceptions[${index}]`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path}: must be an object`);
    const inflected = nonEmptyString(value.inflected, `${path}.inflected`).normalize('NFC').toLocaleLowerCase('en-US');
    if (!Array.isArray(value.lemmas) || value.lemmas.length === 0) {
      throw new TypeError(`${path}.lemmas: must be a non-empty array`);
    }
    if (!POS_TAGS.includes(value.pos) || value.pos === 'x') throw new TypeError(`${path}.pos: must be an established POS`);
    if (!value.source || typeof value.source !== 'object' || Array.isArray(value.source)) {
      throw new TypeError(`${path}.source: must be an object`);
    }
    const datasetKey = `${value.source.datasetId}\u0000${value.source.version}`;
    const datasetIndex = datasetIndexes.get(datasetKey);
    if (datasetIndex === undefined) throw new TypeError(`${path}.source: dataset is absent from manifests`);
    const recordRef = nonEmptyString(value.source.recordRef, `${path}.source.recordRef`);
    for (const [lemmaIndex, lemmaValue] of value.lemmas.entries()) {
      const lemma = nonEmptyString(lemmaValue, `${path}.lemmas[${lemmaIndex}]`)
        .normalize('NFC').toLocaleLowerCase('en-US');
      rows.push([inflected, lemma, value.pos, datasetIndex, recordRef]);
    }
  });
  rows.sort(compareRows);
  const deduplicated = rows.filter((row, index) => index === 0 || canonicalJson(row) !== canonicalJson(rows[index - 1]));
  for (const row of deduplicated) deepFreeze(row);
  void manifests;
  return Object.freeze(deduplicated);
}

function selectedEntries(entryValues, datasetIndexes) {
  if (!Array.isArray(entryValues)) throw new TypeError('entries: must be an array');
  const entries = entryValues.map(normalizeLexicalEntry).sort((left, right) =>
    compareUtf8(left.locale, right.locale) ||
    compareUtf8(left.normalizedSurface, right.normalizedSurface) ||
    compareUtf8(left.pos, right.pos) ||
    compareUtf8(left.entryId, right.entryId));
  const selected = [];
  const identities = new Map();
  for (const entry of entries) {
    const datasetKey = `${entry.source.datasetId}\u0000${entry.source.version}`;
    if (!datasetIndexes.has(datasetKey)) {
      throw new TypeError(`entries.${entry.entryId}.source: dataset is absent from manifests`);
    }
    const previous = identities.get(entry.entryId);
    if (previous) {
      if (canonicalJson(previous) !== canonicalJson(entry)) {
        throw new TypeError(`entries.${entry.entryId}: duplicate identity has conflicting evidence`);
      }
      continue;
    }
    identities.set(entry.entryId, entry);
    selected.push(entry);
  }
  return selected;
}

function payloadFrom(entryValues, options) {
  const settings = options || {};
  const manifests = normalizeManifests(settings.datasetManifests);
  const datasetIndexes = new Map(manifests.map((manifest, index) => [
    `${manifest.datasetId}\u0000${manifest.version}`,
    index
  ]));
  const entries = selectedEntries(entryValues, datasetIndexes);
  const glosses = Object.freeze([...new Set(entries.map((entry) => entry.glosses[0].text))].sort(compareUtf8));
  const glossIndexes = new Map(glosses.map((gloss, index) => [gloss, index]));
  const englishRows = [];
  const chineseRows = [];
  for (const entry of entries) {
    const datasetIndex = datasetIndexes.get(`${entry.source.datasetId}\u0000${entry.source.version}`);
    const gloss = entry.glosses[0];
    if (entry.locale === 'en') {
      englishRows.push([
        entry.normalizedSurface,
        entry.lemma,
        entry.pos,
        entry.posConfidence,
        entry.source.recordRef,
        gloss.ref,
        glossIndexes.get(gloss.text),
        datasetIndex
      ]);
    } else {
      chineseRows.push([
        entry.normalizedSurface,
        entry.source.recordData.simplified || entry.surface,
        entry.pos,
        entry.posConfidence,
        entry.source.recordRef,
        gloss.ref,
        glossIndexes.get(gloss.text),
        datasetIndex,
        entry.source.recordData.pinyin || ''
      ]);
    }
  }
  englishRows.sort(compareRows);
  chineseRows.sort(compareRows);
  englishRows.forEach(deepFreeze);
  chineseRows.forEach(deepFreeze);
  const morphologyRows = normalizeMorphologyExceptions(
    settings.morphologyExceptions,
    datasetIndexes,
    manifests
  );
  return deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    indexFormat: INDEX_FORMAT,
    indexId: nonEmptyString(settings.indexId || 'halo-runtime-lexical-index-v1', 'options.indexId'),
    builder: BUILDER,
    builtAt: timestamp(settings.builtAt, 'options.builtAt'),
    datasets: manifests,
    glosses,
    englishRows: Object.freeze(englishRows),
    chineseRows: Object.freeze(chineseRows),
    morphologyRows
  });
}

function documentFor(payload) {
  return deepFreeze({
    ...payload,
    hash: { algorithm: 'sha256', value: sha256Hex(canonicalJson(payload)) }
  });
}

function datasetRef(document, datasetIndex, recordRef) {
  const dataset = document.datasets[datasetIndex];
  return Object.freeze({
    datasetId: dataset.datasetId,
    datasetVersion: dataset.version,
    recordRef
  });
}

function entryFromEnglishRow(document, row) {
  return Object.freeze({
    surface: row[0],
    normalizedSurface: row[0],
    language: 'en',
    lemma: row[1],
    simplifiedPos: row[2],
    posConfidence: row[3],
    lexicalRef: row[4],
    glossRef: row[5],
    gloss: document.glosses[row[6]],
    datasetRef: datasetRef(document, row[7], row[4]),
    provenance: Object.freeze([
      `runtime-index:${document.hash.value}`,
      `dataset:${document.datasets[row[7]].datasetId}@${document.datasets[row[7]].version}`
    ])
  });
}

function entryFromChineseRow(document, row) {
  return Object.freeze({
    surface: row[0],
    normalizedSurface: row[0],
    language: 'zh-Hant',
    lemma: row[0],
    traditional: row[0],
    simplified: row[1],
    simplifiedPos: row[2],
    posConfidence: row[3],
    lexicalRef: row[4],
    glossRef: row[5],
    gloss: document.glosses[row[6]],
    datasetRef: datasetRef(document, row[7], row[4]),
    pinyin: row[8] || null,
    provenance: Object.freeze([
      `runtime-index:${document.hash.value}`,
      `dataset:${document.datasets[row[7]].datasetId}@${document.datasets[row[7]].version}`
    ])
  });
}

function runtimeFromDocument(document) {
  const englishLookup = new Map();
  const chineseLookup = new Map();
  const morphologyLookup = new Map();
  let maxZhLength = 0;
  for (const row of document.englishRows) {
    if (!englishLookup.has(row[0])) englishLookup.set(row[0], []);
    englishLookup.get(row[0]).push(row);
  }
  for (const row of document.chineseRows) {
    if (!chineseLookup.has(row[0])) chineseLookup.set(row[0], []);
    chineseLookup.get(row[0]).push(row);
    maxZhLength = Math.max(maxZhLength, row[0].length);
  }
  for (const row of document.morphologyRows) {
    if (!morphologyLookup.has(row[0])) morphologyLookup.set(row[0], []);
    morphologyLookup.get(row[0]).push(row);
  }
  const index = Object.freeze({
    schemaVersion: document.schemaVersion,
    indexFormat: document.indexFormat,
    indexId: document.indexId,
    builder: document.builder,
    builtAt: document.builtAt,
    datasets: document.datasets,
    hash: document.hash,
    statistics: Object.freeze({
      glossCount: document.glosses.length,
      englishRowCount: document.englishRows.length,
      chineseRowCount: document.chineseRows.length,
      morphologyRowCount: document.morphologyRows.length
    }),
    lookup(surface, locale) {
      if (typeof surface !== 'string' || !surface) return EMPTY_RESULTS;
      if (locale === 'en') {
        const key = surface.normalize('NFC').toLocaleLowerCase('en-US');
        const rows = englishLookup.get(key);
        return rows ? Object.freeze(rows.map((row) => entryFromEnglishRow(document, row))) : EMPTY_RESULTS;
      }
      if (locale === 'zh-Hant') {
        const rows = chineseLookup.get(surface.normalize('NFC'));
        return rows ? Object.freeze(rows.map((row) => entryFromChineseRow(document, row))) : EMPTY_RESULTS;
      }
      return EMPTY_RESULTS;
    },
    lookupMorphology(surface, locale) {
      if (locale !== 'en' || typeof surface !== 'string' || !surface) return EMPTY_RESULTS;
      const rows = morphologyLookup.get(surface.normalize('NFC').toLocaleLowerCase('en-US'));
      if (!rows) return EMPTY_RESULTS;
      return Object.freeze(rows.map((row) => Object.freeze({
        inflected: row[0],
        lemma: row[1],
        simplifiedPos: row[2],
        datasetRef: datasetRef(document, row[3], row[4])
      })));
    },
    longestMatch(text, start, locale) {
      if (locale !== 'zh-Hant' || typeof text !== 'string' || !Number.isInteger(start) || start < 0 || start >= text.length) {
        return null;
      }
      const upperBound = Math.min(maxZhLength, text.length - start);
      for (let length = upperBound; length > 0; length -= 1) {
        const surface = text.slice(start, start + length).normalize('NFC');
        const rows = chineseLookup.get(surface);
        if (rows) {
          return Object.freeze({
            surface,
            start,
            end: start + length,
            entries: Object.freeze(rows.map((row) => entryFromChineseRow(document, row)))
          });
        }
      }
      return null;
    }
  });
  INDEX_DOCUMENTS.set(index, document);
  return index;
}

function buildRuntimeLexicalIndex(entryValues, options) {
  return runtimeFromDocument(documentFor(payloadFrom(entryValues, options)));
}

function serializeRuntimeLexicalIndex(index) {
  const document = INDEX_DOCUMENTS.get(index);
  if (!document) throw new TypeError('index: must be a RuntimeLexicalIndex created by this module');
  return canonicalJson(document);
}

function validRowBasics(row, length, posIndex, confidenceIndex, datasetIndex, document, path) {
  if (!Array.isArray(row) || row.length !== length) throw integrityError('INVALID_ROW', `${path} has an invalid tuple shape`);
  if (typeof row[0] !== 'string' || !row[0] || !POS_TAGS.includes(row[posIndex])) {
    throw integrityError('INVALID_ROW', `${path} has invalid lexical fields`);
  }
  if (!Number.isFinite(row[confidenceIndex]) || row[confidenceIndex] < 0 || row[confidenceIndex] > 1) {
    throw integrityError('INVALID_ROW', `${path} has invalid confidence`);
  }
  if (!Number.isInteger(row[datasetIndex]) || !document.datasets[row[datasetIndex]]) {
    throw integrityError('INVALID_ROW', `${path} has invalid dataset reference`);
  }
}

function validatePayload(raw) {
  if (raw.schemaVersion !== SCHEMA_VERSION || raw.indexFormat !== INDEX_FORMAT) {
    throw integrityError('UNSUPPORTED_FORMAT', 'Runtime lexical index format is unsupported');
  }
  if (typeof raw.indexId !== 'string' || !raw.indexId.trim() ||
      !raw.builder || raw.builder.id !== BUILDER.id || raw.builder.version !== BUILDER.version ||
      typeof raw.builtAt !== 'string' || Number.isNaN(Date.parse(raw.builtAt)) ||
      !Array.isArray(raw.datasets) || !Array.isArray(raw.glosses) ||
      !Array.isArray(raw.englishRows) || !Array.isArray(raw.chineseRows) ||
      !Array.isArray(raw.morphologyRows)) {
    throw integrityError('INVALID_DOCUMENT', 'Runtime lexical index metadata is malformed');
  }
  let datasets;
  try {
    datasets = raw.datasets.map(normalizeDatasetManifest);
  } catch (_error) {
    throw integrityError('INVALID_DATASET', 'Runtime lexical index contains invalid dataset provenance');
  }
  const document = { ...raw, datasets };
  raw.glosses.forEach((gloss, index) => {
    if (typeof gloss !== 'string' || !gloss) throw integrityError('INVALID_GLOSS', `glosses[${index}] is invalid`);
  });
  raw.englishRows.forEach((row, index) => {
    validRowBasics(row, 8, 2, 3, 7, document, `englishRows[${index}]`);
    if (![0, 1, 4, 5].every((position) => typeof row[position] === 'string' && row[position]) ||
        !Number.isInteger(row[6]) || raw.glosses[row[6]] === undefined) {
      throw integrityError('INVALID_ROW', `englishRows[${index}] has invalid references`);
    }
  });
  raw.chineseRows.forEach((row, index) => {
    validRowBasics(row, 9, 2, 3, 7, document, `chineseRows[${index}]`);
    if (![0, 1, 4, 5, 8].every((position) => typeof row[position] === 'string') ||
        !row[1] || !row[4] || !row[5] || !Number.isInteger(row[6]) || raw.glosses[row[6]] === undefined) {
      throw integrityError('INVALID_ROW', `chineseRows[${index}] has invalid references`);
    }
  });
  raw.morphologyRows.forEach((row, index) => {
    if (!Array.isArray(row) || row.length !== 5 ||
        !row.slice(0, 3).every((value) => typeof value === 'string' && value) ||
        !POS_TAGS.includes(row[2]) || !Number.isInteger(row[3]) || !datasets[row[3]] ||
        typeof row[4] !== 'string' || !row[4]) {
      throw integrityError('INVALID_ROW', `morphologyRows[${index}] is invalid`);
    }
  });
  for (const [name, rows] of [
    ['datasets', datasets],
    ['glosses', raw.glosses],
    ['englishRows', raw.englishRows],
    ['chineseRows', raw.chineseRows],
    ['morphologyRows', raw.morphologyRows]
  ]) {
    const comparator = name === 'datasets'
      ? (left, right) => compareUtf8(left.datasetId, right.datasetId) || compareUtf8(left.version, right.version)
      : (name === 'glosses' ? compareUtf8 : compareRows);
    for (let index = 1; index < rows.length; index += 1) {
      if (comparator(rows[index - 1], rows[index]) > 0) {
        throw integrityError('NON_CANONICAL_ORDER', `${name} is not in canonical order`);
      }
    }
  }
  return deepFreeze({
    schemaVersion: raw.schemaVersion,
    indexFormat: raw.indexFormat,
    indexId: raw.indexId,
    builder: { id: raw.builder.id, version: raw.builder.version },
    builtAt: raw.builtAt,
    datasets,
    glosses: raw.glosses,
    englishRows: raw.englishRows,
    chineseRows: raw.chineseRows,
    morphologyRows: raw.morphologyRows
  });
}

function loadRuntimeLexicalIndex(serialized) {
  let raw;
  try {
    raw = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
  } catch (_error) {
    throw integrityError('INVALID_JSON', 'Runtime lexical index is not valid JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw integrityError('INVALID_DOCUMENT', 'Runtime lexical index document must be an object');
  }
  if (!raw.hash || raw.hash.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(raw.hash.value || '')) {
    throw integrityError('INVALID_HASH', 'Runtime lexical index SHA-256 field is malformed');
  }
  const rawPayload = { ...raw };
  delete rawPayload.hash;
  if (sha256Hex(canonicalJson(rawPayload)) !== raw.hash.value) {
    throw integrityError('HASH_MISMATCH', 'Runtime lexical index SHA-256 does not match its payload');
  }
  const payload = validatePayload(rawPayload);
  const document = deepFreeze({
    ...payload,
    hash: { algorithm: 'sha256', value: raw.hash.value }
  });
  return runtimeFromDocument(document);
}

module.exports = Object.freeze({
  SCHEMA_VERSION,
  INDEX_FORMAT,
  BUILDER,
  RuntimeLexicalIndexIntegrityError,
  buildRuntimeLexicalIndex,
  loadRuntimeLexicalIndex,
  serializeRuntimeLexicalIndex
});
