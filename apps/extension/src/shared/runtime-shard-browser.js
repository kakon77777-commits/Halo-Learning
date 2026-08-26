(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloRuntimeShardBrowser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const MANIFEST_FORMAT = 'halo-browser-lexical-manifest-v1';
  const SHARD_FORMAT = 'halo-browser-lexical-shard-v1';
  const BUILDER = Object.freeze({ id: 'halo-browser-lexical-builder', version: '1.0.0' });
  const ROUTING = Object.freeze({
    en: Object.freeze({ id: 'fnv1a-normalized-surface', version: '1.0.0' }),
    'zh-Hant': Object.freeze({ id: 'fnv1a-first-code-point', version: '1.0.0' })
  });
  const EMPTY_RESULTS = Object.freeze([]);
  const VERIFIED_MANIFESTS = new WeakSet();

  class BrowserShardError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'BrowserShardError';
      this.code = code;
    }
  }

  function fail(code, message) {
    throw new BrowserShardError(code, message);
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }

  function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function bytesFor(value) {
    return new TextEncoder().encode(value);
  }

  function compareUtf8(left, right) {
    const a = bytesFor(String(left));
    const b = bytesFor(String(right));
    const length = Math.min(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      if (a[index] !== b[index]) return a[index] - b[index];
    }
    return a.length - b.length;
  }

  function compareRows(left, right) {
    return compareUtf8(canonicalJson(left), canonicalJson(right));
  }

  function validHash(value) {
    return value && value.algorithm === 'sha256' && /^[a-f0-9]{64}$/.test(value.value || '');
  }

  async function sha256Hex(value, cryptoValue) {
    if (!cryptoValue || !cryptoValue.subtle || typeof cryptoValue.subtle.digest !== 'function') {
      fail('CRYPTO_UNAVAILABLE', 'Web Crypto SHA-256 is unavailable');
    }
    const digest = await cryptoValue.subtle.digest('SHA-256', bytesFor(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function parseDocument(serialized, code, message) {
    try {
      return typeof serialized === 'string' ? JSON.parse(serialized.trim()) : serialized;
    } catch (_error) {
      fail(code, message);
    }
  }

  function profileNow() {
    return root.performance && typeof root.performance.now === 'function'
      ? root.performance.now()
      : Date.now();
  }

  function recordProfileStage(profile, name, started) {
    if (!profile || !profile.stageMs || typeof profile.stageMs !== 'object') return;
    const durationMs = profileNow() - started;
    profile.stageMs[name] = (profile.stageMs[name] || 0) + durationMs;
  }

  function fnv1a(value) {
    let result = 0x811c9dc5;
    for (const byte of bytesFor(value)) {
      result ^= byte;
      result = Math.imul(result, 0x01000193) >>> 0;
    }
    return result;
  }

  function englishBucket(surface, bucketCount) {
    return fnv1a(surface.normalize('NFC').toLocaleLowerCase('en-US')) % bucketCount;
  }

  function chineseBucket(surface, bucketCount) {
    return fnv1a([...surface.normalize('NFC')][0]) % bucketCount;
  }

  function assertCanonical(name, values, comparator) {
    for (let index = 1; index < values.length; index += 1) {
      if (comparator(values[index - 1], values[index]) > 0) {
        fail('NON_CANONICAL_ORDER', `${name} is not canonical`);
      }
    }
  }

  function compareBytes(left, right) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return left.length - right.length;
  }

  function assertCanonicalRows(name, values) {
    if (values.length < 2) return;
    let previous = bytesFor(canonicalJson(values[0]));
    for (let index = 1; index < values.length; index += 1) {
      const current = bytesFor(canonicalJson(values[index]));
      if (compareBytes(previous, current) > 0) {
        fail('NON_CANONICAL_ORDER', `${name} is not canonical`);
      }
      previous = current;
    }
  }

  function validateManifest(raw) {
    if (raw.schemaVersion !== SCHEMA_VERSION || raw.manifestFormat !== MANIFEST_FORMAT ||
        !raw.builder || raw.builder.id !== BUILDER.id || raw.builder.version !== BUILDER.version) {
      fail('MANIFEST_UNSUPPORTED_FORMAT', 'Browser lexical manifest format is unsupported');
    }
    if (!Number.isInteger(raw.bucketCount) || raw.bucketCount < 1 ||
        !Array.isArray(raw.locales) || raw.locales.join(',') !== 'en,zh-Hant' ||
        !raw.routing || canonicalJson(raw.routing) !== canonicalJson(ROUTING) ||
        !raw.sourceIndex || typeof raw.sourceIndex.format !== 'string' || !validHash(raw.sourceIndex.hash) ||
        !Array.isArray(raw.datasets) || raw.datasets.length === 0 || !Array.isArray(raw.shards) ||
        raw.shards.length !== raw.bucketCount * 2 || !raw.statistics ||
        raw.statistics.shardCount !== raw.shards.length) {
      fail('MANIFEST_INVALID', 'Browser lexical manifest metadata is invalid');
    }
    const identities = new Set();
    const paths = new Set();
    const width = String(raw.bucketCount - 1).length;
    for (const [descriptorIndex, descriptor] of raw.shards.entries()) {
      const localeIndex = Math.floor(descriptorIndex / raw.bucketCount);
      const expectedLocale = raw.locales[localeIndex];
      const expectedBucket = descriptorIndex % raw.bucketCount;
      const bucketText = String(expectedBucket).padStart(width, '0');
      const expectedId = `${expectedLocale}-${bucketText}`;
      const expectedPath = `shards/${expectedLocale}/${bucketText}.json`;
      if (!descriptor || typeof descriptor.id !== 'string' || !['en', 'zh-Hant'].includes(descriptor.locale) ||
          !Number.isInteger(descriptor.bucket) || descriptor.bucket < 0 || descriptor.bucket >= raw.bucketCount ||
          descriptor.locale !== expectedLocale || descriptor.bucket !== expectedBucket ||
          descriptor.id !== expectedId || descriptor.path !== expectedPath ||
          !Number.isInteger(descriptor.bytes) || descriptor.bytes < 1 || !validHash(descriptor.hash) ||
          !descriptor.rowCounts || !['lexical', 'morphology', 'glosses'].every((name) =>
            Number.isInteger(descriptor.rowCounts[name]) && descriptor.rowCounts[name] >= 0)) {
        fail('MANIFEST_INVALID', 'Browser lexical shard descriptor is invalid');
      }
      if (identities.has(descriptor.id) || paths.has(descriptor.path)) {
        fail('MANIFEST_INVALID', 'Browser lexical shard descriptor is duplicated');
      }
      identities.add(descriptor.id);
      paths.add(descriptor.path);
    }
    assertCanonical('manifest shards', raw.shards, (left, right) =>
      compareUtf8(left.locale, right.locale) || left.bucket - right.bucket);
  }

  async function loadBrowserLexicalManifest(serialized, options) {
    const profile = options && options.profile;
    let started = profileNow();
    const raw = parseDocument(serialized, 'MANIFEST_INVALID_JSON', 'Browser lexical manifest is not valid JSON');
    recordProfileStage(profile, 'manifestJsonParseMs', started);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !validHash(raw.hash)) {
      fail('MANIFEST_INVALID_HASH', 'Browser lexical manifest hash is malformed');
    }
    const payload = { ...raw };
    delete payload.hash;
    const cryptoValue = options && options.crypto ? options.crypto : root.crypto;
    started = profileNow();
    if (await sha256Hex(canonicalJson(payload), cryptoValue) !== raw.hash.value) {
      fail('MANIFEST_HASH_MISMATCH', 'Browser lexical manifest payload hash does not match');
    }
    recordProfileStage(profile, 'manifestIntegrityMs', started);
    started = profileNow();
    validateManifest(payload);
    if (!validHash(payload.rootHash)) fail('MANIFEST_INVALID_ROOT', 'Browser lexical manifest root is malformed');
    recordProfileStage(profile, 'manifestValidationMs', started);
    const rootPayload = { ...payload };
    delete rootPayload.rootHash;
    delete rootPayload.shards;
    started = profileNow();
    if (await sha256Hex(canonicalJson(rootPayload), cryptoValue) !== payload.rootHash.value) {
      fail('MANIFEST_ROOT_MISMATCH', 'Browser lexical manifest root does not match');
    }
    recordProfileStage(profile, 'manifestIntegrityMs', started);
    started = profileNow();
    const manifest = deepFreeze({ ...payload, hash: { ...raw.hash } });
    recordProfileStage(profile, 'manifestDeepFreezeMs', started);
    VERIFIED_MANIFESTS.add(manifest);
    return manifest;
  }

  function datasetRef(manifest, datasetIndex, recordRef) {
    const dataset = manifest.datasets[datasetIndex];
    return Object.freeze({ datasetId: dataset.datasetId, datasetVersion: dataset.version, recordRef });
  }

  function englishEntry(document, manifest, row) {
    return Object.freeze({
      surface: row[0],
      normalizedSurface: row[0],
      language: 'en',
      lemma: row[1],
      simplifiedPos: row[2],
      posConfidence: row[3],
      lexicalRef: row[4],
      glossRef: row[5],
      gloss: document.glosses[row[6]],
      datasetRef: datasetRef(manifest, row[7], row[4]),
      provenance: Object.freeze([
        `browser-shard:${document.hash.value}`,
        `runtime-index:${manifest.sourceIndex.hash.value}`,
        `dataset:${manifest.datasets[row[7]].datasetId}@${manifest.datasets[row[7]].version}`
      ])
    });
  }

  function chineseEntry(document, manifest, row) {
    return Object.freeze({
      surface: row[0],
      normalizedSurface: row[0],
      language: 'zh-Hant',
      lemma: row[0],
      traditional: row[0],
      simplified: row[1],
      simplifiedPos: row[2],
      posConfidence: row[3],
      lexicalRef: row[4],
      glossRef: row[5],
      gloss: document.glosses[row[6]],
      datasetRef: datasetRef(manifest, row[7], row[4]),
      pinyin: row[8] || null,
      provenance: Object.freeze([
        `browser-shard:${document.hash.value}`,
        `runtime-index:${manifest.sourceIndex.hash.value}`,
        `dataset:${manifest.datasets[row[7]].datasetId}@${manifest.datasets[row[7]].version}`
      ])
    });
  }

  function validateShard(raw, manifest, descriptor) {
    if (raw.schemaVersion !== SCHEMA_VERSION || raw.shardFormat !== SHARD_FORMAT) {
      fail('SHARD_UNSUPPORTED_FORMAT', 'Browser lexical shard format is unsupported');
    }
    if (raw.shardId !== descriptor.id || raw.locale !== descriptor.locale || raw.bucket !== descriptor.bucket ||
        raw.bucketCount !== manifest.bucketCount || canonicalJson(raw.routing) !== canonicalJson(ROUTING[raw.locale]) ||
        canonicalJson(raw.manifestRoot) !== canonicalJson(manifest.rootHash) ||
        !Array.isArray(raw.glosses) || !Array.isArray(raw.lexicalRows) || !Array.isArray(raw.morphologyRows) ||
        !raw.statistics || raw.statistics.lexicalRowCount !== raw.lexicalRows.length ||
        raw.statistics.morphologyRowCount !== raw.morphologyRows.length ||
        raw.statistics.glossCount !== raw.glosses.length) {
      fail('SHARD_INVALID', 'Browser lexical shard metadata is invalid');
    }
    assertCanonical('shard glosses', raw.glosses, compareUtf8);
    assertCanonicalRows('shard lexical rows', raw.lexicalRows);
    assertCanonicalRows('shard morphology rows', raw.morphologyRows);
    for (const [index, row] of raw.lexicalRows.entries()) {
      const expectedLength = raw.locale === 'en' ? 8 : 9;
      if (!Array.isArray(row) || row.length !== expectedLength || typeof row[0] !== 'string' || !row[0] ||
          !Number.isInteger(row[6]) || raw.glosses[row[6]] === undefined ||
          !Number.isInteger(row[7]) || !manifest.datasets[row[7]] ||
          (raw.locale === 'en' ? englishBucket(row[0], raw.bucketCount) : chineseBucket(row[0], raw.bucketCount)) !== raw.bucket) {
        fail('SHARD_INVALID_ROW', `Browser lexical row ${index} is invalid`);
      }
    }
    for (const [index, row] of raw.morphologyRows.entries()) {
      if (raw.locale !== 'en' || !Array.isArray(row) || row.length !== 5 || typeof row[0] !== 'string' || !row[0] ||
          !Number.isInteger(row[3]) || !manifest.datasets[row[3]] || englishBucket(row[0], raw.bucketCount) !== raw.bucket) {
        fail('SHARD_INVALID_ROW', `Browser morphology row ${index} is invalid`);
      }
    }
  }

  function materializeShard(document, manifest) {
    const lexical = new Map();
    const morphology = new Map();
    let maxZhLength = 0;
    for (const row of document.lexicalRows) {
      if (!lexical.has(row[0])) lexical.set(row[0], []);
      lexical.get(row[0]).push(row);
      maxZhLength = Math.max(maxZhLength, row[0].length);
    }
    for (const row of document.morphologyRows) {
      if (!morphology.has(row[0])) morphology.set(row[0], []);
      morphology.get(row[0]).push(row);
    }
    return Object.freeze({
      id: document.shardId,
      locale: document.locale,
      bucket: document.bucket,
      format: document.shardFormat,
      lookup(surface, locale) {
        if (locale !== document.locale || typeof surface !== 'string' || !surface) return EMPTY_RESULTS;
        const key = locale === 'en'
          ? surface.normalize('NFC').toLocaleLowerCase('en-US')
          : surface.normalize('NFC');
        const rows = lexical.get(key);
        if (!rows) return EMPTY_RESULTS;
        return Object.freeze(rows.map((row) => locale === 'en'
          ? englishEntry(document, manifest, row)
          : chineseEntry(document, manifest, row)));
      },
      lookupMorphology(surface, locale) {
        if (locale !== 'en' || document.locale !== 'en' || typeof surface !== 'string' || !surface) return EMPTY_RESULTS;
        const rows = morphology.get(surface.normalize('NFC').toLocaleLowerCase('en-US'));
        return rows ? Object.freeze(rows.map((row) => Object.freeze({
          inflected: row[0],
          lemma: row[1],
          simplifiedPos: row[2],
          datasetRef: datasetRef(manifest, row[3], row[4])
        }))) : EMPTY_RESULTS;
      },
      longestMatch(text, start, locale) {
        if (locale !== 'zh-Hant' || document.locale !== 'zh-Hant' || typeof text !== 'string' ||
            !Number.isInteger(start) || start < 0 || start >= text.length) return null;
        const upper = Math.min(maxZhLength, text.length - start);
        for (let length = upper; length > 0; length -= 1) {
          const surface = text.slice(start, start + length).normalize('NFC');
          const rows = lexical.get(surface);
          if (rows) return Object.freeze({
            surface,
            start,
            end: start + length,
            entries: Object.freeze(rows.map((row) => chineseEntry(document, manifest, row)))
          });
        }
        return null;
      }
    });
  }

  async function loadBrowserLexicalShard(serialized, manifest, options) {
    if (!VERIFIED_MANIFESTS.has(manifest)) throw new TypeError('manifest: must be verified');
    const profile = options && options.profile;
    let started = profileNow();
    const raw = parseDocument(serialized, 'SHARD_INVALID_JSON', 'Browser lexical shard is not valid JSON');
    recordProfileStage(profile, 'shardJsonParseMs', started);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !validHash(raw.hash)) {
      fail('SHARD_INVALID_HASH', 'Browser lexical shard hash is malformed');
    }
    const payload = { ...raw };
    delete payload.hash;
    const cryptoValue = options && options.crypto ? options.crypto : root.crypto;
    started = profileNow();
    const canonicalPayload = canonicalJson(payload);
    recordProfileStage(profile, 'shardCanonicalizeMs', started);
    started = profileNow();
    const actualHash = await sha256Hex(canonicalPayload, cryptoValue);
    recordProfileStage(profile, 'shardSha256Ms', started);
    if (actualHash !== raw.hash.value) fail('SHARD_HASH_MISMATCH', 'Browser lexical shard payload hash does not match');
    const descriptor = manifest.shards.find((value) => value.id === raw.shardId);
    if (!descriptor) fail('SHARD_NOT_DECLARED', 'Browser lexical shard is absent from the manifest');
    started = profileNow();
    const descriptorBytes = bytesFor(canonicalJson(raw)).length;
    recordProfileStage(profile, 'shardDescriptorBytesMs', started);
    if (descriptor.hash.value !== raw.hash.value || descriptor.bytes !== descriptorBytes) {
      fail('SHARD_HASH_MISMATCH', 'Browser lexical shard does not match its manifest descriptor');
    }
    started = profileNow();
    validateShard(payload, manifest, descriptor);
    recordProfileStage(profile, 'shardValidationMs', started);
    started = profileNow();
    const document = deepFreeze({ ...payload, hash: { ...raw.hash } });
    recordProfileStage(profile, 'shardDeepFreezeMs', started);
    started = profileNow();
    const shard = materializeShard(document, manifest);
    recordProfileStage(profile, 'shardMaterializationMs', started);
    return shard;
  }

  function stableFailureCode(error) {
    return error && typeof error.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(error.code)
      ? error.code
      : 'SHARD_LOAD_FAILED';
  }

  function createBrowserLexicalRuntime(options) {
    const settings = options || {};
    const manifest = settings.manifest;
    if (!VERIFIED_MANIFESTS.has(manifest)) throw new TypeError('manifest: must be verified');
    if (typeof settings.readText !== 'function') throw new TypeError('readText: must be a function');
    const maxResidentShards = settings.maxResidentShards === undefined ? 32 : settings.maxResidentShards;
    if (!Number.isInteger(maxResidentShards) || maxResidentShards < 1) {
      throw new TypeError('maxResidentShards: must be a positive integer');
    }
    const now = settings.now || (() => performance.now());
    const descriptors = new Map(manifest.shards.map((value) => [value.id, value]));
    const resident = new Map();
    const pending = new Map();
    const pinCounts = new Map();
    const failureCodes = new Set();

    function recordFailure(error) {
      failureCodes.add(stableFailureCode(error));
    }

    function touch(id) {
      const value = resident.get(id);
      if (value) value.usedAt = now();
    }

    function evict() {
      while (resident.size > maxResidentShards) {
        const candidates = [...resident.entries()].filter(([id]) => !pinCounts.has(id));
        if (!candidates.length) return;
        candidates.sort((left, right) => left[1].usedAt - right[1].usedAt || compareUtf8(left[0], right[0]));
        resident.delete(candidates[0][0]);
      }
    }

    function load(id) {
      if (resident.has(id)) {
        touch(id);
        return Promise.resolve(resident.get(id).shard);
      }
      if (pending.has(id)) return pending.get(id);
      const descriptor = descriptors.get(id);
      if (!descriptor) return Promise.reject(new BrowserShardError('SHARD_NOT_DECLARED', 'Shard ID is absent from manifest'));
      const promise = Promise.resolve()
        .then(() => settings.readText(descriptor.path))
        .then((serialized) => loadBrowserLexicalShard(
          serialized,
          manifest,
          { crypto: settings.crypto || root.crypto, profile: settings.profile }
        ))
        .then((shard) => {
          resident.set(id, { shard, usedAt: now() });
          evict();
          return shard;
        })
        .catch((error) => {
          recordFailure(error);
          throw error;
        })
        .finally(() => pending.delete(id));
      pending.set(id, promise);
      return promise;
    }

    function waitForCaller(promise, signal) {
      if (!signal) return promise;
      if (signal.aborted) return Promise.reject(new BrowserShardError('ABORTED', 'Shard wait was aborted'));
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          callback(value);
        };
        const onAbort = () => finish(reject, new BrowserShardError('ABORTED', 'Shard wait was aborted'));
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
          (value) => finish(resolve, value),
          (error) => finish(reject, error)
        );
      });
    }

    function requiredShardIds(texts, languageMode) {
      if (!Array.isArray(texts) || !['en', 'zh', 'zh-Hant', 'both'].includes(languageMode)) return EMPTY_RESULTS;
      const ids = new Set();
      for (const text of texts) {
        if (typeof text !== 'string') continue;
        if (languageMode === 'en' || languageMode === 'both') {
          for (const match of text.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu)) {
            if (!/\p{Script=Latin}/u.test(match[0])) continue;
            const bucket = englishBucket(match[0], manifest.bucketCount);
            const descriptor = manifest.shards.find((value) => value.locale === 'en' && value.bucket === bucket);
            if (descriptor) ids.add(descriptor.id);
          }
        }
        if (languageMode === 'zh' || languageMode === 'zh-Hant' || languageMode === 'both') {
          for (const character of text) {
            if (!/\p{Script=Han}/u.test(character)) continue;
            const bucket = chineseBucket(character, manifest.bucketCount);
            const descriptor = manifest.shards.find((value) => value.locale === 'zh-Hant' && value.bucket === bucket);
            if (descriptor) ids.add(descriptor.id);
          }
        }
      }
      return Object.freeze([...ids].sort(compareUtf8));
    }

    function ensureShards(ids, loadOptions) {
      const signal = loadOptions && loadOptions.signal;
      if (!Array.isArray(ids)) return Promise.reject(new TypeError('ids: must be an array'));
      if (signal && signal.aborted) {
        return Promise.reject(new BrowserShardError('ABORTED', 'Shard wait was aborted'));
      }
      const unique = [...new Set(ids)];
      if (unique.length > maxResidentShards) {
        return Promise.reject(new BrowserShardError(
          'SHARD_SET_EXCEEDS_CACHE_LIMIT',
          'Required shard set exceeds the resident cache limit'
        ));
      }
      return Promise.all(unique.map((id) => waitForCaller(load(id), signal)))
        .then((values) => Object.freeze(values));
    }

    function withPinnedShards(ids, callback) {
      if (!Array.isArray(ids) || typeof callback !== 'function') throw new TypeError('ids and callback are required');
      const unique = [...new Set(ids)];
      if (unique.length > maxResidentShards) {
        throw new BrowserShardError('SHARD_SET_EXCEEDS_CACHE_LIMIT', 'Pinned shard set exceeds the cache limit');
      }
      const shards = unique.map((id) => {
        const value = resident.get(id);
        if (!value) throw new BrowserShardError('SHARD_NOT_RESIDENT', 'Required shard is not resident');
        return value.shard;
      });
      for (const id of unique) {
        pinCounts.set(id, (pinCounts.get(id) || 0) + 1);
        touch(id);
      }
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        for (const id of unique) {
          const next = (pinCounts.get(id) || 1) - 1;
          if (next > 0) pinCounts.set(id, next);
          else pinCounts.delete(id);
        }
        evict();
      };
      try {
        const result = callback(Object.freeze(shards));
        if (result && typeof result.then === 'function') return result.finally(release);
        release();
        return result;
      } catch (error) {
        release();
        throw error;
      }
    }

    async function withEnsuredShards(ids, loadOptions, callback) {
      if (!Array.isArray(ids) || typeof callback !== 'function') {
        throw new TypeError('ids and callback are required');
      }
      const signal = loadOptions && loadOptions.signal;
      if (signal && signal.aborted) throw new BrowserShardError('ABORTED', 'Shard wait was aborted');
      const unique = [...new Set(ids)];
      if (unique.length > maxResidentShards) {
        throw new BrowserShardError('SHARD_SET_EXCEEDS_CACHE_LIMIT', 'Pinned shard set exceeds the cache limit');
      }
      for (const id of unique) {
        if (!descriptors.has(id)) throw new BrowserShardError('SHARD_NOT_DECLARED', 'Shard ID is absent from manifest');
      }
      for (const id of unique) pinCounts.set(id, (pinCounts.get(id) || 0) + 1);
      try {
        const shards = await Promise.all(unique.map((id) => waitForCaller(load(id), signal)));
        for (const id of unique) touch(id);
        return await callback(Object.freeze(shards));
      } finally {
        for (const id of unique) {
          const next = (pinCounts.get(id) || 1) - 1;
          if (next > 0) pinCounts.set(id, next);
          else pinCounts.delete(id);
        }
        evict();
      }
    }

    function status() {
      return deepFreeze({
        manifestFormat: MANIFEST_FORMAT,
        shardFormat: SHARD_FORMAT,
        builderVersion: BUILDER.version,
        bucketCount: manifest.bucketCount,
        descriptorCount: manifest.shards.length,
        residentCount: resident.size,
        pendingCount: pending.size,
        pinnedCount: pinCounts.size,
        maxResidentShards,
        failures: [...failureCodes].sort(compareUtf8).map((code) => ({ code }))
      });
    }

    function clearMemoryCache() {
      let cleared = 0;
      for (const id of [...resident.keys()]) {
        if (!pinCounts.has(id)) {
          resident.delete(id);
          cleared += 1;
        }
      }
      return cleared;
    }

    return Object.freeze({
      requiredShardIds,
      ensureShards,
      withPinnedShards,
      withEnsuredShards,
      status,
      clearMemoryCache
    });
  }

  return Object.freeze({
    SCHEMA_VERSION,
    MANIFEST_FORMAT,
    SHARD_FORMAT,
    BUILDER,
    ROUTING,
    BrowserShardError,
    loadBrowserLexicalManifest,
    loadBrowserLexicalShard,
    createBrowserLexicalRuntime
  });
});
