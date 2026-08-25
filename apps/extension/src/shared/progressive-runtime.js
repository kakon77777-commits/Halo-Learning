(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloProgressiveRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const LANGUAGE_MODES = new Set(['en', 'zh-Hant', 'both']);

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }

  function stableHash(values) {
    const framed = values.map((value) => {
      const serialized = JSON.stringify(value);
      return `${serialized.length}:${serialized}`;
    }).join('|');
    let hash = 2166136261;
    for (let index = 0; index < framed.length; index += 1) {
      hash ^= framed.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function validVersion(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
  }

  function validRevision(value) {
    return (typeof value === 'string' && value.length > 0 && value.length <= 128 &&
      !/[\u0000-\u001f\u007f]/.test(value)) || (Number.isSafeInteger(value) && value >= 0);
  }

  function createAnalysisKey(input) {
    const value = input || {};
    if (typeof value.text !== 'string') throw new TypeError('text: must be a string');
    if (!LANGUAGE_MODES.has(value.languageMode)) {
      throw new TypeError('languageMode: must be en, zh-Hant, or both');
    }
    if (!validVersion(value.semanticVersion)) throw new TypeError('semanticVersion: is required');
    if (!validVersion(value.grammarVersion)) throw new TypeError('grammarVersion: is required');
    if (!validRevision(value.profileRevision)) throw new TypeError('profileRevision: is required');
    if (!validVersion(value.lexicalVersion)) throw new TypeError('lexicalVersion: is required');
    return stableHash([
      value.text,
      value.languageMode,
      value.semanticVersion,
      value.grammarVersion,
      value.profileRevision,
      value.lexicalVersion
    ]);
  }

  function validStableId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
  }

  function rejected(request, status) {
    const value = request && typeof request === 'object' ? request : {};
    const result = { schemaVersion: SCHEMA_VERSION, status };
    if (validStableId(value.requestId)) result.requestId = value.requestId;
    if (Number.isSafeInteger(value.pageEpoch) && value.pageEpoch >= 1) result.pageEpoch = value.pageEpoch;
    if (validStableId(value.rootId)) result.rootId = value.rootId;
    if (Number.isSafeInteger(value.rootRevision) && value.rootRevision >= 1) {
      result.rootRevision = value.rootRevision;
    }
    if (validStableId(value.analysisKey)) result.analysisKey = value.analysisKey;
    return deepFreeze(result);
  }

  function createProgressiveSemanticRuntime(options) {
    const settings = options || {};
    if (!settings.bootstrapEngine || typeof settings.bootstrapEngine.annotateText !== 'function') {
      throw new TypeError('bootstrapEngine.annotateText: must be a function');
    }
    if (typeof settings.enrichBatch !== 'function') throw new TypeError('enrichBatch: must be a function');
    if (!validVersion(settings.semanticVersion)) throw new TypeError('semanticVersion: is required');
    if (!validVersion(settings.grammarVersion)) throw new TypeError('grammarVersion: is required');
    const now = typeof settings.now === 'function' ? settings.now : () => new Date().toISOString();
    let pageEpoch = settings.initialPageEpoch === undefined ? 1 : settings.initialPageEpoch;
    if (!Number.isSafeInteger(pageEpoch) || pageEpoch < 1) {
      throw new TypeError('initialPageEpoch: must be a positive integer');
    }
    const seenBootstrap = new Set();
    const seenLexical = new Set();
    const latestRootRevisions = new Map();
    const pendingByRequest = new Map();
    let successfulBootstrap = 0;
    let successfulLexical = 0;

    function executionKey(request) {
      return [request.pageEpoch, request.rootId, request.rootRevision, request.analysisKey].join('\u0000');
    }

    function validRequest(request) {
      if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
      if (!validStableId(request.requestId) || !validStableId(request.rootId) ||
          !Number.isSafeInteger(request.pageEpoch) || request.pageEpoch < 1 ||
          !Number.isSafeInteger(request.rootRevision) || request.rootRevision < 1 ||
          typeof request.text !== 'string' || !request.text || !LANGUAGE_MODES.has(request.languageMode) ||
          !validRevision(request.profileRevision) || !validVersion(request.lexicalVersion) ||
          !validStableId(request.analysisKey)) return false;
      if (request.generatedAt !== undefined &&
          (typeof request.generatedAt !== 'string' || Number.isNaN(Date.parse(request.generatedAt)))) return false;
      try {
        return request.analysisKey === createAnalysisKey({
          text: request.text,
          languageMode: request.languageMode,
          semanticVersion: settings.semanticVersion,
          grammarVersion: settings.grammarVersion,
          profileRevision: request.profileRevision,
          lexicalVersion: request.lexicalVersion
        });
      } catch (_error) {
        return false;
      }
    }

    function pendingCount() {
      let count = 0;
      for (const values of pendingByRequest.values()) count += values.size;
      return count;
    }

    function registerPending(operation) {
      if (!pendingByRequest.has(operation.request.requestId)) {
        pendingByRequest.set(operation.request.requestId, new Set());
      }
      pendingByRequest.get(operation.request.requestId).add(operation);
    }

    function releasePending(operation) {
      const values = pendingByRequest.get(operation.request.requestId);
      if (!values) return;
      values.delete(operation);
      if (!values.size) pendingByRequest.delete(operation.request.requestId);
    }

    function markLatest(request) {
      const latest = latestRootRevisions.get(request.rootId);
      if (latest !== undefined && request.rootRevision < latest) return false;
      if (latest === undefined || request.rootRevision > latest) {
        latestRootRevisions.set(request.rootId, request.rootRevision);
        for (const values of pendingByRequest.values()) {
          for (const operation of values) {
            if (operation.request.rootId === request.rootId &&
                operation.request.rootRevision < request.rootRevision) {
              operation.stale = true;
              operation.controller.abort();
            }
          }
        }
      }
      return true;
    }

    function isStale(operation) {
      return operation.stale || operation.request.pageEpoch !== pageEpoch ||
        latestRootRevisions.get(operation.request.rootId) !== operation.request.rootRevision;
    }

    function result(request, phase, annotationSet, lexicalVersion, generatedAt) {
      return deepFreeze({
        schemaVersion: SCHEMA_VERSION,
        requestId: request.requestId,
        pageEpoch: request.pageEpoch,
        rootId: request.rootId,
        rootRevision: request.rootRevision,
        analysisKey: request.analysisKey,
        phase,
        annotationSet,
        lexicalVersion,
        generatedAt
      });
    }

    async function run(request, phase) {
      if (!validRequest(request)) return rejected(request, 'invalid');
      if (request.pageEpoch !== pageEpoch) return rejected(request, 'stale');
      if (!markLatest(request)) return rejected(request, 'stale');
      const seen = phase === 'bootstrap' ? seenBootstrap : seenLexical;
      const key = executionKey(request);
      if (seen.has(key)) return rejected(request, 'duplicate');
      seen.add(key);
      const operation = {
        request,
        controller: new AbortController(),
        cancelled: false,
        stale: false
      };
      registerPending(operation);
      const generatedAt = request.generatedAt || now();
      try {
        let annotationSet;
        let lexicalVersion = request.lexicalVersion;
        if (phase === 'bootstrap') {
          annotationSet = await settings.bootstrapEngine.annotateText(request.text, {
            languageMode: request.languageMode,
            generatedAt
          });
        } else {
          const enriched = await settings.enrichBatch(request, { signal: operation.controller.signal });
          if (!enriched || typeof enriched !== 'object') return rejected(request, 'invalid');
          annotationSet = enriched.annotationSet;
          lexicalVersion = enriched.lexicalVersion;
        }
        if (isStale(operation)) return rejected(request, 'stale');
        if (operation.cancelled || operation.controller.signal.aborted) return rejected(request, 'cancelled');
        if (!annotationSet || typeof annotationSet !== 'object' || Array.isArray(annotationSet) ||
            !validVersion(lexicalVersion) || lexicalVersion !== request.lexicalVersion) {
          return rejected(request, 'invalid');
        }
        if (phase === 'bootstrap') successfulBootstrap += 1;
        else successfulLexical += 1;
        return result(request, phase, annotationSet, lexicalVersion, generatedAt);
      } catch (_error) {
        if (isStale(operation)) return rejected(request, 'stale');
        if (operation.cancelled || operation.controller.signal.aborted) return rejected(request, 'cancelled');
        return rejected(request, 'invalid');
      } finally {
        releasePending(operation);
      }
    }

    function cancel(requestId) {
      if (!validStableId(requestId)) return false;
      const operations = pendingByRequest.get(requestId);
      if (!operations || !operations.size) return false;
      for (const operation of operations) {
        operation.cancelled = true;
        operation.controller.abort();
      }
      return true;
    }

    function advancePageEpoch(nextEpoch) {
      if (!Number.isSafeInteger(nextEpoch) || nextEpoch <= pageEpoch) {
        throw new TypeError('nextEpoch: must be a greater positive integer');
      }
      pageEpoch = nextEpoch;
      for (const operations of pendingByRequest.values()) {
        for (const operation of operations) {
          operation.stale = true;
          operation.controller.abort();
        }
      }
      latestRootRevisions.clear();
      seenBootstrap.clear();
      seenLexical.clear();
      return pageEpoch;
    }

    function status() {
      return deepFreeze({
        schemaVersion: SCHEMA_VERSION,
        pageEpoch,
        bootstrapRevisionCount: successfulBootstrap,
        lexicalRevisionCount: successfulLexical,
        pendingCount: pendingCount()
      });
    }

    return Object.freeze({
      bootstrap: (request) => run(request, 'bootstrap'),
      enrich: (request) => run(request, 'lexical'),
      cancel,
      advancePageEpoch,
      status
    });
  }

  return Object.freeze({ SCHEMA_VERSION, createAnalysisKey, createProgressiveSemanticRuntime });
});
