# Halo Learning v0.4.0 Browser Runtime & UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build a production-like, local-first Manifest V3 runtime that progressively annotates only viewport-relevant English and Traditional-Chinese content, remains reversible and accessible across dynamic sites, and produces honest real-Chromium release evidence.

**Architecture:** Keep SemanticToken and AnnotationSet canonical, but replace whole-index startup with a verified manifest plus deterministic lazy shards and bootstrap-first enrichment. Split DOM work into sentence mapping, viewport scheduling, mutation lifecycle, rendering, triggers, policy, and accessibility modules; orchestrate them from the content script under bounded budgets and cancellation.

**Tech Stack:** Node.js >=22, dependency-free CommonJS/UMD runtime modules, Chrome/Chromium Manifest V3, Web Crypto, Intl.Segmenter with deterministic fallback, Playwright 1.62.1 for real-browser evidence, node:test, deterministic JSON/ZIP release scripts.

**Spec:** docs/superpowers/specs/2026-08-25-browser-runtime-ux-v0.4.0-design.md

## Global Constraints

- Base exactly on GitHub main commit 046c6f629a32614b68573196da9200adb4c1a20f plus the committed v0.4.0 design.
- Work only on branch workbench/v0.4.0-browser-runtime.
- Local-first: basic and enriched semantic runtime cannot require a remote service.
- Provider-agnostic: no OpenAI, Gemini, Anthropic, spaCy, or single-provider semantics in core modules.
- Preserve page text -> SemanticToken / AnnotationSet -> MarkingProfile -> RenderPlan -> reversible DOM artifact.
- Rendered CSS, color, position, wrapper state, and interaction state never write back to semantic truth.
- Apply/Remove restores source text and reasonable DOM structure; Apply twice never double-wraps.
- POS color is secondary and always has a non-color carrier.
- English and Traditional Chinese are the only v0.4.0 language scope.
- Never read password values, form values, cookies, tokens, browsing history, hidden account state, or private message content.
- Sensitive pages fail closed before sentence extraction or semantic requests.
- No Halo Story, learner-event store, mastery projector, gap planner, remote AI, cloud sync, login, billing, mobile app, teacher backend, own-model training, or new language.
- Every new behavior follows RED -> GREEN -> REFACTOR with the expected RED observed before production code.
- Node-only measurements never substitute for required Chromium evidence.
- A missing browser, failed lifecycle gate, missing fixture, or blocking performance failure yields partial or blocked, never completed.
- Development validation requires Git; standalone validation must pass without .git and must not invoke Git.
- Stop after the v0.4.0 release report; do not start v0.5.0.

## Baseline record

- Branch creation base: 046c6f629a32614b68573196da9200adb4c1a20f.
- Design commit: 36281034a15aa53c01a49e844a3a068a6fd8a7c2.
- Unmodified full suite: 142/142 PASS.
- Unmodified development validator: PASS with 142 passed and 0 failed.
- Legacy lexical index: 48,544,255 on-disk bytes.
- Legacy Node diagnostic: about 5,594 ms verify/freeze/materialize and about 636 MB RSS after load.
- These Node values are diagnostic only. Task 1 creates the required Chromium baseline.

## File responsibility map

| Path | Responsibility |
| --- | --- |
| packages/lexical-index/browser-lexical-shards.js | Deterministic shard routing, building, canonical serialization, and Node verification |
| scripts/build-browser-lexical-runtime.js | Corpus-to-browser-shard orchestration and atomic write/verify modes |
| apps/extension/src/shared/runtime-shard-browser.js | Browser manifest/shard integrity validation and per-shard map materialization |
| apps/extension/src/shared/sharded-dictionary-provider.js | Synchronous provider view over the verified shards pinned for one batch |
| apps/extension/src/shared/progressive-runtime.js | Bootstrap/enrichment revisions, analysis keys, cancellation, and stale-result rejection |
| apps/extension/src/shared/sentence-pipeline.js | TextRun extraction, segmentation, language detection, and token-to-node-fragment mapping |
| apps/extension/src/shared/runtime-scheduler.js | Time/character/node/sentence/token/shard budgets, priority, cancellation, and backpressure |
| apps/extension/src/shared/dynamic-dom-controller.js | Mutation coalescing, Halo-owned suppression, route epoch, and cleanup |
| apps/extension/src/shared/reversible-renderer.js | Idempotent node-local wrapping, atomic reconciliation, removal, and Shadow DOM panel |
| apps/extension/src/shared/trigger-controller.js | adaptive-hover, explicit-only, hybrid, dismissal, and explicit priority state machine |
| apps/extension/src/shared/site-policy.js | URL/attribute/user-denylist fail-closed policy without private value reads |
| apps/extension/src/content.js | Thin browser orchestrator wiring the focused runtime modules |
| apps/extension/src/service-worker.js | Shard cache, enrichment message protocol, context menu/command entry, and lifecycle diagnostics |
| tests/browser/helpers/extension-harness.js | Real Chromium persistent-context extension harness |
| tests/browser/helpers/fixture-server.js | Deterministic loopback HTTP fixture server |
| fixtures/browser/ | Twenty browser fixture classes and matrix metadata |
| scripts/profile-browser-runtime.js | Legacy/candidate cold/warm browser profiling and evidence writer |
| scripts/validate-v0.4.0.js | Progress-reporting development/standalone validator |
| scripts/package-v0.4.0.js | Deterministic extension and source release packaging |

---

### Task 1: V040-01 Real-Chromium profiling baseline

**Files:**
- Modify: package.json
- Create: package-lock.json
- Create: tests/browser/helpers/extension-harness.js
- Create: tests/browser/helpers/fixture-server.js
- Create: tests/browser-harness.test.js
- Create: scripts/profile-browser-runtime.js
- Create after a successful run: docs/validation/v0.4.0-browser-baseline.json

**Interfaces:**
- Consumes: dist/halo-learning-magic-hand-v0.3.0.zip and the v0.3.0 extension runtime.
- Produces: resolveChromiumExecutable(options), launchExtension(options), withFixtureServer(fixtures, callback), profileLegacyRuntime(options), and BrowserRuntimeProfile/v1 evidence.

- [ ] **Step 1: Write failing harness-resolution tests**

~~~javascript
const test = require('node:test');
const assert = require('node:assert/strict');

test('explicit Chromium path has priority and must be executable', () => {
  const Harness = require('./browser/helpers/extension-harness');
  const result = Harness.resolveChromiumExecutable({
    environment: { HALO_CHROMIUM_EXECUTABLE: '/fixture/chromium' },
    exists: (value) => value === '/fixture/chromium',
    playwrightExecutable: '/managed/chromium'
  });
  assert.equal(result.path, '/fixture/chromium');
  assert.equal(result.source, 'environment');
});

test('missing Chromium fails explicitly instead of skipping browser gates', () => {
  const Harness = require('./browser/helpers/extension-harness');
  assert.throws(() => Harness.resolveChromiumExecutable({
    environment: {},
    exists: () => false,
    playwrightExecutable: '/missing/chromium'
  }), /Chromium executable is required/);
});
~~~

- [ ] **Step 2: Run the focused test and confirm RED**

Run: node --test tests/browser-harness.test.js

Expected: FAIL with MODULE_NOT_FOUND for tests/browser/helpers/extension-harness.js.

- [ ] **Step 3: Add the pinned browser dependency and minimal harness**

Add exact package metadata:

~~~json
{
  "devDependencies": {
    "playwright": "1.62.1"
  },
  "scripts": {
    "browser:install": "playwright install chromium",
    "test:browser": "node --test tests/browser/*.e2e.test.js",
    "profile:browser": "node scripts/profile-browser-runtime.js --write"
  }
}
~~~

Implement these exact exports:

~~~javascript
function resolveChromiumExecutable(options) {
  const explicit = options.environment.HALO_CHROMIUM_EXECUTABLE;
  if (explicit && options.exists(explicit)) {
    return Object.freeze({ path: explicit, source: 'environment' });
  }
  if (options.playwrightExecutable && options.exists(options.playwrightExecutable)) {
    return Object.freeze({ path: options.playwrightExecutable, source: 'playwright' });
  }
  throw new Error('Chromium executable is required for Halo browser gates');
}

async function launchExtension({ extensionRoot, userDataDir, headless, executablePath }) {
  return chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless,
    args: [
      '--disable-extensions-except=' + extensionRoot,
      '--load-extension=' + extensionRoot,
      '--enable-precise-memory-info',
      '--no-sandbox'
    ]
  });
}
~~~

