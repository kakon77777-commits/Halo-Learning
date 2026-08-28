(function (root, factory) {
  const schemaModule = typeof module === 'object' && module.exports ? require('./dogfood-storage-schema') : root.HaloDogfoodStorageSchema;
  const contractsModule = typeof module === 'object' && module.exports ? require('./dogfood-contracts') : root.HaloDogfoodContracts;
  const api = factory(root, schemaModule, contractsModule);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDogfoodStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Schema, Contracts) {
  'use strict';

  const DEFAULT_PREFERENCES = Object.freeze({
    key: 'dogfood.preferences', schemaVersion: 1, captureEnabled: true,
    retention: Object.freeze({ passiveDays: 30, ordinaryDays: 90, explicitDays: null, dogfoodNoteDays: null })
  });
  const EXPORT_STORE_NAMES = Object.freeze(['events', 'sources', 'sentences', 'profiles', 'analyses', 'settings']);
  const DAY_MS = 86400000;

  const cloneJson = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }
  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
      transaction.onerror = () => {};
    });
  }
  async function withTransaction(database, stores, mode, callback) {
    const transaction = database.transaction(stores, mode);
    const done = transactionDone(transaction);
    try {
      const result = await callback(transaction);
      await done;
      return result;
    } catch (error) {
      try { transaction.abort(); } catch (_ignored) {}
      try { await done; } catch (_ignored) {}
      throw error;
    }
  }
  function stableText(value, name, maximum = 512) {
    if (typeof value !== 'string' || !value || value.length > maximum) throw new TypeError(`${name}: bounded string required`);
    return value;
  }
  function isoNow(now) {
    const value = Number(now());
    if (!Number.isFinite(value)) throw new TypeError('now: finite milliseconds required');
    return new Date(value).toISOString();
  }
  function cacheKeyFor(textHash, contextHash, algorithmVersion) {
    const input = `${stableText(textHash, 'textHash')}\n${stableText(contextHash, 'contextHash')}\n${stableText(algorithmVersion, 'algorithmVersion', 256)}`;
    const encoder = typeof root.TextEncoder === 'function' ? new root.TextEncoder() : null;
    if (!encoder) throw new TypeError('TextEncoder: required');
    let hash = 0xcbf29ce484222325n;
    for (const byte of encoder.encode(input)) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
    return `cache:${hash.toString(16).padStart(16, '0')}`;
  }
  function serializeEventsJsonl(events) {
    if (!Array.isArray(events)) throw new TypeError('events: array required');
    return events.length ? `${events.map((value) => JSON.stringify(Contracts.normalizeLearningEvent(value))).join('\n')}\n` : '';
  }
  async function initializePreferences(database) {
    return withTransaction(database, ['settings'], 'readwrite', async (tx) => {
      const store = tx.objectStore('settings');
      if (await requestPromise(store.get(DEFAULT_PREFERENCES.key)) === undefined) store.add(cloneJson(DEFAULT_PREFERENCES));
    });
  }
  function openDatabase(indexedDBApi, databaseName, databaseVersion, now) {
    return new Promise((resolve, reject) => {
      const request = indexedDBApi.open(databaseName, databaseVersion);
      request.onupgradeneeded = (event) => {
        try {
          Schema.applyUpgrade({ database: request.result, transaction: request.transaction, oldVersion: event.oldVersion, newVersion: event.newVersion, now });
        } catch (error) {
          try { request.transaction.abort(); } catch (_ignored) {}
          reject(error);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
  }

  function openHaloDogfoodStore(options) {
    const settings = options || {};
    const indexedDBApi = settings.indexedDB;
    if (!indexedDBApi || typeof indexedDBApi.open !== 'function') return Promise.reject(new TypeError('indexedDB: required'));
    const databaseName = typeof settings.databaseName === 'string' && settings.databaseName ? settings.databaseName : Schema.DATABASE_NAME;
    const databaseVersion = settings.databaseVersion === undefined ? Schema.DATABASE_VERSION : settings.databaseVersion;
    if (!Number.isInteger(databaseVersion) || databaseVersion < 1) return Promise.reject(new TypeError('databaseVersion: positive integer required'));
    const now = typeof settings.now === 'function' ? settings.now : () => Date.now();

    return openDatabase(indexedDBApi, databaseName, databaseVersion, now).then(async (database) => {
      await initializePreferences(database);
      let closed = false;
      const ensureOpen = () => { if (closed) throw new Error('dogfood store is closed'); };
      const boundedLimit = (value) => {
        const limit = value === undefined ? 100 : Number(value);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('limit: integer between 1 and 100 required');
        return limit;
      };

      function schemaStatus() {
        ensureOpen();
        return Object.freeze({ databaseName: database.name, databaseVersion: database.version, storeNames: Object.freeze(Array.from(database.objectStoreNames)) });
      }
      async function getSetting(key) {
        ensureOpen(); stableText(key, 'setting key', 256);
        return withTransaction(database, ['settings'], 'readonly', async (tx) => {
          const value = await requestPromise(tx.objectStore('settings').get(key));
          return value === undefined ? null : cloneJson(value);
        });
      }
      async function putSetting(value) {
        ensureOpen();
        if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.key !== 'string' || !value.key) throw new TypeError('setting: canonical keyed object required');
        return withTransaction(database, ['settings'], 'readwrite', async (tx) => { tx.objectStore('settings').put(cloneJson(value)); return cloneJson(value); });
      }
      async function appendEvent(value) {
        ensureOpen();
        const event = Contracts.normalizeLearningEvent(value);
        return withTransaction(database, ['events'], 'readwrite', async (tx) => {
          const store = tx.objectStore('events');
          if (await requestPromise(store.get(event.eventId)) !== undefined) return Object.freeze({ status: 'duplicate', eventId: event.eventId });
          store.add(cloneJson(event));
          return Object.freeze({ status: 'inserted', eventId: event.eventId });
        });
      }
      async function putSource(value) {
        ensureOpen();
        const source = Contracts.normalizeSourceRef(value);
        return withTransaction(database, ['sources'], 'readwrite', async (tx) => {
          const store = tx.objectStore('sources');
          const existing = await requestPromise(store.get(source.sourceId));
          if (existing !== undefined) {
            const current = Contracts.normalizeSourceRef(existing);
            for (const name of ['domain', 'normalizedPathHash', 'pathNormalizationVersion', 'language']) if (current[name] !== source[name]) throw new Error('SourceRef identity conflict');
            if (current.fullUrl && source.fullUrl && current.fullUrl !== source.fullUrl) throw new Error('SourceRef full URL conflict');
            if (current.fullUrl && !source.fullUrl) return current;
          }
          store.put(cloneJson(source)); return source;
        });
      }
      async function putSentence(value) {
        ensureOpen();
        const sentence = Contracts.normalizeSentenceRecord(value);
        return withTransaction(database, ['sentences'], 'readwrite', async (tx) => {
          const store = tx.objectStore('sentences');
          const existing = await requestPromise(store.get(sentence.sentenceId));
          if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(sentence)) throw new Error('SentenceRecord identity conflict');
          if (existing === undefined) store.add(cloneJson(sentence));
          return sentence;
        });
      }
      async function getSentence(sentenceId) {
        ensureOpen(); stableText(sentenceId, 'sentenceId', 256);
        return withTransaction(database, ['sentences'], 'readonly', async (tx) => {
          const value = await requestPromise(tx.objectStore('sentences').get(sentenceId));
          return value === undefined ? null : Contracts.normalizeSentenceRecord(value);
        });
      }
      async function getEvent(eventId) {
        ensureOpen(); stableText(eventId, 'eventId', 256);
        return withTransaction(database, ['events'], 'readonly', async (tx) => {
          const value = await requestPromise(tx.objectStore('events').get(eventId));
          return value === undefined ? null : Contracts.normalizeLearningEvent(value);
        });
      }
      async function putProfileSnapshot(value) {
        ensureOpen();
        if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.profileKey !== 'string' || !value.profileKey) throw new TypeError('profile snapshot: profileKey required');
        return withTransaction(database, ['profiles'], 'readwrite', async (tx) => {
          const store = tx.objectStore('profiles'); const existing = await requestPromise(store.get(value.profileKey));
          if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(value)) throw new Error('Profile snapshot conflict');
          if (existing === undefined) store.add(cloneJson(value)); return cloneJson(value);
        });
      }
      async function putAnalysis(value) {
        ensureOpen();
        if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.analysisId !== 'string' || !value.analysisId) throw new TypeError('analysis: analysisId required');
        return withTransaction(database, ['analyses'], 'readwrite', async (tx) => { tx.objectStore('analyses').put(cloneJson(value)); return cloneJson(value); });
      }
      async function putCache(value) {
        ensureOpen();
        const entry = Contracts.normalizeAnalysisCacheEntry(value);
        if (entry.cacheKey !== cacheKeyFor(entry.textHash, entry.contextHash, entry.algorithmVersion)) throw new TypeError('cacheKey does not match text/context/algorithm identity');
        return withTransaction(database, ['cache'], 'readwrite', async (tx) => { tx.objectStore('cache').put(cloneJson(entry)); return entry; });
      }
      async function getCache(request) {
        ensureOpen();
        const raw = request || {}; const key = cacheKeyFor(raw.textHash, raw.contextHash, raw.algorithmVersion);
        return withTransaction(database, ['cache'], 'readwrite', async (tx) => {
          const store = tx.objectStore('cache'); const value = await requestPromise(store.get(key));
          if (value === undefined) return null;
          const entry = Contracts.normalizeAnalysisCacheEntry(value);
          if (entry.textHash !== raw.textHash || entry.contextHash !== raw.contextHash || entry.algorithmVersion !== raw.algorithmVersion) return null;
          if (Date.parse(entry.expiresAt) <= Number(now())) { store.delete(key); return null; }
          return entry;
        });
      }
      async function queryEvents(options) {
        ensureOpen(); const raw = options || {}; const limit = boundedLimit(raw.limit);
        return withTransaction(database, ['events'], 'readonly', async (tx) => {
          const before = raw.before == null ? null : String(raw.before);
          const items = (await requestPromise(tx.objectStore('events').getAll())).map(Contracts.normalizeLearningEvent)
            .filter((value) => !before || value.timestamp < before)
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.eventId.localeCompare(a.eventId)).slice(0, limit);
          return Object.freeze({ items: Object.freeze(items), next: items.length === limit ? items[items.length - 1].timestamp : null });
        });
      }
      async function querySources(options) {
        ensureOpen(); const limit = boundedLimit(options && options.limit);
        return withTransaction(database, ['sources'], 'readonly', async (tx) => Object.freeze((await requestPromise(tx.objectStore('sources').getAll()))
          .map(Contracts.normalizeSourceRef).sort((a, b) => a.domain.localeCompare(b.domain)).slice(0, limit)));
      }
      async function querySentences(options) {
        ensureOpen(); const limit = boundedLimit(options && options.limit);
        return withTransaction(database, ['sentences'], 'readonly', async (tx) => Object.freeze((await requestPromise(tx.objectStore('sentences').getAll()))
          .map(Contracts.normalizeSentenceRecord).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, limit)));
      }
      async function readReplayDataset() {
        ensureOpen();
        return withTransaction(database, EXPORT_STORE_NAMES, 'readonly', async (tx) => {
          const [events, sources, sentences, profiles, analyses, settingsValues] = await Promise.all(EXPORT_STORE_NAMES.map((name) => requestPromise(tx.objectStore(name).getAll())));
          return Object.freeze({
            events: Object.freeze(events.map(Contracts.normalizeLearningEvent).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.eventId.localeCompare(b.eventId))),
            sources: Object.freeze(sources.map(Contracts.normalizeSourceRef).sort((a, b) => a.sourceId.localeCompare(b.sourceId))),
            sentences: Object.freeze(sentences.map(Contracts.normalizeSentenceRecord).sort((a, b) => a.sentenceId.localeCompare(b.sentenceId))),
            profiles: Object.freeze(profiles.map(cloneJson).sort((a, b) => String(a.profileKey).localeCompare(String(b.profileKey)))),
            analyses: Object.freeze(analyses.map(cloneJson).sort((a, b) => String(a.analysisId).localeCompare(String(b.analysisId)))),
            settings: Object.freeze(settingsValues.map(cloneJson).sort((a, b) => String(a.key).localeCompare(String(b.key))))
          });
        });
      }
      async function exportBundle() {
        const data = await readReplayDataset();
        return Contracts.normalizeExportBundle({ schema: 'ExportBundle/v1', exportedAt: isoNow(now), ...data });
      }
      async function exportEventsJsonl() {
        const data = await readReplayDataset();
        return serializeEventsJsonl(data.events);
      }
      async function importBundleIntoEmptyStore(value) {
        ensureOpen();
        const bundle = Contracts.normalizeExportBundle(value);
        return withTransaction(database, EXPORT_STORE_NAMES, 'readwrite', async (tx) => {
          const existing = {};
          for (const name of EXPORT_STORE_NAMES) existing[name] = await requestPromise(tx.objectStore(name).getAll());
          for (const name of ['events', 'sources', 'sentences', 'profiles', 'analyses']) {
            if (existing[name].length) throw new Error('import target is not empty');
          }
          if (existing.settings.some((entry) => entry.key !== DEFAULT_PREFERENCES.key || JSON.stringify(entry) !== JSON.stringify(DEFAULT_PREFERENCES))) {
            throw new Error('import target settings are not empty');
          }
          for (const name of EXPORT_STORE_NAMES) tx.objectStore(name).clear();
          for (const item of bundle.events) tx.objectStore('events').add(cloneJson(item));
          for (const item of bundle.sources) tx.objectStore('sources').add(cloneJson(item));
          for (const item of bundle.sentences) tx.objectStore('sentences').add(cloneJson(item));
          for (const item of bundle.profiles) tx.objectStore('profiles').add(cloneJson(item));
          for (const item of bundle.analyses) tx.objectStore('analyses').add(cloneJson(item));
          for (const item of bundle.settings) tx.objectStore('settings').add(cloneJson(item));
          return Object.freeze({ imported: Object.freeze(Object.fromEntries(EXPORT_STORE_NAMES.map((name) => [name, bundle[name].length]))) });
        });
      }

      async function garbageCollectAttachments(tx, survivingEvents) {
        const sourcesStore = tx.objectStore('sources'); const sentencesStore = tx.objectStore('sentences'); const analysesStore = tx.objectStore('analyses');
        const [sources, sentences, analyses] = await Promise.all([requestPromise(sourcesStore.getAll()), requestPromise(sentencesStore.getAll()), requestPromise(analysesStore.getAll())]);
        const sentenceRefs = new Set(survivingEvents.map((value) => value.sentenceRef).filter(Boolean));
        const sourceRefs = new Set(survivingEvents.map((value) => value.sourceRef).filter(Boolean));
        let deletedSentences = 0; let deletedAnalyses = 0; let deletedSources = 0;
        for (const raw of sentences) {
          const sentence = Contracts.normalizeSentenceRecord(raw);
          if (!sentenceRefs.has(sentence.sentenceId)) { sentencesStore.delete(sentence.sentenceId); deletedSentences += 1; }
          else sourceRefs.add(sentence.sourceRef);
        }
        for (const analysis of analyses) {
          const keep = (analysis.sourceRef && sourceRefs.has(analysis.sourceRef)) || (analysis.sentenceRef && sentenceRefs.has(analysis.sentenceRef));
          if (!keep) { analysesStore.delete(analysis.analysisId); deletedAnalyses += 1; }
          else if (analysis.sourceRef) sourceRefs.add(analysis.sourceRef);
        }
        for (const raw of sources) {
          const source = Contracts.normalizeSourceRef(raw);
          if (!sourceRefs.has(source.sourceId)) { sourcesStore.delete(source.sourceId); deletedSources += 1; }
        }
        return Object.freeze({ sources: deletedSources, sentences: deletedSentences, analyses: deletedAnalyses });
      }

      async function deleteByScope(scopeValue) {
        ensureOpen();
        const scope = scopeValue && typeof scopeValue === 'object' && !Array.isArray(scopeValue) ? cloneJson(scopeValue) : null;
        if (!scope || !['domain', 'time-range', 'all-dogfood'].includes(scope.kind)) throw new TypeError('delete scope: unsupported');
        let from = null; let to = null; let domain = null;
        if (scope.kind === 'domain') domain = stableText(scope.domain, 'delete scope domain', 253).toLowerCase();
        if (scope.kind === 'time-range') {
          from = stableText(scope.from, 'delete scope from', 64); to = stableText(scope.to, 'delete scope to', 64);
          if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || from > to) throw new TypeError('delete scope time range: invalid');
        }
        return withTransaction(database, ['events', 'sources', 'sentences', 'analyses'], 'readwrite', async (tx) => {
          const eventsStore = tx.objectStore('events'); const sourcesStore = tx.objectStore('sources');
          const events = (await requestPromise(eventsStore.getAll())).map(Contracts.normalizeLearningEvent);
          const sources = (await requestPromise(sourcesStore.getAll())).map(Contracts.normalizeSourceRef);
          const domainSources = new Set(domain === null ? [] : sources.filter((value) => value.domain === domain).map((value) => value.sourceId));
          const remove = (event) => scope.kind === 'all-dogfood' || (scope.kind === 'domain' && domainSources.has(event.sourceRef)) ||
            (scope.kind === 'time-range' && event.timestamp >= from && event.timestamp <= to);
          const surviving = []; let deletedEvents = 0;
          for (const event of events) {
            if (remove(event)) { eventsStore.delete(event.eventId); deletedEvents += 1; } else surviving.push(event);
          }
          const attachments = await garbageCollectAttachments(tx, surviving);
          return Contracts.normalizeDeleteReceipt({
            schema: 'DeleteReceipt/v1', scope, deleted: { events: deletedEvents, ...attachments }, completedAt: isoNow(now), success: true
          });
        });
      }
      async function clearAnalysisCache() {
        ensureOpen();
        return withTransaction(database, ['cache'], 'readwrite', async (tx) => {
          const store = tx.objectStore('cache'); const count = (await requestPromise(store.getAllKeys())).length; store.clear(); return count;
        });
      }
      async function pruneRetention() {
        ensureOpen();
        return withTransaction(database, ['events', 'sources', 'sentences', 'analyses', 'cache', 'settings'], 'readwrite', async (tx) => {
          const eventsStore = tx.objectStore('events'); const cacheStore = tx.objectStore('cache');
          const preferences = (await requestPromise(tx.objectStore('settings').get(DEFAULT_PREFERENCES.key))) || cloneJson(DEFAULT_PREFERENCES);
          const events = (await requestPromise(eventsStore.getAll())).map(Contracts.normalizeLearningEvent);
          const currentTime = Number(now()); if (!Number.isFinite(currentTime)) throw new TypeError('now: finite milliseconds required');
          const retention = preferences.retention || DEFAULT_PREFERENCES.retention;
          const cutoff = (days) => days == null ? null : currentTime - Number(days) * DAY_MS;
          const cutoffs = { passive: cutoff(retention.passiveDays), ordinary: cutoff(retention.ordinaryDays), 'explicit-learning': cutoff(retention.explicitDays), 'dogfood-note': cutoff(retention.dogfoodNoteDays) };
          const surviving = []; let deletedEvents = 0;
          for (const event of events) {
            const threshold = cutoffs[event.interactionClass];
            if (threshold !== null && Date.parse(event.timestamp) < threshold) { eventsStore.delete(event.eventId); deletedEvents += 1; } else surviving.push(event);
          }
          const attachments = await garbageCollectAttachments(tx, surviving);
          const cache = await requestPromise(cacheStore.getAll()); let deletedCache = 0;
          for (const raw of cache) {
            const entry = Contracts.normalizeAnalysisCacheEntry(raw);
            if (Date.parse(entry.expiresAt) <= currentTime) { cacheStore.delete(entry.cacheKey); deletedCache += 1; }
          }
          return Object.freeze({ deleted: Object.freeze({ events: deletedEvents, ...attachments, cache: deletedCache }), surviving: Object.freeze({ events: surviving.length }) });
        });
      }
      async function estimateUsage() { return Object.freeze({ bytes: JSON.stringify(await readReplayDataset()).length }); }
      function close() { if (closed) return false; closed = true; database.close(); return true; }

      return Object.freeze({
        schemaStatus, appendEvent, getEvent, putSource, putSentence, getSentence, putProfileSnapshot, putAnalysis,
        getSetting, putSetting, putCache, getCache, queryEvents, querySources, querySentences, readReplayDataset,
        exportBundle, exportEventsJsonl, importBundleIntoEmptyStore, deleteByScope, clearAnalysisCache,
        pruneRetention, estimateUsage, close
      });
    });
  }

  return Object.freeze({ DEFAULT_PREFERENCES, EXPORT_STORE_NAMES, cacheKeyFor, serializeEventsJsonl, openHaloDogfoodStore });
});
