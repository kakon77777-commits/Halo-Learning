(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloProgressiveRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const LANGUAGE_MODES = new Set(['en', 'zh-Hant', 'both']);
  const ANALYSIS_KEY_PATTERN = /^ak1:[a-f0-9]{64}$/;
  const SHA256_CONSTANTS = Object.freeze([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }

  function rotateRight(value, count) {
    return (value >>> count) | (value << (32 - count));
  }

  function sha256Hex(text) {
    const input = new TextEncoder().encode(text);
    const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
    const bytes = new Uint8Array(paddedLength);
    bytes.set(input);
    bytes[input.length] = 0x80;
    const bitLength = input.length * 8;
    const view = new DataView(bytes.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(paddedLength - 4, bitLength >>> 0, false);
    const state = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);
    const words = new Uint32Array(64);
    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
      for (let index = 16; index < 64; index += 1) {
        const left = words[index - 15];
        const right = words[index - 2];
        const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
        const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
        words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
      }
      let a = state[0];
      let b = state[1];
      let c = state[2];
      let d = state[3];
      let e = state[4];
      let f = state[5];
      let g = state[6];
      let h = state[7];
      for (let index = 0; index < 64; index += 1) {
        const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choice = (e & f) ^ (~e & g);
        const temporary1 = (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
        const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temporary2 = (sum0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temporary1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temporary1 + temporary2) >>> 0;
      }
      state[0] = (state[0] + a) >>> 0;
      state[1] = (state[1] + b) >>> 0;
      state[2] = (state[2] + c) >>> 0;
      state[3] = (state[3] + d) >>> 0;
      state[4] = (state[4] + e) >>> 0;
      state[5] = (state[5] + f) >>> 0;
      state[6] = (state[6] + g) >>> 0;
      state[7] = (state[7] + h) >>> 0;
    }
    return [...state].map((value) => value.toString(16).padStart(8, '0')).join('');
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
    return `ak1:${sha256Hex(JSON.stringify([
      value.text,
      value.languageMode,
      value.semanticVersion,
      value.grammarVersion,
      value.profileRevision,
      value.lexicalVersion
    ]))}`;
  }

  function isAnalysisKey(value) {
    return typeof value === 'string' && ANALYSIS_KEY_PATTERN.test(value);
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
    if (typeof settings.validateAnnotationSet !== 'function') {
      throw new TypeError('validateAnnotationSet: must be a function');
    }
    if (!validVersion(settings.semanticVersion)) throw new TypeError('semanticVersion: is required');
    if (!validVersion(settings.grammarVersion)) throw new TypeError('grammarVersion: is required');
    const now = typeof settings.now === 'function' ? settings.now : () => new Date().toISOString();
    let pageEpoch = settings.initialPageEpoch === undefined ? 1 : settings.initialPageEpoch;
    if (!Number.isSafeInteger(pageEpoch) || pageEpoch < 1) {
      throw new TypeError('initialPageEpoch: must be a positive integer');
    }
    const seenBootstrap = new Set();
    const seenLexical = new Set();
    const completedLexical = new Set();
    const latestRootRevisions = new Map();
    const pendingByRequest = new Map();
    let successfulBootstrap = 0;
    let successfulLexical = 0;

    function executionKey(request) {
      return [request.pageEpoch, request.rootId, request.rootRevision, request.analysisKey].join('\u0000');
    }

    function snapshotRequest(request) {
      if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
      if (!validStableId(request.requestId) || !validStableId(request.rootId) ||
          !Number.isSafeInteger(request.pageEpoch) || request.pageEpoch < 1 ||
          !Number.isSafeInteger(request.rootRevision) || request.rootRevision < 1 ||
          typeof request.text !== 'string' || !request.text || !LANGUAGE_MODES.has(request.languageMode) ||
          !validRevision(request.profileRevision) || !validVersion(request.lexicalVersion) ||
          !isAnalysisKey(request.analysisKey)) return false;
      if (request.generatedAt !== undefined &&
          (typeof request.generatedAt !== 'string' || Number.isNaN(Date.parse(request.generatedAt)))) return false;
      try {
        if (request.analysisKey !== createAnalysisKey({
          text: request.text,
          languageMode: request.languageMode,
          semanticVersion: settings.semanticVersion,
          grammarVersion: settings.grammarVersion,
          profileRevision: request.profileRevision,
          lexicalVersion: request.lexicalVersion
        })) return false;
        return Object.freeze({
          requestId: request.requestId,
          pageEpoch: request.pageEpoch,
          rootId: request.rootId,
          rootRevision: request.rootRevision,
          text: request.text,
          languageMode: request.languageMode,
          profileRevision: request.profileRevision,
          lexicalVersion: request.lexicalVersion,
          analysisKey: request.analysisKey,
          generatedAt: request.generatedAt
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

    function completeLexical(operation, key) {
      completedLexical.add(key);
      for (const values of pendingByRequest.values()) {
        for (const pending of values) {
          if (pending !== operation && pending.phase === 'bootstrap' && pending.key === key) {
            pending.stale = true;
            pending.controller.abort();
          }
        }
      }
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

    async function run(rawRequest, phase) {
      const request = snapshotRequest(rawRequest);
      if (!request) return rejected(rawRequest, 'invalid');
      if (request.pageEpoch !== pageEpoch) return rejected(request, 'stale');
      if (!markLatest(request)) return rejected(request, 'stale');
      const seen = phase === 'bootstrap' ? seenBootstrap : seenLexical;
      const key = executionKey(request);
      if (phase === 'bootstrap' && completedLexical.has(key)) return rejected(request, 'stale');
      if (seen.has(key)) return rejected(request, 'duplicate');
      seen.add(key);
      const operation = {
        request,
        controller: new AbortController(),
        cancelled: false,
        stale: false,
        phase,
        key
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
        if (isStale(operation) || (phase === 'bootstrap' && completedLexical.has(key))) {
          return rejected(request, 'stale');
        }
        if (operation.cancelled || operation.controller.signal.aborted) return rejected(request, 'cancelled');
        if (!validVersion(lexicalVersion) || lexicalVersion !== request.lexicalVersion) {
          return rejected(request, 'invalid');
        }
        const normalizedSet = settings.validateAnnotationSet(annotationSet);
        if (!normalizedSet || normalizedSet.textLength !== request.text.length ||
            normalizedSet.languageMode !== request.languageMode || normalizedSet.generatedAt !== generatedAt) {
          return rejected(request, 'invalid');
        }
        if (phase === 'bootstrap') successfulBootstrap += 1;
        else {
          successfulLexical += 1;
          completeLexical(operation, key);
        }
        return result(request, phase, normalizedSet, lexicalVersion, generatedAt);
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
      completedLexical.clear();
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

  return Object.freeze({ SCHEMA_VERSION, ANALYSIS_KEY_PATTERN, isAnalysisKey, createAnalysisKey, createProgressiveSemanticRuntime });
});
