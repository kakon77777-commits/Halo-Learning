# Halo Learning v0.5.0 Local Data & Dogfood Observatory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable local Halo Learning v0.5.0 dogfood extension that preserves the validated v0.4 browser runtime while adding privacy-minimized IndexedDB observation, append-only learning events, deterministic replay, export/delete controls, contextual Dogfood Notes, and a usable local Data Dashboard.

**Architecture:** Keep v0.4 semantic/rendering authority unchanged. Add a separate versioned dogfood data plane: content runtime observes only already-authorized page interactions, converts them into privacy-minimized capture drafts, and sends them to a service-worker data service. The data service re-authorizes page senders, writes through one IndexedDB repository, and exposes bounded read/admin messages to extension-owned UI. Dashboard views are deterministic projections over retained events; they never become semantic truth and never infer mastery.

**Tech Stack:** Node.js >=22, dependency-free CommonJS/UMD shared modules, Chrome/Chromium Manifest V3, IndexedDB, Web Crypto, `chrome.storage.local`, Playwright 1.62.1 persistent-context browser tests, `node:test`, deterministic ZIP packaging.

**Spec:** `docs/superpowers/specs/2026-08-28-local-data-dogfood-observatory-v0.5.0-design.md`

## Global Constraints

- Base implementation on `main` merge `5430dd9608d311aa04651ed36cb5f85d07a5138c` and the approved v0.5 design on `workbench/v0.5.0-local-dogfood`.
- Work only on `workbench/v0.5.0-local-dogfood` unless a later integration decision explicitly changes that.
- Preserve all validated v0.4 behavior; do not reopen resolved v0.4 blockers absent a fresh regression.
- Local-first only. No remote analytics, cloud account, external telemetry, remote AI/NLP, billing, teacher backend, mobile app, or new language.
- English + Traditional Chinese remain the only v0.5 language scope.
- Sensitive pages fail closed **before** dogfood capture. A failed/ambiguous policy decision produces zero durable dogfood writes.
- Never add production host permissions merely to collect data.
- `Exposure != Learning Intent` is a data-contract invariant.
- Passive and ordinary interaction events never retain sentence text.
- Only explicit gloss/detail open, Save Sentence, and sentence-linked Dogfood Note may retain the associated sentence text.
- Ordinary URL capture stores readable domain + normalized path hash only; query and fragment are discarded before hashing. Full URL is retained only for explicit return/reproduction actions.
- `normalizedPathHash` is pseudonymous, not anonymous.
- Events are append-only except explicit user-authorized physical deletion/retention cleanup. There is no ordinary `updateEvent` API.
- Dashboard counters, sessions, sites, saved state, and note state are replayable projections, not canonical learner truth.
- v0.5 must not contain mastery, confidence, level, adaptive density, gap planning, or learner-state inference.
- Storage failures degrade observation only. Ordinary v0.4 Apply/Remove/marking must remain usable.
- Passive capture must be coalesced; repeated viewport callbacks and pointer movement must not become an unbounded event log.
- First milestone is a **DOGFOOD** build, not a public v0.5 release. Do not run the formal v0.5 release-closure phase before real-use review.
- Every production change follows RED -> GREEN -> REFACTOR. Observe the expected RED before implementing the behavior.
- Commit after each coherent task. Before every publication, fetch and reconcile remote movement; never force-push over collaborator work.

## File Responsibility Map

| Path | Responsibility |
| --- | --- |
| `apps/extension/src/shared/dogfood-contracts.js` | Canonical v0.5 data contracts, event families, strict normalizers |
| `apps/extension/src/shared/dogfood-source.js` | URL minimization, path normalization/hash, sentence hash, local-control source |
| `apps/extension/src/shared/dogfood-storage-schema.js` | IndexedDB database/store/index/migration description without browser side effects |
| `apps/extension/src/shared/dogfood-store.js` | IndexedDB transaction wrapper, bounded queries, cache, retention, export/import, scoped delete |
| `apps/extension/src/shared/dogfood-capture.js` | Session IDs, event IDs, capture classification, exposure coalescing, profile-change classification |
| `apps/extension/src/shared/dogfood-projector.js` | Deterministic Overview/Activity/Sites/Sessions/Saved/Notes projections and replay report |
| `apps/extension/src/shared/dogfood-data-service.js` | Storage orchestration, capture-on/off, notes/save APIs, query/export/delete/replay facade |
| `apps/extension/src/service-worker.js` | Chrome sender authorization + dogfood message transport; semantic service remains separate |
| `apps/extension/src/shared/browser-entry.js` | Inject v0.5 content-side dogfood modules before `content.js` |
| `apps/extension/src/content.js` | Thin observation hooks after v0.4 policy; never owns durable storage |
| `apps/extension/src/shared/reversible-renderer.js` | Present Save Sentence / Dogfood Note actions; no storage authority |
| `apps/extension/src/options.html` | Data Dashboard document |
| `apps/extension/src/options.css` | Dashboard local UI/accessibility styles |
| `apps/extension/src/options.js` | Bounded dashboard queries and local data controls |
| `apps/extension/src/popup.html` / `.js` / `.css` | Small capture status + Open Data Dashboard entry only |
| `apps/extension/manifest.json` | v0.5 dogfood version + options page; permissions remain bounded |
| `tests/dogfood-*.test.js` | Node contract/domain tests |
| `tests/browser/v050-*.e2e.test.js` | Real Chromium IndexedDB/privacy/UI/durability dogfood gates |
| `scripts/package-v0.5.0-dogfood.js` | Clearly labeled deterministic local dogfood extension ZIP |
| `docs/dogfood/v0.5.0-local-install.md` | Local install/use/reload/data inspection guide |

