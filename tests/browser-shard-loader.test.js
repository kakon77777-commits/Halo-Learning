'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Shards = require('../packages/lexical-index/browser-lexical-shards');
const BrowserLoader = require('../apps/extension/src/shared/runtime-shard-browser');
const { canonicalJson, sha256Hex } = require('../packages/lexical-data/shared/build-utils');

const ENTRIES = Object.freeze([
  Object.freeze({
    locale: 'en',
    row: Object.freeze(['model', 'model', 'n', 1, 'en:model', 'gloss:model', 0, 0]),
    gloss: 'a representation'
  }),
  Object.freeze({
    locale: 'zh-Hant',
    row: Object.freeze(['學習', '学习', 'v', 0.8, 'zh:學習', 'gloss:學習', 0, 1, 'xue2 xi2']),
    gloss: 'to learn'
  })
]);

function artifacts() {
  return Shards.buildBrowserLexicalArtifacts(ENTRIES, {
    bucketCount: 64,
    builtAt: '2026-08-25T00:00:00.000Z',
    sourceIndex: {
      format: 'halo-runtime-lexical-index-v1',
      hash: { algorithm: 'sha256', value: 'b'.repeat(64) }
    },
    datasets: [
      { datasetId: 'fixture-en', version: '1', locale: 'en' },
      { datasetId: 'fixture-zh', version: '1', locale: 'zh-Hant' }
    ],
    morphologyRows: [['models', 'model', 'n', 0, 'noun.exc:models']]
  });
}

async function runtimeFixture(options) {
  const settings = options || {};
  const built = artifacts();
  const manifest = await BrowserLoader.loadBrowserLexicalManifest(built.serializedManifest);
  const reads = [];
  const runtime = BrowserLoader.createBrowserLexicalRuntime({
    manifest,
    maxResidentShards: settings.maxResidentShards || 32,
    now: settings.now,
    readText: async (resourcePath) => {
      reads.push(resourcePath);
      const serialized = built.serializedShards[resourcePath];
      if (settings.corruptPath === resourcePath) {
        return serialized.replace('"schemaVersion":1', '"schemaVersion":2');
      }
      return serialized;
    }
  });
  return { built, manifest, reads, runtime };
}

function rehashManifest(raw) {
  const payload = { ...raw };
  delete payload.hash;
  return canonicalJson({
    ...payload,
    hash: { algorithm: 'sha256', value: sha256Hex(canonicalJson(payload)) }
  });
}

test('a verified manifest routes and loads only the requested shard', async () => {
  const fixture = await runtimeFixture();
  const ids = fixture.runtime.requiredShardIds(['The model learns.'], 'en');
  await fixture.runtime.ensureShards(ids);

  assert.ok(fixture.reads.length > 0);
  assert.ok(fixture.reads.every((resourcePath) => resourcePath.includes('/en/')));
  assert.equal(fixture.runtime.status().residentCount, ids.length);
});

test('manifest validation requires the exact locale/bucket grid and canonical safe descriptor paths', async () => {
  const mutations = [
    (manifest) => {
      manifest.shards[0] = {
        ...manifest.shards[0], bucket: 1, id: 'en-extra', path: 'shards/en/extra.json'
      };
    },
    (manifest) => { manifest.shards[0].id = 'en-wrong'; },
    (manifest) => { manifest.shards[0].path = 'shards/en/../zh-Hant/00.json'; }
  ];
  for (const mutate of mutations) {
    const raw = JSON.parse(artifacts().serializedManifest);
    mutate(raw);
    await assert.rejects(
      () => BrowserLoader.loadBrowserLexicalManifest(rehashManifest(raw)),
      { code: 'MANIFEST_INVALID' }
    );
  }
});

test('runtime creation rejects format-shaped manifests that did not cross the verified loader boundary', async () => {
  const fixture = await runtimeFixture();
  assert.throws(() => BrowserLoader.createBrowserLexicalRuntime({
    manifest: { ...fixture.manifest },
    readText: async () => ''
  }), /manifest: must be verified/);
});

