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
  const DEFAULT_SETTINGS = Object.freeze({
    schemaVersion: 2,
    profileId: 'halo-default-v0.3.0',
    enabled: true,
    languageMode: 'both',
    channels: DEFAULT_CHANNELS,
    density: 0.65,
    minConfidence: 0.6,
    labelPosition: 'top-right',
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
    DEFAULT_SETTINGS,
    normalizeSettings,
    migrateSettings
  });
});