---

## Task 1: V050-A — Canonical contracts and privacy-minimized source identity

**Files:**
- Create: `apps/extension/src/shared/dogfood-contracts.js`
- Create: `apps/extension/src/shared/dogfood-source.js`
- Create: `tests/dogfood-contracts.test.js`
- Create: `tests/dogfood-source.test.js`

### Step 1: Write the failing contract tests

- [ ] Create `tests/dogfood-contracts.test.js` with strict cases for all seven schemas, the approved event families, and the mastery prohibition.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Contracts = require('../apps/extension/src/shared/dogfood-contracts');

test('LearningEvent/v1 accepts observational data and rejects mastery fields', () => {
  const event = Contracts.normalizeLearningEvent({
    schema: 'LearningEvent/v1',
    eventId: 'event:abc',
    timestamp: '2026-08-28T14:00:00.000Z',
    eventType: 'sentence_exposed',
    sessionId: 'session:one',
    sessionPolicyVersion: 'top-level-page-v1',
    sourceRef: 'source:one',
    language: 'en',
    sentenceRef: null,
    sentenceHash: 'sha256:abc',
    interactionClass: 'passive',
    capturePolicyVersion: 'dogfood-capture-v1',
    profileId: 'halo-default-v0.3.0',
    profileRevision: 4,
    uiContext: { activeChannels: ['posLabel'], density: 0.65, triggerMode: 'hybrid' },
    algorithmVersion: 'halo-semantic-v0.4',
    refersToEventId: null,
    detail: { noteText: null }
  });
  assert.equal(event.schema, 'LearningEvent/v1');
  assert.throws(() => Contracts.normalizeLearningEvent({ ...event, mastery: 0.8 }), /not allowed/);
});

test('Dogfood note events require note text and revision linkage', () => {
  const base = Contracts.eventFixture('dogfood_note_created');
  assert.throws(() => Contracts.normalizeLearningEvent({ ...base, detail: { noteText: '' } }), /noteText/);
  const revised = Contracts.eventFixture('dogfood_note_revised', {
    refersToEventId: base.eventId,
    detail: { noteText: 'POS label too noisy here' }
  });
  assert.equal(Contracts.normalizeLearningEvent(revised).refersToEventId, base.eventId);
});
```

- [ ] Create `tests/dogfood-source.test.js` proving query/fragment removal precedes hashing and full URL is absent by default.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Source = require('../apps/extension/src/shared/dogfood-source');

test('ordinary source identity strips query and fragment before path hashing', async () => {
  const a = await Source.createSourceRef({ url: 'https://example.com/read/ch1?token=secret#x', language: 'en' });
  const b = await Source.createSourceRef({ url: 'https://example.com/read/ch1?other=2#y', language: 'en' });
  assert.equal(a.domain, 'example.com');
  assert.equal(a.normalizedPathHash, b.normalizedPathHash);
  assert.equal(a.fullUrl, null);
  assert.doesNotMatch(JSON.stringify(a), /secret|other=2|#x|#y/);
});

test('explicit return context may retain sanitized full URL', async () => {
  const source = await Source.createSourceRef({
    url: 'https://example.com/read/ch1?view=1#paragraph',
    language: 'en',
    retainFullUrl: true
  });
  assert.equal(source.fullUrl, 'https://example.com/read/ch1?view=1#paragraph');
});
```

### Step 2: Run RED

- [ ] Run:

```bash
node --test tests/dogfood-contracts.test.js tests/dogfood-source.test.js
```

Expected: FAIL because `dogfood-contracts.js` and `dogfood-source.js` do not exist.

### Step 3: Implement the canonical contract module

- [ ] Implement `dogfood-contracts.js` in the repo's UMD/CommonJS pattern with these exact public constants/exports:

```js
const SCHEMAS = Object.freeze({
  event: 'LearningEvent/v1',
  source: 'SourceRef/v1',
  sentence: 'SentenceRecord/v1',
  cache: 'AnalysisCacheEntry/v1',
  export: 'ExportBundle/v1',
  deleteReceipt: 'DeleteReceipt/v1',
  replay: 'ReplayReport/v1'
});

const EVENT_TYPES = Object.freeze([
  'halo_applied', 'halo_removed', 'sentence_exposed',
  'gloss_opened', 'explanation_opened',
  'sentence_saved', 'sentence_unsaved',
  'dogfood_note_created', 'dogfood_note_revised', 'dogfood_note_removed',
  'profile_changed', 'density_changed', 'channels_changed', 'trigger_mode_changed',
  'capture_paused', 'capture_resumed'
]);

const INTERACTION_CLASSES = Object.freeze([
  'passive', 'ordinary', 'explicit-learning', 'dogfood-note'
]);
```

`normalizeLearningEvent()` must reject unknown properties, reject `mastery`, `confidence`, `learnerLevel`, require canonical ISO timestamp/event type/class, and enforce:

```text
passive/ordinary -> no retained sentence text exists in event payload
note_created/revised -> detail.noteText non-empty <= 4000
note_revised/note_removed -> refersToEventId required
all non-note events -> detail.noteText === null
```

The event never contains sentence text; text lives only in `SentenceRecord/v1`.

### Step 4: Implement source/hash helpers

- [ ] Implement `dogfood-source.js` exports:

