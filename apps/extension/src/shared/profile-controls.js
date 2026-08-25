(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloProfileControls = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function mergeUiSettings(currentValue, uiValue, normalizeSettings) {
    if (typeof normalizeSettings !== 'function') {
      throw new TypeError('normalizeSettings: must be a function');
    }
    const current = normalizeSettings(currentValue);
    const ui = uiValue && typeof uiValue === 'object' ? uiValue : {};
    const channels = ui.channels && typeof ui.channels === 'object' && !Array.isArray(ui.channels)
      ? { ...current.channels, ...ui.channels }
      : current.channels;
    const merged = { ...current, channels };
    for (const name of ['density', 'languageMode', 'labelPosition']) {
      if (Object.hasOwn(ui, name)) merged[name] = ui[name];
    }
    return normalizeSettings(merged);
  }

  return Object.freeze({ mergeUiSettings });
});
