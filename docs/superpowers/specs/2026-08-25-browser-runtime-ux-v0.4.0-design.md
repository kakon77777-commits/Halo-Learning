# Halo Learning v0.4.0 Browser Runtime & UX Design

**Date:** 2026-08-25
**Release:** v0.4.0 — Browser Runtime & UX
**Base:** v0.3.0 Semantic Annotation Engine (`046c6f629a32614b68573196da9200adb4c1a20f`)
**Branch:** `workbench/v0.4.0-browser-runtime`

## 1. Purpose and release boundary

v0.4.0 turns the verified v0.3.0 semantic engine into a production-like
Manifest V3 browser runtime that can run for extended periods on real pages
without scanning entire documents eagerly, blocking the page, duplicating DOM
artifacts, or processing sensitive sites.

The canonical semantic pipeline remains:

```text
page text
  -> SemanticToken / AnnotationSet
  -> MarkingProfile
  -> RenderPlan
  -> reversible DOM artifact
```

v0.4.0 adds scheduling, lifecycle, interaction, privacy, accessibility, and
browser evidence around that pipeline. Rendered CSS, DOM position, and user
interaction state never become semantic truth.

This release does not add Halo Story, learner mastery, learner events,
IndexedDB learner storage, cloud sync, login, billing, remote AI/NLP, mobile
apps, teacher tools, model training, new languages, or a semantic-ontology
redesign. Those boundaries remain assigned to later releases.

## 2. Baseline record

The unmodified v0.3.0 baseline was re-fetched from GitHub and measured before
design work:

| Evidence | Observed value |
| --- | ---: |
| GitHub `main` HEAD | `046c6f629a32614b68573196da9200adb4c1a20f` |
| Full test suite | 142/142 PASS |
| Development validator | PASS; parsed 142 passed, 0 failed |
| Runtime index on-disk bytes | 48,544,255 |
| Runtime index ZIP-compressed bytes | 11,367,634 |
| Node file-read diagnostic | 159–267 ms |
| Node JSON parse diagnostic | 210–232 ms |
| Node hash diagnostic | about 298 ms |
| Node canonical-order diagnostic | about 2,366 ms |
| Node English map construction | about 76 ms |
| Node Traditional-Chinese map construction | about 32 ms |
| Node morphology map construction | below 1 ms |
| Node full verify/freeze/materialize diagnostic | about 5,594 ms |
| Node RSS after full runtime load | about 636 MB |
| Node first two-sentence annotation | about 10.6 ms |
| Node warm two-sentence annotation p95 | about 0.92 ms |

Environment: Ubuntu 24.04.3, Linux x86-64, 9 logical AMD EPYC 9V74
vCPUs, about 21 GiB available memory, Node v24.19.0. These are diagnostic
Node measurements, not browser claims. They establish that initialization and
whole-index materialization are the dominant risks; semantic lookup after
materialization is not the primary bottleneck.

## 3. Architectural decision: hybrid bootstrap plus deterministic shards

### 3.1 Rejected alternatives

**Language-only sharding** is simpler but leaves each language payload large
enough to retain multi-second cold-start and high-memory risk.

**IndexedDB full-corpus materialization** could provide warm lookup, but it
adds an installation transaction, schema migration, interrupted-build
recovery, duplication of packaged bytes, and a new persistent-store lifecycle.
That complexity is not justified before static sharding is measured and also
overlaps the v0.5.0 data-store boundary.

**Binary or custom database formats** could reduce bytes further, but would
increase audit, rebuild, migration, and cross-runtime complexity before JSON
sharding has been shown insufficient.

### 3.2 Selected approach

The selected design is:

```text
small authored bootstrap provider
  -> immediate SemanticToken / AnnotationSet
  -> minimal RenderPlan
  -> local shard-routing manifest
  -> fetch only required packaged shards
  -> verify and materialize those shards
  -> deterministic enriched AnnotationSet
  -> one versioned RenderPlan reconciliation
```

The bootstrap result is a real provider-neutral semantic result, not a visual
guess. The enriched result replaces it only when the source fingerprint,
profile revision, engine version, and lexical-manifest version still match.

### 3.3 Bucket candidates and selection rule

An in-memory projection of the verified v0.3.0 corpus produced these
diagnostic candidates:

