(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDogfoodContracts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMAS = Object.freeze({
    event: 'LearningEvent/v1',
    source: 'SourceRef/v1',
    sentence: 'SentenceRecord/v1',
    cache: 'AnalysisCacheEntry/v1',
    export: 'ExportBundle/v1',
    deleteReceipt: 'DeleteReceipt/v1',
    replay: 'ReplayReport/v1'
  });

  const EVENT_TYPES = Object.freeze([
    'halo_applied', 'halo_removed', 'sentence_exposed',
    'gloss_opened', 'explanation_opened',
    'sentence_saved', 'sentence_unsaved',
    'dogfood_note_created', 'dogfood_note_revised', 'dogfood_note_removed',
    'profile_changed', 'density_changed', 'channels_changed', 'trigger_mode_changed',
    'capture_paused', 'capture_resumed'
  ]);

  const INTERACTION_CLASSES = Object.freeze([
    'passive', 'ordinary', 'explicit-learning', 'dogfood-note'
  ]);

  const LANGUAGES = Object.freeze(['en', 'zh-Hant', 'both', 'und']);
  const TRIGGER_MODES = Object.freeze(['adaptive-hover', 'explicit-only', 'hybrid']);
  const NOTE_TYPES = new Set(['dogfood_note_created', 'dogfood_note_revised', 'dogfood_note_removed']);
  const NOTE_LINK_TYPES = new Set(['dogfood_note_revised', 'dogfood_note_removed']);

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }

  function plainObject(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${path}: canonical object required`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path}: plain JSON data required`);
    }
    return value;
  }

  function exactObject(value, keys, path) {
    const raw = plainObject(value, path);
    const actual = Object.keys(raw);
    for (const key of actual) {
      if (!keys.includes(key)) throw new TypeError(`${path}.${key}: not allowed`);
    }
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) {
        throw new TypeError(`${path}.${key}: required`);
      }
    }
    return raw;
  }

  function nullableString(value, path, maximum) {
    if (value === null) return null;
    if (typeof value !== 'string' || !value || value.length > maximum) {
      throw new TypeError(`${path}: must be null or a non-empty string of at most ${maximum} characters`);
    }
    return value;
  }

  function stringValue(value, path, maximum) {
    if (typeof value !== 'string' || !value || value.length > maximum) {
      throw new TypeError(`${path}: must be a non-empty string of at most ${maximum} characters`);
    }
    return value;
  }

  function isoTimestamp(value, path) {
    const text = stringValue(value, path, 64);
    const date = new Date(text);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) {
      throw new TypeError(`${path}: canonical ISO timestamp required`);
    }
    return text;
  }

  function nonNegativeInteger(value, path) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${path}: non-negative safe integer required`);
    return value;
  }

  function stableRef(value, path) {
    const text = stringValue(value, path, 256);
    if (!/^[A-Za-z0-9._:@-]+$/u.test(text)) throw new TypeError(`${path}: stable local reference required`);
    return text;
  }

  function nullableStableRef(value, path) {
    return value === null ? null : stableRef(value, path);
  }

  function normalizeUiContext(value) {
    const raw = exactObject(value, ['activeChannels', 'density', 'triggerMode'], 'LearningEvent/v1.uiContext');
    if (!Array.isArray(raw.activeChannels) || raw.activeChannels.length > 32 ||
        raw.activeChannels.some((name) => typeof name !== 'string' || !name || name.length > 64)) {
      throw new TypeError('LearningEvent/v1.uiContext.activeChannels: bounded string array required');
    }
    if (!Number.isFinite(raw.density) || raw.density < 0 || raw.density > 1) {
      throw new TypeError('LearningEvent/v1.uiContext.density: number between 0 and 1 required');
    }
    if (!TRIGGER_MODES.includes(raw.triggerMode)) {
      throw new TypeError('LearningEvent/v1.uiContext.triggerMode: canonical trigger mode required');
    }
    return deepFreeze({
      activeChannels: Object.freeze([...raw.activeChannels]),
      density: raw.density,
      triggerMode: raw.triggerMode
    });
  }

  function normalizeLearningEvent(value) {
    const keys = [
      'schema', 'eventId', 'timestamp', 'eventType', 'sessionId', 'sessionPolicyVersion',
      'sourceRef', 'language', 'sentenceRef', 'sentenceHash', 'interactionClass',
      'capturePolicyVersion', 'profileId', 'profileRevision', 'uiContext',
      'algorithmVersion', 'refersToEventId', 'detail'
    ];
    const raw = exactObject(value, keys, SCHEMAS.event);
    if (raw.schema !== SCHEMAS.event) throw new TypeError(`${SCHEMAS.event}.schema: invalid`);
    const eventId = stableRef(raw.eventId, `${SCHEMAS.event}.eventId`);
    const timestamp = isoTimestamp(raw.timestamp, `${SCHEMAS.event}.timestamp`);
    if (!EVENT_TYPES.includes(raw.eventType)) throw new TypeError(`${SCHEMAS.event}.eventType: not allowed`);
    const sessionId = stableRef(raw.sessionId, `${SCHEMAS.event}.sessionId`);
    const sessionPolicyVersion = stableRef(raw.sessionPolicyVersion, `${SCHEMAS.event}.sessionPolicyVersion`);
    const sourceRef = stableRef(raw.sourceRef, `${SCHEMAS.event}.sourceRef`);
    if (!LANGUAGES.includes(raw.language)) throw new TypeError(`${SCHEMAS.event}.language: not allowed`);
    const sentenceRef = nullableStableRef(raw.sentenceRef, `${SCHEMAS.event}.sentenceRef`);
    const sentenceHash = nullableStableRef(raw.sentenceHash, `${SCHEMAS.event}.sentenceHash`);
    if (!INTERACTION_CLASSES.includes(raw.interactionClass)) {
      throw new TypeError(`${SCHEMAS.event}.interactionClass: not allowed`);
    }
    const capturePolicyVersion = stableRef(raw.capturePolicyVersion, `${SCHEMAS.event}.capturePolicyVersion`);
    const profileId = nullableString(raw.profileId, `${SCHEMAS.event}.profileId`, 256);
    const profileRevision = raw.profileRevision === null ? null : nonNegativeInteger(raw.profileRevision, `${SCHEMAS.event}.profileRevision`);
    const uiContext = raw.uiContext === null ? null : normalizeUiContext(raw.uiContext);
    const algorithmVersion = nullableString(raw.algorithmVersion, `${SCHEMAS.event}.algorithmVersion`, 256);
    const refersToEventId = nullableStableRef(raw.refersToEventId, `${SCHEMAS.event}.refersToEventId`);
    const detail = exactObject(raw.detail, ['noteText'], `${SCHEMAS.event}.detail`);
    const noteText = detail.noteText === null ? null : stringValue(detail.noteText, `${SCHEMAS.event}.detail.noteText`, 4000);

    if (NOTE_TYPES.has(raw.eventType)) {
      if (raw.eventType !== 'dogfood_note_removed' && noteText === null) {
        throw new TypeError(`${SCHEMAS.event}.detail.noteText: note text required`);
      }
      if (raw.eventType === 'dogfood_note_removed' && noteText !== null) {
        throw new TypeError(`${SCHEMAS.event}.detail.noteText: removed note must not carry note text`);
      }
    } else if (noteText !== null) {
      throw new TypeError(`${SCHEMAS.event}.detail.noteText: not allowed for non-note event`);
    }
    if (NOTE_LINK_TYPES.has(raw.eventType) && refersToEventId === null) {
      throw new TypeError(`${SCHEMAS.event}.refersToEventId: required for note revision/removal`);
    }

    return deepFreeze({
      schema: SCHEMAS.event,
      eventId,
      timestamp,
      eventType: raw.eventType,
      sessionId,
      sessionPolicyVersion,
      sourceRef,
      language: raw.language,
      sentenceRef,
      sentenceHash,
      interactionClass: raw.interactionClass,
      capturePolicyVersion,
      profileId,
      profileRevision,
      uiContext,
      algorithmVersion,
      refersToEventId,
      detail: { noteText }
    });
  }

  function normalizeSourceRef(value) {
    const raw = exactObject(value, [
      'schema', 'sourceId', 'domain', 'normalizedPathHash', 'pathNormalizationVersion', 'fullUrl', 'language'
    ], SCHEMAS.source);
    if (raw.schema !== SCHEMAS.source) throw new TypeError(`${SCHEMAS.source}.schema: invalid`);
    const sourceId = stableRef(raw.sourceId, `${SCHEMAS.source}.sourceId`);
    const domain = stringValue(raw.domain, `${SCHEMAS.source}.domain`, 253).toLowerCase();
    if (domain !== raw.domain || /[\s/?#@]/u.test(domain)) throw new TypeError(`${SCHEMAS.source}.domain: canonical hostname required`);
    const normalizedPathHash = stableRef(raw.normalizedPathHash, `${SCHEMAS.source}.normalizedPathHash`);
    const pathNormalizationVersion = stableRef(raw.pathNormalizationVersion, `${SCHEMAS.source}.pathNormalizationVersion`);
    const fullUrl = nullableString(raw.fullUrl, `${SCHEMAS.source}.fullUrl`, 4096);
    if (!LANGUAGES.includes(raw.language)) throw new TypeError(`${SCHEMAS.source}.language: not allowed`);
    return deepFreeze({ schema: SCHEMAS.source, sourceId, domain, normalizedPathHash, pathNormalizationVersion, fullUrl, language: raw.language });
  }

  function normalizeSentenceRecord(value) {
    const raw = exactObject(value, [
      'schema', 'sentenceId', 'text', 'language', 'textHash', 'sourceRef', 'captureReason',
      'capturedAt', 'algorithmVersion', 'profileId', 'profileRevision'
    ], SCHEMAS.sentence);
    if (raw.schema !== SCHEMAS.sentence) throw new TypeError(`${SCHEMAS.sentence}.schema: invalid`);
    if (!LANGUAGES.includes(raw.language) || raw.language === 'und') throw new TypeError(`${SCHEMAS.sentence}.language: not allowed`);
    return deepFreeze({
      schema: SCHEMAS.sentence,
      sentenceId: stableRef(raw.sentenceId, `${SCHEMAS.sentence}.sentenceId`),
      text: stringValue(raw.text, `${SCHEMAS.sentence}.text`, 12000),
      language: raw.language,
      textHash: stableRef(raw.textHash, `${SCHEMAS.sentence}.textHash`),
      sourceRef: stableRef(raw.sourceRef, `${SCHEMAS.sentence}.sourceRef`),
      captureReason: stableRef(raw.captureReason, `${SCHEMAS.sentence}.captureReason`),
      capturedAt: isoTimestamp(raw.capturedAt, `${SCHEMAS.sentence}.capturedAt`),
      algorithmVersion: nullableString(raw.algorithmVersion, `${SCHEMAS.sentence}.algorithmVersion`, 256),
      profileId: nullableString(raw.profileId, `${SCHEMAS.sentence}.profileId`, 256),
      profileRevision: raw.profileRevision === null ? null : nonNegativeInteger(raw.profileRevision, `${SCHEMAS.sentence}.profileRevision`)
    });
  }

  function normalizeAnalysisCacheEntry(value) {
    const raw = exactObject(value, [
      'schema', 'cacheKey', 'textHash', 'contextHash', 'algorithmVersion', 'createdAt', 'expiresAt', 'value'
    ], SCHEMAS.cache);
    if (raw.schema !== SCHEMAS.cache) throw new TypeError(`${SCHEMAS.cache}.schema: invalid`);
    plainObject(raw.value, `${SCHEMAS.cache}.value`);
    return deepFreeze({
      schema: SCHEMAS.cache,
      cacheKey: stableRef(raw.cacheKey, `${SCHEMAS.cache}.cacheKey`),
      textHash: stableRef(raw.textHash, `${SCHEMAS.cache}.textHash`),
      contextHash: stableRef(raw.contextHash, `${SCHEMAS.cache}.contextHash`),
      algorithmVersion: stringValue(raw.algorithmVersion, `${SCHEMAS.cache}.algorithmVersion`, 256),
      createdAt: isoTimestamp(raw.createdAt, `${SCHEMAS.cache}.createdAt`),
      expiresAt: isoTimestamp(raw.expiresAt, `${SCHEMAS.cache}.expiresAt`),
      value: raw.value
    });
  }

  function normalizeExportBundle(value) {
    const raw = exactObject(value, [
      'schema', 'exportedAt', 'events', 'sources', 'sentences', 'profiles', 'analyses', 'settings'
    ], SCHEMAS.export);
    if (raw.schema !== SCHEMAS.export) throw new TypeError(`${SCHEMAS.export}.schema: invalid`);
    for (const name of ['events', 'sources', 'sentences', 'profiles', 'analyses', 'settings']) {
      if (!Array.isArray(raw[name])) throw new TypeError(`${SCHEMAS.export}.${name}: array required`);
    }
    return deepFreeze({
      schema: SCHEMAS.export,
      exportedAt: isoTimestamp(raw.exportedAt, `${SCHEMAS.export}.exportedAt`),
      events: raw.events.map(normalizeLearningEvent),
      sources: raw.sources.map(normalizeSourceRef),
      sentences: raw.sentences.map(normalizeSentenceRecord),
      profiles: [...raw.profiles],
      analyses: [...raw.analyses],
      settings: [...raw.settings]
    });
  }

  function normalizeDeleteReceipt(value) {
    const raw = exactObject(value, ['schema', 'scope', 'deleted', 'completedAt', 'success'], SCHEMAS.deleteReceipt);
    if (raw.schema !== SCHEMAS.deleteReceipt) throw new TypeError(`${SCHEMAS.deleteReceipt}.schema: invalid`);
    plainObject(raw.scope, `${SCHEMAS.deleteReceipt}.scope`);
    const deleted = plainObject(raw.deleted, `${SCHEMAS.deleteReceipt}.deleted`);
    for (const count of Object.values(deleted)) nonNegativeInteger(count, `${SCHEMAS.deleteReceipt}.deleted`);
    if (typeof raw.success !== 'boolean') throw new TypeError(`${SCHEMAS.deleteReceipt}.success: boolean required`);
    return deepFreeze({ schema: SCHEMAS.deleteReceipt, scope: raw.scope, deleted, completedAt: isoTimestamp(raw.completedAt, `${SCHEMAS.deleteReceipt}.completedAt`), success: raw.success });
  }

  function normalizeReplayReport(value) {
    const raw = exactObject(value, [
      'schema', 'sourceEventCount', 'eventRange', 'projectorVersion', 'projectionHash', 'skippedEventIds', 'success'
    ], SCHEMAS.replay);
    if (raw.schema !== SCHEMAS.replay) throw new TypeError(`${SCHEMAS.replay}.schema: invalid`);
    const range = exactObject(raw.eventRange, ['from', 'to'], `${SCHEMAS.replay}.eventRange`);
    const eventRange = {
      from: range.from === null ? null : isoTimestamp(range.from, `${SCHEMAS.replay}.eventRange.from`),
      to: range.to === null ? null : isoTimestamp(range.to, `${SCHEMAS.replay}.eventRange.to`)
    };
    if (!Array.isArray(raw.skippedEventIds)) throw new TypeError(`${SCHEMAS.replay}.skippedEventIds: array required`);
    if (typeof raw.success !== 'boolean') throw new TypeError(`${SCHEMAS.replay}.success: boolean required`);
    return deepFreeze({
      schema: SCHEMAS.replay,
      sourceEventCount: nonNegativeInteger(raw.sourceEventCount, `${SCHEMAS.replay}.sourceEventCount`),
      eventRange,
      projectorVersion: stableRef(raw.projectorVersion, `${SCHEMAS.replay}.projectorVersion`),
      projectionHash: stableRef(raw.projectionHash, `${SCHEMAS.replay}.projectionHash`),
      skippedEventIds: raw.skippedEventIds.map((value, index) => stableRef(value, `${SCHEMAS.replay}.skippedEventIds[${index}]`)),
      success: raw.success
    });
  }

  return Object.freeze({
    SCHEMAS,
    EVENT_TYPES,
    INTERACTION_CLASSES,
    normalizeLearningEvent,
    normalizeSourceRef,
    normalizeSentenceRecord,
    normalizeAnalysisCacheEntry,
    normalizeExportBundle,
    normalizeDeleteReceipt,
    normalizeReplayReport
  });
});