test('shard hash verification precedes schema validation and rejected promises are retriable', async () => {
  const built = artifacts();
  const manifest = await BrowserLoader.loadBrowserLexicalManifest(built.serializedManifest);
  const descriptor = manifest.shards.find((value) => value.locale === 'en' && value.rowCounts.lexical > 0);
  let reads = 0;
  const runtime = BrowserLoader.createBrowserLexicalRuntime({
    manifest,
    readText: async () => {
      reads += 1;
      return built.serializedShards[descriptor.path].replace('"schemaVersion":1', '"schemaVersion":2');
    }
  });

  await assert.rejects(() => runtime.ensureShards([descriptor.id]), { code: 'SHARD_HASH_MISMATCH' });
  await assert.rejects(() => runtime.ensureShards([descriptor.id]), { code: 'SHARD_HASH_MISMATCH' });
  assert.equal(reads, 2);
  assert.deepEqual(runtime.status().failures, [{ code: 'SHARD_HASH_MISMATCH' }]);
});

test('bounded LRU evicts unpinned shards but preserves a shard pinned by an active callback', async () => {
  let clock = 0;
  const fixture = await runtimeFixture({ maxResidentShards: 1, now: () => ++clock });
  const first = fixture.manifest.shards[0];
  const second = fixture.manifest.shards[1];
  await fixture.runtime.ensureShards([first.id]);

  await fixture.runtime.withPinnedShards([first.id], async (pinned) => {
    assert.equal(pinned[0].id, first.id);
    await fixture.runtime.ensureShards([second.id]);
    assert.equal(fixture.runtime.status().pinnedCount, 1);
    assert.equal(fixture.runtime.status().residentCount, 1);
    assert.equal(fixture.runtime.withPinnedShards([first.id], (again) => again[0].id), first.id);
  });

  assert.equal(fixture.runtime.status().pinnedCount, 0);
  assert.equal(fixture.runtime.status().residentCount, 1);
});

test('atomic ensure-and-pin survives concurrent disjoint loads at the cache boundary', async () => {
  const built = artifacts();
  const manifest = await BrowserLoader.loadBrowserLexicalManifest(built.serializedManifest);
  const descriptors = manifest.shards.slice(0, 2);
  const releases = new Map();
  const callbackReleases = [];
  const entered = [];
  const runtime = BrowserLoader.createBrowserLexicalRuntime({
    manifest,
    maxResidentShards: 1,
    readText: (resourcePath) => new Promise((resolve) => {
      releases.set(resourcePath, () => resolve(built.serializedShards[resourcePath]));
    })
  });
  const run = (descriptor) => runtime.withEnsuredShards(
    [descriptor.id],
    {},
    async (pinned) => {
      entered.push(pinned[0].id);
      await new Promise((resolve) => callbackReleases.push(resolve));
      return pinned[0].id;
    }
  );

  const first = run(descriptors[0]);
  const second = run(descriptors[1]);
  while (releases.size < 2) await new Promise((resolve) => setImmediate(resolve));
  for (const descriptor of descriptors) releases.get(descriptor.path)();
  while (entered.length < 2) await new Promise((resolve) => setImmediate(resolve));

  assert.equal(runtime.status().pinnedCount, 2);
  assert.equal(runtime.status().residentCount, 2);
  callbackReleases.splice(0).forEach((release) => release());
  assert.deepEqual(await Promise.all([first, second]), descriptors.map((value) => value.id));
  assert.equal(runtime.status().pinnedCount, 0);
  assert.equal(runtime.status().residentCount, 1);
});

test('pin acquisition is atomic when any requested shard is absent', async () => {
  const fixture = await runtimeFixture();
  const first = fixture.manifest.shards[0];
  await fixture.runtime.ensureShards([first.id]);

  assert.throws(
    () => fixture.runtime.withPinnedShards([first.id, 'missing-shard'], () => null),
    { code: 'SHARD_NOT_RESIDENT' }
  );
  assert.equal(fixture.runtime.status().pinnedCount, 0);
});

