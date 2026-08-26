from pathlib import Path


def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return source.replace(old, new, 1)


runtime_path = Path('apps/extension/src/shared/runtime-shard-browser.js')
source = runtime_path.read_text(encoding='utf-8')
if 'function recordProfileStage(profile, name, started)' not in source:
    old = """  function parseDocument(serialized, code, message) {
    try {
      return typeof serialized === 'string' ? JSON.parse(serialized.trim()) : serialized;
    } catch (_error) {
      fail(code, message);
    }
  }
"""
    new = old + """
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
"""
    source = replace_once(source, old, new, 'profiling helper')

    old = """  async function loadBrowserLexicalManifest(serialized, options) {
    const raw = parseDocument(serialized, 'MANIFEST_INVALID_JSON', 'Browser lexical manifest is not valid JSON');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !validHash(raw.hash)) {
      fail('MANIFEST_INVALID_HASH', 'Browser lexical manifest hash is malformed');
    }
    const payload = { ...raw };
    delete payload.hash;
    const cryptoValue = options && options.crypto ? options.crypto : root.crypto;
    if (await sha256Hex(canonicalJson(payload), cryptoValue) !== raw.hash.value) {
      fail('MANIFEST_HASH_MISMATCH', 'Browser lexical manifest payload hash does not match');
    }
    validateManifest(payload);
    if (!validHash(payload.rootHash)) fail('MANIFEST_INVALID_ROOT', 'Browser lexical manifest root is malformed');
    const rootPayload = { ...payload };
    delete rootPayload.rootHash;
    delete rootPayload.shards;
    if (await sha256Hex(canonicalJson(rootPayload), cryptoValue) !== payload.rootHash.value) {
      fail('MANIFEST_ROOT_MISMATCH', 'Browser lexical manifest root does not match');
    }
    const manifest = deepFreeze({ ...payload, hash: { ...raw.hash } });
    VERIFIED_MANIFESTS.add(manifest);
    return manifest;
  }
"""
    new = """  async function loadBrowserLexicalManifest(serialized, options) {
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
"""
    source = replace_once(source, old, new, 'manifest profiling')

    old = """  async function loadBrowserLexicalShard(serialized, manifest, options) {
    if (!VERIFIED_MANIFESTS.has(manifest)) throw new TypeError('manifest: must be verified');
    const raw = parseDocument(serialized, 'SHARD_INVALID_JSON', 'Browser lexical shard is not valid JSON');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !validHash(raw.hash)) {
      fail('SHARD_INVALID_HASH', 'Browser lexical shard hash is malformed');
    }
    const payload = { ...raw };
    delete payload.hash;
    const cryptoValue = options && options.crypto ? options.crypto : root.crypto;
    const actualHash = await sha256Hex(canonicalJson(payload), cryptoValue);
    if (actualHash !== raw.hash.value) fail('SHARD_HASH_MISMATCH', 'Browser lexical shard payload hash does not match');
    const descriptor = manifest.shards.find((value) => value.id === raw.shardId);
    if (!descriptor) fail('SHARD_NOT_DECLARED', 'Browser lexical shard is absent from the manifest');
    if (descriptor.hash.value !== raw.hash.value || descriptor.bytes !== bytesFor(canonicalJson(raw)).length) {
      fail('SHARD_HASH_MISMATCH', 'Browser lexical shard does not match its manifest descriptor');
    }
    validateShard(payload, manifest, descriptor);
    return materializeShard(deepFreeze({ ...payload, hash: { ...raw.hash } }), manifest);
  }
"""
    new = """  async function loadBrowserLexicalShard(serialized, manifest, options) {
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
"""
    source = replace_once(source, old, new, 'shard profiling')

    old = """        .then((serialized) => loadBrowserLexicalShard(
          serialized,
          manifest,
          { crypto: settings.crypto || root.crypto }
        ))
"""
    new = """        .then((serialized) => loadBrowserLexicalShard(
          serialized,
          manifest,
          { crypto: settings.crypto || root.crypto, profile: settings.profile }
        ))
"""
    source = replace_once(source, old, new, 'runtime profile forwarding')
    runtime_path.write_text(source, encoding='utf-8', newline='\n')

profiler_path = Path('scripts/profile-browser-runtime.js')
profiler = profiler_path.read_text(encoding='utf-8')
if 'measurements.coldRequiredShardsP95Ms <= SHARD_COMPARISON_BUDGETS.coldRequiredShardsP95Ms' not in profiler:
    profiler = replace_once(
        profiler,
        'measurements.coldRequiredShardsP95Ms < SHARD_COMPARISON_BUDGETS.coldRequiredShardsP95Ms',
        'measurements.coldRequiredShardsP95Ms <= SHARD_COMPARISON_BUDGETS.coldRequiredShardsP95Ms',
        'cold inclusive gate'
    )
    profiler = replace_once(
        profiler,
        'measurements.warmLookupP95Ms < SHARD_COMPARISON_BUDGETS.warmLookupP95Ms',
        'measurements.warmLookupP95Ms <= SHARD_COMPARISON_BUDGETS.warmLookupP95Ms',
        'warm inclusive gate'
    )
    profiler = replace_once(
        profiler,
        'measurements.longTaskMaxMs < SHARD_COMPARISON_BUDGETS.longTaskMaxMs',
        'measurements.longTaskMaxMs <= SHARD_COMPARISON_BUDGETS.longTaskMaxMs',
        'long-task inclusive gate'
    )
    profiler_path.write_text(profiler, encoding='utf-8', newline='\n')