```js
PATH_NORMALIZATION_VERSION = 'path-v1'
normalizePageUrl(url)
sha256Text(text, cryptoApi = globalThis.crypto)
createSourceRef({ url, language, retainFullUrl = false, cryptoApi })
createLocalControlSourceRef({ cryptoApi })
createSentenceHash(text, cryptoApi)
```

Rules:

```text
http/https only for page SourceRef
hostname lowercased
pathname normalized to URL.pathname exactly; query/fragment excluded from hash input
sourceId = sha256(domain + "\n" + normalizedPathHash)
local control source = domain "halo.local" + hash("/data-privacy")
fullUrl = null unless retainFullUrl === true
```

### Step 5: Run GREEN + full Node regression

- [ ] Run:

```bash
node --test tests/dogfood-contracts.test.js tests/dogfood-source.test.js
node --test tests/*.test.js
```

Expected: focused PASS; existing Node suite remains PASS.

### Step 6: Commit

- [ ] Commit:

```bash
git add apps/extension/src/shared/dogfood-contracts.js apps/extension/src/shared/dogfood-source.js tests/dogfood-contracts.test.js tests/dogfood-source.test.js
git commit -m "feat: define v0.5 dogfood data contracts"
```

---

## Task 2: V050-A — IndexedDB schema, migration registry, and repository

**Files:**
- Create: `apps/extension/src/shared/dogfood-storage-schema.js`
- Create: `apps/extension/src/shared/dogfood-store.js`
- Create: `tests/dogfood-storage-schema.test.js`
- Create: `tests/browser/v050-local-data-store.e2e.test.js`

### Step 1: Write RED schema tests

- [ ] Define the exact database surface in `tests/dogfood-storage-schema.test.js`:

```js
const EXPECTED_STORES = [
  'profiles', 'sources', 'sentences', 'analyses',
  'events', 'settings', 'cache', 'migrations'
];

test('v0.5 database schema has exactly the canonical stores', () => {
  assert.deepEqual(Schema.DATABASE_SCHEMA.stores.map((value) => value.name), EXPECTED_STORES);
  const events = Schema.DATABASE_SCHEMA.stores.find((value) => value.name === 'events');
  assert.equal(events.keyPath, 'eventId');
  assert.ok(events.indexes.some((index) => index.name === 'byTimestamp'));
  assert.ok(events.indexes.some((index) => index.name === 'bySource'));
});
```

The schema must be:

```js
DATABASE_NAME = 'halo-learning-local'
DATABASE_VERSION = 1
```

with indexes:

```text
events: byTimestamp(timestamp), bySource(sourceRef), bySession(sessionId), byType(eventType), byInteraction(interactionClass)
sources: byDomain(domain)
sentences: bySource(sourceRef), byCapturedAt(capturedAt)
cache: byExpiresAt(expiresAt)
```

### Step 2: Run RED

- [ ] Run:

```bash
node --test tests/dogfood-storage-schema.test.js
```

Expected: FAIL because storage modules do not exist.

### Step 3: Implement schema plan + migration record

- [ ] `dogfood-storage-schema.js` exports:

```js
DATABASE_NAME
DATABASE_VERSION
DATABASE_SCHEMA
MIGRATIONS
applyUpgrade({ db, oldVersion, newVersion, transaction })
```

`MIGRATIONS` contains one explicit migration:

```js
Object.freeze({ id: 'v0.5.0-db-1', from: 0, to: 1 })
```

No migration deletes data silently.

### Step 4: Write real IndexedDB RED browser test

- [ ] `tests/browser/v050-local-data-store.e2e.test.js` loads `dogfood-storage-schema.js` + `dogfood-store.js` into a normal page and checks:

```js
const names = await page.evaluate(async () => {
  const store = await HaloDogfoodStore.openHaloDogfoodStore({ indexedDB });
  const result = store.schemaStatus();
  store.close();
  return result.storeNames;
});
assert.deepEqual(names, EXPECTED_STORES);
```

Add append idempotency:

```js
const first = await store.appendEvent(event);
const second = await store.appendEvent(event);
assert.deepEqual([first.status, second.status], ['inserted', 'duplicate']);
```

and assert there is no `updateEvent` public method.

### Step 5: Implement repository API

- [ ] Implement `openHaloDogfoodStore({ indexedDB, databaseName, databaseVersion })` returning a frozen object with exactly:

```text
schemaStatus
appendEvent
putSource
putSentence
putProfileSnapshot
putAnalysis
putSetting
getSetting
putCache
getCache
queryEvents
querySources
querySentences
readReplayDataset
importBundleIntoEmptyStore
deleteByScope
clearAnalysisCache
pruneRetention
estimateUsage
close
```

`queryEvents({limit, before})` defaults to 100 and rejects limits >100. `putSource()` allows only monotonic enrichment of `fullUrl: null -> explicitly retained URL`; it must reject domain/path identity changes for an existing `sourceId`.

### Step 6: Run GREEN

- [ ] Run:

```bash
node --test tests/dogfood-storage-schema.test.js
node --test tests/browser/v050-local-data-store.e2e.test.js
node --test tests/*.test.js
```

Expected: all PASS.

### Step 7: Commit

- [ ] Commit:

```bash
git add apps/extension/src/shared/dogfood-storage-schema.js apps/extension/src/shared/dogfood-store.js tests/dogfood-storage-schema.test.js tests/browser/v050-local-data-store.e2e.test.js
git commit -m "feat: add v0.5 indexeddb dogfood store"
```

