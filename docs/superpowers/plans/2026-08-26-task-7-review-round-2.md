# Task 7 Review Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five Task 7 review findings without weakening reversible DOM ownership, stale-work cancellation, or page-mutation detection.

**Architecture:** The renderer will journal every actual wrapper location and retain private capabilities until cleanup succeeds. Sentence remapping will consume the renderer's private `ownsToken` predicate. Scoped mutation suppression will match renderer-created nodes and exact renderer-induced operations instead of trusting page nodes or public markers. Content invalidation will snapshot identities, cancel canonical work first, and perform renderer/registry/release cleanup in deterministic error-isolated paths.

**Tech Stack:** Manifest V3 JavaScript, Node `node:test`, repository fake DOM fixtures, Playwright Chromium E2E.

**Spec:** `docs/superpowers/specs/2026-08-25-browser-runtime-ux-v0.4.0-design.md`

## Global Constraints

- Follow strict RED -> GREEN -> REFACTOR for each behavior group.
- Never use `innerHTML`, public marker strings as ownership authority, remote services, or expanded permissions.
- Preserve exact source text, inline element identity, third-party children, semantic/projection separation, and stale-revision cancellation.
- Do not edit `.superpowers/sdd/2026-08-25-browser-runtime-ux-v0.4.0/progress.md`.
- Run the real browser test and report missing Chromium as an explicit failure, never a skip or pass.

---

### Task 1: Multi-location rollback and parentless capability revocation

**Files:**
- Modify: `tests/reversible-renderer.test.js`
- Modify: `apps/extension/src/shared/reversible-renderer.js`

**Interfaces:**
- Consumes: private wrapper refs/capabilities, `removeRoot(rootId)`, `removeAll()`.
- Produces: `ownsToken(element) -> boolean`, multi-root transaction journaling, explicit rollback failure errors, complete parentless scrubbing/revocation.

- [x] **Step 1: Write failing renderer tests**

Add tests that move one or more privately-owned wrappers into outside destinations, make a destination `normalize()` mutate and throw, and verify rollback restores every source/destination plus state. Add a double-fault test that asserts both initiating and rollback errors are observable and a later `removeAll()` can still clean up. Add parentless detach/remove/reattach/apply tests that assert all `halo-*` attributes, Halo classes, `title`, private ownership, and renderer state are removed while child/third-party content survives.

- [x] **Step 2: Run renderer tests to verify RED**

Run: `node --test tests/reversible-renderer.test.js`

Expected: failures show the outside destination was not restored, rollback errors were swallowed, `ownsToken` is absent, and detached wrappers retain private/public ownership.

- [x] **Step 3: Implement minimal renderer lifecycle changes**

Capture each distinct actual parent subtree of every private wrapper before remove/rebuild, along with the canonical root. Restore all journals on failure. If rollback fails, throw an `AggregateError` containing the initiating error and rollback failure while retaining the previous state/capability for later cleanup. Scrub parentless wrappers by removing Halo-owned attributes/classes/title while preserving children, then revoke `WeakSet`/`WeakMap` authority before committing state removal. Return `ownsToken` from the renderer public surface.

- [x] **Step 4: Run renderer tests to verify GREEN**

Run: `node --test tests/reversible-renderer.test.js`

Expected: all renderer unit tests pass.

### Task 2: Bounded released-root identity and private sentence remapping

**Files:**
- Modify: `tests/runtime-scheduler.test.js`
- Modify: `tests/sentence-pipeline.test.js`
- Modify: `apps/extension/src/content.js`
- Modify: `apps/extension/src/shared/sentence-pipeline.js`

**Interfaces:**
- Consumes: `ownsToken(element)`, discovery `releaseRoots(values)`.
- Produces: `createTextRuns(root, { ownsToken })`, released root ID/revision deletion and safe ID reuse.

- [x] **Step 1: Write failing discovery/remapping tests**

Replace the public-marker remapping test with a forged all-public-marker element that remains ordinary page text and a privately admitted element that remaps. Add discovery churn/reuse tests proving `releaseRoots()` deletes the element's identity and revision metadata and a reused explicit ID starts at revision 1 without retaining the prior root.

- [x] **Step 2: Run focused tests to verify RED**

Run: `node --test tests/sentence-pipeline.test.js tests/runtime-scheduler.test.js`

Expected: forged markers are treated as Halo authority and released roots retain old revisions/identity.

- [x] **Step 3: Implement minimal remapping/lifetime changes**

Make `isRemappableHaloToken` require `options.ownsToken(element) === true`; public marker strings alone never grant admission. Pass the active renderer predicate through content's pipeline and eligibility checks. In `releaseRoots`, snapshot an existing root ID, cancel/unobserve, then delete `rootRevisions` and the `WeakMap` identity entry.

- [x] **Step 4: Run focused tests to verify GREEN**

Run: `node --test tests/sentence-pipeline.test.js tests/runtime-scheduler.test.js`

Expected: both suites pass.

### Task 3: Exact scoped mutation sanitation

