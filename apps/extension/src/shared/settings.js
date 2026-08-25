(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    languageMode: 'both',
    posLabels: true,
    posColors: true,
    density: 0.65,
    minConfidence: 0.6,
    labelPosition: 'top-right',
    maxTextNodes: 600,
    maxMarkedTokens: 3000
  });

  const LANGUAGE_MODES = new Set(['both', 'en', 'zh']);
  const LABEL_POSITIONS = new Set(['top-right', 'top-left', 'bottom-right', 'inline']);

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function normalizeSettings(input) {
    const raw = input || {};
    return Object.freeze({
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SETTINGS.enabled,
      languageMode: LANGUAGE_MODES.has(raw.languageMode) ? raw.languageMode : DEFAULT_SETTINGS.languageMode,
      posLabels: typeof raw.posLabels === 'boolean' ? raw.posLabels : DEFAULT_SETTINGS.posLabels,
      posColors: typeof raw.posColors === 'boolean' ? raw.posColors : DEFAULT_SETTINGS.posColors,
      density: clampNumber(raw.density, 0, 1, DEFAULT_SETTINGS.density),
      minConfidence: clampNumber(raw.minConfidence, 0, 1, DEFAULT_SETTINGS.minConfidence),
      labelPosition: LABEL_POSITIONS.has(raw.labelPosition) ? raw.labelPosition : DEFAULT_SETTINGS.labelPosition,
      maxTextNodes: Math.round(clampNumber(raw.maxTextNodes, 50, 2000, DEFAULT_SETTINGS.maxTextNodes)),
      maxMarkedTokens: Math.round(clampNumber(raw.maxMarkedTokens, 100, 10000, DEFAULT_SETTINGS.maxMarkedTokens))
    });
  }

  return Object.freeze({ DEFAULT_SETTINGS, normalizeSettings });
});