The fixture server binds to 127.0.0.1 on an ephemeral port, refuses path
traversal, returns explicit UTF-8 content types, and always closes in finally.

- [ ] **Step 4: Run unit tests and install the browser**

Run: node --test tests/browser-harness.test.js

Expected: PASS.

Run: npm install --ignore-scripts

Expected: package-lock.json pins Playwright 1.62.1 and install exits 0.

Run: npm run browser:install

Expected: a Chromium executable is installed. If environment policy blocks the
download, record the exact blocker and do not mark browser work complete.

- [ ] **Step 5: Write the legacy Chromium profiler**

The profiler must unzip the v0.3.0 extension into a temporary directory, launch
it, open an extension-origin page, and capture separate stages:

~~~javascript
const REQUIRED_METRICS = Object.freeze([
  'compressedBytes',
  'uncompressedBytes',
  'fetchMs',
  'jsonParseMs',
  'sha256Ms',
  'integrityValidationMs',
  'deepFreezeMs',
  'englishMapMs',
  'chineseMapMs',
  'morphologyMapMs',
  'firstAnnotationMs',
  'warmAnnotationMs',
  'heapPeakBytes',
  'serviceWorkerRestart'
]);

function assertCompleteMeasurements(measurements) {
  for (const name of REQUIRED_METRICS) {
    if (measurements[name] === undefined) {
      throw new Error('browser baseline measurement is missing: ' + name);
    }
  }
  return measurements;
}
~~~

Run at least five cold browser contexts and twenty warm annotations. Record
browser version, OS, CPU/memory class, fixture text, condition, index hash, and
raw samples. Unsupported reliable memory APIs produce the string unknown.

- [ ] **Step 6: Generate and verify fresh baseline evidence**

Run: npm run profile:browser

Expected: docs/validation/v0.4.0-browser-baseline.json is written with
schemaVersion 1, condition-separated samples, actual Chromium version, legacy
hash f2a63b7b5af3673a7faea6acaed53776cb94bcf4146949d965a37b76003fca21,
and no missing required field.

Run: node scripts/profile-browser-runtime.js --verify

Expected: deterministic evidence schema/invariants verify; volatile timing
values are range-checked rather than regenerated byte-for-byte.

- [ ] **Step 7: Run regression and commit**

