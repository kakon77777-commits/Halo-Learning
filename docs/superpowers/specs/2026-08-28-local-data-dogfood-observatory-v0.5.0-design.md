# Halo Learning v0.5.0 Local Data & Dogfood Observatory Design

**Date:** 2026-08-28  
**Release:** v0.5.0 — Local Data, Event Store & Dogfood Observatory  
**Base:** v0.4.0 Browser Runtime & UX (`main` @ `5430dd9608d311aa04651ed36cb5f85d07a5138c`)  
**Branch:** `workbench/v0.5.0-local-dogfood`

## 1. Purpose and release boundary

v0.5.0 adds the first durable local learning-data layer to the now-validated
v0.4.0 browser runtime. The canonical roadmap already assigns v0.5.0 these
responsibilities:

- local-first IndexedDB storage;
- append-only learning events;
- privacy-aware capture;
- versioned analysis cache;
- export and scoped deletion;
- deterministic replay/projector seams;
- a user-facing data/options UI.

This design keeps those responsibilities, but changes the execution emphasis:
**v0.5.0 is first a local dogfood build, then a release candidate.** The user
must be able to install it locally, use it on real Chinese and English pages,
inspect what Halo records, add direct experience notes, and use that evidence
to judge the later learner-model design.

The design objective is therefore:

```text
v0.4 validated browser runtime
  -> v0.5 local durable observation
  -> real dogfood use
  -> UX + behavioral evidence
  -> v0.6 design revision
```

v0.5.0 does **not** claim learner mastery, learner level, confidence, adaptive
scaffolding, gap planning, Halo Story, cloud sync, login, billing, remote AI,
new languages, teacher tooling, or a new semantic model.

The original v0.6.0 learner-model roadmap remains a provisional hypothesis
until dogfood evidence is reviewed.

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

## 3. Product strategy: dogfood before v0.6

The main unknown after v0.4.0 is no longer whether the browser runtime can be
engineered. It is how the product actually feels during repeated use.

v0.5.0 must collect enough local evidence to answer questions such as:

- which annotation channels are actually useful during normal reading;
- which channels become visually noisy over time;
- whether English and Traditional-Chinese pages need different defaults;
- which detail/gloss interactions are intentional learning actions versus
  casual inspection;
- what marking density is comfortable on different page types;
- whether trigger timing and panel behavior feel intrusive;
- which interactions are unsafe to interpret as evidence of learning;
- what users need to inspect or delete from local storage.

The v0.5.0 dashboard must therefore expose observation, not scoring.

Allowed v0.5 views include:

```text
exposures
interaction counts
explicit learning signals
saved sentences
site/session distribution
language distribution
profile/channel/density context
dogfood notes
local storage usage
```

Forbidden v0.5 claims include:

```text
you mastered X
your English level is Y
this concept should now receive less scaffolding
this vocabulary item is learned
```

## 4. User-facing surfaces

### 4.1 Daily popup

The extension popup remains intentionally small. It should remain optimized for
ordinary reading rather than become an analytics dashboard.

The v0.5 popup may expose:

- Apply / Remove;
- current-site state;
- current profile;
- density control;
- a compact local-capture status indicator;
- link/button to open the full Data Dashboard.

The popup must not become the primary data-management surface.

### 4.2 Options / Data Dashboard

The full Options page becomes the main v0.5 user-facing addition. It has eight
logical sections:

1. **Overview**
2. **Activity**
3. **Sites & Sessions**
4. **Learning Events**
5. **Saved Sentences**
6. **Dogfood Notes**
7. **Data & Privacy**
8. **System / Replay**

These are views over the same storage contracts. They are not eight independent
data silos.

### 4.3 Overview

Overview shows descriptive local state only:

- number of Halo-active days;
- number of sites with retained events;
- retained structured event count;
- explicit learning-signal count;
- saved-sentence count;
- dogfood-note count;
- EN / zh-Hant usage distribution;
- current profile / density;
- approximate local database bytes;
- oldest/newest retained event timestamps.

No mastery or level score is displayed.

### 4.4 Activity

