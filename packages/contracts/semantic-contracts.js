'use strict';

const BrowserSemanticContracts = require('../../apps/extension/src/shared/semantic-contracts');

const SEMANTIC_SCHEMA_VERSION = BrowserSemanticContracts.SEMANTIC_SCHEMA_VERSION;
const MARKING_PROFILE_SCHEMA_VERSION = 2;
const LANGUAGES = Object.freeze(['en', 'zh-Hant']);
const LANGUAGE_MODES = Object.freeze(['auto', 'both', 'en', 'zh-Hant']);
const POS_TAGS = Object.freeze(['n', 'v', 'adj', 'adv', 'prep', 'conj', 'det', 'pron', 'aux', 'modal', 'x']);
const LABEL_POSITIONS = Object.freeze(['top-right', 'top-left', 'bottom-right', 'inline']);
const CHANNELS = Object.freeze([
  'posLabel',
  'posColor',
  'lemma',
  'morphology',
  'glossHint',
  'grammarRole',
  'tenseAspect',
  'chunk',
  'learningState'
]);

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function objectAt(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value;
}

function stringAt(value, path) {
  if (typeof value !== 'string') fail(path, 'must be a string');
  const result = value.trim();
  if (!result) fail(path, 'must not be empty');
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

function integerAt(value, path, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || (maximum !== undefined && value > maximum)) {
    const upper = maximum === undefined ? '' : ` and <= ${maximum}`;
    fail(path, `must be an integer >= ${minimum}${upper}`);
  }
  return value;
}

