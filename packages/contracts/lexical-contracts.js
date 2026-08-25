'use strict';

const SCHEMA_VERSION = 1;
const LOCALES = Object.freeze(['en', 'zh-Hant']);
const POS_TAGS = Object.freeze(['n', 'v', 'adj', 'adv', 'prep', 'conj', 'det', 'pron', 'aux', 'modal', 'x']);

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function objectAt(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value;
}

function stringAt(value, path, options) {
  const settings = options || {};
  if (typeof value !== 'string') fail(path, 'must be a string');
  const result = value.trim();
  if (!settings.allowEmpty && !result) fail(path, 'must not be empty');
  return result;
}

function booleanAt(value, path) {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean');
  return value;
}

function enumAt(value, allowed, path) {
  if (!allowed.includes(value)) fail(path, `must be one of ${allowed.join(', ')}`);
  return value;
}

function integerAt(value, path, minimum) {
  if (!Number.isInteger(value) || value < minimum) fail(path, `must be an integer >= ${minimum}`);
  return value;
}

function confidenceAt(value, path) {
  if (!Number.isFinite(value) || value < 0 || value > 1) fail(path, 'must be a number between 0 and 1');
  return value;
}

function dateAt(value, path, dateOnly) {
  const result = stringAt(value, path);
  if (dateOnly) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00.000Z`))) {
      fail(path, 'must be an ISO 8601 date');
    }
  } else if (Number.isNaN(Date.parse(result))) {
    fail(path, 'must be an ISO 8601 timestamp');
  }
  return result;
}

function hashAt(value, path) {
  const raw = objectAt(value, path);
  if (raw.algorithm !== 'sha256') fail(`${path}.algorithm`, 'must be sha256');
  const digest = stringAt(raw.value, `${path}.value`);
  if (!/^[a-f0-9]{64}$/.test(digest)) fail(`${path}.value`, 'must be 64 lowercase hexadecimal characters');
  return { algorithm: 'sha256', value: digest };
}

function stringsAt(value, path, options) {
  const settings = options || {};
  if (!Array.isArray(value)) fail(path, 'must be an array');
  if (settings.nonEmpty && value.length === 0) fail(path, 'must not be empty');
  return value.map((item, index) => stringAt(item, `${path}[${index}]`));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function schemaVersionAt(value, path) {
  if (value !== SCHEMA_VERSION) fail(path, `must equal ${SCHEMA_VERSION}`);
  return value;
}

function normalizeLicenseRecord(value) {
  const raw = objectAt(value, 'license');
  return deepFreeze({
    schemaVersion: schemaVersionAt(raw.schemaVersion, 'license.schemaVersion'),
    licenseId: stringAt(raw.licenseId, 'license.licenseId'),
    name: stringAt(raw.name, 'license.name'),
    url: stringAt(raw.url, 'license.url'),
    commercialUse: enumAt(raw.commercialUse, ['allowed', 'prohibited'], 'license.commercialUse'),
    redistribution: enumAt(
      raw.redistribution,
      ['allowed', 'allowed-with-notice', 'share-alike', 'prohibited'],
      'license.redistribution'
    ),
    attributionRequired: booleanAt(raw.attributionRequired, 'license.attributionRequired'),
    shareAlike: booleanAt(raw.shareAlike, 'license.shareAlike'),
    redistributionNote: stringAt(raw.redistributionNote, 'license.redistributionNote'),
    verifiedAt: dateAt(raw.verifiedAt, 'license.verifiedAt', true),
    verificationUrl: stringAt(raw.verificationUrl, 'license.verificationUrl')
  });
}

function normalizeDatasetManifest(value) {
  const raw = objectAt(value, 'manifest');
  const source = objectAt(raw.source, 'manifest.source');
  if (!Array.isArray(raw.files) || raw.files.length === 0) fail('manifest.files', 'must be a non-empty array');
  return deepFreeze({
    schemaVersion: schemaVersionAt(raw.schemaVersion, 'manifest.schemaVersion'),
    datasetId: stringAt(raw.datasetId, 'manifest.datasetId'),
    name: stringAt(raw.name, 'manifest.name'),
    locale: enumAt(raw.locale, LOCALES, 'manifest.locale'),
    version: stringAt(raw.version, 'manifest.version'),
    source: {
      publisher: stringAt(source.publisher, 'manifest.source.publisher'),
      canonicalUrl: stringAt(source.canonicalUrl, 'manifest.source.canonicalUrl'),
      acquiredAt: dateAt(source.acquiredAt, 'manifest.source.acquiredAt', false),
      retrievalMode: enumAt(
        source.retrievalMode,
        ['user-supplied', 'verified-release', 'synthetic-fixture'],
        'manifest.source.retrievalMode'
      )
    },
    license: normalizeLicenseRecord(raw.license),
    hash: hashAt(raw.hash, 'manifest.hash'),
    files: raw.files.map((file, index) => {
      const item = objectAt(file, `manifest.files[${index}]`);
      return {
        role: stringAt(item.role, `manifest.files[${index}].role`),
        path: stringAt(item.path, `manifest.files[${index}].path`),
        bytes: integerAt(item.bytes, `manifest.files[${index}].bytes`, 0),
        sha256: hashAt({ algorithm: 'sha256', value: item.sha256 }, `manifest.files[${index}].sha256`).value
      };
    }),
    bundled: booleanAt(raw.bundled, 'manifest.bundled'),
    redistributionNote: stringAt(raw.redistributionNote, 'manifest.redistributionNote')
  });
}

function normalizeLexicalEntry(value) {
  const raw = objectAt(value, 'entry');
  const source = objectAt(raw.source, 'entry.source');
  const provenance = objectAt(raw.provenance, 'entry.provenance');
  const fieldOrigins = objectAt(provenance.fieldOrigins, 'entry.provenance.fieldOrigins');
  const requiredOrigins = ['surface', 'lemma', 'pos', 'glosses'];
  for (const field of requiredOrigins) stringAt(fieldOrigins[field], `entry.provenance.fieldOrigins.${field}`);
  const normalizedOrigins = Object.fromEntries(Object.keys(fieldOrigins).sort().map((field) => [
    field,
    stringAt(fieldOrigins[field], `entry.provenance.fieldOrigins.${field}`)
  ]));
  const recordData = raw.source.recordData === undefined
    ? {}
    : Object.fromEntries(Object.keys(objectAt(raw.source.recordData, 'entry.source.recordData')).sort().map((field) => [
      field,
      stringAt(raw.source.recordData[field], `entry.source.recordData.${field}`)
    ]));
  if (!Array.isArray(raw.glosses) || raw.glosses.length === 0) fail('entry.glosses', 'must be a non-empty array');

  return deepFreeze({
    schemaVersion: schemaVersionAt(raw.schemaVersion, 'entry.schemaVersion'),
    entryId: stringAt(raw.entryId, 'entry.entryId'),
    locale: enumAt(raw.locale, LOCALES, 'entry.locale'),
    surface: stringAt(raw.surface, 'entry.surface'),
    normalizedSurface: stringAt(raw.normalizedSurface, 'entry.normalizedSurface'),
    lemma: stringAt(raw.lemma, 'entry.lemma'),
    pos: enumAt(raw.pos, POS_TAGS, 'entry.pos'),
    posConfidence: confidenceAt(raw.posConfidence, 'entry.posConfidence'),
    glosses: raw.glosses.map((gloss, index) => {
      const item = objectAt(gloss, `entry.glosses[${index}]`);
      return {
        text: stringAt(item.text, `entry.glosses[${index}].text`),
        locale: enumAt(item.locale, LOCALES, `entry.glosses[${index}].locale`),
        ref: stringAt(item.ref, `entry.glosses[${index}].ref`)
      };
    }),
    glossRefs: stringsAt(raw.glossRefs, 'entry.glossRefs', { nonEmpty: true }),
    aliases: stringsAt(raw.aliases, 'entry.aliases'),
    source: {
      datasetId: stringAt(source.datasetId, 'entry.source.datasetId'),
      version: stringAt(source.version, 'entry.source.version'),
      recordRef: stringAt(source.recordRef, 'entry.source.recordRef'),
      lineNumber: integerAt(source.lineNumber, 'entry.source.lineNumber', 1),
      recordData
    },
    provenance: {
      fieldOrigins: normalizedOrigins,
      transformations: stringsAt(provenance.transformations, 'entry.provenance.transformations')
    }
  });
}

function normalizeCorpusBuildReceipt(value) {
  const raw = objectAt(value, 'receipt');
  const importer = objectAt(raw.importer, 'receipt.importer');
  const reproducibility = objectAt(raw.reproducibility, 'receipt.reproducibility');
  return deepFreeze({
    schemaVersion: schemaVersionAt(raw.schemaVersion, 'receipt.schemaVersion'),
    receiptId: stringAt(raw.receiptId, 'receipt.receiptId'),
    datasetId: stringAt(raw.datasetId, 'receipt.datasetId'),
    datasetVersion: stringAt(raw.datasetVersion, 'receipt.datasetVersion'),
    importer: {
      id: stringAt(importer.id, 'receipt.importer.id'),
      version: stringAt(importer.version, 'receipt.importer.version')
    },
    inputHash: hashAt(raw.inputHash, 'receipt.inputHash'),
    outputHash: hashAt(raw.outputHash, 'receipt.outputHash'),
    entryCount: integerAt(raw.entryCount, 'receipt.entryCount', 0),
    rejectedCount: integerAt(raw.rejectedCount, 'receipt.rejectedCount', 0),
    builtAt: dateAt(raw.builtAt, 'receipt.builtAt', false),
    reproducibility: {
      canonicalOrder: booleanAt(reproducibility.canonicalOrder, 'receipt.reproducibility.canonicalOrder'),
      deterministicIndexHash: booleanAt(
        reproducibility.deterministicIndexHash,
        'receipt.reproducibility.deterministicIndexHash'
      )
    }
  });
}

module.exports = Object.freeze({
  SCHEMA_VERSION,
  LOCALES,
  POS_TAGS,
  normalizeLicenseRecord,
  normalizeDatasetManifest,
  normalizeLexicalEntry,
  normalizeCorpusBuildReceipt
});