---

## Task 3: V050-B/C — Capture classifier, sessions, coalescing, sparse sentence retention

**Files:**
- Create: `apps/extension/src/shared/dogfood-capture.js`
- Create: `tests/dogfood-capture.test.js`

### Step 1: Write RED behavior tests

- [ ] Cover policy/classification/coalescing:

```js
test('passive exposure never retains sentence text', async () => {
  const capture = Capture.createCaptureRuntime({ cryptoApi: globalThis.crypto, now: () => 1000 });
  const result = await capture.prepare({
    eventType: 'sentence_exposed',
    policyDecision: { allow: true },
    sourceRef: 'source:one',
    language: 'en',
    sentenceText: 'The model learns.',
    profile: profileFixture()
  });
  assert.equal(result.sentenceRecord, null);
  assert.equal(result.event.interactionClass, 'passive');
});

test('explicit gloss open retains exactly the associated sentence', async () => {
  const result = await capture.prepare({
    eventType: 'gloss_opened',
    policyDecision: { allow: true },
    sourceRef: 'source:one',
    language: 'en',
    sentenceText: 'The model learns.',
    profile: profileFixture()
  });
  assert.equal(result.sentenceRecord.text, 'The model learns.');
  assert.equal(result.event.interactionClass, 'explicit-learning');
});

test('blocked policy yields no durable draft', async () => {
  assert.equal(await capture.prepare({ ...fixture, policyDecision: { allow: false } }), null);
});
```

Add exposure coalescing test: same `sessionId + sourceRef + sentenceHash + exposurePolicyVersion` yields the same deterministic event ID; a later duplicate can be safely ignored by the store.

### Step 2: Run RED

- [ ] Run:

```bash
node --test tests/dogfood-capture.test.js
```

Expected: FAIL because module does not exist.

### Step 3: Implement capture runtime

- [ ] Export exact policy identities:

```js
CAPTURE_POLICY_VERSION = 'dogfood-capture-v1'
SESSION_POLICY_VERSION = 'top-level-page-v1'
EXPOSURE_POLICY_VERSION = 'exposure-v1'
```

and:

```js
createCaptureRuntime({ cryptoApi, now, randomUUID })
classifyEventType(eventType)
diffProfileEvents(previous, next)
```

`createCaptureRuntime()` provides:

```text
startSession({ sourceRef }) -> sessionId
currentSession()
prepare(input) -> { event, sourceRecord?, sentenceRecord? } | null
```

Use random UUIDs for ordinary explicit actions, but derive passive exposure event IDs from the coalescing tuple hash.

`diffProfileEvents()` emits only semantic transitions:

```text
density change -> density_changed
channel set change -> channels_changed
trigger change -> trigger_mode_changed
other profile revision change -> profile_changed
```

No raw range-input frames or pointer coordinates are recorded.

### Step 4: Run GREEN

- [ ] Run:

```bash
node --test tests/dogfood-capture.test.js tests/dogfood-contracts.test.js tests/dogfood-source.test.js
node --test tests/*.test.js
```

### Step 5: Commit

- [ ] Commit:

```bash
git add apps/extension/src/shared/dogfood-capture.js tests/dogfood-capture.test.js
git commit -m "feat: add privacy bounded dogfood capture runtime"
```

---

## Task 4: V050-D/E — Analysis cache, retention, deterministic projector and replay

**Files:**
- Create: `apps/extension/src/shared/dogfood-projector.js`
- Create: `tests/dogfood-projector.test.js`
- Modify: `apps/extension/src/shared/dogfood-store.js`
- Modify: `tests/browser/v050-local-data-store.e2e.test.js`

### Step 1: Write RED projector tests

- [ ] Verify the same ordered retained events produce byte-equivalent projection output:

```js
const first = Projector.project(events);
const second = Projector.project(JSON.parse(JSON.stringify(events)));
assert.equal(JSON.stringify(first), JSON.stringify(second));
assert.equal(Object.hasOwn(first, 'mastery'), false);
```

Project exactly these dashboard sections:

```text
overview
activity
sites
sessions
savedSentences
notes
```

Notes fold `dogfood_note_created -> revised -> removed` by `refersToEventId`; saved-state folds `sentence_saved` / `sentence_unsaved` without deleting canonical events.

### Step 2: Add cache/retention RED cases

- [ ] In real IndexedDB test verify:

```text
cache key = textHash + contextHash + algorithmVersion
expired entry -> cache miss
algorithmVersion mismatch -> cache miss
passive event older than 30 days -> pruned
ordinary event older than 90 days -> pruned
explicit-learning + dogfood-note -> retained
orphan sources/sentences removed only after no surviving references
```

### Step 3: Implement projector/replay

- [ ] `dogfood-projector.js` exports:

```js
PROJECTOR_VERSION = 'dogfood-projector-v1'
project(events, attachments)
createReplayReport({ events, projection, skipped, cryptoApi })
```

`ReplayReport/v1` includes source event count/range, projector version, deterministic projection hash, skipped invalid IDs, and `success`.

### Step 4: Implement retention/cache repository behavior

- [ ] Add `putCache/getCache/pruneRetention` behavior to `dogfood-store.js`. Retention accepts an injected `now` in tests; production uses `Date.now()`.

### Step 5: Run GREEN and commit

- [ ] Run:

```bash
node --test tests/dogfood-projector.test.js
node --test tests/browser/v050-local-data-store.e2e.test.js
node --test tests/*.test.js
```

- [ ] Commit:

```bash
git add apps/extension/src/shared/dogfood-projector.js apps/extension/src/shared/dogfood-store.js tests/dogfood-projector.test.js tests/browser/v050-local-data-store.e2e.test.js
git commit -m "feat: add deterministic dogfood replay and retention"
```

---

## Task 5: V050-F — Export, import-round-trip contract, scoped delete

**Files:**
- Modify: `apps/extension/src/shared/dogfood-store.js`
- Create: `tests/dogfood-export-delete.test.js`
- Modify: `tests/browser/v050-local-data-store.e2e.test.js`

### Step 1: Write RED export/delete tests

- [ ] Assert `ExportBundle/v1` contains replayable canonical data but excludes cache:

```js
assert.equal(bundle.schema, 'ExportBundle/v1');
assert.ok(Array.isArray(bundle.events));
assert.ok(Array.isArray(bundle.sources));
assert.ok(Array.isArray(bundle.sentences));
assert.ok(Array.isArray(bundle.profiles));
assert.ok(Array.isArray(bundle.analyses));
assert.equal(Object.hasOwn(bundle, 'cache'), false);
```

Assert no unretained sentence text or non-explicit full URL appears anywhere in JSON/JSONL output.

- [ ] Add real browser round-trip:

```text
DB A -> export bundle -> empty DB B -> importBundleIntoEmptyStore -> replay A/B hashes equal
```

- [ ] Add delete scopes:

```js
{ kind: 'domain', domain: 'example.com' }
{ kind: 'time-range', from: isoA, to: isoB }
{ kind: 'all-dogfood' }
```

and separate `clearAnalysisCache()`.

### Step 2: Run RED

- [ ] Run:

```bash
node --test tests/dogfood-export-delete.test.js tests/browser/v050-local-data-store.e2e.test.js
```

Expected: new export/delete assertions fail.

### Step 3: Implement export/delete

- [ ] Add repository methods:

```text
exportBundle({ generatedAt })
exportEventsJsonl()
importBundleIntoEmptyStore(bundle)
deleteByScope(scope) -> DeleteReceipt/v1
```

Import refuses non-empty target stores; this is a contract/replay tool, not a public v0.5 Import button.

Deletion transaction must remove matching events and then garbage-collect now-unreferenced sources/sentences/analyses. A failure aborts the transaction rather than returning a partial success.

### Step 4: Run GREEN and commit

- [ ] Run:

```bash
node --test tests/dogfood-export-delete.test.js tests/browser/v050-local-data-store.e2e.test.js
node --test tests/*.test.js
```

- [ ] Commit:

```bash
git add apps/extension/src/shared/dogfood-store.js tests/dogfood-export-delete.test.js tests/browser/v050-local-data-store.e2e.test.js
git commit -m "feat: add local export replay and scoped delete"
```

---

## Task 6: V050-B/F — Service-worker dogfood data service and fail-closed transport

**Files:**
- Create: `apps/extension/src/shared/dogfood-data-service.js`
- Modify: `apps/extension/src/service-worker.js`
- Create: `tests/dogfood-data-service.test.js`
- Modify: `tests/browser-trigger-entry.test.js`

### Step 1: Write RED service tests with an in-memory fake repository

- [ ] Test that page capture requires an authorized sender and extension admin operations require an extension-owned sender:

```js
test('capture is rejected before repository write when sender is unauthorized', async () => {
  const repository = fakeRepository();
  const service = Service.createDogfoodDataService({
    repository,
    authorizePageSender: async () => false,
    authorizeAdminSender: () => false
  });
  const result = await service.handleMessage({ type: 'HALO_DOGFOOD_CAPTURE', draft: captureDraft() }, pageSender());
  assert.equal(result.error, 'DOGFOOD_CAPTURE_BLOCKED');
  assert.equal(repository.writes.length, 0);
});
```

### Step 2: Define exact message families

- [ ] Implement only:

```text
HALO_DOGFOOD_CAPTURE       page sender, write
HALO_DOGFOOD_STATUS        extension UI, read
HALO_DOGFOOD_QUERY         extension UI, read, bounded
HALO_DOGFOOD_NOTE          page or extension UI, explicit write
HALO_DOGFOOD_SAVE_SENTENCE page sender, explicit write
HALO_DOGFOOD_SET_CAPTURE   extension UI, admin write
HALO_DOGFOOD_EXPORT        extension UI, read
HALO_DOGFOOD_DELETE        extension UI, admin write
HALO_DOGFOOD_REPLAY        extension UI, read
```

No generic method name or arbitrary store/path is accepted over runtime messaging.

### Step 3: Implement shared data service

- [ ] `dogfood-data-service.js` creates one service over `dogfood-store`, `dogfood-capture`, `dogfood-projector`, and contracts. It must expose `status()` including:

```js
{
  schemaVersion: 1,
  mode: 'ready' | 'storage-degraded',
  captureEnabled: true | false,
  lastErrorCode: null | 'INDEXEDDB_UNAVAILABLE' | 'QUOTA_EXCEEDED' | 'MIGRATION_FAILED'
}
```

Repeated storage failure trips `storage-degraded` and stops non-critical retries until an admin/status operation explicitly retries opening storage. It never disables semantic marking.

### Step 4: Integrate service worker without disturbing semantic listener

- [ ] Add imports before initialization:

```js
'dogfood-contracts.js',
'dogfood-source.js',
'dogfood-storage-schema.js',
'dogfood-store.js',
'dogfood-capture.js',
'dogfood-projector.js',
'dogfood-data-service.js'
```