| Buckets per language | Total shard files | Maximum uncompressed shard | Approximate total gzip bytes |
| ---: | ---: | ---: | ---: |
| 32 | 64 | 1,154,481 | 15,387,384 |
| 64 | 128 | 621,205 | 15,709,052 |
| 128 | 256 | 361,295 | 16,078,137 |

The implementation must benchmark the 64- and 128-bucket candidates in real
Chromium before freezing the release format. If both satisfy all blocking
browser budgets, 64 is selected to reduce file count. If 64 fails and 128
passes, 128 is selected. If neither passes, the release remains partial or
blocked; the validator must not conceal the failure.

The selected bucket count and measurements are recorded in an ADR and the
v0.4.0 performance report. Release artifacts use exactly one fixed count.

## 4. Sharded lexical runtime format

### 4.1 Routing

- English lexical rows route by a stable versioned hash of the normalized
  complete surface.
- English morphology rows route by the same hash of the normalized inflected
  surface, allowing one English shard request to support exact and morphology
  lookup.
- Traditional-Chinese rows route by a stable versioned hash of the first
  Unicode code point. All words beginning with the same code point therefore
  reside in the same bucket and deterministic longest-match remains possible
  after loading one bucket for that source position.
- Unknown or unsupported languages never trigger shard loads.

The routing algorithm has an explicit ID and version. Changing it requires a
new format version and rebuild; it cannot silently reinterpret old shards.

### 4.2 Manifest

`BrowserLexicalManifest/v1` contains:

- schema and format versions;
- builder and routing algorithm IDs and versions;
- fixed bucket count;
- locales, dataset manifests, licenses, source hashes, and build time;
- v0.3.0 canonical source-index hash;
- one descriptor per shard with ID, locale, path, byte length, row counts,
  payload SHA-256, and compressed release bytes when available;
- a root hash over the canonical manifest payload.

The manifest is small enough to validate on every MV3 cold start.

### 4.3 Shards

Each shard is a canonical JSON envelope containing only:

- its format, routing identity, bucket number, locale, and manifest root;
- local gloss table;
- English lexical and morphology rows, or Traditional-Chinese rows;
- row statistics;
- SHA-256 over the canonical shard payload.

Rows retain provider-neutral lexical, morphology, gloss, dataset, license, and
provenance evidence. Shards are deterministic rebuild products. A corrupt
shard is rejected before lookup, recorded with a sanitized failure code, and
falls back to the authored provider for only the affected work.

### 4.4 Runtime cache

The service worker keeps an in-memory Promise cache and bounded LRU of verified
materialized shards. Shards needed by an in-flight annotation batch are pinned
until that batch completes. The cache is an optimization, never durable truth.

Service-worker suspension may erase the entire cache. On restart, the manifest
and required shards are re-fetched from packaged extension URLs and reverified.
No correctness path assumes resident RAM or IndexedDB persistence.

## 5. Progressive semantic enrichment

Every sentence run has a deterministic analysis key derived from:

- exact source text;
- language mode;
- semantic-engine version;
- grammar-engine version;
- MarkingProfile revision;
- lexical manifest root hash or explicit bootstrap identity.

Processing has two phases:

1. `bootstrap`: bounded local tokenization and authored dictionary analysis;
2. `lexical`: verified required shards, full lexical/morphology/gloss evidence,
   bounded grammar, and final projection.

The bootstrap paint never waits for the 48.5 MB legacy index. A sentence may
receive at most one lexical reconciliation for one analysis key. Duplicate,
late, cancelled, or version-mismatched results are discarded. If token
boundaries are unchanged, the renderer updates attributes in place. If
boundaries change, it performs one root-scoped atomic replacement. It does not
oscillate between phases.

Failure to enrich leaves the valid bootstrap result visible and exposes a
sanitized local diagnostic. No remote request is introduced.

## 6. Sentence pipeline and DOM mapping

The runtime pipeline is:

```text
visible DOM root
  -> filter unsuitable descendants
  -> immutable TextRun list
  -> sentence segmentation
  -> sentence-to-TextRun mapping
  -> language detection
  -> privacy policy
  -> semantic analysis
  -> RenderPlan
  -> reversible local-node fragments
```

### 6.1 Text runs

A `TextRun` records an ephemeral text node reference, exact node text,
aggregate start/end offsets, and a root revision. It is never persisted or
sent remotely. Runs preserve whitespace and inline boundaries across nested
spans, links, emphasis, and mixed text nodes.

### 6.2 Sentence segmentation