Activity is a chronological projection. Example:

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

Activity must work even when a historical event has no retained sentence text.

### 4.5 Sites & Sessions

A session is identified by a generated `sessionId` attached to events. A
separate canonical session store is not required for v0.5. Session summaries
are projected from events.

The view may group by:

- domain;
- date/time range;
- session;
- language;
- profile;
- explicit-learning-signal count.

### 4.6 Saved Sentences

Saved Sentences shows only sentence text that the capture policy allowed to be
persisted. Each record exposes its provenance/context without pretending that
saving means mastery.

### 4.7 Dogfood Notes

Dogfood Notes is a first-class v0.5 feature because human experience is part of
the evidence used to redesign v0.6.

A note records:

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

When created from a sentence/detail surface, the note may retain that sentence
under the explicit-learning capture rule. Notes created from the dashboard may
exist without a sentence reference.

A note edit does not mutate the original event. It appends a revision event
referencing the previous note event. A note removal similarly appends a
logical-delete event unless the user invokes an explicit data-deletion command
that physically removes retained records.

## 5. Capture policy

v0.5.0 uses automatic local dogfood capture on ordinary permitted sites.
Manual "start recording" is not required.

The default policy is:

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

### 5.1 Passive events do not retain text

Examples that may produce structured events but do not retain sentence text:

- sentence entered analysis/viewport eligibility;
- annotation was rendered;
- ordinary hover;
- ordinary scroll;
- ordinary click;
- Apply / Remove;
- profile/density/channel changes.

The event may contain a hash-based content reference where needed, but not the
full sentence.

### 5.2 Explicit learning signals

The following are v0.5 explicit learning signals and may retain the associated
sentence text on a permitted site:

- user explicitly opens gloss;
- user explicitly opens explanation/detail intended for learning;
- user saves a sentence;
- user creates a Dogfood Note attached to the sentence.

Future comprehension or transfer probes may join this category in later
releases, but v0.5 does not implement those learner-model features.

### 5.3 URL privacy

For ordinary retained activity:

```yaml
site:
  domain: readable
  normalizedPathHash: stored
  query: not_stored
  fragment: not_stored
  fullUrl: not_stored_by_default
```

A full URL may be retained only when the user performs an explicit action whose
purpose is later return/reproduction, such as Save Sentence or Dogfood Note.
That full URL remains local and deletable.

## 6. Storage architecture

### 6.1 IndexedDB database

Use one versioned Halo Learning IndexedDB database. The canonical v0.5 stores
follow the existing roadmap:

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

`Sessions`, `Activity`, `Sites`, and `Dogfood Notes` are primarily projections
of these stores rather than new canonical stores.

### 6.2 Contract set

v0.5 introduces versioned contracts with explicit schema IDs, including:

```text
LearningEvent/v1
SourceRef/v1
SentenceRecord/v1
AnalysisCacheEntry/v1
ExportBundle/v1
DeleteReceipt/v1
ReplayReport/v1
```

The exact field layout is implementation-plan work, but every contract must
carry enough version/provenance information to be exported and re-read without
relying on hidden runtime state.

### 6.3 Event store

`events` is the primary canonical observation log.

Requirements:

- every event has a stable idempotent `eventId`;
- inserting the same `eventId` twice is a no-op/safe duplicate outcome;
- there is no ordinary `updateEvent` API;
- corrections/revisions are new events referring to previous events;
- events carry `timestamp`, `eventType`, `sessionId`, language/site references,
  and the minimum interaction/UI context required for later interpretation;
- events may refer to a sentence by hash/reference without storing its text;
- the event schema does not contain mastery/confidence fields.

### 6.4 Source references

`sources` stores privacy-minimized page/site identity needed for grouping and
reconstruction:

- readable domain;
- normalized path hash;
- optional explicit full URL;
- language observations;
- timestamps/provenance needed by export/delete.

Query strings and fragments are never captured by default.

### 6.5 Sentence records

`sentences` is sparse by design.

A sentence record exists only when the capture policy explicitly permits text
retention. The record contains:

- stable local sentence id;
- exact retained text;
- language;
- text hash;
- source reference;
- capture reason;
- capture timestamp;
- algorithm/profile provenance needed to understand the associated event.

An event that references a non-retained sentence must still remain valid.

### 6.6 Analysis cache

The v0.5 analysis cache follows the existing roadmap key:

```text
textHash + contextHash + algorithmVersion
```

Cache entries include TTL and algorithm/provenance identity. A new algorithm
version never silently reuses an incompatible old entry.

Cache is an optimization, not canonical learner evidence. It may be deleted
without changing historical event semantics.

### 6.7 Profiles and settings

Profiles/settings preserve the currently active v0.4 visual configuration and
capture preferences. Historical events contain the minimal profile revision or
snapshot reference required to interpret old interactions after settings
change.

### 6.8 Migrations

IndexedDB schema upgrades use a versioned migration registry.

Migration requirements:

- explicit from/to versions;
- idempotent restart behavior where browser semantics permit;
- no silent data drop;
- migration failure is surfaced to the dashboard;
- marking runtime remains available in storage-degraded mode when safe;
- no v0.5 migration assumes future v0.6 mastery projections.

## 7. Retention policy

Automatic local capture must not become an indefinite local browsing-history
archive.

Default retention:

```text
passive telemetry events        rolling 30 days
ordinary interaction events    rolling 90 days
explicit learning events       until manual delete
saved sentences                until manual delete
dogfood notes                  until manual delete
analysis cache                 TTL / algorithm-version invalidation
```

Retention cleanup is an explicit storage-governance operation. It does not
permit in-place mutation of surviving events.

The Data & Privacy UI exposes current retention rules and allows future
configurability without requiring that configurability for the first dogfood
build.

## 8. Capture data flow

The v0.5 flow is layered after the v0.4 product/security decision:

```text
page interaction
  -> v0.4 site/privacy policy
      -> blocked/sensitive: no durable capture
      -> allowed:
           classify interaction
           -> structured LearningEvent
           -> optional SentenceRecord only for explicit signal
           -> IndexedDB transaction
           -> dashboard projections
```

The durable observer is not allowed to bypass the v0.4 site policy.

The semantic pipeline remains independent:

```text
page text
  -> semantic analysis
  -> MarkingProfile
  -> RenderPlan
  -> reversible DOM
```

Storage consumes outcomes/events from this runtime; storage never becomes the
semantic authority for rendering.

## 9. Replay and projections

v0.5 replay is **data replay**, not video/browser replay.

```text
retained event log
  -> deterministic projector
  -> counters / activity / sessions / site summaries
```

The same retained event sequence and projector version must yield the same
projection.

Replay does not recreate the historical page DOM and does not pretend to know
missing sentence text.

`ReplayReport/v1` records:

- source event range/count;
- projector version;
- resulting projection summary/hash;
- skipped/invalid records;
- deterministic success/failure.

This provides the seam that v0.6 may later use for learner projections without
embedding a learner model in v0.5.

## 10. Export

The dashboard supports:

- JSON bundle export;
- JSONL event export.

Exports include explicit schema/provenance metadata and enough references to
rebuild v0.5 projections in an empty compatible database.

Export rules:

- sentence text appears only if it is actually retained locally;
- missing text remains missing rather than being reconstructed/guessed;
- full URLs appear only when explicitly retained;
- export never silently adds remote data;
- export failure cannot mutate the database.

The implementation must provide a round-trip fixture proving that exported
versioned data can be imported/replayed in an empty test database. A public
import UI is optional for the first dogfood build; the contract/replay path is
not optional.

## 11. Delete and reset semantics

Data & Privacy supports at minimum:

- delete by site/domain;
- delete by date/time range;
- delete all retained learning/dogfood data;
- clear analysis cache independently.

Deletion is an explicit governance exception to append-only event history.
Normal code cannot rewrite an event, but a user-authorized delete transaction
may physically remove matching retained records.

A delete operation returns `DeleteReceipt/v1` containing counts/scopes and
success/failure information. For a full user-data wipe, the receipt may be
shown transiently rather than persisted back into the database that was just
cleared.