- [ ] Add `initializeDogfoodBrowser()` as a separate initialization path. Reuse `createWorkerPolicyAuthorizer()` for page capture authorization. Extension-admin authorization must require a `chrome-extension://<runtime.id>/...` sender URL and no foreign origin.

Semantic message handling continues to own only the existing semantic message family.

### Step 5: Update injection/source-contract tests

- [ ] Ensure browser entry tests still prove canonical content injection order once dogfood content modules are added later; at this task only service-worker imports change.

### Step 6: Run GREEN

- [ ] Run:

```bash
node --test tests/dogfood-data-service.test.js tests/browser-trigger-entry.test.js
node --test tests/*.test.js
```

### Step 7: Commit

- [ ] Commit:

```bash
git add apps/extension/src/shared/dogfood-data-service.js apps/extension/src/service-worker.js tests/dogfood-data-service.test.js tests/browser-trigger-entry.test.js
git commit -m "feat: add fail closed dogfood data service"
```

---

## Task 7: V050-B/C/G — Content observation hooks, Save Sentence, contextual Dogfood Notes

**Files:**
- Create: `apps/extension/src/shared/dogfood-content.js`
- Modify: `apps/extension/src/shared/browser-entry.js`
- Modify: `apps/extension/src/content.js`
- Modify: `apps/extension/src/shared/reversible-renderer.js`
- Create: `tests/dogfood-content.test.js`
- Modify: `tests/reversible-renderer.test.js`
- Modify: `tests/browser-entry-idempotent-injection.test.js`
- Create: `tests/browser/v050-capture-privacy.e2e.test.js`

### Step 1: Write RED renderer action tests

- [ ] Extend renderer tests so a panel model may contain exactly these actions:

```js
actions: [
  { id: 'save-sentence', label: 'Save sentence · 儲存句子' },
  { id: 'dogfood-note', label: 'Dogfood note · 體驗註記' }
]
```

`dogfood-note` opens an inline textarea with Save/Cancel; `onPanelAction({id, value, observationKey})` receives sanitized text. Renderer owns presentation only and stores no dogfood record.

Add private token observation identity:

```text
fragment.observationKey -> wrapper WeakMap metadata -> renderer.observationKeyForToken(token)
```

Do **not** serialize full sentence text into `data-*` attributes.

### Step 2: Write RED content capture tests

- [ ] `dogfood-content.js` API:

```js
createDogfoodContentClient({ chrome, location, cryptoApi, now, onError })
```

with:

```text
startPageSession()
recordApply(profile)
recordRemove(profile)
recordExposure({sentenceText, language, profile, observationKey})
recordExplicitOpen({kind, sentenceText, language, profile, observationKey})
saveSentence({...})
createNote({noteText, ...})
recordProfileDiff(previous, next)
routeChanged()
```

All methods must be best-effort: rejection updates only local diagnostic callback and must not throw through the v0.4 rendering path.

### Step 3: Run RED

- [ ] Run:

```bash
node --test tests/reversible-renderer.test.js tests/dogfood-content.test.js tests/browser-entry-idempotent-injection.test.js
```

Expected: missing action/observation/capture behavior fails.

### Step 4: Implement observation context without semantic pollution

- [ ] In `content.js`, when `renderBatch()` processes each sentence, create an internal observation context keyed by a generated `observationKey`:

```js
{
  sentenceText: record.text,
  language: record.language,
  sourceUrl: location.href,
  profileId: settings.profileId,
  profileRevision: settings.profileRevision,
  activeChannels: enabledChannelNames(settings.channels),
  density: settings.density,
  triggerMode: settings.triggerMode,
  algorithmVersion: modules.Semantic.ENGINE.version
}
```

Pass only `observationKey` through renderer-private metadata. Store context in a bounded content-runtime map and release it when roots are invalidated/removed/route-cleaned.

### Step 5: Instrument allowed runtime events

- [ ] Only after `freshPolicyDecision(...).allow === true`:

```text
successful Apply -> halo_applied
successful Remove on an allowed page -> halo_removed
first/coalesced sentence render/exposure -> sentence_exposed
explicit token click/modifier open with gloss -> gloss_opened
explicit detail open without gloss -> explanation_opened
Save button -> sentence_saved + SentenceRecord
Dogfood Note save -> dogfood_note_created + SentenceRecord when sentence context exists
profile/storage change diff -> density/channels/trigger/profile event
route start -> new session
```

Hover-open may show UI but does not retain sentence text and does not become an explicit-learning signal.

### Step 6: Browser privacy RED/GREEN

- [ ] `v050-capture-privacy.e2e.test.js` must prove in real Chromium:

```text
allowed EN page -> structured event exists
allowed zh-Hant page -> structured event exists
repeated viewport callbacks -> one exposure per coalescing key
passive events -> no SentenceRecord
explicit Save -> one retained sentence
sensitive fixture -> event count unchanged
saved source may retain full URL
ordinary source -> no query/fragment/full URL
```

Use the existing persistent extension harness and existing sensitive-site fixture logic; do not invent a weaker policy path.

### Step 7: Run regression

- [ ] Run:

```bash
node --test tests/reversible-renderer.test.js tests/dogfood-content.test.js tests/browser-entry-idempotent-injection.test.js
node --test tests/browser/v050-capture-privacy.e2e.test.js
node --test tests/browser/sensitive-site-product-security.e2e.test.js
node --test tests/browser/reversible-renderer.e2e.test.js
node --test tests/*.test.js
```

