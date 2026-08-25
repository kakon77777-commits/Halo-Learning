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
    for (const name of ['density', 'languageMode', 'labelPosition', 'triggerMode']) {
      if (Object.hasOwn(ui, name)) merged[name] = ui[name];
    }
    const candidate = normalizeSettings(merged);
    const changed = candidate.density !== current.density ||
      candidate.languageMode !== current.languageMode ||
      candidate.labelPosition !== current.labelPosition ||
      candidate.triggerMode !== current.triggerMode ||
      Object.keys(current.channels).some((name) => candidate.channels[name] !== current.channels[name]);
    if (!changed) return candidate;
    if (current.profileRevision >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('profileRevision: cannot be incremented safely');
    }
    return normalizeSettings({ ...candidate, profileRevision: current.profileRevision + 1 });
  }

  return Object.freeze({ mergeUiSettings });
});
