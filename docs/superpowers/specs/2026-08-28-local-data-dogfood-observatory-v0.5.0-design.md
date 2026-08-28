# Halo Learning v0.5.0 Local Data & Dogfood Observatory Design

**Date:** 2026-08-28  
**Release:** v0.5.0 — Local Data, Event Store & Dogfood Observatory  
**Base:** v0.4.0 Browser Runtime & UX (`main` @ `5430dd9608d311aa04651ed36cb5f85d07a5138c`)  
**Branch:** `workbench/v0.5.0-local-dogfood`

## 1. Purpose and release boundary

v0.5.0 adds the first durable local learning-data layer to the validated v0.4.0 browser runtime. The canonical roadmap already assigns v0.5.0 these responsibilities:

- local-first IndexedDB storage;
- append-only learning events;
- privacy-aware capture;
- versioned analysis cache;
- export and scoped deletion;
- deterministic replay/projector seams;
- a user-facing data/options UI.

This design keeps those responsibilities but changes the execution emphasis: **v0.5.0 is first a local dogfood build, then a release candidate.** The user must be able to install it locally, use it on real Chinese and English pages, inspect what Halo records, add direct experience notes, and use that evidence to judge the later learner-model design.

```text
v0.4 validated browser runtime
  -> v0.5 local durable observation
  -> real dogfood use
  -> UX + behavioral evidence
  -> v0.6 design revision
```

v0.5.0 does **not** claim learner mastery, learner level, confidence, adaptive scaffolding, gap planning, Halo Story, cloud sync, login, billing, remote AI, new languages, teacher tooling, or a new semantic model.

The original v0.6.0 learner-model roadmap remains provisional until dogfood evidence is reviewed.

## 2. Canonical invariants

v0.5.0 preserves all v0.4.0 product invariants:

- local-first;
- provider-agnostic semantic core;
- English + Traditional Chinese first;
- semantic state remains separate from visual projection;
- reversible DOM rendering;
- privacy-minimized capture;
- sensitive sites fail closed;
- no new production host-permission expansion;
- the marking runtime continues to work if durable storage is unavailable.

v0.5.0 adds these data invariants:

1. **Exposure is not learning intent.**
2. **A LearningEvent does not imply stored sentence text.**
3. **Events are append-only between explicit retention/deletion operations.**
4. **Derived dashboard counters are projections, not canonical truth.**
5. **No v0.5 projection may infer mastery or language level.**
6. **Sensitive-site policy is evaluated before durable capture.**
7. **Export, delete, and replay operate on explicit versioned contracts.**
8. **Storage failure must not break ordinary v0.4 marking.**
9. **Passive capture must be bounded/coalesced; scroll or viewport churn may not create unbounded telemetry.**
10. **Path hashes are pseudonymous references, not anonymization guarantees.**

## 3. Product strategy: dogfood before v0.6

The main unknown after v0.4.0 is no longer whether the browser runtime can be engineered. It is how the product actually feels during repeated use.

v0.5.0 must collect enough local evidence to answer questions such as:

- which annotation channels are useful during normal reading;
- which channels become visually noisy over time;
- whether English and Traditional-Chinese pages need different defaults;
- which detail/gloss interactions are intentional learning actions versus casual inspection;
- what marking density is comfortable on different page types;
- whether trigger timing and panel behavior feel intrusive;
- which interactions are unsafe to interpret as evidence of learning;
- what the user needs to inspect or delete from local storage.

The v0.5 dashboard exposes observation, not scoring.

Allowed views include exposure/interaction counts, explicit learning signals, saved sentences, site/session distribution, language distribution, profile/channel/density context, dogfood notes, and local storage usage.

Forbidden claims include:

```text
you mastered X
your English level is Y
this concept should now receive less scaffolding
this vocabulary item is learned
```

## 4. User-facing surfaces

### 4.1 Daily popup

The popup remains intentionally small and optimized for ordinary reading. It may expose:

- Apply / Remove;
- current-site state;
- current profile;
- density control;
- compact local-capture status;
- link/button to the full Data Dashboard.

The popup is not the primary data-management surface.

### 4.2 Options / Data Dashboard

The Options page becomes the main v0.5 user-facing addition. It has eight logical sections:

1. **Overview**
2. **Activity**
3. **Sites & Sessions**
4. **Learning Events**
5. **Saved Sentences**
6. **Dogfood Notes**
7. **Data & Privacy**
8. **System / Replay**