test('oversized required shard sets fail before reads or partial cache churn', async () => {
  const fixture = await runtimeFixture({ maxResidentShards: 1 });
  const ids = fixture.manifest.shards.slice(0, 2).map((descriptor) => descriptor.id);

  await assert.rejects(
    () => fixture.runtime.ensureShards(ids),
    { code: 'SHARD_SET_EXCEEDS_CACHE_LIMIT' }
  );
  assert.equal(fixture.reads.length, 0);
  assert.equal(fixture.runtime.status().residentCount, 0);
  assert.equal(fixture.runtime.status().pendingCount, 0);
});

test('deduplicated transport keeps each waiter cancellation independent', async () => {
  const built = artifacts();
  const manifest = await BrowserLoader.loadBrowserLexicalManifest(built.serializedManifest);
  const descriptor = manifest.shards[0];
  let reads = 0;
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const runtime = BrowserLoader.createBrowserLexicalRuntime({
    manifest,
    readText: async () => {
      reads += 1;
      await firstGate;
      return built.serializedShards[descriptor.path];
    }
  });
  const firstAbort = new AbortController();
  const first = runtime.ensureShards([descriptor.id], { signal: firstAbort.signal });
  const second = runtime.ensureShards([descriptor.id]);
  firstAbort.abort();
  releaseFirst();
  await assert.rejects(() => first, { code: 'ABORTED' });
  assert.equal((await second)[0].id, descriptor.id);
  assert.equal(reads, 1);

  runtime.clearMemoryCache();
  let releaseSecond;
  const secondGate = new Promise((resolve) => { releaseSecond = resolve; });
  let secondReads = 0;
  const laterRuntime = BrowserLoader.createBrowserLexicalRuntime({
    manifest,
    readText: async () => {
      secondReads += 1;
      await secondGate;
      return built.serializedShards[descriptor.path];
    }
  });
  const shared = laterRuntime.ensureShards([descriptor.id]);
  const laterAbort = new AbortController();
  const later = laterRuntime.ensureShards([descriptor.id], { signal: laterAbort.signal });
  laterAbort.abort();
  releaseSecond();
  await assert.rejects(() => later, { code: 'ABORTED' });
  assert.equal((await shared)[0].id, descriptor.id);
  assert.equal(secondReads, 1);
});

test('a pre-aborted caller starts no transport and leaves no delayed cache or rejection side effects', async () => {
  const built = artifacts();
  const manifest = await BrowserLoader.loadBrowserLexicalManifest(built.serializedManifest);
  const descriptor = manifest.shards[0];
  const controller = new AbortController();
  const unhandled = [];
  let reads = 0;
  const onUnhandled = (error) => { unhandled.push(error); };
  const runtime = BrowserLoader.createBrowserLexicalRuntime({
    manifest,
    readText: async () => {
      reads += 1;
      throw new Error('pre-aborted transport must not start');
    }
  });
  process.on('unhandledRejection', onUnhandled);
  try {
    controller.abort();
    await assert.rejects(
      () => runtime.ensureShards([descriptor.id], { signal: controller.signal }),
      { code: 'ABORTED' }
    );
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reads, 0);
    assert.equal(runtime.status().pendingCount, 0);
    assert.equal(runtime.status().residentCount, 0);
    assert.deepEqual(unhandled, []);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

test('unsupported language modes route no shards and status exposes no resource paths or content', async () => {
  const fixture = await runtimeFixture();
  assert.deepEqual(fixture.runtime.requiredShardIds(['modèle 學習'], 'fr'), []);
  assert.equal(JSON.stringify(fixture.runtime.status()).includes('shards/'), false);
  assert.equal(JSON.stringify(fixture.runtime.status()).includes('model'), false);
});
