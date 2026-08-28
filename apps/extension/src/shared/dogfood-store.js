(function (root, factory) {
  const schemaModule = typeof module === 'object' && module.exports
    ? require('./dogfood-storage-schema')
    : root.HaloDogfoodStorageSchema;
  const contractsModule = typeof module === 'object' && module.exports
    ? require('./dogfood-contracts')
    : root.HaloDogfoodContracts;
  const api = factory(root, schemaModule, contractsModule);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDogfoodStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Schema, Contracts) {
  'use strict';

  const DEFAULT_PREFERENCES = Object.freeze({
    key: 'dogfood.preferences',
    schemaVersion: 1,
    captureEnabled: true,
    retention: Object.freeze({ passiveDays: 30, ordinaryDays: 90, explicitDays: null, dogfoodNoteDays: null })
  });
  const DAY_MS = 24 * 60 * 60 * 1000;

  function cloneJson(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

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

  function cacheKeyFor(textHash, contextHash, algorithmVersion) {
    const input = `${stableText(textHash, 'textHash')}\n${stableText(contextHash, 'contextHash')}\n${stableText(algorithmVersion, 'algorithmVersion', 256)}`;
    const encoder = typeof root.TextEncoder === 'function' ? new root.TextEncoder() : null;
    if (!encoder) throw new TypeError('TextEncoder: required');
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const mask = 0xffffffffffffffffn;
    for (const byte of encoder.encode(input)) {
      hash ^= BigInt(byte);
      hash = (hash * prime) & mask;
    }
    return `cache:${hash.toString(16).padStart(16, '0')}`;
  }

  async function initializePreferences(database) {
    return withTransaction(database, ['settings'], 'readwrite', async (transaction) => {
      const store = transaction.objectStore('settings');
      const existing = await requestPromise(store.get(DEFAULT_PREFERENCES.key));
      if (existing === undefined) store.add(cloneJson(DEFAULT_PREFERENCES));
    });
  }

  async function openDatabase(indexedDBApi, databaseName, databaseVersion, now) {
    return new Promise((resolve, reject) => {
      const request = indexedDBApi.open(databaseName, databaseVersion);
      request.onupgradeneeded = (event) => {
        try {
          Schema.applyUpgrade({
            database: request.result,
            transaction: request.transaction,
            oldVersion: event.oldVersion,
            newVersion: event.newVersion,
            now
          });
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
    if (!indexedDBApi || typeof indexedDBApi.open !== 'function') {
      return Promise.reject(new TypeError('indexedDB: required'));
    }
    const databaseName = typeof settings.databaseName === 'string' && settings.databaseName
      ? settings.databaseName
      : Schema.DATABASE_NAME;
    const databaseVersion = settings.databaseVersion === undefined ? Schema.DATABASE_VERSION : settings.databaseVersion;
    if (!Number.isInteger(databaseVersion) || databaseVersion < 1) {
      return Promise.reject(new TypeError('databaseVersion: positive integer required'));
    }
    const now = typeof settings.now === 'function' ? settings.now : () => Date.now();

    return openDatabase(indexedDBApi, databaseName, databaseVersion, now).then(async (database) => {
      await initializePreferences(database);
      let closed = false;

      function ensureOpen() {
        if (closed) throw new Error('dogfood store is closed');
      }

      function schemaStatus() {
        ensureOpen();
        return Object.freeze({
          databaseName: database.name,
          databaseVersion: database.version,
          storeNames: Object.freeze(Array.from(database.objectStoreNames))
        });
      }

      async function getSetting(key) {
        ensureOpen();
        stableText(key, 'setting key', 256);
        return withTransaction(database, ['settings'], 'readonly', async (transaction) => {
          const result = await requestPromise(transaction.objectStore('settings').get(key));
          return result === undefined ? null : cloneJson(result);
        });
      }

      async function putSetting(value) {
        ensureOpen();
        if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.key !== 'string' || !value.key) {
          throw new TypeError('setting: canonical keyed object required');
        }
        return withTransaction(database, ['settings'], 'readwrite', async (transaction) => {
          transaction.objectStore('settings').put(cloneJson(value));
          return cloneJson(value);
        });
      }

      async function appendEvent(value) {
        ensureOpen();
        const event = Contracts.normalizeLearningEvent(value);
        return withTransaction(database, ['events'], 'readwrite', async (transaction) => {
          const store = transaction.objectStore('events');
          const existing = await requestPromise(store.get(event.eventId));
          if (existing !== undefined) return Object.freeze({ status: 'duplicate', eventId: event.eventId });
          store.add(cloneJson(event));
          return Object.freeze({ status: 'inserted', eventId: event.eventId });
        });
      }

      async function putSource(value) {
        ensureOpen();
        const source = Contracts.normalizeSourceRef(value);
        return withTransaction(database, ['sources'], 'readwrite', async (transaction) => {
          const store = transaction.objectStore('sources');
          const existing = await requestPromise(store.get(source.sourceId));
          if (existing !== undefined) {
            const current = Contracts.normalizeSourceRef(existing);
            for (const name of ['domain', 'normalizedPathHash', 'pathNormalizationVersion', 'language']) {
              if (current[name] !== source[name]) throw new Error('SourceRef identity conflict');
            }
            if (current.fullUrl && source.fullUrl && current.fullUrl !== source.fullUrl) throw new Error('SourceRef full URL conflict');
            if (current.fullUrl && !source.fullUrl) return current;
          }
          store.put(cloneJson(source));
          return source;
        });
      }

      async function putSentence(value) {
        ensureOpen();
        const sentence = Contracts.normalizeSentenceRecord(value);
        return withTransaction(database, ['sentences'], 'readwrite', async (transaction) => {
          const store = transaction.objectStore('sentences');
          const existing = await requestPromise(store.get(sentence.sentenceId));
          if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(sentence)) {
            throw new Error('SentenceRecord identity conflict');
          }
          if (existing === undefined) store.add(cloneJson(sentence));
          return sentence;
        });
      }

      async function putProfileSnapshot(value) {
        ensureOpen();
        if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.profileKey !== 'string' || !value.profileKey) {
          throw new TypeError('profile snapshot: profileKey required');
        }
        return withTransaction(database, ['profiles'], 'readwrite', async (transaction) => {
          const store = transaction.objectStore('profiles');
          const existing = await requestPromise(store.get(value.profileKey));
          if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(value)) throw new Error('Profile snapshot conflict');
          if (existing === undefined) store.add(cloneJson(value));
          return cloneJson(value);
        });
      }

      async function putAnalysis(value) {
        ensureOpen();
        if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.analysisId !== 'string' || !value.analysisId) {
          throw new TypeError('analysis: analysisId required');
        }
        return withTransaction(database, ['analyses'], 'readwrite', async (transaction) => {
          transaction.objectStore('analyses').put(cloneJson(value));
          return cloneJson(value);
        });
      }

      async function putCache(value) {
        ensureOpen();
        const entry = Contracts.normalizeAnalysisCacheEntry(value);
        const expected = cacheKeyFor(entry.textHash, entry.contextHash, entry.algorithmVersion);
        if (entry.cacheKey !== expected) throw new TypeError('cacheKey does not match text/context/algorithm identity');
        return withTransaction(database, ['cache'], 'readwrite', async (transaction) => {
          transaction.objectStore('cache').put(cloneJson(entry));
          return entry;
        });
      }

      async function getCache(request) {
        ensureOpen();
        const raw = request || {};
        const key = cacheKeyFor(raw.textHash, raw.contextHash, raw.algorithmVersion);
        return withTransaction(database, ['cache'], 'readwrite', async (transaction) => {
          const store = transaction.objectStore('cache');
          const value = await requestPromise(store.get(key));
          if (value === undefined) return null;
          const entry = Contracts.normalizeAnalysisCacheEntry(value);
          if (entry.textHash !== raw.textHash || entry.contextHash !== raw.contextHash || entry.algorithmVersion !== raw.algorithmVersion) return null;
          if (Date.parse(entry.expiresAt) <= Number(now())) {
            store.delete(key);
            return null;
          }
          return entry;
        });
      }

      function boundedLimit(value) {
        const limit = value === undefined ? 100 : Number(value);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('limit: integer between 1 and 100 required');
        return limit;
      }

      async function queryEvents(options) {
        ensureOpen();
        const raw = options || {};
        const limit = boundedLimit(raw.limit);
        return withTransaction(database, ['events'], 'readonly', async (transaction) => {
          const all = await requestPromise(transaction.objectStore('events').getAll());
          const before = raw.before === undefined || raw.before === null ? null : String(raw.before);
          const items = all
            .map((value) => Contracts.normalizeLearningEvent(value))
            .filter((value) => !before || value.timestamp < before)
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.eventId.localeCompare(a.eventId))
            .slice(0, limit);
          return Object.freeze({
            items: Object.freeze(items),
            next: items.length === limit ? items[items.length - 1].timestamp : null
          });
        });
      }

      async function querySources(options) {
        ensureOpen();
        const limit = boundedLimit(options && options.limit);
        return withTransaction(database, ['sources'], 'readonly', async (transaction) => {
          const all = await requestPromise(transaction.objectStore('sources').getAll());
          return Object.freeze(all.map((value) => Contracts.normalizeSourceRef(value)).sort((a, b) => a.domain.localeCompare(b.domain)).slice(0, limit));
        });
      }

      async function querySentences(options) {
        ensureOpen();
        const limit = boundedLimit(options && options.limit);
        return withTransaction(database, ['sentences'], 'readonly', async (transaction) => {
          const all = await requestPromise(transaction.objectStore('sentences').getAll());
          return Object.freeze(all.map((value) => Contracts.normalizeSentenceRecord(value)).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, limit));
        });
      }

      async function readReplayDataset() {
        ensureOpen();
        const stores = ['events', 'sources', 'sentences', 'profiles', 'analyses', 'settings'];
        return withTransaction(database, stores, 'readonly', async (transaction) => {
          const [events, sources, sentences, profiles, analyses, settingsValues] = await Promise.all(stores.map((name) => requestPromise(transaction.objectStore(name).getAll())));
          return Object.freeze({
            events: Object.freeze(events.map((value) => Contracts.normalizeLearningEvent(value)).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.eventId.localeCompare(b.eventId))),
            sources: Object.freeze(sources.map((value) => Contracts.normalizeSourceRef(value)).sort((a, b) => a.sourceId.localeCompare(b.sourceId))),
            sentences: Object.freeze(sentences.map((value) => Contracts.normalizeSentenceRecord(value)).sort((a, b) => a.sentenceId.localeCompare(b.sentenceId))),
            profiles: Object.freeze(profiles.map(cloneJson).sort((a, b) => String(a.profileKey).localeCompare(String(b.profileKey)))),
            analyses: Object.freeze(analyses.map(cloneJson).sort((a, b) => String(a.analysisId).localeCompare(String(b.analysisId)))),
            settings: Object.freeze(settingsValues.map(cloneJson).sort((a, b) => String(a.key).localeCompare(String(b.key))))
          });
        });
      }

      async function pruneRetention() {
        ensureOpen();
        const storeNames = ['events', 'sources', 'sentences', 'analyses', 'cache', 'settings'];
        return withTransaction(database, storeNames, 'readwrite', async (transaction) => {
          const eventsStore = transaction.objectStore('events');
          const sourcesStore = transaction.objectStore('sources');
          const sentencesStore = transaction.objectStore('sentences');
          const analysesStore = transaction.objectStore('analyses');
          const cacheStore = transaction.objectStore('cache');
          const preferences = (await requestPromise(transaction.objectStore('settings').get('dogfood.preferences'))) || cloneJson(DEFAULT_PREFERENCES);
          const [events, sources, sentences, analyses, cache] = await Promise.all([
            requestPromise(eventsStore.getAll()),
            requestPromise(sourcesStore.getAll()),
            requestPromise(sentencesStore.getAll()),
            requestPromise(analysesStore.getAll()),
            requestPromise(cacheStore.getAll())
          ]);
          const currentTime = Number(now());
          if (!Number.isFinite(currentTime)) throw new TypeError('now: finite milliseconds required');
          const retention = preferences.retention || DEFAULT_PREFERENCES.retention;
          const cutoffFor = (days) => days === null || days === undefined ? null : currentTime - Number(days) * DAY_MS;
          const cutoffs = {
            passive: cutoffFor(retention.passiveDays),
            ordinary: cutoffFor(retention.ordinaryDays),
            'explicit-learning': cutoffFor(retention.explicitDays),
            'dogfood-note': cutoffFor(retention.dogfoodNoteDays)
          };
          const surviving = [];
          let deletedEvents = 0;
          for (const rawEvent of events) {
            const event = Contracts.normalizeLearningEvent(rawEvent);
            const cutoff = cutoffs[event.interactionClass];
            if (cutoff !== null && Date.parse(event.timestamp) < cutoff) {
              eventsStore.delete(event.eventId);
              deletedEvents += 1;
            } else surviving.push(event);
          }

          const referencedSentenceIds = new Set(surviving.map((value) => value.sentenceRef).filter(Boolean));
          const referencedSourceIds = new Set(surviving.map((value) => value.sourceRef).filter(Boolean));
          let deletedSentences = 0;
          const survivingSentences = [];
          for (const rawSentence of sentences) {
            const sentence = Contracts.normalizeSentenceRecord(rawSentence);
            if (!referencedSentenceIds.has(sentence.sentenceId)) {
              sentencesStore.delete(sentence.sentenceId);
              deletedSentences += 1;
            } else {
              survivingSentences.push(sentence);
              referencedSourceIds.add(sentence.sourceRef);
            }
          }

          let deletedAnalyses = 0;
          const survivingAnalyses = [];
          for (const analysis of analyses) {
            const keep = (analysis.sourceRef && referencedSourceIds.has(analysis.sourceRef)) ||
              (analysis.sentenceRef && referencedSentenceIds.has(analysis.sentenceRef));
            if (!keep) {
              analysesStore.delete(analysis.analysisId);
              deletedAnalyses += 1;
            } else {
              survivingAnalyses.push(analysis);
              if (analysis.sourceRef) referencedSourceIds.add(analysis.sourceRef);
            }
          }

          let deletedSources = 0;
          for (const rawSource of sources) {
            const source = Contracts.normalizeSourceRef(rawSource);
            if (!referencedSourceIds.has(source.sourceId)) {
              sourcesStore.delete(source.sourceId);
              deletedSources += 1;
            }
          }

          let deletedCache = 0;
          for (const rawEntry of cache) {
            const entry = Contracts.normalizeAnalysisCacheEntry(rawEntry);
            if (Date.parse(entry.expiresAt) <= currentTime) {
              cacheStore.delete(entry.cacheKey);
              deletedCache += 1;
            }
          }

          return Object.freeze({
            deleted: Object.freeze({
              events: deletedEvents,
              sources: deletedSources,
              sentences: deletedSentences,
              analyses: deletedAnalyses,
              cache: deletedCache
            }),
            surviving: Object.freeze({
              events: surviving.length,
              sentences: survivingSentences.length,
              analyses: survivingAnalyses.length
            })
          });
        });
      }

      async function estimateUsage() {
        const dataset = await readReplayDataset();
        return Object.freeze({ bytes: JSON.stringify(dataset).length });
      }

      function close() {
        if (closed) return false;
        closed = true;
        database.close();
        return true;
      }

      return Object.freeze({
        schemaStatus,
        appendEvent,
        putSource,
        putSentence,
        putProfileSnapshot,
        putAnalysis,
        getSetting,
        putSetting,
        putCache,
        getCache,
        queryEvents,
        querySources,
        querySentences,
        readReplayDataset,
        pruneRetention,
        estimateUsage,
        close
      });
    });
  }

  return Object.freeze({
    DEFAULT_PREFERENCES,
    cacheKeyFor,
    openHaloDogfoodStore
  });
});
