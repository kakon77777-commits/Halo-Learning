# Halo Learning v0.5.0 Local Data & Dogfood Observatory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable local Halo Learning v0.5.0 dogfood extension that preserves the validated v0.4 browser runtime while adding privacy-minimized IndexedDB observation, append-only learning events, deterministic replay, export/delete controls, contextual Dogfood Notes, and a usable local Data Dashboard.

**Architecture:** Keep the v0.4 semantic/rendering authority unchanged. Add a separate versioned dogfood data plane. Content code observes only already-authorized page interactions, prepares privacy-minimized capture envelopes, and sends them to the service worker. The service worker re-authorizes page senders and writes through a shared IndexedDB repository. Extension-owned Options UI opens the same repository/domain service directly for bounded reads, export, delete, note revision, replay, and capture controls; no large export bundle is tunneled through runtime messaging. Dashboard views are deterministic projections over retained events and never become semantic truth.

**Tech Stack:** Node.js >=22, dependency-free CommonJS/UMD shared modules, Chrome/Chromium Manifest V3, IndexedDB, Web Crypto, `chrome.storage.local`, Playwright 1.62.1 persistent-context browser tests, `node:test`, deterministic ZIP packaging.

**Spec:** `docs/superpowers/specs/2026-08-28-local-data-dogfood-observatory-v0.5.0-design.md`

## Global Constraints

- Base implementation on `main` merge `5430dd9608d311aa04651ed36cb5f85d07a5138c` and the approved v0.5 design on `workbench/v0.5.0-local-dogfood`.
- Work only on `workbench/v0.5.0-local-dogfood` unless a later integration decision explicitly changes that.
- Preserve validated v0.4 behavior; do not reopen resolved v0.4 blockers absent a fresh regression.
- Local-first only. No remote analytics, cloud account, external telemetry, remote AI/NLP, billing, teacher backend, mobile app, or new language.
- English + Traditional Chinese remain the only v0.5 language scope.
- Sensitive pages fail closed **before** dogfood capture. A failed/ambiguous policy decision produces zero durable dogfood writes.
- Never add production host permissions merely to collect data.
- `Exposure != Learning Intent` is a data-contract invariant.
- Passive and ordinary interaction events never retain sentence text.
- Only explicit gloss/detail open, Save Sentence, and sentence-linked Dogfood Note may retain the associated sentence text.
- Ordinary URL capture stores readable domain + normalized path hash only; query and fragment are discarded before hashing. Full URL is retained only after an explicit return/reproduction action.
- `normalizedPathHash` is pseudonymous, not anonymous.
- Events are append-only except explicit user-authorized physical deletion/retention cleanup. There is no ordinary `updateEvent` API.
- Dashboard counters, sessions, sites, saved state, and note state are replayable projections, not canonical learner truth.
- v0.5 must not contain mastery, confidence, level, adaptive density, gap planning, or learner-state inference.
- Storage failures degrade observation only. Ordinary v0.4 Apply/Remove/marking must remain usable.
- Passive capture must be coalesced; repeated viewport callbacks and pointer movement must not become an unbounded event log.
- The analysis-cache API is implemented and tested in v0.5 dogfood, but is **not** wired into the v0.4 semantic execution path before dogfood unless fresh profiling proves that integration is needed. This avoids turning a new persistence layer into a v0.4 correctness dependency.
- First milestone is a **DOGFOOD** build, not a public v0.5 release. Do not run the formal v0.5 release-closure phase before real-use review.
- Every production change follows RED -> GREEN -> REFACTOR. Observe the expected RED before implementing the behavior.
- Commit after each coherent task. Before every publication, fetch and reconcile remote movement; never force-push over collaborator work.

## Canonical v0.5 storage identities

```text
Database: halo-learning-local
Database version: 1
Dogfood capture policy: dogfood-capture-v1
Session policy: top-level-page-v1
Exposure policy: exposure-v1
Path normalization: path-v1
Projector: dogfood-projector-v1
```

The eight IndexedDB stores are exactly:

| Store | Key path | Required indexes |
| --- | --- | --- |
| `profiles` | `profileKey` | — |
| `sources` | `sourceId` | `byDomain(domain)` |
| `sentences` | `sentenceId` | `bySource(sourceRef)`, `byCapturedAt(capturedAt)` |
| `analyses` | `analysisId` | — |
| `events` | `eventId` | `byTimestamp(timestamp)`, `bySource(sourceRef)`, `bySession(sessionId)`, `byType(eventType)`, `byInteraction(interactionClass)` |
| `settings` | `key` | — |
| `cache` | `cacheKey` | `byExpiresAt(expiresAt)` |
| `migrations` | `migrationId` | — |

`profiles.profileKey` is `${profileId}@${profileRevision}`. Dogfood preferences live under `settings.key === 'dogfood.preferences'` with this exact initial value:

```js
{
  key: 'dogfood.preferences',
  schemaVersion: 1,
  captureEnabled: true,
  retention: {
    passiveDays: 30,
    ordinaryDays: 90,
    explicitDays: null,
    dogfoodNoteDays: null
  }
}
```