`Intl.Segmenter` is used when available with a deterministic tested fallback.
Sentence offsets refer to the aggregate root text. Mapping converts each token
span into one or more node-local fragments. Rendering wraps node-local
fragments rather than extracting or replacing a cross-element DOM Range, so
inline links and emphasis retain their structure.

Code, preformatted content, controls, editable regions, hidden content,
navigation, Halo-owned artifacts, and sensitive roots are excluded unless a
future explicit contract changes the rule.

### 6.3 Lifetime

DOM `Range`, text-node arrays, and root maps are released after rendering,
cancellation, removal, external mutation, or route cleanup. Long-lived runtime
state retains only small revision/fingerprint metadata and weak references
where supported.

## 7. Viewport discovery and bounded scheduling

The runtime does not synchronously walk and analyze the whole document.

- Visible roots are discovered first and observed with
  `IntersectionObserver` using a bounded pre/post-viewport margin.
- Further DOM discovery advances incrementally under the same scheduler; it
  may register off-screen candidates but never performs semantic analysis
  until they intersect the viewport buffer.
- Scroll, resize, mutation, and route work is coalesced.
- Roots leaving the buffer cancel queued and in-flight work that is no longer
  useful.

Initial conservative defaults are:

| Budget | Default |
| --- | ---: |
| Candidate elements visited per discovery slice | 32 |
| Text nodes per semantic batch | 24 |
| Characters per semantic batch | 12,000 |
| Sentences per semantic batch | 24 |
| Semantic tokens per semantic batch | 600 |
| Distinct lexical shards per batch | 24 |
| Main-thread scheduling slice | 8 ms |
| Queued roots before backpressure | 200 |
| Viewport buffer | 1,200 px before and after viewport |

Settings normalization clamps values to safe ranges. Tests assert every
budget independently. Browser measurements may lower defaults; raising a
blocking budget requires evidence and an updated design/ADR.

Scheduling uses `requestIdleCallback` when suitable, with a bounded timeout
and `setTimeout` fallback. A monotonic run revision plus `AbortController`
supports cancellation. Backpressure drops stale off-screen work before recent
visible explicit work. Explicit user actions always outrank inferred hover or
background discovery.

## 8. Dynamic DOM and SPA lifecycle

`MutationObserver` records are debounced and coalesced by affected content
root. The observer ignores mutations whose target and added nodes are wholly
Halo-owned. Renderer operations additionally use a scoped suppression epoch so
their own fragment replacement cannot create an annotation loop.

External changes invalidate only affected roots. Removed roots are cancelled
and released. Inserted or replaced roots enter viewport discovery. A
fingerprint and root revision prevent duplicate annotation.

SPA navigation is detected through `pushState`, `replaceState`, `popstate`,
`hashchange`, and document replacement signals. Route cleanup:

1. increments the page epoch;
2. cancels queued and in-flight requests;
3. disconnects old observers;
4. removes Halo artifacts from surviving old content;
5. releases DOM references;
6. starts a fresh site-policy decision and viewport runtime.

## 9. Idempotent reversible renderer

The renderer has an explicit per-root state machine and run ID.

- `Apply -> Apply` with the same analysis key is a no-op.
- `Apply -> Remove` unwraps only Halo-owned token fragments and normalizes
  touched parents.
- `Apply -> Remove -> Apply` produces one valid artifact set.
- External DOM mutation invalidates and safely reprocesses the affected root.
- Route cleanup removes old artifacts and runtime state.

Every wrapper stores the exact original local substring plus projection and
run metadata needed for reversal. It never stores or invents semantic truth.
Mutations are applied in reverse node/offset order to prevent offset drift.
Removal never rewrites unrelated nodes or attributes.

Inline token wrappers use a strict `halo-` namespace. The floating core panel
uses Shadow DOM for stronger style isolation. No untrusted `innerHTML`, remote
style, remote script, or model-produced DOM is used.

## 10. Trigger controller and interaction modes

The canonical modes are:

- `adaptive-hover`;
- `explicit-only`;
- `hybrid`.

The controller is a pure tested state machine around idle, candidate, primed,
core-open, dismissed, and cancelled states. Explicit actions always outrank
hover inference:

- click;
- keyboard command;
- modifier-hover;
- extension context-menu action;
- popup Apply/action.

