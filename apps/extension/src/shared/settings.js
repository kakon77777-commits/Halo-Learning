(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CHANNEL_NAMES = Object.freeze([
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
  const UNAVAILABLE_CHANNELS = Object.freeze(['learningState']);
  const DEFAULT_CHANNELS = Object.freeze({
    posLabel: true,
    posColor: true,
    lemma: false,
    morphology: false,
    glossHint: false,
    grammarRole: false,
    tenseAspect: false,
    chunk: false,
    learningState: false
  });
  const DEFAULT_RUNTIME_BUDGETS = Object.freeze({
    maxTextNodes: 24,
    maxCharacters: 12000,
    maxSentences: 24,
    maxSemanticTokens: 600,
    maxShardIds: 24,
    timeSliceMs: 8,
    maxQueuedRoots: 200,
    viewportBufferPx: 1200
  });
  const DEFAULT_SETTINGS = Object.freeze({
    schemaVersion: 2,
    profileId: 'halo-default-v0.3.0',
    enabled: true,
    languageMode: 'both',
    channels: DEFAULT_CHANNELS,
    density: 0.65,
    minConfidence: 0.6,
    labelPosition: 'top-right',
    runtimeBudgets: DEFAULT_RUNTIME_BUDGETS,
    // Retained only while MarkingProfile/v2 serialization requires the legacy fields.
    maxTextNodes: 600,
    maxMarkedTokens: 3000
  });

  const LANGUAGE_MODES = new Set(['auto', 'both', 'en', 'zh-Hant']);
  const LABEL_POSITIONS = new Set(['top-right', 'top-left', 'bottom-right', 'inline']);

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function channelValue(raw, channels, name) {
    if (UNAVAILABLE_CHANNELS.includes(name)) return false;
    if (channels && typeof channels[name] === 'boolean') return channels[name];
    if (name === 'posLabel' && typeof raw.posLabels === 'boolean') return raw.posLabels;
    if (name === 'posColor' && typeof raw.posColors === 'boolean') return raw.posColors;
    return DEFAULT_CHANNELS[name];
  }

  function normalizeRuntimeBudgets(input) {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const budgets = {};
    for (const name of [
      'maxTextNodes', 'maxCharacters', 'maxSentences', 'maxSemanticTokens',
      'maxShardIds', 'timeSliceMs', 'maxQueuedRoots'
    ]) {
      budgets[name] = Math.round(clampNumber(raw[name], 1, DEFAULT_RUNTIME_BUDGETS[name], DEFAULT_RUNTIME_BUDGETS[name]));
    }
    budgets.viewportBufferPx = Math.round(clampNumber(
      raw.viewportBufferPx,
      0,
      DEFAULT_RUNTIME_BUDGETS.viewportBufferPx,
      DEFAULT_RUNTIME_BUDGETS.viewportBufferPx
    ));
    return Object.freeze(budgets);
  }

  function normalizeSettings(input) {
    const raw = input || {};
    const rawChannels = raw.channels && typeof raw.channels === 'object' && !Array.isArray(raw.channels)
      ? raw.channels
      : null;
    const channels = {};
    for (const name of CHANNEL_NAMES) channels[name] = channelValue(raw, rawChannels, name);
    const rawLanguage = raw.languageMode === 'zh' ? 'zh-Hant' : raw.languageMode;
    return Object.freeze({
      schemaVersion: 2,
      profileId: typeof raw.profileId === 'string' && raw.profileId.trim()
        ? raw.profileId.trim()
        : (raw.schemaVersion === 2 ? DEFAULT_SETTINGS.profileId : 'migrated-v0.1-v0.2'),
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SETTINGS.enabled,
      languageMode: LANGUAGE_MODES.has(rawLanguage) ? rawLanguage : DEFAULT_SETTINGS.languageMode,
      channels: Object.freeze(channels),
      density: clampNumber(raw.density, 0, 1, DEFAULT_SETTINGS.density),
      minConfidence: clampNumber(raw.minConfidence, 0, 1, DEFAULT_SETTINGS.minConfidence),
      labelPosition: LABEL_POSITIONS.has(raw.labelPosition) ? raw.labelPosition : DEFAULT_SETTINGS.labelPosition,
      runtimeBudgets: normalizeRuntimeBudgets(raw.runtimeBudgets),
      // Compatibility fields are normalized for MarkingProfile/v2 only; runtime policy never reads them.
      maxTextNodes: Math.round(clampNumber(raw.maxTextNodes, 50, 2000, DEFAULT_SETTINGS.maxTextNodes)),
      maxMarkedTokens: Math.round(clampNumber(raw.maxMarkedTokens, 100, 10000, DEFAULT_SETTINGS.maxMarkedTokens))
    });
  }

  function migrateSettings(input) {
    return normalizeSettings(input);
  }

  return Object.freeze({
    CHANNEL_NAMES,
    UNAVAILABLE_CHANNELS,
    DEFAULT_CHANNELS,
    DEFAULT_RUNTIME_BUDGETS,
    DEFAULT_SETTINGS,
    normalizeRuntimeBudgets,
    normalizeSettings,
    migrateSettings
  });
});
