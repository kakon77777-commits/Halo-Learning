'use strict';

const { normalizeLexicalEntry } = require('../contracts/lexical-contracts');
const { canonicalJson, sha256Hex } = require('../lexical-data/shared/build-utils');

const SCHEMA_VERSION = 1;
const INDEX_FORMAT = 'halo-lexical-index-v1';
const EMPTY_RESULTS = Object.freeze([]);
const INDEX_DOCUMENTS = new WeakMap();

class LexicalIndexIntegrityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LexicalIndexIntegrityError';
    this.code = code;
  }
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function compareEntries(left, right) {
  return compareUtf8(left.locale, right.locale) ||
    compareUtf8(left.normalizedSurface, right.normalizedSurface) ||
    compareUtf8(left.pos, right.pos) ||
    compareUtf8(left.entryId, right.entryId);
}

function normalizeLookupSurface(surface, locale) {
  if (typeof surface !== 'string' || !surface) return null;
  if (locale === 'en') return surface.normalize('NFC').toLocaleLowerCase('en-US');
  if (locale === 'zh-Hant') return surface.normalize('NFC');
  return null;
}

function sourceDatasetsFor(entries) {
  return Object.freeze([...new Set(entries.map((entry) => `${entry.source.datasetId}@${entry.source.version}`))]
    .sort(compareUtf8));
}

function payloadFor(indexId, sourceDatasets, entries) {
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    indexFormat: INDEX_FORMAT,
    indexId,
    sourceDatasets,
    entries
  });
}

function documentFor(payload) {
  return Object.freeze({
    ...payload,
    hash: Object.freeze({ algorithm: 'sha256', value: sha256Hex(canonicalJson(payload)) })
  });
}

function runtimeFromDocument(document) {
  const lookupMap = new Map();
  let maxZhLength = 0;
  for (const entry of document.entries) {
    const key = `${entry.locale}\u0000${entry.normalizedSurface}`;
    if (!lookupMap.has(key)) lookupMap.set(key, []);
    lookupMap.get(key).push(entry);
    if (entry.locale === 'zh-Hant') maxZhLength = Math.max(maxZhLength, entry.normalizedSurface.length);
  }
  for (const [key, values] of lookupMap) lookupMap.set(key, Object.freeze(values));

  const index = Object.freeze({
    schemaVersion: document.schemaVersion,
    indexFormat: document.indexFormat,
    indexId: document.indexId,
    sourceDatasets: document.sourceDatasets,
    entries: document.entries,
    hash: document.hash,
    lookup(surface, locale) {
      const normalized = normalizeLookupSurface(surface, locale);
      if (normalized === null) return EMPTY_RESULTS;
      return lookupMap.get(`${locale}\u0000${normalized}`) || EMPTY_RESULTS;
    },
    longestMatch(text, start, locale) {
      if (locale !== 'zh-Hant' || typeof text !== 'string' || !Number.isInteger(start) || start < 0 || start >= text.length) {
        return null;
      }
      const upperBound = Math.min(maxZhLength, text.length - start);
      for (let length = upperBound; length > 0; length -= 1) {
        const surface = text.slice(start, start + length).normalize('NFC');
        const entries = lookupMap.get(`zh-Hant\u0000${surface}`);
        if (entries) return Object.freeze({ surface, start, end: start + length, entries });
      }
      return null;
    }
  });
  INDEX_DOCUMENTS.set(index, document);
  return index;
}

function buildLexicalIndex(entryValues, options) {
  if (!Array.isArray(entryValues)) throw new TypeError('entries: must be an array');
  const settings = options || {};
  const indexId = settings.indexId === undefined ? 'halo-lexical-index-v1' : settings.indexId;
  if (typeof indexId !== 'string' || !indexId.trim()) throw new TypeError('options.indexId: must be a non-empty string');
  const entries = Object.freeze(entryValues.map(normalizeLexicalEntry).sort(compareEntries));
  const sourceDatasets = sourceDatasetsFor(entries);
  return runtimeFromDocument(documentFor(payloadFor(indexId.trim(), sourceDatasets, entries)));
}

function serializeLexicalIndex(index) {
  const document = INDEX_DOCUMENTS.get(index);
  if (!document) throw new TypeError('index: must be a LexicalIndex created by this module');
  return canonicalJson(document);
}

function integrityError(code, message) {
  return new LexicalIndexIntegrityError(code, message);
}

function loadLexicalIndex(serialized) {
  let raw;
  try {
    raw = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
  } catch (_error) {
    throw integrityError('INVALID_JSON', 'Lexical index is not valid JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw integrityError('INVALID_DOCUMENT', 'Lexical index document must be an object');
  }
  if (raw.schemaVersion !== SCHEMA_VERSION || raw.indexFormat !== INDEX_FORMAT) {
    throw integrityError('UNSUPPORTED_FORMAT', 'Lexical index format is unsupported');
  }
  if (typeof raw.indexId !== 'string' || !raw.indexId.trim() || !Array.isArray(raw.sourceDatasets) || !Array.isArray(raw.entries)) {
    throw integrityError('INVALID_DOCUMENT', 'Lexical index metadata is malformed');
  }
  if (!raw.hash || raw.hash.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(raw.hash.value || '')) {
    throw integrityError('INVALID_HASH', 'Lexical index SHA-256 field is malformed');
  }

  const rawPayload = {
    schemaVersion: raw.schemaVersion,
    indexFormat: raw.indexFormat,
    indexId: raw.indexId,
    sourceDatasets: raw.sourceDatasets,
    entries: raw.entries
  };
  if (sha256Hex(canonicalJson(rawPayload)) !== raw.hash.value) {
    throw integrityError('HASH_MISMATCH', 'Lexical index SHA-256 does not match its payload');
  }

  let entries;
  try {
    entries = raw.entries.map(normalizeLexicalEntry);
  } catch (_error) {
    throw integrityError('INVALID_ENTRY', 'Lexical index contains an invalid lexical entry');
  }
  const sortedEntries = [...entries].sort(compareEntries);
  if (canonicalJson(entries) !== canonicalJson(sortedEntries)) {
    throw integrityError('NON_CANONICAL_ORDER', 'Lexical index entries are not in canonical order');
  }
  const sourceDatasets = sourceDatasetsFor(entries);
  if (canonicalJson(raw.sourceDatasets) !== canonicalJson(sourceDatasets)) {
    throw integrityError('SOURCE_DATASET_MISMATCH', 'Lexical index source dataset list does not match its entries');
  }
  const frozenEntries = Object.freeze(entries);
  const document = Object.freeze({
    ...payloadFor(raw.indexId, sourceDatasets, frozenEntries),
    hash: Object.freeze({ algorithm: 'sha256', value: raw.hash.value })
  });
  return runtimeFromDocument(document);
}

module.exports = Object.freeze({
  SCHEMA_VERSION,
  INDEX_FORMAT,
  LexicalIndexIntegrityError,
  buildLexicalIndex,
  serializeLexicalIndex,
  loadLexicalIndex
});