These are views over shared storage contracts, not independent silos.

### 4.3 Overview

Overview shows descriptive local state only:

- Halo-active days;
- sites with retained events;
- retained structured-event count;
- explicit learning-signal count;
- saved-sentence count;
- dogfood-note count;
- EN / zh-Hant usage distribution;
- current profile / density;
- approximate local database bytes;
- oldest/newest retained event timestamps.

No mastery or level score is displayed.

### 4.4 Activity

Activity is a chronological projection and must work even when historical events have no retained sentence text.

```text
21:07  example.com
       sentence exposed
       profile: balanced

21:08  gloss opened
       explicit learning signal
       sentence retained

21:10  dogfood note
       "tense labels too noisy here"
```

### 4.5 Sites & Sessions

A `sessionId` is attached to events. A session begins when Halo starts an allowed top-level page-use interval and changes on top-level navigation or a versioned inactivity/session-boundary rule. The event records the `sessionPolicyVersion`, so future grouping changes do not reinterpret historical data silently.

A separate canonical session store is not required. Session summaries are projected from events and may group by domain, date/time, language, profile, and explicit-learning-signal count.

### 4.6 Saved Sentences

Saved Sentences shows only sentence text that capture policy allowed to be persisted. Saving is an explicit learning action but is not equivalent to mastery.

### 4.7 Dogfood Notes

Dogfood Notes is a first-class v0.5 feature because human experience is part of the evidence used to redesign v0.6.

A contextual note records:

```yaml
note:
  text: "tense labels too noisy here"
  timestamp: ...
  siteRef: ...
  sentenceRef: optional
  profileId: ...
  profileRevision: ...
  activeChannels: [...]
  density: ...
  triggerMode: ...
```

When created from a sentence/detail surface, the note may retain that sentence under the explicit-learning capture rule. Dashboard notes may exist without a sentence reference.

Edits append a revision event referencing the prior note event. Logical note removal appends a removal event unless the user invokes explicit physical data deletion.

## 5. Capture policy

Automatic local dogfood capture is enabled by default on ordinary permitted sites. Manual "start recording" is not required. Data & Privacy may expose a user-controlled pause switch, but the dogfood default is capture-on.

```yaml
passive_exposure:
  structured_event: true
  sentence_text: false

ordinary_interaction:
  structured_event: true
  sentence_text: false

explicit_learning_signal:
  structured_event: true
  sentence_text: true

dogfood_note:
  structured_event: true
  sentence_text: true_when_sentence_context_exists
  ui_state_snapshot: true

sensitive_site:
  structured_event: false
  sentence_text: false
  behavior: fail_closed
```

### 5.1 Passive/ordinary capture never retains sentence text

Examples include annotation exposure/render, ordinary hover, ordinary scroll, ordinary click, Apply/Remove, and profile/density/channel changes. Events may contain hash-based references where needed, but not sentence text.

### 5.2 Explicit learning signals

The v0.5 signals that may retain the associated sentence text on an allowed site are:

- explicit gloss open;
- explicit explanation/detail open;
- Save Sentence;
- sentence-linked Dogfood Note.

Future comprehension or transfer probes may join this category later; v0.5 does not implement them.

### 5.3 Capture coalescing and deduplication

Dogfood capture must describe use without becoming a scroll logger.

Rules:

- one passive exposure event at most per `sessionId + sourceRef + sentenceHash + exposurePolicyVersion`;
- repeated IntersectionObserver callbacks for the same sentence do not append new exposure events;
- raw scroll coordinates are not stored;
- hover is stored only when it crosses an existing Halo interaction boundary worth observing, not for every pointer movement;
- profile/channel/density changes append on semantic setting transition, not every UI input frame;
- repeated event submission uses stable idempotent `eventId` rules;
- capture policy has an explicit version so later coalescing changes remain interpretable.

### 5.4 URL privacy

Ordinary retained activity stores:

```yaml
site:
  domain: readable
  normalizedPathHash: stored
  query: not_stored
  fragment: not_stored
  fullUrl: not_stored_by_default
```

`normalizedPathHash` is a pseudonymous grouping key, not a claim that common paths cannot be guessed. Normalization excludes query and fragment before hashing and is versioned by `pathNormalizationVersion`.

A full URL may be retained only when the user performs an explicit action whose purpose is later return/reproduction, such as Save Sentence or a Dogfood Note. It remains local and deletable.