`capture_paused` is appended before `captureEnabled` changes to `false`; `capture_resumed` is appended immediately after it changes to `true`. Both use the reserved local-control source produced by `createLocalControlSourceRef()`.

## File Responsibility Map

| Path | Responsibility |
| --- | --- |
| `apps/extension/src/shared/dogfood-contracts.js` | Canonical v0.5 contracts, event families, strict normalizers |
| `apps/extension/src/shared/dogfood-source.js` | URL minimization, path hash, sentence hash, local-control source |
| `apps/extension/src/shared/dogfood-storage-schema.js` | IndexedDB schema/migration description without side effects |
| `apps/extension/src/shared/dogfood-store.js` | IndexedDB transaction wrapper, queries, cache, retention, export/import, delete |
| `apps/extension/src/shared/dogfood-capture.js` | Sessions, event IDs, classification, coalescing, profile-change events |
| `apps/extension/src/shared/dogfood-projector.js` | Deterministic Overview/Activity/Sites/Sessions/Saved/Notes projections |
| `apps/extension/src/shared/dogfood-data-service.js` | Shared repository orchestration for worker and Options UI |
| `apps/extension/src/shared/dogfood-content.js` | Best-effort content-side capture client; no durable storage authority |
| `apps/extension/src/service-worker.js` | Re-authorized page-capture transport + status; semantic service stays separate |
| `apps/extension/src/shared/browser-entry.js` | Inject v0.5 content-side modules before `content.js` |
| `apps/extension/src/content.js` | Observation hooks after v0.4 policy; private sentence context map |
| `apps/extension/src/shared/reversible-renderer.js` | Save Sentence / Dogfood Note presentation; no storage authority |
| `apps/extension/src/options.html` / `.css` / `.js` | Local Data Dashboard |
| `apps/extension/src/popup.html` / `.css` / `.js` | Compact capture status + Dashboard entry |
| `apps/extension/manifest.json` | `0.5.0`, options page, unchanged bounded permissions |
| `tests/dogfood-*.test.js` | Node contract/domain tests |
| `tests/browser/v050-*.e2e.test.js` | Real Chromium IndexedDB/privacy/UI/durability dogfood gates |
| `scripts/package-v0.5.0-dogfood.js` | Deterministic local DOGFOOD ZIP |
| `docs/dogfood/v0.5.0-local-install.md` | Local installation/use guide |

---

## Task 1: V050-A — Canonical contracts and privacy-minimized source identity

**Files:**
- Create: `apps/extension/src/shared/dogfood-contracts.js`
- Create: `apps/extension/src/shared/dogfood-source.js`
- Create: `tests/dogfood-contracts.test.js`
- Create: `tests/dogfood-source.test.js`

### Step 1: Write RED contract tests

- [ ] Create `tests/dogfood-contracts.test.js`. Use a local fixture helper, not a production test-fixture export:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Contracts = require('../apps/extension/src/shared/dogfood-contracts');

function eventFixture(eventType, overrides = {}) {
  return {
    schema: 'LearningEvent/v1',
    eventId: `event:${eventType}:1`,
    timestamp: '2026-08-28T14:00:00.000Z',
    eventType,
    sessionId: 'session:one',
    sessionPolicyVersion: 'top-level-page-v1',
    sourceRef: 'source:one',
    language: 'en',
    sentenceRef: null,
    sentenceHash: null,
    interactionClass: eventType.startsWith('dogfood_note_') ? 'dogfood-note' : 'ordinary',
    capturePolicyVersion: 'dogfood-capture-v1',
    profileId: 'halo-default-v0.3.0',
    profileRevision: 4,
    uiContext: { activeChannels: ['posLabel'], density: 0.65, triggerMode: 'hybrid' },
    algorithmVersion: 'halo-semantic-v0.4',
    refersToEventId: null,
    detail: { noteText: null },
    ...overrides
  };
}

test('LearningEvent/v1 rejects learner-state fields', () => {
  const event = Contracts.normalizeLearningEvent(eventFixture('profile_changed'));
  assert.equal(event.schema, 'LearningEvent/v1');
  assert.throws(() => Contracts.normalizeLearningEvent({ ...event, mastery: 0.8 }), /not allowed/);
  assert.throws(() => Contracts.normalizeLearningEvent({ ...event, confidence: 0.9 }), /not allowed/);
});

test('note create/revise carries bounded note text and revisions link to an earlier event', () => {
  const created = eventFixture('dogfood_note_created', {
    eventId: 'event:note:1',
    detail: { noteText: 'Tense labels are too noisy here.' }
  });
  assert.equal(Contracts.normalizeLearningEvent(created).detail.noteText, 'Tense labels are too noisy here.');
  const revised = eventFixture('dogfood_note_revised', {
    eventId: 'event:note:2',
    refersToEventId: 'event:note:1',
    detail: { noteText: 'Tense labels are too noisy on articles.' }
  });
  assert.equal(Contracts.normalizeLearningEvent(revised).refersToEventId, 'event:note:1');
});
```

`detail` is the exact implementation-level discriminated payload needed to persist note text without creating a ninth canonical store. In v1 it is exactly `{ noteText: string | null }`; non-note events require `null`.

### Step 2: Write RED source tests

- [ ] Create `tests/dogfood-source.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Source = require('../apps/extension/src/shared/dogfood-source');