Run: node --test tests/*.test.js

Expected: 142 existing tests plus new focused tests all PASS.

Run: git diff --check

Expected: no output and exit 0.

Commit:

~~~bash
git add package.json package-lock.json tests/browser tests/browser-harness.test.js scripts/profile-browser-runtime.js docs/validation/v0.4.0-browser-baseline.json
git commit -m "test: establish v0.4 Chromium runtime baseline"
~~~

---

### Task 2: V040-02 Deterministic lexical shards and benchmarked format selection

**Files:**
- Create: packages/lexical-index/browser-lexical-shards.js
- Create: apps/extension/src/shared/runtime-shard-browser.js
- Create: apps/extension/src/shared/sharded-dictionary-provider.js
- Create: scripts/build-browser-lexical-runtime.js
- Create: tests/browser-lexical-shards.test.js
- Create: tests/browser-shard-loader.test.js
- Create: tests/sharded-dictionary-provider.test.js
- Create: docs/adr/ADR-009-browser-lexical-sharding.md
- Create generated tree: apps/extension/data/lexical-v0.4.0/
- Create generated manifests: dist/lexical-v0.4.0/
- Modify: scripts/profile-browser-runtime.js

**Interfaces:**
- Consumes: verified corpus importers, RuntimeLexicalIndex/v1 evidence, BrowserRuntimeProfile/v1.
- Produces: routeEnglishSurface(surface, bucketCount), routeChineseSurface(surface, bucketCount), buildBrowserLexicalArtifacts(entries, options), serializeBrowserLexicalManifest(manifest), serializeBrowserLexicalShard(shard), loadBrowserLexicalManifest(serialized, options), loadBrowserLexicalShard(serialized, manifest, options), createShardedDictionaryProvider(options).

- [ ] **Step 1: Write RED routing and deterministic-build tests**

~~~javascript
test('routing is deterministic, normalized, and language-specific', () => {
  const Shards = require('../packages/lexical-index/browser-lexical-shards');
  assert.equal(Shards.routeEnglishSurface('Models', 64), Shards.routeEnglishSurface('models', 64));
  assert.equal(Shards.routeChineseSurface('學習', 64), Shards.routeChineseSurface('學者', 64));
  assert.notEqual(Shards.ROUTING.en.id, Shards.ROUTING['zh-Hant'].id);
});

test('same corpus and bucket count produce byte-identical manifest and shards', () => {
  const first = Shards.buildBrowserLexicalArtifacts(fixtureEntries, fixtureOptions(64));
  const second = Shards.buildBrowserLexicalArtifacts([...fixtureEntries].reverse(), fixtureOptions(64));
  assert.equal(first.serializedManifest, second.serializedManifest);
  assert.deepEqual(first.serializedShards, second.serializedShards);
});
~~~

- [ ] **Step 2: Confirm RED**

Run: node --test tests/browser-lexical-shards.test.js

Expected: FAIL with MODULE_NOT_FOUND for browser-lexical-shards.js.

- [ ] **Step 3: Implement the pure builder and atomic build script**

Use exact format identities:

~~~javascript
const MANIFEST_FORMAT = 'halo-browser-lexical-manifest-v1';
const SHARD_FORMAT = 'halo-browser-lexical-shard-v1';
const BUILDER = Object.freeze({ id: 'halo-browser-lexical-builder', version: '1.0.0' });
const ROUTING = Object.freeze({
  en: Object.freeze({ id: 'fnv1a-normalized-surface', version: '1.0.0' }),
  'zh-Hant': Object.freeze({ id: 'fnv1a-first-code-point', version: '1.0.0' })
});
~~~

English lexical and morphology rows share a bucket derived from the complete
normalized lookup key. Traditional-Chinese rows use the first Unicode code
point. Every shard remaps used glosses into a canonical local table. The
manifest root and every shard payload use SHA-256. Write mode stages all files
under a temporary sibling directory and renames only after every byte is
complete. Verify mode never repairs source artifacts.

- [ ] **Step 4: Write RED browser-loader and provider tests**

~~~javascript
test('a verified manifest routes and loads only the requested shard', async () => {
  const reads = [];
  const runtime = BrowserLoader.createBrowserLexicalRuntime({
    manifest: await BrowserLoader.loadBrowserLexicalManifest(fixtureManifest),
    readText: async (path) => { reads.push(path); return fixtureFiles[path]; }
  });
  await runtime.ensureForTexts(['The model learns.'], 'en');
  assert.ok(reads.length > 0);
  assert.ok(reads.every((path) => path.includes('/en/')));
});

test('a corrupt required shard falls back without exposing its bytes', async () => {
  const provider = await createFixtureProvider({ corruptShard: true });
  assert.equal(provider.lookup('model', 'en').source, 'bootstrap');
  assert.deepEqual(provider.status().failures, [{ code: 'SHARD_HASH_MISMATCH' }]);
});
~~~

- [ ] **Step 5: Implement browser validation, bounded LRU, and provider view**

The browser runtime exposes:

~~~javascript
function createBrowserLexicalRuntime({
  manifest,
  readText,
  crypto,
  maxResidentShards = 32,
  now = () => performance.now()
}) {
  return Object.freeze({
    requiredShardIds(texts, languageMode),
    ensureShards(ids, { signal }),
    withPinnedShards(ids, callback),
    status(),
    clearMemoryCache()
  });
}

function createShardedDictionaryProvider({
  runtime,
  pinnedShards,
  bootstrapProvider
}) {
  return Object.freeze({
    id: 'halo-sharded-dictionary-chain',
    version: '0.4.0',
    lookup,
    lookupAll,
    lookupMorphology,
    longestMatch,
    status
  });
}
~~~

Hash verification precedes schema/order validation and materialization. Promise
cache entries are removed after rejection. Pinned shards cannot be evicted.
Status exposes only format/version/counts and sanitized uppercase failure codes.

- [ ] **Step 6: Verify GREEN and full deterministic rebuild**

Run: node --test tests/browser-lexical-shards.test.js tests/browser-shard-loader.test.js tests/sharded-dictionary-provider.test.js

Expected: PASS.

Run: node --max-old-space-size=3072 scripts/build-browser-lexical-runtime.js --write --buckets 64

Expected: deterministic 64-bucket candidate written to a temporary profiling
root, with 128 data shards and zero rejected lexical records.

Run again with --buckets 128 into a separate temporary profiling root.

Expected: 256 data shards and zero rejected records.

- [ ] **Step 7: Run real-Chromium candidate comparison and freeze ADR**

Run: node scripts/profile-browser-runtime.js --compare-buckets 64,128 --write

Expected: both candidates have cold/warm samples. Apply the spec rule exactly:
choose 64 only if all blocking browser budgets pass; otherwise choose 128 if
it passes. If neither passes, stop with partial/blocked evidence.

Write ADR-009 with:

~~~javascript
const decision = Object.freeze({
  candidates: Object.freeze([64, 128]),
  selected: comparison.selection.selectedBucketCount,
  rule: '64 if both pass; 128 if only 128 passes; blocked if neither passes',
  browserProfile: 'docs/validation/v0.4.0-browser-baseline.json',
  comparisonEvidence: 'docs/validation/v0.4.0-browser-shard-comparison.json',
  manifestFormat: 'halo-browser-lexical-manifest-v1',
  shardFormat: 'halo-browser-lexical-shard-v1'
});
~~~

The profiler serializes the measured integer into both the comparison evidence
and ADR. It must refuse to write an ADR when neither candidate passes.

- [ ] **Step 8: Publish only the selected shard tree and verify**

Run: node --max-old-space-size=3072 scripts/build-browser-lexical-runtime.js --write --selection-file docs/validation/v0.4.0-browser-shard-comparison.json

Run: node --max-old-space-size=3072 scripts/build-browser-lexical-runtime.js --verify

Expected: manifest, every shard, data manifest, and build receipt match; the
legacy 48.5 MB file is no longer an extension runtime dependency.

- [ ] **Step 9: Run regressions and commit**

Run: node --test tests/*.test.js

Expected: all tests PASS.

Run: git diff --check

Expected: clean.

Commit:

~~~bash
git add packages/lexical-index/browser-lexical-shards.js apps/extension/src/shared/runtime-shard-browser.js apps/extension/src/shared/sharded-dictionary-provider.js scripts/build-browser-lexical-runtime.js tests/browser-lexical-shards.test.js tests/browser-shard-loader.test.js tests/sharded-dictionary-provider.test.js docs/adr/ADR-009-browser-lexical-sharding.md apps/extension/data/lexical-v0.4.0 dist/lexical-v0.4.0 scripts/profile-browser-runtime.js
git commit -m "feat: add benchmark-selected lexical shards"
~~~

---

### Task 3: V040-03 Versioned progressive semantic enrichment

**Files:**
- Create: apps/extension/src/shared/progressive-runtime.js
- Create: tests/progressive-enrichment.test.js
- Modify: apps/extension/src/service-worker.js
- Modify: tests/extension-semantic-service.test.js

**Interfaces:**
- Consumes: authored bootstrap engine, browser lexical runtime, sharded provider, SemanticAnnotation engine.
- Produces: createAnalysisKey(input), createProgressiveSemanticRuntime(options), HALO_ENRICH_BATCH, HALO_CANCEL_REQUEST, and stale-safe ProgressiveResult/v1.

- [ ] **Step 1: Write RED deterministic/stale/cancellation tests**

~~~javascript
test('one analysis key permits one bootstrap and one lexical reconciliation', async () => {
  const runtime = Progressive.createProgressiveSemanticRuntime(fixtureOptions());
  const first = await runtime.bootstrap(fixtureRequest('root-1', 1));
  const enriched = await runtime.enrich(fixtureRequest('root-1', 1));
  const duplicate = await runtime.enrich(fixtureRequest('root-1', 1));
  assert.equal(first.phase, 'bootstrap');
  assert.equal(enriched.phase, 'lexical');
  assert.equal(duplicate.status, 'duplicate');
});

test('late result from an old page epoch is rejected', async () => {
  const runtime = Progressive.createProgressiveSemanticRuntime(fixtureOptions());
  const pending = runtime.enrich(fixtureRequest('root-1', 1));
  runtime.advancePageEpoch(2);
  assert.equal((await pending).status, 'stale');
});
~~~

- [ ] **Step 2: Confirm RED**

Run: node --test tests/progressive-enrichment.test.js

Expected: FAIL with MODULE_NOT_FOUND.

- [ ] **Step 3: Implement exact analysis-key and phase contracts**

~~~javascript
function createAnalysisKey({
  text,
  languageMode,
  semanticVersion,
  grammarVersion,
  profileRevision,
  lexicalVersion
}) {
  return stableHash([
    text,
    languageMode,
    semanticVersion,
    grammarVersion,
    profileRevision,
    lexicalVersion
  ]);
}

function createProgressiveSemanticRuntime({
  bootstrapEngine,
  enrichBatch,
  semanticVersion,
  grammarVersion
}) {
  return Object.freeze({
    bootstrap(request),
    enrich(request),
    cancel(requestId),
    advancePageEpoch(nextEpoch),
    status()
  });
}
~~~

Results include schemaVersion, requestId, pageEpoch, rootId, rootRevision,
analysisKey, phase, annotationSet, lexicalVersion, and generatedAt. Duplicate,
cancelled, stale, and invalid results never reach projection.

- [ ] **Step 4: Replace whole-index worker initialization with shard enrichment**

The service worker imports runtime-shard-browser.js and
sharded-dictionary-provider.js. HALO_ENRICH_BATCH validates:

~~~javascript
{
  type: 'HALO_ENRICH_BATCH',
  requestId: 'non-empty stable ID',
  pageEpoch: 1,
  items: [{
    rootId: 'root-1',
    rootRevision: 1,
    text: 'The model learns.',
    languageMode: 'en',
    analysisKey: 'stable hash'
  }]
}
~~~

Enforce maximum 24 items, 12,000 total characters, 600 estimated tokens, and
24 distinct shards. AbortController instances are keyed by sender tab and
request ID. HALO_CANCEL_REQUEST can cancel only the sender's request.

- [ ] **Step 5: Verify GREEN and regression**

Run: node --test tests/progressive-enrichment.test.js tests/extension-semantic-service.test.js tests/runtime-dictionary-provider.test.js

Expected: PASS, including corrupt-shard fallback and old message rejection.

Run: node --test tests/*.test.js

Expected: all tests PASS.

- [ ] **Step 6: Commit**

~~~bash
git add apps/extension/src/shared/progressive-runtime.js apps/extension/src/service-worker.js tests/progressive-enrichment.test.js tests/extension-semantic-service.test.js
git commit -m "feat: add progressive semantic enrichment"
~~~

---

### Task 4: V040-04 TextRun sentence pipeline and DOM fragment mapping

**Files:**
- Create: apps/extension/src/shared/sentence-pipeline.js
- Create: tests/sentence-pipeline.test.js
- Create: tests/browser/sentence-pipeline.e2e.test.js

**Interfaces:**
- Consumes: visible policy-approved DOM roots.
- Produces: createTextRuns(root, options), segmentSentences(text, options), detectLanguage(text), mapAggregateSpanToFragments(runs, start, end), buildSentenceRecords(root, options).

- [ ] **Step 1: Write RED pure mapping and segmentation tests**

~~~javascript
test('aggregate token spans map across nested node-local fragments without drift', () => {
  const runs = [
    { nodeId: 'a', text: 'The ', start: 0, end: 4 },
    { nodeId: 'b', text: 'model', start: 4, end: 9 },
    { nodeId: 'c', text: ' learns.', start: 9, end: 17 }
  ];
  assert.deepEqual(Pipeline.mapAggregateSpanToFragments(runs, 4, 15), [
    { nodeId: 'b', start: 0, end: 5 },
    { nodeId: 'c', start: 0, end: 6 }
  ]);
});

test('mixed English and Traditional Chinese sentences keep exact UTF-16 offsets', () => {
  const text = 'Models learn. 人工智慧學習。';
  const sentences = Pipeline.segmentSentences(text, { locale: 'zh-Hant' });
  assert.deepEqual(sentences.map((value) => text.slice(value.start, value.end)), [
    'Models learn.',
    '人工智慧學習。'
  ]);
});
~~~

- [ ] **Step 2: Confirm RED**

Run: node --test tests/sentence-pipeline.test.js

Expected: FAIL with MODULE_NOT_FOUND.

- [ ] **Step 3: Implement pure offsets and browser extraction**

~~~javascript
function mapAggregateSpanToFragments(runs, start, end) {
  const fragments = [];
  for (const run of runs) {
    const left = Math.max(start, run.start);
    const right = Math.min(end, run.end);
    if (right > left) {
      fragments.push(Object.freeze({
        node: run.node,
        nodeId: run.nodeId,
        start: left - run.start,
        end: right - run.start
      }));
    }
  }
  return Object.freeze(fragments);
}
~~~

createTextRuns ignores script, style, noscript, textarea, input, select,
option, code, pre, kbd, samp, button, SVG, MathML, editable, role=textbox,
ARIA-hidden, navigation, invisible, and Halo-owned descendants. It preserves
exact node strings and inserts only deterministic block/BR boundaries.

- [ ] **Step 4: Add real-browser nested-span verification**

The browser test loads a fixture containing nested span, link, em, and mixed
text nodes. It asserts that every sentence and token maps to its exact source
substring and that link href/emphasis nodes remain present.

Run: node --test tests/sentence-pipeline.test.js

Expected: PASS.

Run: node --test tests/browser/sentence-pipeline.e2e.test.js

Expected: PASS in real Chromium.

- [ ] **Step 5: Regress and commit**

Run: node --test tests/*.test.js

Expected: all tests PASS.

Commit:

~~~bash
git add apps/extension/src/shared/sentence-pipeline.js tests/sentence-pipeline.test.js tests/browser/sentence-pipeline.e2e.test.js
git commit -m "feat: add DOM sentence pipeline"
~~~

---

### Task 5: V040-05 Viewport scheduler, budgets, cancellation, and backpressure

**Files:**
- Create: apps/extension/src/shared/runtime-scheduler.js
- Create: tests/runtime-scheduler.test.js
- Modify: apps/extension/src/shared/settings.js
- Modify: tests/profile-migration.test.js
- Modify: apps/extension/src/content.js
- Modify: apps/extension/src/popup.js

**Interfaces:**
- Consumes: sentence roots and explicit/inferred priority.
- Produces: createRuntimeScheduler(options), enqueue(work), cancelRoot(rootId), cancelEpoch(epoch), flush(), status().

- [ ] **Step 1: Write RED budget and priority tests**

~~~javascript
test('one batch respects every independent production budget', async () => {
  const scheduler = Scheduler.createRuntimeScheduler({
    budgets: {
      maxTextNodes: 24,
      maxCharacters: 12000,
      maxSentences: 24,
      maxSemanticTokens: 600,
      maxShardIds: 24,
      timeSliceMs: 8,
      maxQueuedRoots: 200
    },
    clock: fixtureClock()
  });
  scheduler.enqueue(fixtureWork(30));
  const batch = await scheduler.nextBatch();
  assert.ok(batch.textNodes <= 24);
  assert.ok(batch.characters <= 12000);
  assert.ok(batch.sentences <= 24);
  assert.ok(batch.semanticTokens <= 600);
  assert.ok(batch.shardIds.size <= 24);
});

test('explicit visible work displaces stale offscreen inferred work', () => {
  const scheduler = Scheduler.createRuntimeScheduler(fixtureOptions());
  scheduler.enqueue({ id: 'old', priority: 'background', visible: false, epoch: 1 });
  scheduler.enqueue({ id: 'click', priority: 'explicit', visible: true, epoch: 1 });
  assert.equal(scheduler.peek().id, 'click');
});
~~~

- [ ] **Step 2: Confirm RED**

Run: node --test tests/runtime-scheduler.test.js

Expected: FAIL with MODULE_NOT_FOUND.

- [ ] **Step 3: Implement bounded queue and normalized settings**

Add normalized settings with exact defaults:

~~~javascript
runtimeBudgets: Object.freeze({
  maxTextNodes: 24,
  maxCharacters: 12000,
  maxSentences: 24,
  maxSemanticTokens: 600,
  maxShardIds: 24,
  timeSliceMs: 8,
  maxQueuedRoots: 200,
  viewportBufferPx: 1200
})
~~~

Legacy maxTextNodes/maxMarkedTokens remain migration inputs only. The scheduler
uses requestIdleCallback with a bounded timeout and setTimeout fallback.
AbortController is created per batch. Stale offscreen work is evicted before
visible work; explicit work is never dropped for inferred work.

- [ ] **Step 4: Wire IntersectionObserver and incremental discovery**

content.js observes discovered block roots with rootMargin equal to the
normalized viewport buffer. Initial visible roots are sampled first. DOM
discovery advances at most 32 candidates per 8 ms slice and performs no
semantic analysis for nonintersecting roots.

- [ ] **Step 5: Verify GREEN and no eager-scan browser behavior**

Run: node --test tests/runtime-scheduler.test.js tests/profile-migration.test.js

Expected: PASS.

Run: node --test tests/browser/sentence-pipeline.e2e.test.js

Expected: a long fixture shows that offscreen paragraphs have zero semantic
requests until they enter the buffer.

Run: node --test tests/*.test.js

Expected: all tests PASS.

- [ ] **Step 6: Commit**

~~~bash
git add apps/extension/src/shared/runtime-scheduler.js apps/extension/src/shared/settings.js apps/extension/src/content.js apps/extension/src/popup.js tests/runtime-scheduler.test.js tests/profile-migration.test.js tests/browser/sentence-pipeline.e2e.test.js
git commit -m "feat: add bounded viewport scheduling"
~~~

---

### Task 6: V040-06 Dynamic DOM and SPA lifecycle

**Files:**
- Create: apps/extension/src/shared/dynamic-dom-controller.js
- Create: tests/dynamic-dom-controller.test.js
- Create: tests/browser/dynamic-dom.e2e.test.js
- Modify: apps/extension/src/content.js

**Interfaces:**
- Consumes: MutationObserver records, history/navigation signals, scheduler, renderer cleanup.
- Produces: createDynamicDomController(options), classifyMutation(record), coalesceMutations(records), routeEpoch(), cleanup().

- [ ] **Step 1: Write RED coalescing/loop/route tests**

~~~javascript
test('Halo-owned mutations never become article work', () => {
  const result = Dynamic.coalesceMutations([
    fixtureMutation({ targetOwned: true, addedOwned: true })
  ]);
  assert.deepEqual(result.roots, []);
});

test('one route change cancels old work and starts one new epoch', () => {
  const calls = [];
  const controller = Dynamic.createDynamicDomController(fixtureOptions(calls));
  controller.routeChanged('/article/a', '/article/b');
  assert.deepEqual(calls, ['cancel:1', 'remove:1', 'disconnect:1', 'start:2']);
  assert.equal(controller.routeEpoch(), 2);
});
~~~

- [ ] **Step 2: Confirm RED**

Run: node --test tests/dynamic-dom-controller.test.js

Expected: FAIL with MODULE_NOT_FOUND.

- [ ] **Step 3: Implement mutation and route controller**

~~~javascript
function createDynamicDomController({
  debounceMs = 80,
  maxWaitMs = 250,
  isHaloOwned,
  onRootsChanged,
  onRouteCleanup,
  onRouteStart
}) {
  return Object.freeze({
    observe(document),
    routeChanged(previousUrl, nextUrl),
    suppressRendererMutations(callback),
    routeEpoch,
    cleanup
  });
}
~~~

Patch pushState and replaceState reversibly, listen to popstate/hashchange,
coalesce affected nonowned roots, and restore original history methods during
cleanup. Renderer suppression is scoped with try/finally and cannot remain
enabled after an exception.

- [ ] **Step 4: Verify real SPA/infinite/dynamic behavior**

Run: node --test tests/dynamic-dom-controller.test.js

Expected: PASS.

Run: node --test tests/browser/dynamic-dom.e2e.test.js

Expected: dynamic insertion, content replacement, infinite append, pushState,
replaceState, popstate, and renderer mutations behave without duplicate
requests or wrappers.

- [ ] **Step 5: Regression and commit**

Run: node --test tests/*.test.js

Expected: all tests PASS.

Commit:

~~~bash
git add apps/extension/src/shared/dynamic-dom-controller.js apps/extension/src/content.js tests/dynamic-dom-controller.test.js tests/browser/dynamic-dom.e2e.test.js
git commit -m "feat: handle dynamic DOM and SPA lifecycle"
~~~

---

### Task 7: V040-07 Idempotent reversible renderer and isolated core panel

**Files:**
- Create: apps/extension/src/shared/reversible-renderer.js
- Create: tests/reversible-renderer.test.js
- Create: tests/browser/reversible-renderer.e2e.test.js
- Modify: apps/extension/src/content.js
- Modify: apps/extension/src/content.css
- Modify: tests/source-contract.test.js

**Interfaces:**
- Consumes: sentence fragments, RenderPlan, analysis key, root revision.
- Produces: createReversibleRenderer(options), apply(renderRequest), reconcile(renderRequest), removeRoot(rootId), removeAll(), openPanel(model), closePanel(reason), status().

- [ ] **Step 1: Write RED fragment order/idempotency tests**

~~~javascript
test('node-local operations sort from last offset to first', () => {
  const operations = Renderer.planNodeOperations([
    { nodeId: 'a', start: 0, end: 3 },
    { nodeId: 'a', start: 4, end: 9 },
    { nodeId: 'b', start: 0, end: 5 }
  ]);
  assert.deepEqual(operations.map((value) => [value.nodeId, value.start]), [
    ['b', 0],
    ['a', 4],
    ['a', 0]
  ]);
});

test('same root revision and analysis key is an idempotent no-op', () => {
  const state = Renderer.createRenderState();
  state.record({ rootId: 'r', rootRevision: 2, analysisKey: 'k', wrappers: 3 });
  assert.equal(state.classify({ rootId: 'r', rootRevision: 2, analysisKey: 'k' }), 'duplicate');
});
~~~

- [ ] **Step 2: Confirm RED**

Run: node --test tests/reversible-renderer.test.js

Expected: FAIL with MODULE_NOT_FOUND.

- [ ] **Step 3: Implement renderer with exact ownership markers**

Token wrappers use:

~~~javascript
span.dataset.haloOwned = 'token';
span.dataset.haloRun = request.runId;
span.dataset.haloRoot = request.rootId;
span.dataset.haloOriginal = fragment.text;
span.className = 'halo-token';
span.textContent = fragment.text;
~~~

Do not use innerHTML. Reconcile attributes in place when boundaries match.
When boundaries differ, build all node-local fragments first and replace under
one suppression epoch. Remove unwraps only matching Halo-owned nodes and
normalizes touched parents. Release stored Range/text-node arrays after apply.

- [ ] **Step 4: Build the Shadow DOM core panel safely**

~~~javascript
function createCorePanel(document) {
  const host = document.createElement('div');
  host.dataset.haloOwned = 'panel';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  const panel = document.createElement('section');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'halo-panel-title');
  shadow.append(style, panel);
  return Object.freeze({ host, shadow, panel });
}
~~~

All user-visible text uses textContent. Panel position is clamped to viewport
and does not change article layout height.

- [ ] **Step 5: Verify the five renderer lifecycle sequences**

Run: node --test tests/reversible-renderer.test.js tests/source-contract.test.js

Expected: PASS.

Run: node --test tests/browser/reversible-renderer.e2e.test.js

Expected: Apply->Apply, Apply->Remove, Apply->Remove->Apply, DOM mutation->Apply,
and route change->cleanup all preserve exact source text with no duplicate
wrapper and no lost link/emphasis element.

- [ ] **Step 6: Regression and commit**

Run: node --test tests/*.test.js

Expected: all tests PASS.

Commit:

~~~bash
git add apps/extension/src/shared/reversible-renderer.js apps/extension/src/content.js apps/extension/src/content.css tests/reversible-renderer.test.js tests/browser/reversible-renderer.e2e.test.js tests/source-contract.test.js
git commit -m "feat: add idempotent reversible renderer"
~~~

---

### Task 8: V040-08 Trigger controller and explicit interaction priority

**Files:**
- Create: apps/extension/src/shared/trigger-controller.js
- Create: tests/trigger-controller.test.js
- Create: tests/browser/trigger-controller.e2e.test.js
- Modify: apps/extension/manifest.json
- Modify: apps/extension/src/service-worker.js
- Modify: apps/extension/src/content.js
- Modify: apps/extension/src/popup.html
- Modify: apps/extension/src/popup.js
- Modify: apps/extension/src/popup.css
- Modify: apps/extension/src/shared/settings.js

**Interfaces:**
- Consumes: pointer/focus/click/keyboard/context-menu/popup actions and MarkingProfile triggerMode.
- Produces: createTriggerController(options), dispatch(event), state(), context-menu command HALO_EXPLICIT_SELECTION, keyboard command halo-analyze-selection.

- [ ] **Step 1: Write RED state-machine tests**

~~~javascript
test('explicit action preempts a pending adaptive hover', () => {
  const controller = Trigger.createTriggerController(fixtureOptions());
  controller.dispatch({ type: 'POINTER_ENTER', targetId: 's1', at: 0 });
  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 's2', at: 10 });
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 's2', source: 'explicit' });
});

test('Esc and delayed dismissal are recoverable', () => {
  const controller = Trigger.createTriggerController(fixtureOptions());
  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 's1', at: 0 });
  controller.dispatch({ type: 'ESCAPE', at: 1 });
  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 's1', at: 2 });
  assert.equal(controller.state().name, 'core-open');
});
~~~

- [ ] **Step 2: Confirm RED**

Run: node --test tests/trigger-controller.test.js

Expected: FAIL with MODULE_NOT_FOUND.

- [ ] **Step 3: Implement pure controller and settings**

Accepted modes are exactly adaptive-hover, explicit-only, and hybrid. States
are idle, candidate, primed, core-open, dismissed, and cancelled. Events are
POINTER_ENTER, POINTER_LEAVE, MODIFIER_HOVER, HOVER_THRESHOLD, EXPLICIT_OPEN,
OUTSIDE_CLICK, ESCAPE, DISMISS_TIMEOUT, ROUTE_CLEANUP, and CANCEL.

The popup exposes triggerMode and concise current-site controls. Existing
profiles migrate deterministically to hybrid.

- [ ] **Step 4: Add narrow browser entries**

Update manifest:

~~~json
{
  "permissions": ["activeTab", "contextMenus", "scripting", "storage"],
  "commands": {
    "halo-analyze-selection": {
      "suggested_key": { "default": "Alt+Shift+H" },
      "description": "Analyze selected text with Halo Learning"
    }
  }
}
~~~

On install, create one context menu for selection context. Context-menu and
command handlers inject the same packaged local module list used by popup and
send HALO_EXPLICIT_SELECTION. They do not add host permissions or remote code.

- [ ] **Step 5: Verify browser interactions**

Run: node --test tests/trigger-controller.test.js

Expected: PASS.

Run: node --test tests/browser/trigger-controller.e2e.test.js

Expected: click, keyboard, modifier-hover, context action, popup action, Esc,
outside click, delayed dismissal, and recovery pass in every applicable mode;
explicit-only never opens from plain hover.

- [ ] **Step 6: Regression and commit**

Run: node --test tests/*.test.js

Expected: all tests PASS.

Commit:

~~~bash
git add apps/extension/manifest.json apps/extension/src/shared/trigger-controller.js apps/extension/src/shared/settings.js apps/extension/src/service-worker.js apps/extension/src/content.js apps/extension/src/popup.html apps/extension/src/popup.js apps/extension/src/popup.css tests/trigger-controller.test.js tests/browser/trigger-controller.e2e.test.js
git commit -m "feat: add canonical browser triggers"
~~~

---

### Task 9: V040-09 Sensitive-site and user-denylist policy

**Files:**
- Create: apps/extension/src/shared/site-policy.js
- Create: tests/site-policy.test.js
- Create: tests/browser/sensitive-site.e2e.test.js
- Modify: apps/extension/src/shared/settings.js
- Modify: apps/extension/src/popup.html
- Modify: apps/extension/src/popup.js
- Modify: apps/extension/src/content.js
- Modify: tests/source-contract.test.js

**Interfaces:**
- Consumes: URL protocol/hostname/path, security-relevant element attributes, normalized user denylist.
- Produces: normalizeDenylist(values), classifySite(input), PolicyDecision/v1 with allow, category, reasonCode, and evidenceKind.

- [ ] **Step 1: Write RED policy matrix tests**

~~~javascript
test('sensitive categories fail closed without form value access', () => {
  const cases = [
    fixtureSite('https://bank.example/account', ['banking']),
    fixtureSite('https://pay.example/checkout', ['payment']),
    fixtureSite('https://mail.example/inbox', ['webmail']),
    fixtureSite('https://chat.example/messages', ['private-messaging']),
    fixtureSite('https://health.example/patient', ['medical']),
    fixtureSite('https://cloud.example/secrets', ['developer-secrets'])
  ];
  for (const value of cases) assert.equal(Policy.classifySite(value).allow, false);
});

test('user denylist matches exact hosts and subdomains but not suffix tricks', () => {
  const denylist = Policy.normalizeDenylist(['private.example']);
  assert.equal(Policy.classifySite(fixtureUrl('https://private.example/a', denylist)).allow, false);
  assert.equal(Policy.classifySite(fixtureUrl('https://sub.private.example/a', denylist)).allow, false);
  assert.equal(Policy.classifySite(fixtureUrl('https://private.example.attacker.test/a', denylist)).allow, true);
});
~~~

- [ ] **Step 2: Confirm RED**

Run: node --test tests/site-policy.test.js

Expected: FAIL with MODULE_NOT_FOUND.

- [ ] **Step 3: Implement policy without private reads**

~~~javascript
function classifySite({
  url,
  userDenylist,
  sensitiveAttributes,
  knownCategoryRules = DEFAULT_RULES
}) {
  if (!['http:', 'https:'].includes(url.protocol)) return blocked('UNSUPPORTED_PROTOCOL');
  if (matchesDenylist(url.hostname, userDenylist)) return blocked('USER_DENYLIST');
  const category = matchKnownCategory(url, knownCategoryRules);
  if (category) return blocked('SENSITIVE_CATEGORY', category);
  if (sensitiveAttributes.length) return blocked('SENSITIVE_FORM_ATTRIBUTE');
  return Object.freeze({ schemaVersion: 1, allow: true, category: 'public', reasonCode: 'ALLOW' });
}
~~~

The content runtime collects only type, autocomplete, inputmode, name pattern,
and role presence. It never reads value, textContent from a blocked root,
cookies, history, storage tokens, or hidden account data.

- [ ] **Step 4: Add denylist UI and zero-work browser assertions**

Popup supports adding/removing the current exact hostname from
sitePolicy.userDenylist. On a blocked fixture, browser instrumentation must
observe zero TextRun, zero sentence, zero semantic message, zero wrapper, and
zero remote request.

Run: node --test tests/site-policy.test.js tests/source-contract.test.js

Expected: PASS.

Run: node --test tests/browser/sensitive-site.e2e.test.js

Expected: all sensitive fixtures PASS with zero-work counters.

- [ ] **Step 5: Regression and commit**

Run: node --test tests/*.test.js

Expected: all tests PASS.

Commit:

~~~bash
git add apps/extension/src/shared/site-policy.js apps/extension/src/shared/settings.js apps/extension/src/popup.html apps/extension/src/popup.js apps/extension/src/content.js tests/site-policy.test.js tests/browser/sensitive-site.e2e.test.js tests/source-contract.test.js
git commit -m "feat: enforce sensitive-site policy"
~~~

---

### Task 10: V040-10 Accessibility and resilient presentation

**Files:**
- Create: tests/accessibility-contract.test.js
- Create: tests/browser/accessibility.e2e.test.js
- Modify: apps/extension/src/shared/reversible-renderer.js
- Modify: apps/extension/src/content.css
- Modify: apps/extension/src/popup.html
- Modify: apps/extension/src/popup.css

**Interfaces:**
- Consumes: renderer panel, trigger events, browser media preferences.
- Produces: focus entry/return contract, concise accessible labels, noncolor POS alternatives, reduced-motion and forced-color styles.

- [ ] **Step 1: Write RED accessibility contract tests**

~~~javascript
test('visual token labels do not create one tab stop per token', () => {
  const source = fs.readFileSync(contentPath, 'utf8');
  assert.doesNotMatch(source, /halo-token[^\\n]*tabindex/);
});

test('panel has labelled semantics and concise live status', () => {
  const source = fs.readFileSync(rendererPath, 'utf8');
  assert.match(source, /aria-labelledby/);
  assert.match(source, /role.*dialog/);
  assert.match(source, /aria-live.*polite/);
});
~~~

- [ ] **Step 2: Confirm RED**

Run: node --test tests/accessibility-contract.test.js

Expected: FAIL because the v0.4 panel accessibility contract is absent.

- [ ] **Step 3: Implement keyboard/focus/speech behavior**

When the panel opens, focus moves to its heading or first actionable control.
When it closes, focus returns to the explicit trigger if still connected.
Tokens remain native reading text and are not all focusable. Pseudo-label CSS
uses speak: none; semantic details are exposed in the explicitly opened panel.
The live region emits only Ready, Analyzing, Enriched, Blocked, and Closed
messages and never enumerates tokens.

- [ ] **Step 4: Implement resilient CSS**

Add exact media contracts:

~~~css
@media (prefers-reduced-motion: reduce) {
  [data-halo-owned] { animation: none !important; transition: none !important; }
}

@media (forced-colors: active) {
  .halo-token { color: CanvasText !important; outline: 1px dotted CanvasText; }
}

.halo-token::before,
.halo-token::after { speak: none; }

:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
~~~

The panel uses rem/em sizing, wraps at 200% zoom, and passes deterministic
contrast calculations for authored colors.

- [ ] **Step 5: Verify browser accessibility**

Run: node --test tests/accessibility-contract.test.js

Expected: PASS.

Run: node --test tests/browser/accessibility.e2e.test.js

Expected: keyboard-only open/read/close, focus restoration, visible focus,
noncolor label, reduced motion, forced colors, 200% text scaling, and absence
of repeated POS accessible names all PASS.

- [ ] **Step 6: Regression and commit**

Run: node --test tests/*.test.js

Expected: all tests PASS.

Commit:

~~~bash
git add apps/extension/src/shared/reversible-renderer.js apps/extension/src/content.css apps/extension/src/popup.html apps/extension/src/popup.css tests/accessibility-contract.test.js tests/browser/accessibility.e2e.test.js
git commit -m "feat: harden browser accessibility"
~~~

---

### Task 11: V040-11 Twenty-fixture browser E2E matrix

**Files:**
- Create: fixtures/browser/matrix.json
- Create: fixtures/browser/01-simple-article.html
- Create: fixtures/browser/02-news.html
- Create: fixtures/browser/03-technical-docs.html
- Create: fixtures/browser/04-academic.html
- Create: fixtures/browser/05-nested-spans.html
- Create: fixtures/browser/06-inline-links.html
- Create: fixtures/browser/07-code-heavy.html
- Create: fixtures/browser/08-pre-code.html
- Create: fixtures/browser/09-multilingual.html
- Create: fixtures/browser/10-traditional-chinese.html
- Create: fixtures/browser/11-english.html
- Create: fixtures/browser/12-infinite-scroll.html
- Create: fixtures/browser/13-spa-navigation.html
- Create: fixtures/browser/14-dynamic-insertion.html
- Create: fixtures/browser/15-content-replacement.html
- Create: fixtures/browser/16-ad-layout.html
- Create: fixtures/browser/17-accessibility-reading.html
- Create: fixtures/browser/18-shadow-dom.html
- Create: fixtures/browser/19-same-origin-iframe.html
- Create: fixtures/browser/20-long-form.html
- Create: tests/browser/browser-runtime-matrix.e2e.test.js

**Interfaces:**
- Consumes: complete content runtime and extension harness.
- Produces: BrowserFixtureMatrix/v1 with exact fixture IDs, capabilities, assertions, pass/fail, wrapper counts, source hashes, long tasks, and lifecycle counters.

- [ ] **Step 1: Write RED fixture-inventory test**

~~~javascript
test('matrix declares exactly twenty distinct required fixture classes', () => {
  const matrix = readMatrix();
  assert.equal(matrix.schemaVersion, 1);
  assert.equal(matrix.fixtures.length, 20);
  assert.equal(new Set(matrix.fixtures.map((value) => value.id)).size, 20);
  for (const fixture of matrix.fixtures) {
    assert.ok(fixture.file);
    assert.ok(fixture.assertions.includes('source-text-preserved'));
    assert.ok(fixture.assertions.includes('no-duplicate-wrapper'));
    assert.ok(fixture.assertions.includes('remove-correct'));
  }
});
~~~

- [ ] **Step 2: Confirm RED**

Run: node --test tests/browser/browser-runtime-matrix.e2e.test.js

Expected: FAIL because matrix.json and fixtures are absent.

- [ ] **Step 3: Create deterministic fixtures and expectations**

Every fixture contains an element with data-fixture-content and a script-free
static baseline unless dynamic behavior is the purpose. Dynamic fixtures use
small authored local scripts with deterministic buttons or timers. The matrix
marks open Shadow DOM supported and cross-origin iframe unsupported; the
blocking iframe fixture is same-origin.

- [ ] **Step 4: Implement one shared E2E matrix runner**

For each fixture:

~~~javascript
const original = await page.locator('[data-fixture-content]').evaluate((node) => node.textContent);
await applyHalo(page, fixture);
await assertNoCriticalLayoutBreak(page, fixture);
await assertNoDuplicateWrappers(page);
await removeHalo(page);
const restored = await page.locator('[data-fixture-content]').evaluate((node) => node.textContent);
assert.equal(restored, original);
~~~

Record annotation accuracy against exact authored expected marked surfaces,
layout overflow, wrapper count, request count, long tasks, and runtime errors.
No assertion is replaced by a screenshot-only judgment.

- [ ] **Step 5: Run all twenty fixtures twice**

Run: node --test tests/browser/browser-runtime-matrix.e2e.test.js

Expected: 20/20 PASS on first application/removal.

Run the same command again in a fresh browser context.

Expected: 20/20 PASS with identical semantic expectations and no leaked state.

- [ ] **Step 6: Regression and commit**

Run: node --test tests/*.test.js

Expected: all unit/integration tests PASS.

Commit:

~~~bash
git add fixtures/browser tests/browser/browser-runtime-matrix.e2e.test.js
git commit -m "test: add v0.4 browser fixture matrix"
~~~

---

### Task 12: V040-12 Browser performance gates and MV3 lifecycle

**Files:**
- Create: packages/quality/browser-performance.js
- Create: tests/browser-performance-metrics.test.js
- Create: tests/browser/browser-performance.e2e.test.js
- Create: tests/browser/mv3-lifecycle.e2e.test.js
- Create: scripts/run-browser-performance.js
- Create after successful execution: docs/validation/v0.4.0-browser-performance.json
- Create after successful execution: docs/validation/v0.4.0-mv3-lifecycle.json
- Modify: package.json

**Interfaces:**
- Consumes: Chromium runtime instrumentation, fixture matrix, selected shard manifest.
- Produces: percentile(values, p), evaluateBrowserPerformance(report), BrowserPerformanceReport/v1, MV3LifecycleReport/v1.

- [ ] **Step 1: Write RED metric/gate tests**

~~~javascript
test('performance gates keep cold, warm, bootstrap, and lexical values distinct', () => {
  const result = Metrics.evaluateBrowserPerformance(fixtureReport({
    primedHighlightP95Ms: 80,
    localSentenceAnalysisP95Ms: 240,
    corePanelFirstVisibleP95Ms: 410,
    mainThreadLongTaskMaxMs: 42
  }));
  assert.equal(result.allBlockingPassed, true);
  assert.equal(result.measurements.cold.lexical.phase, 'lexical');
  assert.equal(result.measurements.warm.bootstrap.phase, 'bootstrap');
});

test('unknown memory remains unknown and never becomes zero', () => {
  const report = Metrics.normalizeBrowserPerformance(fixtureReport({ heapPeakBytes: 'unknown' }));
  assert.equal(report.memory.heapPeakBytes, 'unknown');
});
~~~

- [ ] **Step 2: Confirm RED**

Run: node --test tests/browser-performance-metrics.test.js

Expected: FAIL with MODULE_NOT_FOUND.

- [ ] **Step 3: Implement fixed gates and evidence schema**

~~~javascript
const BUDGETS = Object.freeze({
  primedHighlightP95Ms: 100,
  localSentenceAnalysisP95Ms: 300,
  corePanelFirstVisibleP95Ms: 500,
  mainThreadLongTaskMaxMs: 50
});

function evaluateBrowserPerformance(report) {
  const gates = Object.freeze({
    primedHighlight: report.primedHighlightP95Ms < BUDGETS.primedHighlightP95Ms,
    sentenceAnalysis: report.localSentenceAnalysisP95Ms < BUDGETS.localSentenceAnalysisP95Ms,
    corePanel: report.corePanelFirstVisibleP95Ms < BUDGETS.corePanelFirstVisibleP95Ms,
    longTask: report.mainThreadLongTaskMaxMs < BUDGETS.mainThreadLongTaskMaxMs
  });
  return Object.freeze({ gates, allBlockingPassed: Object.values(gates).every(Boolean) });
}
~~~

Do not round values before gate comparison. Record raw samples and unrounded
percentiles.

- [ ] **Step 4: Implement real-browser performance runner**

Add scripts:

~~~json
{
  "browser:performance": "node scripts/run-browser-performance.js --write",
  "browser:performance:verify": "node scripts/run-browser-performance.js --verify"
}
~~~

Use at least 20 samples for each reported p95. Create fresh contexts for cold,
reuse one context for warm, and separate bootstrap paint from lexical
enrichment. PerformanceObserver captures longtask entries.

- [ ] **Step 5: Implement MV3 lifecycle tests**

The lifecycle report has explicit booleans and evidence for:

~~~javascript
const REQUIRED_LIFECYCLE = Object.freeze([
  'coldStart',
  'workerRestart',
  'cacheLossReload',
  'inFlightCancellation',
  'tabClose',
  'extensionReload',
  'browserContextRestart',
  'versionMismatchRejected'
]);
~~~

Use Chromium DevTools Protocol to stop the worker target when supported, then
trigger a new message and assert a new worker instance loads required shards.
If that Chromium build cannot expose a stop control, record unsupported and
leave the release incomplete; do not replace it with a unit test claim.

- [ ] **Step 6: Run and adjudicate real values**

Run: npm run browser:performance

Expected: evidence files contain actual browser version, manifest hash, cold
and warm raw samples, p95 metrics, long tasks, memory or unknown, and lifecycle
results.

Run: npm run browser:performance:verify

Expected: normal exit only if every blocking performance and lifecycle gate
passes.

If a metric fails, use systematic debugging to locate the bottleneck. Keep the
actual measurement. Do not change BUDGETS.

- [ ] **Step 7: Regression and commit**

Run: node --test tests/browser-performance-metrics.test.js

Expected: PASS.

Run: npm run test:browser

Expected: all browser tests PASS.

Run: node --test tests/*.test.js

Expected: all tests PASS.

Commit:

~~~bash
git add packages/quality/browser-performance.js tests/browser-performance-metrics.test.js tests/browser/browser-performance.e2e.test.js tests/browser/mv3-lifecycle.e2e.test.js scripts/run-browser-performance.js docs/validation/v0.4.0-browser-performance.json docs/validation/v0.4.0-mv3-lifecycle.json package.json
git commit -m "test: enforce browser performance and MV3 lifecycle"
~~~

---

### Task 13: V040-13 Validator, packaging, release evidence, and stop gate

**Files:**
- Create: scripts/validate-v0.4.0.js
- Create: scripts/package-v0.4.0.js
- Create: tests/release-validator-v0.4.0.test.js
- Create: tests/release-packaging-v0.4.0.test.js
- Create: docs/VALIDATION_REPORT_v0.4.0.md
- Create: docs/releases/v0.4.0-task-evidence.yaml
- Create: dist/halo-learning-magic-hand-v0.4.0.zip
- Create: releases/Halo_Learning_v0.4.0_Browser_Runtime_UX_Release.zip
- Modify: package.json
- Modify: apps/extension/manifest.json
- Modify: README.md
- Modify: apps/extension/README.md
- Modify: THIRD_PARTY_NOTICES.md
- Modify: docs/VALIDATION_REPORT.md
- Modify: docs/workbench/Halo_Learning_v0.1.0_to_v1.0_Workflow.md
- Modify with spreadsheet workflow: docs/workbench/Halo_Learning_v0.1.0_to_v1.0_Workbench.xlsx

**Interfaces:**
- Consumes: all v0.4 tests/artifacts/evidence and selected lexical manifest.
- Produces: parseTapSummary(output), progressGate(index, total, name, action), validateRelease(root, mode), buildReleaseEvidence(evidence), deterministic v0.4 extension/source packages, final release YAML.

- [ ] **Step 1: Write RED TAP/parser/progress tests**

~~~javascript
test('TAP parser returns exact totals and never silently returns null', () => {
  const parsed = Validator.parseTapSummary([
    '1..145',
    '# tests 145',
    '# pass 145',
    '# fail 0',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0'
  ].join('\\n'));
  assert.deepEqual(parsed, {
    status: 'known',
    total: 145,
    passed: 145,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0
  });
});

test('unknown TAP summary is explicit and blocks validation', () => {
  const parsed = Validator.parseTapSummary('format changed');
  assert.equal(parsed.status, 'unknown');
  assert.throws(() => Validator.requireKnownTap(parsed), /TAP summary is unknown/);
});
~~~

- [ ] **Step 2: Confirm RED**

Run: node --test tests/release-validator-v0.4.0.test.js

Expected: FAIL with MODULE_NOT_FOUND for validate-v0.4.0.js.

- [ ] **Step 3: Implement stable TAP invocation and stderr progress**

Run tests with:

~~~javascript
run(process.execPath, [
  '--test',
  '--test-reporter=tap',
  ...testFiles
], { cwd: root, label: 'full test suite' });
~~~

Progress uses:

~~~javascript
async function progressGate(index, total, name, action, write = process.stderr.write.bind(process.stderr)) {
  write('[' + index + '/' + total + '] ' + name + ' ... ');
  const result = await action();
  write('PASS\\n');
  return result;
}
~~~

Failure writes FAIL plus the stable error code and then throws. Stdout contains
only the final JSON report.

- [ ] **Step 4: Write RED deterministic packaging tests**

The extension package inventory includes manifest, runtime modules, popup,
CSS, selected lexical manifest/shards, notices, and licenses. It excludes
tests, fixtures, legacy 48.5 MB runtime JSON, Git metadata, candidate shard
trees, and development evidence.

The source package inventory includes authored source, verified corpora,
selected generated runtime, tests, browser fixtures, docs, and evidence, but
no .git or nested release ZIP.

Run: node --test tests/release-packaging-v0.4.0.test.js

Expected: FAIL until package-v0.4.0.js exists.

- [ ] **Step 5: Implement package and validator gates**

Validator progress order is fixed:

1. full unit/integration tests;
2. JavaScript syntax;
3. lexical shard deterministic rebuild;
4. legacy semantic quality;
5. extension manifest/privacy permissions;
6. twenty-fixture browser evidence;
7. dynamic DOM/SPA evidence;
8. renderer lifecycle evidence;
9. sensitive-site evidence;
10. accessibility evidence;
11. cold/warm performance evidence;
12. MV3 lifecycle evidence;
13. package inventory/bytes;
14. development or standalone hygiene;
15. release/workbench evidence.

Standalone mode never invokes Git. It validates committed browser evidence
hashes and schemas; it does not relabel Node runs as browser evidence.

- [ ] **Step 6: Update versioned documentation and workbench**

Set package and manifest version to 0.4.0. Mark v0.4.0 and V040-01 through
V040-13 Complete only if every fresh blocking gate passes. Keep v0.5.0 Not
Started. Update the XLSX through the spreadsheet artifact workflow and verify
its workbook structure after save.

The release evidence builder maps fresh, validated evidence into the
user-required report structure. It never seeds fields with fabricated defaults:

~~~javascript
function buildReleaseEvidence(evidence) {
  return {
    release: {
      version: 'v0.4.0',
      name: 'Browser Runtime & UX',
      status: deriveReleaseStatus(evidence.gates)
    },
    baseline: evidence.baseline,
    runtime: {
      lexical_index_strategy: 'benchmark-selected deterministic JSON shards',
      lexical_bucket_count: evidence.shardComparison.selection.selectedBucketCount,
      ...evidence.browserProfile.runtime
    },
    browser_performance: evidence.performance.summary,
    tasks: classifyTasks(evidence.taskEvidence),
    files_changed: evidence.git.filesChanged,
    contracts_changed: evidence.contracts.changed,
    migrations_added: evidence.migrations.added,
    tests_added: evidence.tests.added,
    tests_passed: evidence.tests.passed,
    browser_fixtures: evidence.browserFixtures.summary,
    acceptance_evidence: evidence.acceptance.paths,
    performance_evidence: evidence.performance.paths,
    security_privacy_evidence: evidence.security.paths,
    accessibility_evidence: evidence.accessibility.paths,
    known_limitations: evidence.limitations,
    head_after: evidence.git.headAfter,
    working_tree: evidence.git.workingTree,
    next_release: {
      version: 'v0.5.0',
      name: 'Local Data & Event Store'
    }
  };
}
~~~

Every referenced evidence object is schema-validated before serialization. If
any required collection is missing or any blocking gate fails, status is
partial or blocked and workflow rows must not claim Complete.

- [ ] **Step 7: Build packages and run focused validator tests**

Run: node scripts/package-v0.4.0.js

Expected: both ZIPs are created, unzip -tqq passes, inventories match, and
every packaged byte matches its canonical source.

Run: node --test tests/release-validator-v0.4.0.test.js tests/release-packaging-v0.4.0.test.js

Expected: PASS.

- [ ] **Step 8: Commit release candidate before clean development validation**

Run: git diff --check

Expected: no output.

Run: node scripts/audit-source-tree.js

Expected: ok true and zero issues.

Commit:

~~~bash
git add package.json package-lock.json apps/extension README.md THIRD_PARTY_NOTICES.md docs dist releases scripts tests fixtures packages
git commit -m "release: prepare Halo Learning v0.4.0"
~~~

- [ ] **Step 9: Run the complete fresh release gate from the clean commit**

Run: node --test tests/*.test.js

Expected: exact total reported, zero fail/cancelled, normal exit 0.

Run: npm run test:browser

Expected: every browser suite and all 20 fixtures PASS.

Run: node --max-old-space-size=3072 scripts/build-browser-lexical-runtime.js --verify

Expected: selected manifest/shards match.

Run: node --max-old-space-size=2048 scripts/build-lexical-runtime.js --verify

Expected: v0.3 canonical semantic source projection remains reproducible even
though the extension no longer loads it.

Run: node --max-old-space-size=1024 scripts/run-semantic-quality.js --verify

Expected: authored quality thresholds PASS without general-world claims.

Run: npm run browser:performance:verify

Expected: performance and lifecycle reports PASS.

Run: node scripts/validate-v0.4.0.js --development

Expected: 15/15 gates PASS, known exact test count, clean Git worktree, and one
JSON report on stdout.

- [ ] **Step 10: Run the no-Git standalone release gate**

Extract releases/Halo_Learning_v0.4.0_Browser_Runtime_UX_Release.zip into a new
temporary directory that is not inside any Git worktree.

Run from that extracted root:

~~~bash
node scripts/validate-v0.4.0.js --standalone
~~~

Expected: 15/15 gates PASS without any Git invocation; source audit, tests,
syntax, selected shard rebuild, semantic quality, manifest, package, browser
evidence hash/schema, and release evidence all pass.

- [ ] **Step 11: Fresh final audit and release sign-off commit if evidence changed**

If the clean validators generated no changes, no extra commit is needed. If
only canonical reports were intentionally refreshed, inspect exact diffs,
rerun their covering gates, and commit:

~~~bash
git add docs/validation docs/VALIDATION_REPORT_v0.4.0.md docs/releases/v0.4.0-task-evidence.yaml
git commit -m "docs: record v0.4.0 release evidence"
~~~

Then rerun development validation because the previous clean-commit evidence
was invalidated by the new commit.

- [ ] **Step 12: Stop and report**

Record final HEAD, clean/dirty status, all actual performance values, fixture
counts, evidence paths, limitations, and v0.5.0 as the next release. Do not
create v0.5.0 files, branch, schema, or implementation.

## Final verification checklist

- [ ] Spec sections 1–19 each map to at least one completed task.
- [ ] All new production functions have tests that were observed RED first.
- [ ] Full unit/integration suite exits 0 with exact known TAP counts.
- [ ] Real Chromium E2E exits 0 with 20/20 fixture classes.
- [ ] Dynamic DOM, SPA, renderer, site-policy, accessibility, performance, and lifecycle suites exit 0.
- [ ] Selected lexical shards rebuild byte-for-byte from verified corpus input.
- [ ] v0.3 semantic quality regression remains unchanged and clearly fixture-bounded.
- [ ] Development validator passes from a clean Git commit.
- [ ] Standalone validator passes outside Git.
- [ ] Extension/source package inventories and every byte match canonical source.
- [ ] Git diff --check and source audit have zero issues.
- [ ] Final report uses completed only when every blocking gate has fresh evidence.
- [ ] v0.5.0 remains Not Started.