## 6. Storage architecture

### 6.1 IndexedDB database

Use one versioned Halo Learning IndexedDB database. Canonical stores follow the roadmap:

```text
profiles
sources
sentences
analyses
events
settings
cache
migrations
```

Sessions, Activity, Sites, and Dogfood Notes are primarily projections rather than new canonical stores.

### 6.2 Contract set

v0.5 introduces explicit schema IDs:

```text
LearningEvent/v1
SourceRef/v1
SentenceRecord/v1
AnalysisCacheEntry/v1
ExportBundle/v1
DeleteReceipt/v1
ReplayReport/v1
```

Every contract carries enough schema/provenance information to export and re-read data without hidden runtime state.

### 6.3 LearningEvent baseline

`events` is the canonical observation log. A baseline event contains:

```yaml
schema: LearningEvent/v1
eventId: ...
timestamp: ...
eventType: ...
sessionId: ...
sessionPolicyVersion: ...
sourceRef: ...
language: ...
sentenceRef: optional
sentenceHash: optional
interactionClass: passive | ordinary | explicit-learning | dogfood-note
capturePolicyVersion: ...
profileId: optional
profileRevision: optional
uiContext:
  activeChannels: optional
  density: optional
  triggerMode: optional
algorithmVersion: optional
refersToEventId: optional
```

No mastery/confidence field exists in v0.5.

Baseline event families include:

```text
halo_applied
halo_removed
sentence_exposed
gloss_opened
explanation_opened
sentence_saved
sentence_unsaved
dogfood_note_created
dogfood_note_revised
dogfood_note_removed
profile_changed
density_changed
channels_changed
trigger_mode_changed
capture_paused
capture_resumed
```

The implementation may add narrowly necessary administrative events, but new event types must remain observational and versioned.

Event-store requirements:

- stable idempotent `eventId`;
- duplicate insert is a deterministic no-op/safe duplicate result;
- no ordinary `updateEvent` API;
- revisions/corrections append new events;
- events may refer to sentence identity without storing sentence text.

### 6.4 SourceRef

`sources` stores privacy-minimized grouping/reconstruction data:

- readable domain;
- normalized path hash;
- path-normalization version;
- optional explicitly retained full URL;
- language observations;
- timestamps/provenance required by export/delete.

Query strings and fragments are never captured by default.

### 6.5 SentenceRecord

`sentences` is sparse by design. A record exists only when capture policy permits text retention.

It contains stable local sentence id, exact retained text, language, text hash, source reference, capture reason, capture timestamp, and required algorithm/profile provenance.

An event referencing a non-retained sentence remains valid.

### 6.6 Analysis cache

The cache key follows the roadmap:

```text
textHash + contextHash + algorithmVersion
```

Entries include TTL and provenance. Algorithm-version change never silently reuses incompatible cache. Cache is an optimization, not learner evidence, and may be cleared independently.

### 6.7 Profiles/settings

Profiles/settings preserve active v0.4 visual configuration and capture preferences. Historical events carry the minimal profile revision/context needed to interpret old interactions after settings change.

### 6.8 Migrations

IndexedDB upgrades use a versioned migration registry with explicit from/to versions, safe restart behavior, no silent data drop, visible migration failures, and no dependency on future v0.6 mastery projections.

Storage migration failure may put capture into `storage-degraded`, but safe v0.4 marking remains available.

## 7. Retention policy

Automatic capture must not become an indefinite local browsing-history archive.

```text
passive telemetry events        rolling 30 days
ordinary interaction events    rolling 90 days
explicit learning events       until manual delete
saved sentences                until manual delete
dogfood notes                  until manual delete
analysis cache                 TTL / algorithm-version invalidation
```

Retention cleanup is an explicit storage-governance operation, not an in-place update of surviving events. Orphaned `SourceRef` and unreferenced sentence/analysis attachments are garbage-collected transactionally after retention/deletion when no surviving record references them.

The dashboard exposes current retention rules. Custom retention periods are not required for the first dogfood build.

## 8. Capture data flow

The durable observer runs only after the v0.4 site/security decision:

```text
page interaction
  -> v0.4 site/privacy policy
      -> blocked/sensitive: no durable capture
      -> allowed:
           classify + coalesce interaction
           -> structured LearningEvent
           -> optional SentenceRecord only for explicit signal
           -> IndexedDB transaction
           -> dashboard projections
```

