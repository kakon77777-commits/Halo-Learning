'use strict';

const {
  LexicalIndexIntegrityError,
  loadLexicalIndex
} = require('./lexical-index');

function languageRoute(lang) {
  if (lang === 'en') return Object.freeze({ indexLocale: 'en', bootstrapLang: 'en' });
  if (lang === 'zh' || lang === 'zh-Hant') {
    return Object.freeze({ indexLocale: 'zh-Hant', bootstrapLang: 'zh' });
  }
  return null;
}

function createDictionaryRegistry(options) {
  const settings = options || {};
  const bootstrapProvider = settings.bootstrapProvider;
  if (!bootstrapProvider || typeof bootstrapProvider.lookup !== 'function') {
    throw new TypeError('bootstrapProvider.lookup: must be a function');
  }
  if (settings.indexes !== undefined && !Array.isArray(settings.indexes)) {
    throw new TypeError('indexes: must be an array');
  }

  const indexes = [];
  const failures = [];

  function register(serializedIndex) {
    try {
      const index = loadLexicalIndex(serializedIndex);
      const existing = indexes.find((candidate) => candidate.hash.value === index.hash.value);
      if (!existing) indexes.push(index);
      return Object.freeze({ ok: true, indexId: index.indexId, hash: index.hash.value });
    } catch (error) {
      if (!(error instanceof LexicalIndexIntegrityError)) throw error;
      const failure = Object.freeze({ code: error.code });
      failures.push(failure);
      return Object.freeze({ ok: false, code: error.code });
    }
  }

  function lookup(surface, lang) {
    const route = languageRoute(lang);
    if (!route) return null;
    for (const index of indexes) {
      const entries = index.lookup(surface, route.indexLocale);
      if (entries.length) return entries[0];
    }
    return bootstrapProvider.lookup(surface, route.bootstrapLang);
  }

  function longestMatch(text, start, lang) {
    const route = languageRoute(lang);
    if (!route || route.indexLocale !== 'zh-Hant') return null;
    let best = null;
    for (const index of indexes) {
      const match = index.longestMatch(text, start, route.indexLocale);
      if (match && (!best || match.end - match.start > best.end - best.start)) best = match;
    }
    if (best) return best;
    if (typeof bootstrapProvider.longestMatch === 'function') {
      return bootstrapProvider.longestMatch(text, start, route.bootstrapLang);
    }
    return null;
  }

  function status() {
    return Object.freeze({
      mode: failures.length ? 'degraded' : (indexes.length ? 'ready' : 'bootstrap-only'),
      indexCount: indexes.length,
      failures: Object.freeze(failures.map((failure) => Object.freeze({ ...failure })))
    });
  }

  const registry = Object.freeze({ lookup, longestMatch, register, status });
  for (const serializedIndex of settings.indexes || []) register(serializedIndex);
  return registry;
}

module.exports = Object.freeze({ createDictionaryRegistry });