The context menu uses the narrow `contextMenus` permission and the existing
click-scoped `activeTab`/`scripting` path; no host permission is added. A
manifest command provides a user-customizable keyboard entry. Hover is never
the sole path.

Esc closes the panel, outside click dismisses it, pointer departure uses a
short delayed dismissal, and re-entry cancels the pending dismissal. Explicit
reopen recovers immediately from an accidental trigger or dismissal.

## 11. Sensitive-site policy

Site policy runs before text extraction. It uses only URL origin/path,
user-configured host rules, element types, and security-relevant attributes.
It never reads form values, cookies, tokens, browsing history, account state,
or hidden private content.

The default policy fails closed for:

- online banking and payment;
- password managers and authentication flows;
- webmail and private messaging;
- medical and insurance account surfaces;
- government personal-data routes;
- developer secret, credential, and cloud-key consoles;
- password, one-time-code, payment, or equivalent sensitive form markers;
- user denylist matches;
- non-HTTP(S), browser-internal, or policy-ambiguous surfaces.

A blocked decision guarantees zero sentence extraction, zero semantic request,
zero sentence storage, zero remote request, and zero annotation injection.
v0.4.0 has no sentence store or remote provider, but the negative guarantees
remain executable regression contracts.

## 12. Accessibility and low-interference UX

- Reading text remains native text; token wrappers are not turned into hundreds
  of tab stops.
- Visual pseudo-labels are excluded from speech where supported; accessible
  semantic detail is exposed only through the explicitly opened panel.
- The core panel has a labelled role, predictable focus entry/return, keyboard
  navigation, visible focus, and Esc handling.
- POS color always has a textual or shaped alternative and is never the sole
  carrier.
- Styles cover high contrast/forced colors, reduced motion, zoom, and enlarged
  font sizes.
- Animation is nonessential and disabled under `prefers-reduced-motion`.
- ARIA live regions report concise state changes only; they never enumerate
  every POS token.

Accessibility tests cover keyboard-only operation, focus restoration, label
quality, absence of repeated-token speech pollution, contrast, reduced motion,
and 200% text scaling.

## 13. Browser fixture and E2E matrix

The repository contains at least twenty deterministic local HTTP fixtures:

1. simple article;
2. news layout;
3. technical documentation;
4. academic HTML;
5. nested spans;
6. inline links and emphasis;
7. code-heavy page;
8. explicit `pre`/`code` exclusions;
9. multilingual article;
10. Traditional-Chinese article;
11. English article;
12. infinite scroll;
13. SPA navigation;
14. dynamic insertion;
15. content replacement;
16. high-density advertising layout;
17. accessibility reading mode;
18. open Shadow DOM;
19. same-origin iframe when extension permissions permit;
20. large long-form document.

The harness launches the unpacked extension in real Chromium through a
persistent browser context. It must fail explicitly when no supported Chromium
binary exists; browser gates cannot silently skip. The executable may come
from pinned Playwright installation or `HALO_CHROMIUM_EXECUTABLE`.

Every applicable fixture verifies no critical DOM breakage, exact source-text
preservation, correct mapping, remove correctness, duplicate-wrapper absence,
bounded CPU/long tasks, bounded DOM/reference growth, and expected policy.

## 14. Performance evidence

The browser profiler records:

- browser, OS, CPU/memory class, fixture, condition, manifest hash, and version;
- legacy index compressed/uncompressed size;
- manifest and shard compressed/uncompressed sizes;
- fetch, JSON parse, SHA-256 verification, schema/order validation, deep-freeze,
  and materialization timings;
- English, Traditional-Chinese, and morphology map timings;
- bootstrap first annotation and lexical first/warm annotation latency;
- core-panel first-visible latency;
- main-thread long tasks;
- page and service-worker heap when Chromium exposes reliable CDP metrics;
- cold, warm, and service-worker restart behavior.

The canonical performance targets remain:

| Metric | Blocking target |
| --- | ---: |
| Cached/local primed highlight p95 | below 100 ms |
| Local basic sentence analysis p95 | below 300 ms per sentence |
| Core panel first visible p95 | below 500 ms |
| Main-thread long task | below 50 ms |

Reports separate bootstrap from lexical enrichment and cold from warm. Missing
memory APIs are reported as `unknown`, never zero. Failed gates retain their
actual value and blocking status.

## 15. MV3 lifecycle and cancellation

