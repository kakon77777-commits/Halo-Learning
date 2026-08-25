'use strict';

const REQUIRED_LOCALES = Object.freeze(['en', 'zh-Hant']);

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function stringField(record, field, path) {
  if (typeof record[field] !== 'string' || !record[field].trim()) fail(`${path}.${field}`, 'must be a non-empty string');
}

function httpsField(record, field, path) {
  stringField(record, field, path);
  let url;
  try {
    url = new URL(record[field]);
  } catch (_error) {
    fail(`${path}.${field}`, 'must be an absolute URL');
  }
  if (url.protocol !== 'https:') fail(`${path}.${field}`, 'must use HTTPS');
}

function validateRecord(record, index) {
  const path = `sources[${index}]`;
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail(path, 'must be an object');
  for (const field of ['sourceId', 'name', 'locale', 'versionPolicy', 'licenseId', 'verifiedAt']) {
    stringField(record, field, path);
  }
  for (const field of ['officialSourceUrl', 'officialLicenseUrl', 'officialFormatUrl']) {
    httpsField(record, field, path);
  }
  for (const field of ['commercialUseAllowed', 'redistributionAllowed', 'selected', 'bundled']) {
    if (typeof record[field] !== 'boolean') fail(`${path}.${field}`, 'must be a boolean');
  }
  if (!Array.isArray(record.redistributionRequirements) || record.redistributionRequirements.length === 0) {
    fail(`${path}.redistributionRequirements`, 'must be a non-empty array');
  }
  record.redistributionRequirements.forEach((value, requirementIndex) => {
    if (typeof value !== 'string' || !value.trim()) {
      fail(`${path}.redistributionRequirements[${requirementIndex}]`, 'must be a non-empty string');
    }
  });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.verifiedAt)) fail(`${path}.verifiedAt`, 'must be an ISO date');
  if (!record.selected) stringField(record, 'rejectionReason', path);
  return Object.freeze({ ...record, redistributionRequirements: Object.freeze([...record.redistributionRequirements]) });
}

function auditSourceRecords(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('sourceRecords', 'must be an object');
  if (value.schemaVersion !== 1) fail('sourceRecords.schemaVersion', 'must equal 1');
  if (!Array.isArray(value.sources)) fail('sourceRecords.sources', 'must be an array');

  const records = value.sources.map(validateRecord);
  const selected = [];
  for (const locale of REQUIRED_LOCALES) {
    const matches = records.filter((record) => record.selected && record.locale === locale);
    if (matches.length !== 1) fail(`selected.${locale}`, 'must contain exactly one source');
    const record = matches[0];
    if (!record.commercialUseAllowed) fail(`${record.sourceId}.commercialUseAllowed`, 'must be true for a selected source');
    if (!record.redistributionAllowed) fail(`${record.sourceId}.redistributionAllowed`, 'must be true for a selected source');
    if (record.bundled) fail(`${record.sourceId}.bundled`, 'must be false until exact upstream bytes are verified');
    selected.push(record);
  }

  const unsupportedSelected = records.filter((record) => record.selected && !REQUIRED_LOCALES.includes(record.locale));
  if (unsupportedSelected.length) fail('selected.locale', 'contains an out-of-scope locale');

  return Object.freeze({
    ok: true,
    selected: Object.freeze(selected),
    rejected: Object.freeze(records.filter((record) => !record.selected))
  });
}

module.exports = Object.freeze({ REQUIRED_LOCALES, auditSourceRecords });
