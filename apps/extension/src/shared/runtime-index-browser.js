(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloRuntimeIndexBrowser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const INDEX_FORMAT = 'halo-runtime-lexical-index-v1';
  const BUILDER = Object.freeze({ id: 'halo-runtime-index-builder', version: '1.0.0' });
  const LOCALES = Object.freeze(['en', 'zh-Hant']);
  const RETRIEVAL_MODES = Object.freeze(['user-supplied', 'verified-release', 'synthetic-fixture']);
  const COMMERCIAL_USE = Object.freeze(['allowed', 'prohibited']);
  const REDISTRIBUTION = Object.freeze(['allowed', 'allowed-with-notice', 'share-alike', 'prohibited']);
  const TRANSPORT_KINDS = Object.freeze(['direct-upstream', 'pinned-public-mirror']);
  const POS_TAGS = Object.freeze(['n', 'v', 'adj', 'adv', 'prep', 'conj', 'det', 'pron', 'aux', 'modal', 'x']);
  const EMPTY_RESULTS = Object.freeze([]);

  class RuntimeIndexBrowserError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'RuntimeIndexBrowserError';
      this.code = code;
    }
  }

  function fail(code, message) {
    throw new RuntimeIndexBrowserError(code, message);
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }

  function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function bytesFor(value) {
    return new TextEncoder().encode(value);
  }

  function compareUtf8(left, right) {
    const a = bytesFor(String(left));
    const b = bytesFor(String(right));
    const length = Math.min(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      if (a[index] !== b[index]) return a[index] - b[index];
    }
    return a.length - b.length;
  }

  function compareRows(left, right) {
    return compareUtf8(canonicalJson(left), canonicalJson(right));
  }

  function assertCanonicalOrder(name, values, comparator) {
    for (let index = 1; index < values.length; index += 1) {
      if (comparator(values[index - 1], values[index]) > 0) {
        fail('NON_CANONICAL_ORDER', `${name} is not canonical`);
      }
    }
  }

  function objectValue(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function nonEmptyString(value) {
    return typeof value === 'string' && Boolean(value.trim());
  }

  function validTimestamp(value) {
    return nonEmptyString(value) && !Number.isNaN(Date.parse(value));
  }

  function validDate(value) {
    return nonEmptyString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) &&
      !Number.isNaN(Date.parse(`${value.trim()}T00:00:00.000Z`));
  }

  function validStringArray(value, nonEmpty) {
    return Array.isArray(value) && (!nonEmpty || value.length > 0) && value.every(nonEmptyString);
  }

  function validSha256(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  }

  function validateLicense(license, path) {
    if (!objectValue(license) || license.schemaVersion !== 1 ||
        !nonEmptyString(license.licenseId) || !nonEmptyString(license.name) || !nonEmptyString(license.url) ||
        !COMMERCIAL_USE.includes(license.commercialUse) || !REDISTRIBUTION.includes(license.redistribution) ||
        typeof license.attributionRequired !== 'boolean' || typeof license.shareAlike !== 'boolean' ||
        !nonEmptyString(license.redistributionNote) || !validDate(license.verifiedAt) ||
        !nonEmptyString(license.verificationUrl)) {
      fail('INVALID_DATASET', `${path} is invalid`);
    }
  }

  function validateDataset(dataset, index) {
    const path = `datasets[${index}]`;
    if (!objectValue(dataset) || dataset.schemaVersion !== 1 || !nonEmptyString(dataset.datasetId) ||
        !nonEmptyString(dataset.name) || !nonEmptyString(dataset.version) || !LOCALES.includes(dataset.locale) ||
        !objectValue(dataset.source) || !nonEmptyString(dataset.source.publisher) ||
        !nonEmptyString(dataset.source.canonicalUrl) || !validTimestamp(dataset.source.acquiredAt) ||
        !RETRIEVAL_MODES.includes(dataset.source.retrievalMode) || !objectValue(dataset.hash) ||
        dataset.hash.algorithm !== 'sha256' || !validSha256(dataset.hash.value) ||
        !Array.isArray(dataset.files) || dataset.files.length === 0 || typeof dataset.bundled !== 'boolean' ||
        !nonEmptyString(dataset.redistributionNote)) {
      fail('INVALID_DATASET', `${path} is invalid`);
    }
    validateLicense(dataset.license, `${path}.license`);
    dataset.files.forEach((file, fileIndex) => {
      if (!objectValue(file) || !nonEmptyString(file.role) || !nonEmptyString(file.path) ||
          !Number.isInteger(file.bytes) || file.bytes < 0 || !validSha256(file.sha256)) {
        fail('INVALID_DATASET', `${path}.files[${fileIndex}] is invalid`);
      }
    });
    if (dataset.source.retrievalMode === 'verified-release') {
      const transport = dataset.source.transport;
      if (!nonEmptyString(dataset.releaseIdentity) || !nonEmptyString(dataset.formatVersion) ||
          !validStringArray(dataset.attributionRequirements, true) ||
          !validStringArray(dataset.redistributionRequirements, true) || !objectValue(transport) ||
          !TRANSPORT_KINDS.includes(transport.kind) || !nonEmptyString(transport.url) ||
          !nonEmptyString(transport.revision) || !nonEmptyString(transport.note)) {
        fail('INVALID_DATASET', `${path} verified-release evidence is invalid`);
      }
    }
  }

  async function sha256Hex(value, cryptoValue) {
    if (!cryptoValue || !cryptoValue.subtle || typeof cryptoValue.subtle.digest !== 'function') {
      fail('CRYPTO_UNAVAILABLE', 'Web Crypto SHA-256 is unavailable');
    }
    const digest = await cryptoValue.subtle.digest('SHA-256', bytesFor(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function datasetRef(document, datasetIndex, recordRef) {
    const dataset = document.datasets[datasetIndex];
    return Object.freeze({
      datasetId: dataset.datasetId,
      datasetVersion: dataset.version,
      recordRef
    });
  }

  function englishEntry(document, row) {
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

  function chineseEntry(document, row) {
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

  function validateDocument(document) {
    if (document.schemaVersion !== SCHEMA_VERSION || document.indexFormat !== INDEX_FORMAT) {
      fail('UNSUPPORTED_FORMAT', 'Runtime lexical index format is unsupported');
    }
    if (typeof document.indexId !== 'string' || !document.indexId.trim() ||
        !document.builder || document.builder.id !== BUILDER.id || document.builder.version !== BUILDER.version ||
        typeof document.builtAt !== 'string' || Number.isNaN(Date.parse(document.builtAt))) {
      fail('INVALID_DOCUMENT', 'Runtime lexical index metadata is malformed');
    }
    for (const field of ['datasets', 'glosses', 'englishRows', 'chineseRows', 'morphologyRows']) {
      if (!Array.isArray(document[field])) fail('INVALID_DOCUMENT', `${field} must be an array`);
    }
    document.datasets.forEach(validateDataset);
    document.glosses.forEach((gloss, index) => {
      if (typeof gloss !== 'string' || !gloss) fail('INVALID_GLOSS', `glosses[${index}] is invalid`);
    });
    const checks = [
      ['datasets', document.datasets, (left, right) =>
        compareUtf8(left.datasetId, right.datasetId) || compareUtf8(left.version, right.version)],
      ['glosses', document.glosses, compareUtf8],
      ['englishRows', document.englishRows, compareRows],
      ['chineseRows', document.chineseRows, compareRows],
      ['morphologyRows', document.morphologyRows, compareRows]
    ];
    for (const [name, values, comparator] of checks) {
      assertCanonicalOrder(name, values, comparator);
    }
    document.englishRows.forEach((row, index) => {
      if (!Array.isArray(row) || row.length !== 8 ||
          ![0, 1, 4, 5].every((position) => typeof row[position] === 'string' && row[position]) ||
          !POS_TAGS.includes(row[2]) || !Number.isFinite(row[3]) || row[3] < 0 || row[3] > 1 ||
          !Number.isInteger(row[6]) || !Number.isInteger(row[7]) ||
          !document.datasets[row[7]] || document.glosses[row[6]] === undefined) {
        fail('INVALID_ROW', `englishRows[${index}] is invalid`);
      }
    });
    document.chineseRows.forEach((row, index) => {
      if (!Array.isArray(row) || row.length !== 9 ||
          ![0, 1, 4, 5].every((position) => typeof row[position] === 'string' && row[position]) ||
          typeof row[8] !== 'string' || !POS_TAGS.includes(row[2]) ||
          !Number.isFinite(row[3]) || row[3] < 0 || row[3] > 1 ||
          !Number.isInteger(row[6]) || !Number.isInteger(row[7]) ||
          !document.datasets[row[7]] || document.glosses[row[6]] === undefined) {
        fail('INVALID_ROW', `chineseRows[${index}] is invalid`);
      }
    });
    document.morphologyRows.forEach((row, index) => {
      if (!Array.isArray(row) || row.length !== 5 ||
          !row.slice(0, 3).every((value) => typeof value === 'string' && value) ||
          !POS_TAGS.includes(row[2]) || !Number.isInteger(row[3]) || !document.datasets[row[3]] ||
          typeof row[4] !== 'string' || !row[4]) {
        fail('INVALID_ROW', `morphologyRows[${index}] is invalid`);
      }
    });
  }

  function runtimeFromDocument(document) {
    const english = new Map();
    const chinese = new Map();
    const morphology = new Map();
    let maxZhLength = 0;
    for (const row of document.englishRows) {
      if (!english.has(row[0])) english.set(row[0], []);
      english.get(row[0]).push(row);
    }
    for (const row of document.chineseRows) {
      if (!chinese.has(row[0])) chinese.set(row[0], []);
      chinese.get(row[0]).push(row);
      maxZhLength = Math.max(maxZhLength, row[0].length);
    }
    for (const row of document.morphologyRows) {
      if (!morphology.has(row[0])) morphology.set(row[0], []);
      morphology.get(row[0]).push(row);
    }
    return Object.freeze({
      schemaVersion: document.schemaVersion,
      indexFormat: document.indexFormat,
      indexId: document.indexId,
      datasets: Object.freeze(document.datasets),
      hash: Object.freeze(document.hash),
      lookup(surface, locale) {
        if (typeof surface !== 'string' || !surface) return EMPTY_RESULTS;
        if (locale === 'en') {
          const rows = english.get(surface.normalize('NFC').toLocaleLowerCase('en-US'));
          return rows ? Object.freeze(rows.map((row) => englishEntry(document, row))) : EMPTY_RESULTS;
        }
        if (locale === 'zh-Hant') {
          const rows = chinese.get(surface.normalize('NFC'));
          return rows ? Object.freeze(rows.map((row) => chineseEntry(document, row))) : EMPTY_RESULTS;
        }
        return EMPTY_RESULTS;
      },
      lookupMorphology(surface, locale) {
        if (locale !== 'en' || typeof surface !== 'string' || !surface) return EMPTY_RESULTS;
        const rows = morphology.get(surface.normalize('NFC').toLocaleLowerCase('en-US'));
        return rows ? Object.freeze(rows.map((row) => Object.freeze({
          inflected: row[0],
          lemma: row[1],
          simplifiedPos: row[2],
          datasetRef: datasetRef(document, row[3], row[4])
        }))) : EMPTY_RESULTS;
      },
      longestMatch(text, start, locale) {
        if (locale !== 'zh-Hant' || typeof text !== 'string' || !Number.isInteger(start) || start < 0 || start >= text.length) {
          return null;
        }
        const upper = Math.min(maxZhLength, text.length - start);
        for (let length = upper; length > 0; length -= 1) {
          const surface = text.slice(start, start + length).normalize('NFC');
          const rows = chinese.get(surface);
          if (rows) return Object.freeze({
            surface,
            start,
            end: start + length,
            entries: Object.freeze(rows.map((row) => chineseEntry(document, row)))
          });
        }
        return null;
      }
    });
  }

  async function loadRuntimeLexicalIndex(serialized, options) {
    let raw;
    const serializedText = typeof serialized === 'string' ? serialized.trim() : null;
    try {
      raw = serializedText === null ? serialized : JSON.parse(serializedText);
    } catch (_error) {
      fail('INVALID_JSON', 'Runtime lexical index is not valid JSON');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('INVALID_DOCUMENT', 'Index must be an object');
    if (!raw.hash || raw.hash.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(raw.hash.value || '')) {
      fail('INVALID_HASH', 'Runtime lexical index hash is malformed');
    }
    const cryptoValue = options && options.crypto ? options.crypto : root.crypto;
    let payloadText;
    if (serializedText !== null) {
      const hashFragment = `,"hash":{"algorithm":"sha256","value":"${raw.hash.value}"}`;
      const hashOffset = serializedText.indexOf(hashFragment);
      if (hashOffset < 0 || serializedText.indexOf(hashFragment, hashOffset + 1) >= 0) {
        fail('INVALID_DOCUMENT', 'Runtime lexical index is not in the packaged canonical envelope');
      }
      payloadText = serializedText.slice(0, hashOffset) + serializedText.slice(hashOffset + hashFragment.length);
    } else {
      const unhashed = { ...raw };
      delete unhashed.hash;
      payloadText = canonicalJson(unhashed);
    }
    if (await sha256Hex(payloadText, cryptoValue) !== raw.hash.value) {
      fail('HASH_MISMATCH', 'Runtime lexical index payload hash does not match');
    }
    const payload = { ...raw };
    delete payload.hash;
    validateDocument(payload);
    return runtimeFromDocument(deepFreeze({ ...payload, hash: { ...raw.hash } }));
  }

  return Object.freeze({
    SCHEMA_VERSION,
    INDEX_FORMAT,
    BUILDER,
    RuntimeIndexBrowserError,
    loadRuntimeLexicalIndex
  });
});
