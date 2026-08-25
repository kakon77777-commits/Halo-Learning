(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDictionary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function key(surface, lang) {
    const value = String(surface || '');
    return `${lang || 'und'}:${lang === 'en' ? value.toLowerCase() : value}`;
  }

  function createDictionaryProvider(entries, meta) {
    const info = meta || {};
    const index = new Map();
    for (const raw of entries || []) {
      if (!raw || !raw.surface || !raw.lang) continue;
      index.set(key(raw.surface, raw.lang), Object.freeze({ ...raw }));
    }
    return Object.freeze({
      id: info.id || 'dictionary-provider',
      version: info.version || '0.1.0',
      license: info.license || 'unspecified',
      size: index.size,
      lookup(surface, lang) {
        return index.get(key(surface, lang)) || null;
      }
    });
  }

  return Object.freeze({ createDictionaryProvider });
});