**Files:**
- Modify: `tests/dynamic-dom-controller.test.js`
- Modify: `tests/runtime-scheduler.test.js`
- Modify: `apps/extension/src/shared/dynamic-dom-controller.js`
- Modify: `apps/extension/src/shared/reversible-renderer.js`
- Modify: `apps/extension/src/content.js`

**Interfaces:**
- Consumes: renderer `trackOwnedNode(node)` and new exact `trackMutation(operation)` callback.
- Produces: suppression-scoped `sanitizeRendererRecord(record)` matching created nodes/exact text, attribute, child-list, and normalization operations; observer old values.

- [x] **Step 1: Write failing suppression tests**

Add controller tests where one record mixes a renderer-created node with a legitimate sibling, and where a touched page parent synchronously inserts a sibling, changes an attribute, or changes page text during the renderer callback. Assert those page mutations synchronously invalidate and later debounce while renderer-only records do neither. Assert observer options request `attributeOldValue` and `characterDataOldValue`.

- [x] **Step 2: Run suppression tests to verify RED**

Run: `node --test tests/dynamic-dom-controller.test.js tests/runtime-scheduler.test.js`

Expected: ancestor-wide ownership suppresses legitimate mutations and observer old-value options are absent.

- [x] **Step 3: Implement operation-granular sanitation**

Track only renderer-created/private nodes directly, never original page parents/text/normalization children. Record exact renderer-induced operations inside the active mutation scope. Let the dynamic controller call a suppression-scoped sanitizer that removes only matching added/removed nodes or exact attribute/text records, preserving unmatched parts. Configure old values. Treat the panel's private host/subtree separately from article mutation authority.

- [x] **Step 4: Run suppression tests to verify GREEN**

Run: `node --test tests/dynamic-dom-controller.test.js tests/runtime-scheduler.test.js`

Expected: renderer-only records are silent and synchronous page side effects invalidate once.

### Task 4: Cancellation-first invalidation with cleanup isolation

**Files:**
- Modify: `tests/runtime-scheduler.test.js`
- Modify: `apps/extension/src/content.js`

**Interfaces:**
- Consumes: canonical discovery roots/IDs, renderer-root registry, renderer `removeRoot`.
- Produces: exported pure invalidation helper used by the content controller.

- [x] **Step 1: Write failing invalidation-order test**

Add an integration-style test whose renderer throws from `removeRoot`. Assert canonical discovery invalidation/cancellation occurs first and exactly once, registry deletion and detached release occur in finally-style paths, error reporting is safe, and the pending changed root is still refreshed later.

- [x] **Step 2: Run content tests to verify RED**

Run: `node --test tests/runtime-scheduler.test.js`

Expected: no testable helper exists or renderer cleanup prevents the later invalidation/release steps.

- [x] **Step 3: Implement cancellation-first helper and wire content**

Snapshot canonical roots and renderer IDs, add changed roots to pending refresh, synchronously call discovery invalidation, then remove renderer roots with per-root error isolation. Delete registry keys and release detached roots in deterministic cleanup paths. Report cleanup errors without escaping or preventing rediscovery.

- [x] **Step 4: Run content tests to verify GREEN**

Run: `node --test tests/runtime-scheduler.test.js`

Expected: cancellation order, cleanup resilience, and refresh behavior pass.

### Task 5: Browser assertions, regression verification, report, and commit

**Files:**
- Modify: `tests/browser/reversible-renderer.e2e.test.js`
- Modify: `.superpowers/sdd/2026-08-25-browser-runtime-ux-v0.4.0/task-7-report.md`

**Interfaces:**
- Consumes: completed renderer/content contracts.
- Produces: authored browser adversarial coverage and exact Task 7 round-2 evidence.

- [x] **Step 1: Author browser adversarial assertions**

Extend the real-Chromium scenario with moved-wrapper cleanup/rollback, parentless marker scrubbing and reapply, forged lookalike protection, and private `ownsToken` assertions while retaining the five lifecycle sequences and panel checks.

- [x] **Step 2: Run focused and full verification**

Run:

```bash
node --test tests/reversible-renderer.test.js tests/sentence-pipeline.test.js tests/dynamic-dom-controller.test.js tests/runtime-scheduler.test.js tests/source-contract.test.js
node --test tests/*.test.js
node --check apps/extension/src/shared/reversible-renderer.js
node --check apps/extension/src/shared/sentence-pipeline.js
node --check apps/extension/src/shared/dynamic-dom-controller.js
node --check apps/extension/src/content.js
node --test tests/browser/reversible-renderer.e2e.test.js
git diff --check
```

Expected: focused/full/syntax/diff checks pass; browser invocation fails explicitly only if Chromium is unavailable and reports zero skips.

- [x] **Step 3: Append report and commit**

Append exact round-2 RED/GREEN commands, files, contract decisions, browser blocker, concerns, and commit placeholder to the ignored Task 7 report. Stage only Task 7 round-2 source/tests/plan, commit with `fix: close renderer ownership review findings`, determine the exact commit hash, and update the report's exact-commit line without editing the ledger.
