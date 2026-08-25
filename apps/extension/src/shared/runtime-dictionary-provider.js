(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloRuntimeDictionary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EMPTY_RESULTS = Object.freeze([]);

  function routeLanguage(language) {
    if (language === 'en') return Object.freeze({ runtime: 'en', bootstrap: 'en' });
    if (language === 'zh' || language === 'zh-Hant') {
      return Object.freeze({ runtime: 'zh-Hant', bootstrap: 'zh' });
    }
    return null;
  }

  function stableFailureCode(error) {
    if (error && typeof error.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(error.code)) return error.code;
    return 'CORPUS_UNAVAILABLE';
  }

  function createProviderChain(options) {
    const settings = options || {};
    const runtimeIndex = settings.runtimeIndex || null;
    const bootstrapProvider = settings.bootstrapProvider;
    if (!bootstrapProvider || typeof bootstrapProvider.lookup !== 'function') {
      throw new TypeError('bootstrapProvider.lookup: must be a function');
    }
    const failures = settings.failureCode ? Object.freeze([{ code: settings.failureCode }]) : EMPTY_RESULTS;

    function lookupAll(surface, language) {
      const route = routeLanguage(language);
      if (!route) return EMPTY_RESULTS;
      let runtimeEntries = EMPTY_RESULTS;
      if (runtimeIndex) {
        runtimeEntries = runtimeIndex.lookup(surface, route.runtime);
      }
      let bootstrapEntries = EMPTY_RESULTS;
      if (typeof bootstrapProvider.lookupAll === 'function') {
        bootstrapEntries = bootstrapProvider.lookupAll(surface, route.bootstrap);
      } else {
        const entry = bootstrapProvider.lookup(surface, route.bootstrap);
        bootstrapEntries = entry ? Object.freeze([entry]) : EMPTY_RESULTS;
      }
      if (!runtimeEntries.length) return bootstrapEntries;
      if (!bootstrapEntries.length) return runtimeEntries;
      return Object.freeze([...runtimeEntries, ...bootstrapEntries]);
    }

    return Object.freeze({
      id: 'halo-runtime-dictionary-chain',
      version: '0.3.0',
      lookup(surface, language) {
        const entries = lookupAll(surface, language);
        return entries.length ? entries[0] : null;
      },
      lookupAll,
      lookupMorphology(surface, language) {
        const route = routeLanguage(language);
        if (!route || route.runtime !== 'en') return EMPTY_RESULTS;
        if (runtimeIndex && typeof runtimeIndex.lookupMorphology === 'function') {
          const entries = runtimeIndex.lookupMorphology(surface, route.runtime);
          if (entries.length) return entries;
        }
        return typeof bootstrapProvider.lookupMorphology === 'function'
          ? bootstrapProvider.lookupMorphology(surface, route.bootstrap)
          : EMPTY_RESULTS;
      },
      longestMatch(text, start, language) {
        const route = routeLanguage(language);
        if (!route || route.runtime !== 'zh-Hant') return null;
        const runtimeMatch = runtimeIndex && typeof runtimeIndex.longestMatch === 'function'
          ? runtimeIndex.longestMatch(text, start, route.runtime)
          : null;
        const bootstrapMatch = typeof bootstrapProvider.longestMatch === 'function'
          ? bootstrapProvider.longestMatch(text, start, route.bootstrap)
          : null;
        if (!runtimeMatch) return bootstrapMatch;
        if (!bootstrapMatch) return runtimeMatch;
        if (bootstrapMatch.end > runtimeMatch.end) return bootstrapMatch;
        if (runtimeMatch.end > bootstrapMatch.end) return runtimeMatch;
        if (runtimeMatch.surface !== bootstrapMatch.surface) return runtimeMatch;
        return Object.freeze({
          surface: runtimeMatch.surface,
          start: runtimeMatch.start,
          end: runtimeMatch.end,
          entries: Object.freeze([...runtimeMatch.entries, ...bootstrapMatch.entries])
        });
      },
      status() {
        return Object.freeze({
          mode: runtimeIndex ? 'ready' : (failures.length ? 'degraded' : 'bootstrap-only'),
          runtimeIndexId: runtimeIndex ? runtimeIndex.indexId : null,
          runtimeHash: runtimeIndex ? runtimeIndex.hash.value : null,
          fallbackActivated: !runtimeIndex,
          failures
        });
      }
    });
  }

  async function loadPackagedDictionaryProvider(options) {
    const settings = options || {};
    if (typeof settings.readText !== 'function') throw new TypeError('readText: must be a function');
    if (typeof settings.loadIndex !== 'function') throw new TypeError('loadIndex: must be a function');
    const resourcePath = settings.path || 'data/lexical-runtime-index.json';
    try {
      const serialized = await settings.readText(resourcePath);
      const runtimeIndex = await settings.loadIndex(serialized);
      return createProviderChain({ runtimeIndex, bootstrapProvider: settings.bootstrapProvider });
    } catch (error) {
      return createProviderChain({
        runtimeIndex: null,
        bootstrapProvider: settings.bootstrapProvider,
        failureCode: stableFailureCode(error)
      });
    }
  }

  return Object.freeze({ createProviderChain, loadPackagedDictionaryProvider });
});