Settings reset is separate from learning-data deletion unless the UI explicitly
labels a full Halo reset.

## 12. Dogfood Notes workflow

The product should make experiential feedback cheap enough to use during real
reading.

Preferred entry points:

- sentence/detail panel: `Add dogfood note` with sentence/UI context;
- Options dashboard: standalone note for general UX observations.

The user should not need to copy technical configuration manually. When a note
is attached to live context, Halo records the active profile revision, channels,
density, trigger mode, site reference, and optional sentence reference.

This creates a reviewable evidence tuple:

```text
observed events
+ configuration at the time
+ explicit human experience note
```

v0.6 design review should use all three, not raw telemetry alone.

## 13. Failure behavior

### 13.1 IndexedDB unavailable

If IndexedDB cannot open:

- v0.4 marking remains usable;
- capture enters `storage-degraded` state;
- popup/dashboard exposes a local diagnostic;
- no remote fallback is introduced;
- the runtime does not repeatedly spam failing writes.

### 13.2 Quota exceeded

Quota failure:

- stops non-critical new retention safely;
- preserves existing committed data;
- surfaces storage usage/diagnostic;
- offers export/delete/clear-cache actions;
- does not disable ordinary marking.

### 13.3 Duplicate event

Repeated `eventId` insertion is deterministic and does not duplicate evidence.

### 13.4 Interrupted migration

Migration failures are detectable and recoverable/fail-closed with respect to
persistent writes. No migration may silently leave a partially reinterpreted
schema that appears healthy.

### 13.5 Export failure

Export is read-only with respect to canonical storage. Failure returns an error
without modifying retained data.

## 14. Data Dashboard implementation boundaries

The dashboard is a local extension page. v0.5 does not require a server,
account, or remote analytics service.

Dashboard queries should be paged/bounded. Large event logs must not be loaded
into one giant DOM table.

Recommended presentation:

- Overview: compact cards + simple counts;
- Activity: virtualized/paged chronological list;
- Sites & Sessions: grouped summaries with drill-down;
- Learning Events: filterable structured table/detail view;
- Saved Sentences: readable cards/list with source context;
- Dogfood Notes: note timeline + filters;
- Data & Privacy: retention/export/delete/storage controls;
- System / Replay: schema version, algorithm versions, migration status,
  replay/rebuild action and report.

The first dogfood UI optimizes inspectability and correctness over decorative
product polish.

## 15. Testing strategy

v0.5 dogfood is intentionally lighter than the v0.4 final convergence process,
but it still requires engineering evidence before local installation.

### 15.1 Unit / contract tests

Cover:

- schema creation/versioning;
- migration registry;
- idempotent event append;
- no ordinary event update path;
- sparse SentenceRecord behavior;
- URL minimization;
- capture classification;
- retention selection;
- cache version/TTL behavior;
- projection/replay determinism;
- export contracts;
- scoped delete.

### 15.2 Privacy tests

Required cases:

- sensitive-site event count remains unchanged;
- passive event stores no sentence text;
- ordinary interaction stores no sentence text;
- explicit learning signal retains only the associated sentence;
- ordinary page query/fragment are absent from storage;
- full URL appears only after the allowed explicit action.

### 15.3 Browser E2E

Required local/browser flows:

1. install/load extension;
2. use Halo on a normal English page;
3. use Halo on a normal Traditional-Chinese page;
4. restart browser/extension and observe persisted events;
5. inspect dashboard;
6. create a sentence-linked Dogfood Note;
7. save a sentence;
8. export JSON/JSONL;
9. delete by site/date;
10. replay/rebuild projections;
11. verify sensitive-site capture remains zero;
12. verify v0.4 Apply/Remove/dynamic-page behavior still works.

### 15.4 Failure injection

Before a formal v0.5 release candidate, test:

- migration interruption;
- quota/write failure;
- duplicate event submission;
- malformed export/import fixture;
- deletion transaction failure.