function numberAt(value, path, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a number between ${minimum} and ${maximum}`);
  }
  return value;
}

function dateAt(value, path) {
  const result = stringAt(value, path);
  if (Number.isNaN(Date.parse(result)) || !/^\d{4}-\d{2}-\d{2}T/.test(result)) {
    fail(path, 'must be an ISO 8601 timestamp');
  }
  return result;
}

function stringsAt(value, path) {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  return value.map((item, index) => stringAt(item, `${path}[${index}]`));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function jsonValueAt(value, path, seen) {
  const visited = seen || new Set();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, 'must contain only finite JSON values');
    return value;
  }
  if (!value || typeof value !== 'object') fail(path, 'must contain only JSON values');
  if (visited.has(value)) fail(path, 'must not contain circular references');
  visited.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((item, index) => jsonValueAt(item, `${path}[${index}]`, visited));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(path, 'must be a plain JSON object');
    result = {};
    for (const key of Object.keys(value).sort()) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail(`${path}.${key}`, 'is not allowed');
      result[key] = jsonValueAt(value[key], `${path}.${key}`, visited);
    }
  }
  visited.delete(value);
  return result;
}

function schemaVersionAt(value, expected, path) {
  if (value !== expected) fail(path, `must equal ${expected}`);
  return value;
}

function normalizeIdentity(value, path) {
  const raw = objectAt(value, path);
  return {
    id: stringAt(raw.id, `${path}.id`),
    version: stringAt(raw.version, `${path}.version`)
  };
}

function normalizeDatasetRef(value, path) {
  const raw = objectAt(value, path);
  const result = {
    datasetId: stringAt(raw.datasetId, `${path}.datasetId`),
    datasetVersion: stringAt(raw.datasetVersion, `${path}.datasetVersion`)
  };
  if (raw.recordRef !== undefined) result.recordRef = stringAt(raw.recordRef, `${path}.recordRef`);
  return result;
}

function normalizeSemanticAnnotation(value) {
  const raw = objectAt(value, 'annotation');
  const type = stringAt(raw.type, 'annotation.type');
  if (!/^[a-z][a-z0-9.-]*$/.test(type)) fail('annotation.type', 'must use a stable lowercase identifier');
  const result = {
    schemaVersion: schemaVersionAt(raw.schemaVersion, SEMANTIC_SCHEMA_VERSION, 'annotation.schemaVersion'),
    annotationId: stringAt(raw.annotationId, 'annotation.annotationId'),
    type,
    value: jsonValueAt(raw.value, 'annotation.value'),
    confidence: numberAt(raw.confidence, 'annotation.confidence', 0, 1),
    source: stringAt(raw.source, 'annotation.source'),
    provider: normalizeIdentity(raw.provider, 'annotation.provider'),
    algorithm: normalizeIdentity(raw.algorithm, 'annotation.algorithm'),
    generatedAt: dateAt(raw.generatedAt, 'annotation.generatedAt'),
    provenance: stringsAt(raw.provenance, 'annotation.provenance')
  };
  if (raw.datasetRef !== undefined) {
    result.datasetRef = normalizeDatasetRef(raw.datasetRef, 'annotation.datasetRef');
  }
  return deepFreeze(result);
}

function normalizeSemanticToken(value) {
  const raw = objectAt(value, 'token');
  const surface = stringAt(raw.surface, 'token.surface');
  const start = integerAt(raw.start, 'token.start', 0);
  const end = integerAt(raw.end, 'token.end', 1);
  if (end <= start || end - start !== surface.length) {
    fail('token.end', 'must be greater than start and match the UTF-16 surface length');
  }
  if (!Array.isArray(raw.annotations)) fail('token.annotations', 'must be an array');
  const result = {
    schemaVersion: schemaVersionAt(raw.schemaVersion, SEMANTIC_SCHEMA_VERSION, 'token.schemaVersion'),
    tokenId: stringAt(raw.tokenId, 'token.tokenId'),
    surface,
    normalizedSurface: stringAt(raw.normalizedSurface, 'token.normalizedSurface'),
    language: enumAt(raw.language, LANGUAGES, 'token.language'),
    start,
    end,
    glossRefs: stringsAt(raw.glossRefs, 'token.glossRefs'),
    lexicalRefs: stringsAt(raw.lexicalRefs, 'token.lexicalRefs'),
    confidence: numberAt(raw.confidence, 'token.confidence', 0, 1),
    provenance: stringsAt(raw.provenance, 'token.provenance'),
    priority: numberAt(raw.priority, 'token.priority', 0, 1),
    annotations: raw.annotations.map((annotation) => normalizeSemanticAnnotation(annotation))
  };
  if (raw.lemma !== undefined) result.lemma = stringAt(raw.lemma, 'token.lemma');
  if (raw.simplifiedPos !== undefined) {
    result.simplifiedPos = enumAt(raw.simplifiedPos, POS_TAGS, 'token.simplifiedPos');
  }
  if (raw.morphology !== undefined) {
    result.morphology = jsonValueAt(objectAt(raw.morphology, 'token.morphology'), 'token.morphology');
  }
  if (raw.grammarRole !== undefined) result.grammarRole = stringAt(raw.grammarRole, 'token.grammarRole');
  if (raw.tenseAspect !== undefined) result.tenseAspect = stringAt(raw.tenseAspect, 'token.tenseAspect');
  for (const [field, type] of [
    ['lemma', 'lemma'],
    ['simplifiedPos', 'simplified-pos'],
    ['morphology', 'morphology'],
    ['grammarRole', 'grammar-role'],
    ['tenseAspect', 'tense-aspect']
  ]) {
    if (result[field] === undefined) continue;
    const evidence = result.annotations.filter((annotation) => annotation.type === type);
    const expected = JSON.stringify(jsonValueAt(result[field], `token.${field}`));
    if (!evidence.length || evidence.some((annotation) => JSON.stringify(annotation.value) !== expected)) {
      fail(`token.${field}`, `must have matching ${type} annotation evidence`);
    }
  }
  return deepFreeze(result);
}

function normalizeProviderRef(value, path) {
  const raw = objectAt(value, path);
  return {
    id: stringAt(raw.id, `${path}.id`),
    version: stringAt(raw.version, `${path}.version`),
    status: enumAt(raw.status, ['verified', 'bootstrap', 'unavailable'], `${path}.status`)
  };
}

function normalizeDiagnostics(value) {
  const raw = objectAt(value, 'annotationSet.diagnostics');
  return {
    fallbackActivated: booleanAt(raw.fallbackActivated, 'annotationSet.diagnostics.fallbackActivated'),
    unavailableCapabilities: stringsAt(
      raw.unavailableCapabilities,
      'annotationSet.diagnostics.unavailableCapabilities'
    ),
    warnings: stringsAt(raw.warnings, 'annotationSet.diagnostics.warnings')
  };
}

function normalizeAnnotationSet(value) {
  const raw = objectAt(value, 'annotationSet');
  if (!Array.isArray(raw.providerRefs)) fail('annotationSet.providerRefs', 'must be an array');
  if (!Array.isArray(raw.tokens)) fail('annotationSet.tokens', 'must be an array');
  const languageMode = enumAt(raw.languageMode, LANGUAGE_MODES, 'annotationSet.languageMode');
  const textLength = integerAt(raw.textLength, 'annotationSet.textLength', 0);
  const tokens = raw.tokens.map((token) => normalizeSemanticToken(token));
  let previousEnd = 0;
  tokens.forEach((token, index) => {
    if (token.end > textLength) fail('annotationSet.textLength', `must include token ${index} end offset`);
    if (index > 0 && token.start < previousEnd) fail(`annotationSet.tokens[${index}]`, 'must be ordered and not overlap');
    if (languageMode === 'en' && token.language !== 'en') fail(`annotationSet.tokens[${index}].language`, 'must match languageMode');
    if (languageMode === 'zh-Hant' && token.language !== 'zh-Hant') {
      fail(`annotationSet.tokens[${index}].language`, 'must match languageMode');
    }
    previousEnd = token.end;
  });
  return deepFreeze({
    schemaVersion: schemaVersionAt(raw.schemaVersion, SEMANTIC_SCHEMA_VERSION, 'annotationSet.schemaVersion'),
    setId: stringAt(raw.setId, 'annotationSet.setId'),
    languageMode,
    textLength,
    algorithm: normalizeIdentity(raw.algorithm, 'annotationSet.algorithm'),
    generatedAt: dateAt(raw.generatedAt, 'annotationSet.generatedAt'),
    providerRefs: raw.providerRefs.map((provider, index) => normalizeProviderRef(
      provider,
      `annotationSet.providerRefs[${index}]`
    )),
    tokens,
    diagnostics: normalizeDiagnostics(raw.diagnostics)
  });
}

function normalizeMarkingProfile(value) {
  const raw = objectAt(value, 'profile');
  const channels = objectAt(raw.channels, 'profile.channels');
  const normalizedChannels = {};
  for (const channel of CHANNELS) {
    normalizedChannels[channel] = booleanAt(channels[channel], `profile.channels.${channel}`);
  }
  return deepFreeze({
    schemaVersion: schemaVersionAt(
      raw.schemaVersion,
      MARKING_PROFILE_SCHEMA_VERSION,
      'profile.schemaVersion'
    ),
    profileId: stringAt(raw.profileId, 'profile.profileId'),
    profileRevision: raw.profileRevision === undefined
      ? 0
      : integerAt(raw.profileRevision, 'profile.profileRevision', 0, Number.MAX_SAFE_INTEGER),
    enabled: booleanAt(raw.enabled, 'profile.enabled'),
    languageMode: enumAt(raw.languageMode, LANGUAGE_MODES, 'profile.languageMode'),
    channels: normalizedChannels,
    density: numberAt(raw.density, 'profile.density', 0, 1),
    minConfidence: numberAt(raw.minConfidence, 'profile.minConfidence', 0, 1),
    labelPosition: enumAt(raw.labelPosition, LABEL_POSITIONS, 'profile.labelPosition'),
    maxTextNodes: integerAt(raw.maxTextNodes, 'profile.maxTextNodes', 1, 10000),
    maxMarkedTokens: integerAt(raw.maxMarkedTokens, 'profile.maxMarkedTokens', 1, 100000)
  });
}

function migrateLegacySemanticToken(value, options) {
  const raw = objectAt(value, 'legacyToken');
  const settings = objectAt(options, 'migrationOptions');
  const surface = stringAt(raw.text, 'legacyToken.text');
  const language = raw.lang === 'zh' ? 'zh-Hant' : raw.lang;
  const simplifiedPos = raw.pos === undefined ? 'x' : raw.pos;
  const confidence = numberAt(raw.confidence, 'legacyToken.confidence', 0, 1);
  const source = stringAt(raw.source, 'legacyToken.source');
  const generatedAt = dateAt(settings.generatedAt, 'migrationOptions.generatedAt');
  const tokenId = settings.tokenId === undefined
    ? `legacy:${language}:${raw.start}:${raw.end}`
    : stringAt(settings.tokenId, 'migrationOptions.tokenId');
  const annotationId = `${tokenId}:simplified-pos`;
  return normalizeSemanticToken({
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    tokenId,
    surface,
    normalizedSurface: language === 'en' ? surface.toLowerCase() : surface,
    language,
    start: raw.start,
    end: raw.end,
    simplifiedPos,
    glossRefs: [],
    lexicalRefs: [],
    confidence,
    provenance: [`legacy-token:${source}`],
    priority: raw.priority,
    annotations: [{
      schemaVersion: SEMANTIC_SCHEMA_VERSION,
      annotationId,
      type: 'simplified-pos',
      value: simplifiedPos,
      confidence,
      source,
      provider: { id: 'halo-bootstrap-dictionary', version: '0.1.0' },
      algorithm: { id: 'halo-legacy-token-adapter', version: '0.3.0' },
      generatedAt,
      provenance: [`legacy-token:${source}`]
    }]
  });
}

module.exports = Object.freeze({
  SEMANTIC_SCHEMA_VERSION,
  MARKING_PROFILE_SCHEMA_VERSION,
  LANGUAGES,
  LANGUAGE_MODES,
  POS_TAGS,
  CHANNELS,
  normalizeSemanticAnnotation,
  normalizeSemanticToken,
  normalizeAnnotationSet: BrowserSemanticContracts.normalizeAnnotationSet,
  normalizeMarkingProfile,
  migrateLegacySemanticToken
});