Storage consumes runtime outcomes; it never becomes semantic authority for rendering.

## 9. Replay and projections

v0.5 replay is **data replay**, not video/browser replay.

```text
retained event log
  -> deterministic projector
  -> counters / activity / sessions / site summaries
```

The same retained event sequence and projector version yields the same projection. Replay does not recreate historical DOM and does not guess missing sentence text.

`ReplayReport/v1` records event range/count, projector version, projection summary/hash, skipped/invalid records, and deterministic success/failure.

This is the seam a later v0.6 learner projector may consume without putting a learner model inside v0.5.

## 10. Export

The dashboard supports:

- JSON bundle export;
- JSONL event export.

Exports contain version/provenance metadata and enough references to rebuild v0.5 projections in an empty compatible database.

Rules:

- sentence text appears only if retained locally;
- missing text stays missing;
- full URLs appear only if explicitly retained;
- export never adds remote data;
- export failure cannot mutate storage.

A round-trip test must prove exported versioned data can be loaded/replayed in an empty test database. A public import UI is optional for the first dogfood build; the test/import contract path is required.

## 11. Delete and reset semantics

Data & Privacy supports at minimum:

- delete by site/domain;
- delete by date/time range;
- delete all retained learning/dogfood data;
- clear analysis cache independently.

User-authorized deletion is an explicit governance exception to append-only history. A delete transaction removes matching events plus sentence/analysis/source attachments that become unreferenced; it must not leave misleading dangling dashboard projections.

`DeleteReceipt/v1` returns scope, affected-record counts, and success/failure. For full user-data wipe, the receipt may be shown transiently rather than written back into the cleared database.

Settings reset is separate unless the UI explicitly labels a full Halo reset.

## 12. Dogfood Notes workflow

Preferred entry points:

- sentence/detail panel: `Add dogfood note` with live sentence/UI context;
- Options dashboard: standalone note for general UX observations.

Halo captures the active profile revision, channels, density, trigger mode, site reference, and optional sentence reference automatically.

This creates a reviewable evidence tuple:

```text
observed events
+ configuration at the time
+ explicit human experience note
```

v0.6 design review uses all three, not raw telemetry alone.

## 13. Failure behavior

### 13.1 IndexedDB unavailable

- v0.4 marking remains usable;
- capture enters `storage-degraded`;
- popup/dashboard exposes an ephemeral local diagnostic;
- no remote fallback is introduced;
- repeated failing writes are throttled/stopped.

### 13.2 Quota exceeded

- stop non-critical new retention safely;
- preserve committed data;
- surface usage/diagnostic;
- offer export/delete/clear-cache;
- do not disable ordinary marking.

### 13.3 Duplicate event

Repeated `eventId` insertion is deterministic and does not duplicate evidence.

### 13.4 Interrupted migration

Failure is detectable; writes fail closed until a valid storage state is recovered. No partially reinterpreted schema may appear healthy.

### 13.5 Export failure

Export is read-only with respect to canonical storage.

## 14. Data Dashboard implementation boundaries

The dashboard is a local extension page. No server/account/remote analytics service is required.

Queries are paged/bounded; a large event log is never rendered as one giant DOM table.

Recommended presentation:

- Overview: compact cards + counts;
- Activity: virtualized/paged chronological list;
- Sites & Sessions: grouped summaries + drill-down;
- Learning Events: filterable structured table/detail;
- Saved Sentences: readable cards/list;
- Dogfood Notes: note timeline + filters;
- Data & Privacy: retention/export/delete/storage/capture controls;
- System / Replay: schema/algorithm/migration status and replay report.

The first dogfood UI prioritizes inspectability and correctness over decorative polish.

## 15. Testing strategy

v0.5 dogfood is intentionally lighter than the v0.4 final convergence process, but still requires engineering evidence before local installation.

### 15.1 Unit / contract tests

Cover schema creation/versioning, migration registry, idempotent append, absence of ordinary event update, capture coalescing, sparse sentence records, URL minimization, retention, cache version/TTL, replay determinism, export round-trip, scoped deletion, and orphan cleanup.

### 15.2 Privacy tests

Required cases:

- sensitive-site event count remains unchanged;
- passive/ordinary events store no sentence text;
- explicit learning signal retains only its associated sentence;
- query/fragment are absent;
- full URL appears only after an allowed explicit action;
- path hash is generated only after query/fragment removal;
- repeated viewport callbacks do not multiply passive exposure events.