Expected: all PASS.

### Step 8: Commit

- [ ] Commit:

```bash
git add apps/extension/src/shared/dogfood-content.js apps/extension/src/shared/browser-entry.js apps/extension/src/content.js apps/extension/src/shared/reversible-renderer.js tests/dogfood-content.test.js tests/reversible-renderer.test.js tests/browser-entry-idempotent-injection.test.js tests/browser/v050-capture-privacy.e2e.test.js
git commit -m "feat: capture contextual local dogfood events"
```

---

## Task 8: V050-G — Options/Data Dashboard and compact popup entry

**Files:**
- Create: `apps/extension/src/options.html`
- Create: `apps/extension/src/options.css`
- Create: `apps/extension/src/options.js`
- Modify: `apps/extension/src/popup.html`
- Modify: `apps/extension/src/popup.css`
- Modify: `apps/extension/src/popup.js`
- Modify: `apps/extension/manifest.json`
- Create: `tests/browser/v050-dashboard.e2e.test.js`
- Modify: `tests/accessibility-contract.test.js`

### Step 1: Write RED dashboard E2E

- [ ] Seed dogfood data through real service APIs, open `chrome-extension://<id>/src/options.html`, and assert these navigation sections exist:

```text
Overview
Activity
Sites & Sessions
Learning Events
Saved Sentences
Dogfood Notes
Data & Privacy
System / Replay
```

- [ ] Assert Overview renders descriptive values only and contains none of:

```text
mastery
confidence score
English level
learned
```

when used as learner-state claims.

### Step 2: Implement manifest + dashboard shell

- [ ] Update manifest to:

```json
{
  "version": "0.5.0",
  "options_page": "src/options.html"
}
```

while preserving the existing permission list exactly:

```json
["activeTab", "contextMenus", "scripting", "storage"]
```

No host permission is added.

### Step 3: Implement bounded dashboard client

- [ ] `options.js` uses only the exact dogfood admin messages. Every event/list request uses `limit <= 100`; paging/drill-down requests the next page rather than rendering the complete event store.

Required behavior:

```text
Overview -> active days/sites/events/explicit/saved/notes/language/profile/density/bytes/range
Activity -> newest-first event timeline
Sites & Sessions -> grouped replay projection
Learning Events -> filter by type/domain/date, structured detail
Saved Sentences -> retained text only
Dogfood Notes -> create standalone note, revise, logical-remove
Data & Privacy -> capture on/off, retention text, JSON/JSONL export, site/date/all delete, cache clear
System / Replay -> DB/schema/projector versions + run replay + ReplayReport
```

Dangerous delete actions require an explicit confirmation dialog naming the scope; cancelling performs zero write.

### Step 4: Keep popup small

- [ ] Add only:

```html
<output id="dogfoodCaptureStatus">Local capture · 本機紀錄</output>
<button id="openDashboardButton" class="secondary" type="button">Data Dashboard · 本機資料</button>
```

`popup.js` asks `HALO_DOGFOOD_STATUS` for `ready/storage-degraded` + capture on/off and calls `chrome.runtime.openOptionsPage()` on click. Do not embed event tables or analytics in the popup.

### Step 5: Add accessibility assertions

- [ ] Dashboard must have one `h1`, landmark navigation, visible focus, proper labels for filters/textarea/delete confirmation, `aria-live` status, reduced-motion and forced-color support. Existing popup accessibility assertions remain green.

### Step 6: Run GREEN

- [ ] Run:

```bash
node --test tests/browser/v050-dashboard.e2e.test.js
node --test tests/accessibility-contract.test.js
node --test tests/browser/accessibility.e2e.test.js
node --test tests/*.test.js
```

### Step 7: Commit

- [ ] Commit:

```bash
git add apps/extension/src/options.html apps/extension/src/options.css apps/extension/src/options.js apps/extension/src/popup.html apps/extension/src/popup.css apps/extension/src/popup.js apps/extension/manifest.json tests/browser/v050-dashboard.e2e.test.js tests/accessibility-contract.test.js
git commit -m "feat: add v0.5 local data dashboard"
```

---

## Task 9: V050-H — Persistent real-browser dogfood acceptance and installable DOGFOOD package

**Files:**
- Create: `tests/browser/v050-dogfood-acceptance.e2e.test.js`
- Create: `scripts/package-v0.5.0-dogfood.js`
- Create: `tests/package-v0.5.0-dogfood.test.js`
- Modify: `package.json`
- Create: `docs/dogfood/v0.5.0-local-install.md`
- Create after verification: `docs/dogfood/v0.5.0-dogfood-validation.md`

### Step 1: Write persistent-context acceptance RED

- [ ] Use one real `userDataDir`, close Chromium, relaunch with the same directory, and prove:

```text
EN events survive restart
zh-Hant events survive restart
Saved Sentence survives restart
Dogfood Note survives restart
Dashboard sees the same retained state
Replay hash is stable across restart
```

Then verify:

```text
site delete removes only selected site
time-range delete removes only selected interval
all-dogfood delete removes dogfood records but does not corrupt Halo settings/runtime
sensitive-site capture stays zero
v0.4 Apply/Remove/dynamic runtime still works
```

### Step 2: Add storage-degraded acceptance

- [ ] Browser-test an injected/fake IndexedDB-open failure at the dogfood repository boundary. Expected:

```text
dogfood status = storage-degraded
no remote fallback
Apply still marks page
Remove still restores page
capture write failure does not escape into marking path
```