Annotation requests carry request ID, page epoch, root revision, and analysis
key. Service-worker work is abortable. Late responses are ignored by the
content runtime even if platform shutdown prevents explicit abort delivery.

Browser tests cover:

- cold service-worker start;
- worker stop/restart through Chromium lifecycle controls when available;
- in-memory lexical-cache loss and correct reload;
- cancellation during shard fetch/analysis;
- tab close;
- extension reload;
- browser-context restart;
- update-compatible manifest/version mismatch rejection.

If the worker dies during enrichment, the page retains the bootstrap result.
A later current request may restart enrichment. No request is assumed to
survive worker termination, and no stale response may mutate a new page epoch.

## 16. Validator and release packaging

The v0.4.0 validator explicitly runs Node with a stable TAP reporter and parses
total, passed, failed, cancelled, skipped, and todo counts. Parser failure
produces `status: unknown`, retains the raw-format diagnostic, and fails the
release gate even when the child process exits zero.

Progress lines are written to stderr so stdout remains one machine-readable
JSON document, for example:

```text
[1/15] tests ... PASS
[2/15] lexical runtime ... PASS
```

Development validation requires:

- full tests and browser suites;
- syntax/build/package checks;
- `git diff --check`, staged diff check, and clean worktree;
- corpus, shard, provenance, manifest, and release evidence;
- browser performance, privacy, accessibility, and lifecycle reports.

Standalone validation runs from the extracted source release with no `.git`.
It performs tests, syntax, package audit, data/shard integrity, deterministic
runtime rebuild, semantic quality, manifest validation, and browser evidence
artifact validation without invoking Git. Browser evidence may be generated
at the release build boundary and then cryptographically verified in a
standalone environment that lacks a browser; it cannot be fabricated or
silently regenerated as Node-only evidence.

## 17. Test-driven task mapping

| Task | Blocking outcome |
| --- | --- |
| V040-01 | Reproducible legacy and candidate Chromium profiling baseline |
| V040-02 | Deterministic shard builder, manifest, loader, routing, fallback, and ADR selection |
| V040-03 | Bootstrap-first versioned progressive semantic enrichment |
| V040-04 | TextRun sentence pipeline and nested DOM mapping |
| V040-05 | Viewport discovery, bounded scheduler, cancellation, and backpressure |
| V040-06 | Mutation/SPA lifecycle and observer-loop prevention |
| V040-07 | Idempotent reversible renderer and isolated core panel |
| V040-08 | Trigger modes and explicit interaction priority |
| V040-09 | Sensitive-site and user-denylist policy |
| V040-10 | Accessibility behavior and audit gates |
| V040-11 | Twenty-fixture real-Chromium E2E matrix |
| V040-12 | Cold/warm performance and MV3 lifecycle gates |
| V040-13 | Validator parser/progress, deterministic packaging, release evidence |

Every new behavior follows RED -> GREEN -> REFACTOR. Source-inspection tests
alone are insufficient when executable behavior can be tested. Browser gates
must exercise the installed extension rather than a Node-only DOM imitation.

## 18. Release status rules

`v0.4.0 COMPLETE` is permitted only with fresh evidence for all release gates,
including all twenty fixtures, real Chromium performance, service-worker
lifecycle, sensitive-site policy, accessibility, development validation, and
standalone-package validation.

The release is `partial` or `blocked` if any required browser fixture is
missing, Chromium evidence is unavailable, lifecycle behavior is unverified,
standalone validation fails, or a blocking performance target fails. Metrics
or test counts may not be edited, redefined, skipped, or relabelled to obtain a
passing status.

After the v0.4.0 release report, work stops. v0.5.0 Local Data & Event Store is
not started in this branch.

## 19. Known design limits

- The initial semantic engine remains deterministic and fixture-bounded; v0.4
  does not claim general-world NLP accuracy.
- Static JSON sharding may increase total compressed package bytes because
  shard-local gloss tables duplicate a small amount of data. Browser latency
  and memory take priority over minimizing the archive at any cost.
- Closed Shadow DOM cannot be traversed without page cooperation; open Shadow
  DOM is the blocking v0.4 fixture. Closed roots are reported unsupported.
- Cross-origin iframe access remains controlled by browser permissions and
  origin policy. Unsupported cross-origin frames are skipped and reported,
  not bypassed.
- Browser heap APIs vary. Unavailable measurements remain explicit `unknown`
  values while observable leak counters and DOM lifecycle gates still run.