### 15.3 Browser E2E

Required dogfood flows:

1. install/load extension;
2. use Halo on a normal English page;
3. use Halo on a normal Traditional-Chinese page;
4. restart browser/extension and observe persisted events;
5. inspect dashboard;
6. create sentence-linked Dogfood Note;
7. save sentence;
8. export JSON/JSONL;
9. delete by site/date;
10. replay/rebuild projections;
11. verify sensitive-site capture remains zero;
12. verify v0.4 Apply/Remove/dynamic-page behavior remains intact.

### 15.4 Failure injection

Before formal v0.5 release readiness, test migration interruption, quota/write failure, duplicate event submission, malformed export/import fixture, and deletion transaction failure.

These do not have to block the earliest clearly labeled local `dogfood` package, but they must pass before v0.5 is called release-ready.

## 16. Local dogfood build acceptance

The first milestone is an installable local build, not a public release.

```text
extension loads locally
v0.4 marking still works on real pages
IndexedDB persists across restart
structured events are visible in Dashboard
passive capture is bounded/coalesced
sensitive sites capture nothing
passive/ordinary events retain no sentence text
explicit signals can retain sentence text
Dogfood Notes include contextual snapshot
JSON/JSONL export works
site/date/all delete works
replay rebuilds deterministic projections
storage failure does not destroy marking behavior
```

The milestone produces a clearly named unpacked/build artifact and a short local-install guide. It does not require a v0.4-style heavyweight release closure before real use begins.

## 17. Dogfood review protocol

After installation, development enters a feedback period rather than automatically advancing to v0.6.

Review examines:

- recurring Dogfood Notes;
- configuration around those notes;
- EN/zh-Hant and page-type usage distribution;
- explicit-versus-passive interaction ratio;
- features rarely used or repeatedly removed;
- privacy/data-management friction;
- storage growth and retention;
- mismatch between event semantics and actual intention.

There is no artificial calendar threshold. v0.6 remains provisional until the user explicitly judges that enough real use has occurred to revise/freeze its design.

## 18. Relationship to v0.6

The existing roadmap proposes evidence weights, mastery, confidence, adaptive density/trigger, transfer probe, gap planner, and event-log rebuild.

v0.5 implements only the observation/replay substrate needed to study those ideas.

Before v0.6 implementation, every inference is reviewed against dogfood evidence. In particular:

```text
exposure != mastery evidence by default
hover != understanding
panel open != success
save sentence != mastery
lack of interaction != knowledge
```

The final v0.6 model may preserve, revise, or reject roadmap assumptions.

## 19. Compatibility and release debt

v0.5 starts from the validated v0.4.0 main merge and does not reopen resolved v0.4 blockers absent a fresh regression.

The v0.4 deterministic `chrome.runtime.reload()` continuity debt remains explicit future hardening. v0.5 storage must not make that debt a hidden correctness dependency.

v0.5 does not expand production host permissions merely to collect richer telemetry.

## 20. Implementation decomposition

The implementation plan should decompose v0.5 into coherent work packages:

```text
A. contracts + IndexedDB schema/migrations
B. append-only event store + capture classifier/coalescer
C. sparse sentence/source persistence + privacy policy
D. analysis cache + retention
E. replay/projectors
F. export + delete
G. Options/Data Dashboard + Dogfood Notes
H. browser integration + local dogfood packaging
I. later formal v0.5 failure-injection/release gate
```

A–H are the target for an installable local Dogfood Build. I is required before formal v0.5 release closure, not before the first real-use session.

## 21. Success criteria

v0.5 succeeds when:

1. Halo works normally on real EN/zh-Hant pages with v0.4 behavior intact.
2. The user can inspect exactly what Halo retained locally.
3. Passive use does not accumulate full page/sentence text or unbounded viewport telemetry.
4. Explicit learning actions retain enough context to be useful later.
5. Sensitive sites produce no durable dogfood capture.
6. Export/delete/replay make local ownership real.
7. Dogfood Notes connect human experience to actual UI/profile state.
8. Storage failures degrade observation, not core marking.
9. The evidence can challenge and revise v0.6 design.
10. No v0.5 UI claims mastery, confidence, or learner level.

The product decision after dogfood is deliberately:

```text
review real evidence
  -> revise v0.5 UX/data semantics if necessary
  -> revise/freeze v0.6 design
  -> only then implement learner modeling
```