Do not simulate this by weakening production error handling.

### Step 3: Write package RED

- [ ] `tests/package-v0.5.0-dogfood.test.js` requires:

```text
output: dist/halo-learning-magic-hand-v0.5.0-dogfood.zip
manifest version: 0.5.0
options page present
all dogfood shared modules present
no test-fixtures/node_modules/.git
no host_permissions
package label says DOGFOOD, not release-ready
```

### Step 4: Implement dedicated dogfood packager

- [ ] Create `scripts/package-v0.5.0-dogfood.js`. Reuse the proven deterministic packaging rules conceptually, but do not mutate `package-v0.4.0.js` or overwrite v0.4 artifacts.

Constants:

```js
DOGFOOD_VERSION = 'v0.5.0-dogfood'
EXTENSION_OUTPUT = 'dist/halo-learning-magic-hand-v0.5.0-dogfood.zip'
CANONICAL_MTIME = new Date('2026-08-28T00:00:00.000Z')
```

Build twice in the packaging test and require byte-identical ZIP SHA-256.

### Step 5: Add package scripts

- [ ] Add without removing v0.4 validation commands:

```json
{
  "dogfood:test": "node --test tests/dogfood-*.test.js",
  "dogfood:browser": "node --test tests/browser/v050-*.e2e.test.js",
  "dogfood:package": "node scripts/package-v0.5.0-dogfood.js"
}
```

Do not rename the existing authoritative v0.4 scripts during the dogfood phase.

### Step 6: Write local install guide

- [ ] `docs/dogfood/v0.5.0-local-install.md` contains exact steps:

```text
1. Build/test/package.
2. Open chrome://extensions or edge://extensions.
3. Enable Developer mode.
4. Load unpacked apps/extension/ OR unpack the dogfood ZIP and load that directory.
5. Open an ordinary EN or zh-Hant page.
6. Apply Halo.
7. Open Data Dashboard from popup.
8. Verify Overview/Activity changes.
9. Use Save Sentence and Dogfood Note.
10. Restart browser and verify persistence.
11. Export JSON/JSONL before destructive delete experiments.
```

The guide labels this build **local DOGFOOD / not public v0.5 release**.

### Step 7: Run final dogfood gate

- [ ] Run fresh:

```bash
npm ci
node --test tests/*.test.js
node --test tests/dogfood-*.test.js
node --test tests/browser/v050-*.e2e.test.js
node --test tests/browser/sensitive-site-product-security.e2e.test.js
node --test tests/browser/dynamic-dom.e2e.test.js
node --test tests/browser/reversible-renderer.e2e.test.js
node --test tests/browser/trigger-controller.e2e.test.js
node scripts/package-v0.5.0-dogfood.js
node --test tests/package-v0.5.0-dogfood.test.js
```

Expected: all current dogfood gates PASS. Legacy v0.4 release-debt workflows are not redefined as v0.5 product blockers.

### Step 8: Record dogfood validation

- [ ] Create `docs/dogfood/v0.5.0-dogfood-validation.md` containing exact tested commit SHA, commands, pass counts, Chromium executable/version, package SHA-256, known dogfood limitations, and this explicit state:

```yaml
v0_5:
  milestone: local-dogfood-build
  public_release_ready: false
  v0_6_design_status: provisional
  next_action: real-user-dogfood
```

### Step 9: Commit and STOP

- [ ] Commit:

```bash
git add tests/browser/v050-dogfood-acceptance.e2e.test.js scripts/package-v0.5.0-dogfood.js tests/package-v0.5.0-dogfood.test.js package.json docs/dogfood/v0.5.0-local-install.md docs/dogfood/v0.5.0-dogfood-validation.md
git commit -m "dogfood: package Halo Learning v0.5 local build"
```

- [ ] **STOP. Do not begin formal v0.5 release closure or v0.6.** Hand the installable dogfood artifact and local-install guide to the user for real use.

---

# Deferred Phase — Formal v0.5 Release Gate (NOT authorized in this implementation run)

This phase exists only to preserve the approved design's V050-I boundary. It begins after real dogfood review and a fresh user authorization.

When later authorized, create a separate release-closure plan covering:

```text
migration interruption
quota/write failure
malformed export/import fixture
delete transaction rollback
duplicate-event stress
retention/orphan cleanup stress
full privacy audit
full browser regression
standalone package validation
reproducible release packaging
release evidence + migration documentation
```

Do not silently convert the dogfood build into a formal v0.5 release before that review.

## Plan Completion Criteria

The current implementation run is complete at Task 9 when all of the following are true:

```text
[ ] v0.4 marking behavior remains green
[ ] local IndexedDB persists through browser restart
[ ] structured events are visible in Dashboard
[ ] passive capture is coalesced
[ ] passive/ordinary capture retains no sentence text
[ ] sensitive pages produce zero durable dogfood capture
[ ] explicit learning actions can retain associated sentence text
[ ] Save Sentence works
[ ] contextual Dogfood Notes work and include profile/UI snapshot
[ ] JSON + JSONL export work
[ ] site/date/all delete work
[ ] analysis cache can be cleared independently
[ ] deterministic replay rebuilds the same projections
[ ] storage failure degrades capture, not marking
[ ] dashboard exposes observation without mastery/level claims
[ ] deterministic v0.5.0-dogfood ZIP exists
[ ] local install guide exists
[ ] validation report binds artifact to exact commit
[ ] v0.6 remains provisional
```
