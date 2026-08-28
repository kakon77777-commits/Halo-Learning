(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloShardedDictionaryProvider = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EMPTY_RESULTS = Object.freeze([]);

  function languageRoute(language) {
    if (language === 'en') return Object.freeze({ shard: 'en', bootstrap: 'en' });
    if (language === 'zh' || language === 'zh-Hant') {
      return Object.freeze({ shard: 'zh-Hant', bootstrap: 'zh' });
    }
    return null;
  }

  function createShardedDictionaryProvider(options) {
    const settings = options || {};
    const runtime = settings.runtime;
    const pinnedShards = settings.pinnedShards;
    const bootstrapProvider = settings.bootstrapProvider;
    if (!runtime || typeof runtime.status !== 'function') throw new TypeError('runtime: is required');
    if (!Array.isArray(pinnedShards)) throw new TypeError('pinnedShards: must be an array');
    if (!bootstrapProvider || typeof bootstrapProvider.lookup !== 'function') {
      throw new TypeError('bootstrapProvider.lookup: must be a function');
    }

    function shardLookup(method, surface, locale) {
      const result = [];
      for (const shard of pinnedShards) {
        if (shard.locale !== locale || typeof shard[method] !== 'function') continue;
        result.push(...shard[method](surface, locale));
      }
      return result.length ? Object.freeze(result) : EMPTY_RESULTS;
    }

    function bootstrapLookupAll(surface, locale) {
      if (typeof bootstrapProvider.lookupAll === 'function') return bootstrapProvider.lookupAll(surface, locale);
      const value = bootstrapProvider.lookup(surface, locale);
      return value ? Object.freeze([value]) : EMPTY_RESULTS;
    }

    function lookupAll(surface, language) {
      const route = languageRoute(language);
      if (!route) return EMPTY_RESULTS;
      const verified = shardLookup('lookup', surface, route.shard);
      const bootstrap = bootstrapLookupAll(surface, route.bootstrap);
      if (!verified.length) return bootstrap;
      if (!bootstrap.length) return verified;
      return Object.freeze([...verified, ...bootstrap]);
    }

    function longestMatch(text, start, language) {
      const route = languageRoute(language);
      if (!route || route.shard !== 'zh-Hant') return null;
      let verified = null;
      for (const shard of pinnedShards) {
        if (shard.locale !== 'zh-Hant' || typeof shard.longestMatch !== 'function') continue;
        const candidate = shard.longestMatch(text, start, 'zh-Hant');
        if (candidate && (!verified || candidate.end > verified.end)) verified = candidate;
      }
      const bootstrap = typeof bootstrapProvider.longestMatch === 'function'
        ? bootstrapProvider.longestMatch(text, start, route.bootstrap)
        : null;
      if (!verified) return bootstrap;
      if (!bootstrap) return verified;
      if (verified.end > bootstrap.end) return verified;
      if (bootstrap.end > verified.end) return bootstrap;
      if (verified.surface !== bootstrap.surface) return verified;
      return Object.freeze({
        surface: verified.surface,
        start: verified.start,
        end: verified.end,
        entries: Object.freeze([...verified.entries, ...bootstrap.entries])
      });
    }

    return Object.freeze({
      id: 'halo-sharded-dictionary-chain',
      version: '0.4.0',
      lookup(surface, language) {
        const entries = lookupAll(surface, language);
        return entries.length ? entries[0] : null;
      },
      lookupAll,
      lookupMorphology(surface, language) {
        const route = languageRoute(language);
        if (!route || route.shard !== 'en') return EMPTY_RESULTS;
        const verified = shardLookup('lookupMorphology', surface, route.shard);
        if (verified.length) return verified;
        return typeof bootstrapProvider.lookupMorphology === 'function'
          ? bootstrapProvider.lookupMorphology(surface, route.bootstrap)
          : EMPTY_RESULTS;
      },
      longestMatch,
      status() {
        const runtimeStatus = runtime.status();
        return Object.freeze({
          mode: pinnedShards.length ? 'ready' : (runtimeStatus.failures.length ? 'degraded' : 'bootstrap-only'),
          providerVersion: '0.4.0',
          bucketCount: runtimeStatus.bucketCount,
          pinnedShardCount: pinnedShards.length,
          residentShardCount: runtimeStatus.residentCount,
          fallbackActivated: !pinnedShards.length,
          failures: runtimeStatus.failures
        });
      }
    });
  }

  return Object.freeze({ createShardedDictionaryProvider });
});