test('ordinary identity drops query/fragment before hashing', async () => {
  const a = await Source.createSourceRef({ url: 'https://Example.com/read/ch1?token=secret#x', language: 'en' });
  const b = await Source.createSourceRef({ url: 'https://example.com/read/ch1?other=2#y', language: 'en' });
  assert.equal(a.domain, 'example.com');
  assert.equal(a.normalizedPathHash, b.normalizedPathHash);
  assert.equal(a.fullUrl, null);
  assert.doesNotMatch(JSON.stringify(a), /secret|other=2|#x|#y/);
});

test('explicit return context may retain the exact local URL', async () => {
  const source = await Source.createSourceRef({
    url: 'https://example.com/read/ch1?view=1#paragraph',
    language: 'en',
    retainFullUrl: true
  });
  assert.equal(source.fullUrl, 'https://example.com/read/ch1?view=1#paragraph');
});
```

### Step 3: Run RED

- [ ] Run:

```bash
node --test tests/dogfood-contracts.test.js tests/dogfood-source.test.js
```

Expected: FAIL because the modules do not exist.

### Step 4: Implement contracts

- [ ] Implement UMD/CommonJS `dogfood-contracts.js` with exactly these schema/event identities:

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
```

Exports:

```text
SCHEMAS
EVENT_TYPES
INTERACTION_CLASSES
normalizeLearningEvent
normalizeSourceRef
normalizeSentenceRecord
normalizeAnalysisCacheEntry
normalizeExportBundle
normalizeDeleteReceipt
normalizeReplayReport
```

All normalizers reject unknown properties. `LearningEvent/v1` never contains sentence text. Note text is limited to 4000 characters. `dogfood_note_revised` and `dogfood_note_removed` require `refersToEventId`.

### Step 5: Implement source/hash helpers

- [ ] `dogfood-source.js` exports:

```text
PATH_NORMALIZATION_VERSION = path-v1
normalizePageUrl
sha256Text
createSourceRef
createLocalControlSourceRef
createSentenceHash
```

Rules:

```text
page source: http/https only
hostname: lowercase
path hash input: URL.pathname after URL parsing, never query/fragment
sourceId: sha256(domain + "\n" + normalizedPathHash)
local control: domain halo.local, path /data-privacy
fullUrl: null unless retainFullUrl === true
```

### Step 6: Run GREEN and commit

- [ ] Run:

```bash
node --test tests/dogfood-contracts.test.js tests/dogfood-source.test.js
node --test tests/*.test.js
```

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

- [ ] Assert exactly the eight stores/key paths/indexes in the Canonical v0.5 storage identities table.

```js
const EXPECTED = [
  ['profiles', 'profileKey'], ['sources', 'sourceId'], ['sentences', 'sentenceId'],
  ['analyses', 'analysisId'], ['events', 'eventId'], ['settings', 'key'],
  ['cache', 'cacheKey'], ['migrations', 'migrationId']
];
assert.deepEqual(
  Schema.DATABASE_SCHEMA.stores.map((value) => [value.name, value.keyPath]),
  EXPECTED
);
```

### Step 2: Run RED

- [ ] Run `node --test tests/dogfood-storage-schema.test.js` and observe missing-module FAIL.

### Step 3: Implement schema plan

- [ ] `dogfood-storage-schema.js` exports:

```text
DATABASE_NAME = halo-learning-local
DATABASE_VERSION = 1
DATABASE_SCHEMA
MIGRATIONS
applyUpgrade
```

`MIGRATIONS` begins with exactly `{ id: 'v0.5.0-db-1', from: 0, to: 1 }`. Upgrade creates stores/indexes and writes the migration receipt in the same upgrade transaction. No migration deletes data.

### Step 4: Write real IndexedDB RED

- [ ] In `tests/browser/v050-local-data-store.e2e.test.js`, use real page IndexedDB and assert:

```js
const store = await HaloDogfoodStore.openHaloDogfoodStore({ indexedDB });
const status = store.schemaStatus();
assert.deepEqual(status.storeNames, EXPECTED_STORE_NAMES);
const first = await store.appendEvent(event);
const second = await store.appendEvent(event);
assert.deepEqual([first.status, second.status], ['inserted', 'duplicate']);
assert.equal(typeof store.updateEvent, 'undefined');
```

### Step 5: Implement repository

- [ ] `openHaloDogfoodStore({ indexedDB, databaseName, databaseVersion, now })` returns a frozen repository with:

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
exportBundle
exportEventsJsonl
close
```

`queryEvents({limit,before})` defaults to 100 and rejects `limit > 100`. `putSource()` may only enrich an existing source from `fullUrl: null` to the explicitly retained URL; any domain/path identity change is rejected. Initialize `dogfood.preferences` on first open without overwriting an existing record.

### Step 6: Run GREEN and commit

- [ ] Run:

```bash
node --test tests/dogfood-storage-schema.test.js
node --test tests/browser/v050-local-data-store.e2e.test.js
node --test tests/*.test.js
```

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

### Step 1: Write RED capture tests

- [ ] Define one concrete profile in the test:

```js
const profile = Object.freeze({
  profileId: 'halo-default-v0.3.0',
  profileRevision: 2,
  channels: Object.freeze({ posLabel: true, posColor: true, lemma: false, morphology: false, glossHint: true, grammarRole: false, tenseAspect: false, chunk: false, learningState: false }),
  density: 0.65,
  triggerMode: 'hybrid'
});
```

Then assert:

```js
const runtime = Capture.createCaptureRuntime({
  cryptoApi: globalThis.crypto,
  now: () => 1000,
  randomUUID: () => 'uuid-1'
});
runtime.startSession({ sourceRef: 'source:one' });
const passive = await runtime.prepare({
  eventType: 'sentence_exposed', policyDecision: { allow: true },
  sourceRef: 'source:one', language: 'en', sentenceText: 'The model learns.', profile
});
assert.equal(passive.sentenceRecord, null);
assert.equal(passive.event.interactionClass, 'passive');

const explicit = await runtime.prepare({
  eventType: 'gloss_opened', policyDecision: { allow: true },
  sourceRef: 'source:one', language: 'en', sentenceText: 'The model learns.', profile
});
assert.equal(explicit.sentenceRecord.text, 'The model learns.');

const blocked = await runtime.prepare({
  eventType: 'sentence_exposed', policyDecision: { allow: false },
  sourceRef: 'source:one', language: 'en', sentenceText: 'Never persist me.', profile
});
assert.equal(blocked, null);
```

Also assert two identical exposure inputs in the same session generate the same deterministic exposure event ID.

### Step 2: Run RED

- [ ] Run `node --test tests/dogfood-capture.test.js` and observe missing-module FAIL.

### Step 3: Implement capture runtime

- [ ] Export:

```text
CAPTURE_POLICY_VERSION = dogfood-capture-v1
SESSION_POLICY_VERSION = top-level-page-v1
EXPOSURE_POLICY_VERSION = exposure-v1
createCaptureRuntime
classifyEventType
diffProfileEvents
```

`createCaptureRuntime()` exposes `startSession`, `currentSession`, `prepare`. Page navigation calls `startSession` again. Passive `sentence_exposed` IDs are deterministic from:

```text
sessionId + sourceRef + sentenceHash + exposure-v1
```

All other event IDs use `randomUUID`.

`diffProfileEvents(previous,next)` returns only semantic transitions:

```text
density -> density_changed
channel set -> channels_changed
trigger mode -> trigger_mode_changed
other profile revision change -> profile_changed
```

No pointer coordinates or range-input frames are captured.

### Step 4: Run GREEN and commit

- [ ] Run:

```bash
node --test tests/dogfood-capture.test.js tests/dogfood-contracts.test.js tests/dogfood-source.test.js
node --test tests/*.test.js
```

- [ ] Commit:

```bash
git add apps/extension/src/shared/dogfood-capture.js tests/dogfood-capture.test.js
git commit -m "feat: add privacy bounded dogfood capture runtime"
```

---

## Task 4: V050-D/E — Analysis cache, retention, projector, replay

**Files:**
- Create: `apps/extension/src/shared/dogfood-projector.js`
- Create: `tests/dogfood-projector.test.js`
- Modify: `apps/extension/src/shared/dogfood-store.js`
- Modify: `tests/browser/v050-local-data-store.e2e.test.js`

### Step 1: Write RED projector tests

- [ ] Feed the same canonical events twice and require byte-equivalent projection JSON.

```js
const a = Projector.project(events, attachments);
const b = Projector.project(JSON.parse(JSON.stringify(events)), JSON.parse(JSON.stringify(attachments)));
assert.equal(JSON.stringify(a), JSON.stringify(b));
assert.equal(Object.hasOwn(a, 'mastery'), false);
```

Project exactly:

```text
overview
activity
sites
sessions
savedSentences
notes
```

Note state folds create -> revise -> remove using `refersToEventId`; saved state folds `sentence_saved` / `sentence_unsaved` without mutating history.

### Step 2: Add cache/retention RED in real IndexedDB

- [ ] Assert:

```text
cache key includes textHash + contextHash + algorithmVersion
expired cache -> miss
algorithm-version mismatch -> miss
passive event older than 30 days -> pruned
ordinary event older than 90 days -> pruned
explicit-learning/dogfood-note -> retained
source/sentence/analysis attachment -> GC only when no surviving reference
```

### Step 3: Implement projector/replay

- [ ] Export:

```text
PROJECTOR_VERSION = dogfood-projector-v1
project(events, attachments)
createReplayReport({events,projection,skipped,cryptoApi})
```

`ReplayReport/v1` includes source event count/range, projector version, projection hash, skipped invalid event IDs, and success/failure.

### Step 4: Implement cache/retention

- [ ] `putCache/getCache/pruneRetention` use injected `now` for tests and production `Date.now()`. Do not route semantic annotation through this cache in the dogfood phase.

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

## Task 5: V050-F — Export, empty-DB import contract, scoped delete

**Files:**
- Modify: `apps/extension/src/shared/dogfood-store.js`
- Create: `tests/dogfood-export-delete.test.js`
- Modify: `tests/browser/v050-local-data-store.e2e.test.js`

### Step 1: Write RED export tests

- [ ] Require `ExportBundle/v1` arrays:

```text
events
sources
sentences
profiles
analyses
settings
```

and require `cache` to be absent. JSON/JSONL must not manufacture missing sentence text or full URLs.

### Step 2: Write RED browser round-trip and delete tests

- [ ] Real IndexedDB:

```text
DB A -> exportBundle -> empty DB B -> importBundleIntoEmptyStore -> replay hashes equal
```

Delete scopes are exactly:

```js
{ kind: 'domain', domain: 'example.com' }
{ kind: 'time-range', from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T23:59:59.999Z' }
{ kind: 'all-dogfood' }
```

`clearAnalysisCache()` is separate.

### Step 3: Run RED

- [ ] Run:

```bash
node --test tests/dogfood-export-delete.test.js tests/browser/v050-local-data-store.e2e.test.js
```

### Step 4: Implement transactionally

- [ ] `importBundleIntoEmptyStore()` refuses any non-empty canonical target store. `deleteByScope()` returns `DeleteReceipt/v1`, removes matching events, then garbage-collects unreferenced source/sentence/analysis records in the same transaction. Any transaction failure aborts the operation.

### Step 5: Run GREEN and commit

- [ ] Run focused + full Node tests, then commit:

```bash
git add apps/extension/src/shared/dogfood-store.js tests/dogfood-export-delete.test.js tests/browser/v050-local-data-store.e2e.test.js
git commit -m "feat: add local export replay and scoped delete"
```

---

## Task 6: V050-B/F — Shared dogfood data service and service-worker capture transport

**Files:**
- Create: `apps/extension/src/shared/dogfood-data-service.js`
- Modify: `apps/extension/src/service-worker.js`
- Create: `tests/dogfood-data-service.test.js`
- Modify: `tests/browser-trigger-entry.test.js`

### Step 1: Write RED data-service tests

- [ ] Use an explicit fake repository:

```js
const writes = [];
const repository = {
  async appendEvent(value) { writes.push(['event', value]); return { status: 'inserted' }; },
  async putSource(value) { writes.push(['source', value]); },
  async putSentence(value) { writes.push(['sentence', value]); },
  async putProfileSnapshot(value) { writes.push(['profile', value]); },
  async getSetting() { return { key: 'dogfood.preferences', schemaVersion: 1, captureEnabled: true, retention: { passiveDays: 30, ordinaryDays: 90, explicitDays: null, dogfoodNoteDays: null } }; },
  async putSetting(value) { writes.push(['setting', value]); },
  async queryEvents() { return { items: [], next: null }; },
  async readReplayDataset() { return { events: [], sources: [], sentences: [] }; },
  async estimateUsage() { return { bytes: 0 }; }
};
```

`createDogfoodDataService({repository, contracts, sourceModule, projector, now, randomUUID, getCurrentProfile})` must:

```text
persistCapture(envelope)
status()
query(view, options)
createStandaloneNote(text)
reviseNote(eventId, text)
removeNote(eventId)
unsaveSentence(sentenceId)
setCaptureEnabled(boolean)
exportBundle()
exportEventsJsonl()
deleteByScope(scope)
clearAnalysisCache()
replay()
```

`persistCapture()` re-normalizes event/source/sentence before writing. If `captureEnabled === false`, page capture is a no-op. When an event carries profile ID/revision, call `getCurrentProfile()` and persist a `profileKey = profileId@profileRevision` snapshot only if the identities match.

### Step 2: Test pause/resume ordering

- [ ] `setCaptureEnabled(false)` appends `capture_paused` using the local-control SourceRef **before** writing `captureEnabled:false`; resume writes setting first then `capture_resumed`. Standalone dashboard notes also use the local-control source and carry no sentence text.

### Step 3: Run RED

- [ ] Run `node --test tests/dogfood-data-service.test.js` and observe missing-module FAIL.

### Step 4: Implement shared data service

- [ ] `status()` is exactly:

```js
{
  schemaVersion: 1,
  mode: 'ready' | 'storage-degraded',
  captureEnabled: true | false,
  lastErrorCode: null | 'INDEXEDDB_UNAVAILABLE' | 'QUOTA_EXCEEDED' | 'MIGRATION_FAILED'
}
```

Repeated storage-open/write failure enters `storage-degraded`; ordinary semantic/renderer paths are untouched.

### Step 5: Integrate service worker

- [ ] Add `importScripts()` / CommonJS dependencies for dogfood contracts/source/schema/store/projector/data-service. Keep current semantic service exports and message handling intact.

- [ ] Add a separate `initializeDogfoodBrowser()` with only two runtime message families from browser surfaces:

```text
HALO_DOGFOOD_CAPTURE  content page -> write, requires createWorkerPolicyAuthorizer(sender) === true
HALO_DOGFOOD_STATUS   popup/extension UI -> read status
```

`HALO_DOGFOOD_CAPTURE` accepts only a normalized capture envelope; there is no generic store operation over page messaging. Options UI does not send large exports through runtime messaging; it uses the shared data service directly.

### Step 6: Run GREEN and commit

- [ ] Run:

```bash
node --test tests/dogfood-data-service.test.js tests/browser-trigger-entry.test.js
node --test tests/*.test.js
```

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

### Step 1: Write RED renderer-action tests

- [ ] A panel may expose exactly:

```js
actions: [
  { id: 'save-sentence', label: 'Save sentence · 儲存句子' },
  { id: 'dogfood-note', label: 'Dogfood note · 體驗註記' }
]
```

`dogfood-note` opens an inline textarea + Save/Cancel. Renderer constructor receives `onPanelAction`. Saving calls:

```js
onPanelAction({ id: 'dogfood-note', value: 'note text', observationKey: 'obs:1' });
```

Saving a sentence calls the same callback with `id:'save-sentence'` and `value:null`.

Add private token observation identity:

```text
fragment.observationKey -> WeakMap metadata -> renderer.observationKeyForToken(token)
```

Never place sentence text or full URL in `data-*` attributes.

### Step 2: Write RED content-client tests

- [ ] `dogfood-content.js` exports:

```text
createDogfoodContentClient
```

Client methods:

```text
startPageSession
recordApply
recordRemove
recordExposure
recordExplicitOpen
saveSentence
createNote
recordProfileDiff
routeChanged
```

Each method builds a source/capture envelope through `dogfood-source` + `dogfood-capture`, then sends only `{type:'HALO_DOGFOOD_CAPTURE', envelope}`. Any send/storage rejection calls `onError('DOGFOOD_CAPTURE_UNAVAILABLE')` and resolves without throwing into the v0.4 runtime.

### Step 3: Run RED

- [ ] Run:

```bash
node --test tests/reversible-renderer.test.js tests/dogfood-content.test.js tests/browser-entry-idempotent-injection.test.js
```

### Step 4: Implement private sentence observation contexts

- [ ] Add content-side modules to `HaloBrowserEntry.INJECT_FILES` before `content.js`:

```text
src/shared/dogfood-contracts.js
src/shared/dogfood-source.js
src/shared/dogfood-capture.js
src/shared/dogfood-content.js
```

- [ ] In `renderBatch()`, create a bounded private map entry per sentence:

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
  algorithmVersion: Semantic.ENGINE.version
}
```

Pass only `observationKey` to renderer-private metadata. Remove contexts on root invalidation, Remove, route cleanup, and runtime replacement.

### Step 5: Instrument allowed events

- [ ] After `activePolicyDecision.allow === true` only:

```text
successful Apply -> halo_applied
successful user Remove on allowed page -> halo_removed
first/coalesced sentence exposure -> sentence_exposed
explicit open with gloss -> gloss_opened + sparse SentenceRecord
explicit detail open without gloss -> explanation_opened + sparse SentenceRecord
Save button -> sentence_saved + SentenceRecord
sentence-linked note -> dogfood_note_created + SentenceRecord + UI snapshot
profile/storage change diff -> density/channels/trigger/profile event
route start -> new session
```

Hover-open may show the panel but does not become explicit-learning and does not retain sentence text.

### Step 6: Real-browser privacy gate

- [ ] `v050-capture-privacy.e2e.test.js` proves:

```text
allowed EN -> events
allowed zh-Hant -> events
repeated exposure callbacks -> one event per coalescing key
passive -> no sentence record
explicit Save -> retained sentence
sentence-linked note -> retained sentence + note
sensitive fixture -> event count unchanged
ordinary SourceRef -> query/fragment/fullUrl absent
explicit return action -> fullUrl may appear
```

Reuse the real v0.4 site-policy/security path, not a weaker fixture-only policy.

### Step 7: Run GREEN + v0.4 regressions

- [ ] Run:

```bash
node --test tests/reversible-renderer.test.js tests/dogfood-content.test.js tests/browser-entry-idempotent-injection.test.js
node --test tests/browser/v050-capture-privacy.e2e.test.js
node --test tests/browser/sensitive-site-product-security.e2e.test.js
node --test tests/browser/reversible-renderer.e2e.test.js
node --test tests/*.test.js
```

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

- [ ] Seed real IndexedDB through the shared data service, open `src/options.html`, and require these eight sections:

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

Overview is descriptive only and must not present mastery/confidence/level claims.

### Step 2: Implement manifest/options shell

- [ ] Update manifest:

```json
{
  "version": "0.5.0",
  "options_page": "src/options.html"
}
```

Preserve permissions exactly:

```json
["activeTab", "contextMenus", "scripting", "storage"]
```

No `host_permissions`.

- [ ] Options page loads the shared dogfood modules needed to open `dogfood-store`/`dogfood-data-service` directly in the extension origin. All list queries are paged with `limit <= 100`.

### Step 3: Implement eight views

- [ ] Required UI behavior:

```text
Overview -> active days/sites/events/explicit/saved/notes/language/profile/density/bytes/date range
Activity -> newest-first chronological list
Sites & Sessions -> grouped deterministic projection + drill-down
Learning Events -> type/domain/date filters + structured detail
Saved Sentences -> retained text cards + Unsave action
Dogfood Notes -> standalone create + revise + logical remove
Data & Privacy -> capture on/off, retention text, JSON/JSONL export, site/date/all delete, cache clear
System / Replay -> DB/schema/projector status + replay report
```

`Unsave` calls `dogfoodDataService.unsaveSentence(sentenceId)`; the service loads the original sentence/source reference and appends `sentence_unsaved` without deleting unrelated historical events.

Delete actions require a confirmation dialog naming the exact scope. Export creates browser-local Blob downloads from the direct repository/service result; no remote request.

### Step 4: Keep popup small

- [ ] Add only:

```html
<output id="dogfoodCaptureStatus">Local capture · 本機紀錄</output>
<button id="openDashboardButton" class="secondary" type="button">Data Dashboard · 本機資料</button>
```

Popup asks only `HALO_DOGFOOD_STATUS` and calls `chrome.runtime.openOptionsPage()`; no event table or analytics lives in the popup.

### Step 5: Accessibility

- [ ] Dashboard: one `h1`, landmark navigation, labelled filters/textarea, `aria-live` operation status, visible focus, reduced-motion support, forced-colors support. Existing popup/browser accessibility remains green.

### Step 6: Run GREEN and commit

- [ ] Run:

```bash
node --test tests/browser/v050-dashboard.e2e.test.js
node --test tests/accessibility-contract.test.js
node --test tests/browser/accessibility.e2e.test.js
node --test tests/*.test.js
```

- [ ] Commit:

```bash
git add apps/extension/src/options.html apps/extension/src/options.css apps/extension/src/options.js apps/extension/src/popup.html apps/extension/src/popup.css apps/extension/src/popup.js apps/extension/manifest.json tests/browser/v050-dashboard.e2e.test.js tests/accessibility-contract.test.js
git commit -m "feat: add v0.5 local data dashboard"
```

---

## Task 9: V050-H — Persistent dogfood acceptance and installable DOGFOOD package

**Files:**
- Create: `tests/browser/v050-dogfood-acceptance.e2e.test.js`
- Create: `scripts/package-v0.5.0-dogfood.js`
- Create: `tests/package-v0.5.0-dogfood.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `docs/dogfood/v0.5.0-local-install.md`
- Create after verification: `docs/dogfood/v0.5.0-dogfood-validation.md`

### Step 1: Write persistent-context RED

- [ ] Launch a real extension with one `userDataDir`, write EN + zh-Hant dogfood data, close Chromium, relaunch with the same directory, then assert:

```text
EN events persist
zh-Hant events persist
Saved Sentence persists
Dogfood Note persists
Dashboard sees the same state
Replay projection hash is unchanged
```

Then assert site/date/all deletion, sensitive capture zero, and existing v0.4 Apply/Remove/dynamic behavior.

### Step 2: Storage-degraded acceptance

- [ ] Inject IndexedDB-open/write failure at the dogfood repository boundary and require:

```text
status = storage-degraded
no remote fallback
Apply still marks
Remove still restores
capture failure does not reject the marking path
```

### Step 3: Write package RED

- [ ] Require:

```text
dist/halo-learning-magic-hand-v0.5.0-dogfood.zip
manifest version 0.5.0
options page included
all required dogfood modules included
no node_modules/.git/test-fixtures
no host_permissions
DOGFOOD label, never public-release-ready
```

### Step 4: Update package metadata/scripts

- [ ] Set both `package.json` and lockfile root/package versions to `0.5.0` without changing dependency versions. Add:

```json
{
  "dogfood:test": "node --test tests/dogfood-*.test.js",
  "dogfood:browser": "node --test tests/browser/v050-*.e2e.test.js",
  "dogfood:package": "node scripts/package-v0.5.0-dogfood.js"
}
```

Preserve existing v0.4 validation/package scripts for historical evidence; do not repoint them to v0.5.

### Step 5: Implement deterministic dogfood packager

- [ ] Create a new script; do not overwrite v0.4 artifacts.

```js
const DOGFOOD_VERSION = 'v0.5.0-dogfood';
const EXTENSION_OUTPUT = 'dist/halo-learning-magic-hand-v0.5.0-dogfood.zip';
const CANONICAL_MTIME = new Date('2026-08-28T00:00:00.000Z');
```

Build twice in the package test and require byte-identical ZIP SHA-256.

### Step 6: Write local install guide

- [ ] Exact guide steps:

```text
1. npm ci
2. run dogfood Node/browser gates
3. npm run dogfood:package
4. chrome://extensions or edge://extensions
5. Developer mode -> Load unpacked -> apps/extension/
6. Open ordinary EN/zh-Hant page -> Apply
7. Open Data Dashboard from popup
8. Verify Activity/Overview
9. Save a sentence + create a Dogfood Note
10. Restart browser and verify persistence
11. Export JSON/JSONL before destructive delete experiments
```

Label the build **LOCAL DOGFOOD — NOT PUBLIC v0.5 RELEASE**.

### Step 7: Run final dogfood gate

- [ ] Run fresh:

```bash
npm ci
node --test tests/*.test.js
npm run dogfood:test
npm run dogfood:browser
node --test tests/browser/sensitive-site-product-security.e2e.test.js
node --test tests/browser/dynamic-dom.e2e.test.js
node --test tests/browser/reversible-renderer.e2e.test.js
node --test tests/browser/trigger-controller.e2e.test.js
npm run dogfood:package
node --test tests/package-v0.5.0-dogfood.test.js
```

If the governed Linux host uses native shortcut evidence, run the trigger gate with the same proven visible-Chromium/Xvfb + `HALO_NATIVE_SHORTCUT_DRIVER=xdotool` environment used by the v0.4 acceptance workflow rather than weakening the trigger semantics.

### Step 8: Record validation

- [ ] `docs/dogfood/v0.5.0-dogfood-validation.md` records exact tested commit SHA, commands/pass counts, Chromium executable/version, package SHA-256, known limitations, and:

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
git add tests/browser/v050-dogfood-acceptance.e2e.test.js scripts/package-v0.5.0-dogfood.js tests/package-v0.5.0-dogfood.test.js package.json package-lock.json docs/dogfood/v0.5.0-local-install.md docs/dogfood/v0.5.0-dogfood-validation.md
git commit -m "dogfood: package Halo Learning v0.5 local build"
```

- [ ] **STOP. Do not begin formal v0.5 release closure or v0.6.** Hand the installable dogfood artifact and local-install guide to the user for real use.

---

# Deferred Phase — Formal v0.5 Release Gate (NOT authorized in this implementation run)

This phase preserves the approved V050-I boundary and starts only after real dogfood review plus fresh user authorization. The later release-closure plan must cover:

```text
migration interruption
quota/write failure
duplicate-event stress
malformed export/import
transactional delete rollback
retention/orphan-cleanup stress
privacy audit
full browser regression
standalone package validation
reproducible public-release packaging
migration/release evidence
```

The dogfood implementation must not silently convert itself into a formal v0.5 release.

## Plan self-review result

The implementation plan was checked against the approved design for:

- all A–H dogfood work packages;
- all eight canonical stores;
- all seven named versioned contracts;
- capture coalescing and URL minimization;
- sparse sentence retention;
- Dogfood Note persistence/revision/removal;
- profile/UI context snapshots;
- retention/cache/replay/export/delete;
- sensitive-site zero-capture;
- storage-degraded behavior;
- eight-section Dashboard;
- browser restart persistence;
- deterministic DOGFOOD packaging;
- explicit stop before V050-I/v0.6.

Ambiguities resolved at plan level:

1. Dogfood Note text uses the discriminated `LearningEvent/v1.detail.noteText` field; no ninth store is introduced.
2. `capture_paused`, `capture_resumed`, and standalone dashboard notes use the reserved `halo.local` SourceRef so `sourceRef` stays structurally present.
3. Extension Options UI opens the shared local repository directly for potentially large export/delete/replay operations; runtime messaging remains narrow and page capture cannot invoke admin operations.
4. Profile snapshots are keyed by `profileId@profileRevision` and are written only after identity matches current canonical Halo settings.
5. Project/package version becomes `0.5.0` for the local build, while the artifact and documentation remain explicitly labeled DOGFOOD.
6. Analysis cache is implemented as substrate but does not become a new v0.4 semantic correctness dependency before dogfood.

No `TBD`, `TODO`, unspecified provider choice, unspecified store name, unspecified event family, or unspecified acceptance outcome remains in this plan.

## Plan Completion Criteria

The current run stops after Task 9 when:

```text
[ ] v0.4 marking remains green
[ ] IndexedDB persists through browser restart
[ ] structured events are visible in Dashboard
[ ] passive capture is coalesced
[ ] passive/ordinary events retain no sentence text
[ ] sensitive pages produce zero durable capture
[ ] explicit learning actions may retain associated sentence text
[ ] Save Sentence works
[ ] contextual Dogfood Notes work
[ ] JSON + JSONL export work
[ ] site/date/all delete work
[ ] cache clear works independently
[ ] deterministic replay rebuilds projections
[ ] storage failure degrades capture, not marking
[ ] Dashboard exposes observation without learner-state claims
[ ] deterministic v0.5.0-dogfood ZIP exists
[ ] local install guide + validation record exist
[ ] v0.6 remains provisional
```