These are roadmap release-gate concerns; they do not need to block the earliest
throw-on-a-local-browser dogfood package if the build is clearly labeled
`dogfood`, but they must be completed before v0.5 is called release-ready.

## 16. Local dogfood build acceptance

The first v0.5 milestone is not a public release. It is an installable local
build suitable for real use.

Dogfood acceptance requires:

```text
extension loads locally
v0.4 marking still works on real pages
IndexedDB persists across restart
structured events are visible in Dashboard
sensitive sites capture nothing
passive/ordinary events retain no full sentence
explicit learning signals can retain sentence text
Dogfood Notes work with contextual snapshot
JSON/JSONL export works
site/date/all delete works
replay rebuilds deterministic projections
storage failure does not destroy marking behavior
```

This milestone should produce a clearly named unpacked/build artifact and a
short local-install guide. It does not need a v0.4-style heavyweight release
closure before the user has actually tried it.

## 17. Dogfood review protocol

After local installation, product development enters a feedback period rather
than automatically advancing to v0.6 implementation.

Review should examine:

- recurring Dogfood Notes;
- channel/density/trigger configuration around those notes;
- usage distribution across English/Traditional-Chinese and page types;
- explicit versus passive interaction ratio;
- features rarely used or repeatedly removed;
- privacy/data-management friction;
- storage growth and retention behavior;
- any mismatch between event semantics and actual user intention.

There is no artificial calendar threshold in this design. v0.6 remains
provisional until the user explicitly judges that enough real use has occurred
to revise/freeze its design.

## 18. Relationship to v0.6

The existing v0.6 roadmap proposes:

- evidence direction/weights;
- mastery projection;
- confidence;
- adaptive density;
- adaptive trigger;
- transfer probe;
- gap planner;
- rebuild from event log.

v0.5 deliberately implements only the observation/replay substrate required to
study those ideas.

Before v0.6 implementation, each learner-model inference must be reviewed
against dogfood evidence. In particular:

```text
exposure != mastery evidence by default
hover != understanding
panel open != success
save sentence != mastery
lack of interaction != knowledge
```

The final v0.6 model may preserve, revise, or reject roadmap assumptions based
on actual use.

## 19. Compatibility and release debt

v0.5 starts from the validated v0.4.0 main merge. It must not reopen resolved
v0.4 blockers absent a fresh regression.

The v0.4 release debt for deterministic `chrome.runtime.reload()` continuity
remains explicit future hardening; v0.5 local storage must not make that debt a
hidden correctness dependency.

v0.5 does not expand production host permissions merely to collect richer
telemetry.

## 20. Implementation decomposition

The implementation plan should decompose v0.5 into coherent, independently
verifiable work packages roughly matching the canonical roadmap:

```text
A. contracts + IndexedDB schema/migrations
B. append-only event store + capture classifier
C. sparse sentence/source persistence + privacy policy
D. analysis cache + retention
E. replay/projectors
F. export + delete
G. Options/Data Dashboard + Dogfood Notes
H. browser integration + local dogfood packaging
I. later formal v0.5 failure-injection/release gate
```

The first implementation target is A–H sufficient for an installable local
Dogfood Build. I is required before formal v0.5 release closure, not before the
first real-use session.

## 21. Success criteria

v0.5 succeeds when all of the following are true:

1. Halo can be used normally on real EN/zh-Hant pages with v0.4 behavior intact.
2. The user can inspect exactly what Halo retained locally.
3. Passive use does not silently accumulate full page/sentence text.
4. Explicit learning actions retain enough context to be useful later.
5. Sensitive sites produce no durable dogfood capture.
6. Export/delete/replay make local ownership real rather than aspirational.
7. Dogfood Notes connect human experience to the actual UI/profile state.
8. Storage failures degrade observation, not core marking.
9. The resulting evidence is sufficient to challenge and revise v0.6 design.
10. No v0.5 UI claims mastery, confidence, or learner level.

The product decision at the end of the dogfood period is not automatically
"start v0.6". It is:

```text
review real evidence
  -> revise v0.5 UX/data semantics if necessary
  -> revise/freeze v0.6 design
  -> only then implement learner modeling
```
