# Task 7 Review Round 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four Task 7 round-4 findings while preserving reversible rendering, private ownership, stale-work cancellation, and exact page-mutation visibility.

**Architecture:** Renderer transactions will prepare rollback snapshots and dereference all prior handles before granting new wrapper authority. Discovery freshness will compare an existing private ID and revision without allocation. Mutation sanitation will consume one fully matching descriptor at a time and never trust node identity alone. Pending refresh will isolate each canonical root so peer success is retained when another root throws.

**Tech Stack:** Manifest V3 JavaScript, Node `node:test`, repository fake DOM fixtures, Playwright Chromium E2E.

**Spec:** `docs/superpowers/specs/2026-08-25-browser-runtime-ux-v0.4.0-design.md`

## Global Constraints

- Follow strict RED -> GREEN -> REFACTOR for every behavior group.
- Never use `innerHTML`, public page IDs, public marker strings, or tracked node identity as authority.
- Preserve exact source text, inline element identity, third-party content, semantic/projection separation, and prior rollback/lifetime guarantees.
- Do not edit `.superpowers/sdd/2026-08-25-browser-runtime-ux-v0.4.0/progress.md`.
- Run the browser gates and report absent Chromium as an explicit failure with zero skips.

---

### Task 1: Journal-before-grant renderer transactions

**Files:**
- Modify: `tests/reversible-renderer.test.js`
- Modify: `apps/extension/src/shared/reversible-renderer.js`

**Interfaces:**
- Consumes: prepared wrapper operations, render-state weak handles, rollback snapshots.
- Produces: a prepared transaction journal used by apply/rebuild, with grant immediately before mutation and revocation on every failure.

- [x] **Step 1: Write failing capability-order tests**

Add apply and rebuild tests whose snapshot/prior-handle dereference throws after detached wrapper construction. Observe candidate wrappers through a probe and assert none is privately owned at any point, DOM/state remain exact, and later cleanup remains coherent.

- [x] **Step 2: Run renderer tests to verify RED**

Run: `node --test tests/reversible-renderer.test.js`

Expected: snapshot preparation observes new private authority or leaves a grant after a later prior-handle failure.

- [x] **Step 3: Implement prepared transaction journals**

Split snapshot preparation from suppressed mutation execution. Prepare every snapshot and prior wrapper list before invoking the capability-preparation hook/grant, then execute using the existing journal. Revoke every new wrapper when grant or mutation fails; do not recompute snapshots after grant.

- [x] **Step 4: Run renderer tests to verify GREEN**

Run: `node --test tests/reversible-renderer.test.js`

Expected: renderer tests pass.

### Task 2: Non-allocating freshness identity binding

**Files:**
- Modify: `tests/runtime-scheduler.test.js`
- Modify: `apps/extension/src/content.js`

**Interfaces:**
- Consumes: captured `work.rootId`, `payload.element`, `payload.rootRevision`.
- Produces: `isRootRevisionCurrent(element, expectedRootId, revision)` and a non-allocating private identity lookup.

- [x] **Step 1: Write failing freshness tests**

Release a live root, query the old work, and assert false without increasing tracked revisions or recreating an ID. Allocate new work for the same element and require a new monotonic ID; the old response must remain rejected. Update test doubles to require the captured root ID.

- [x] **Step 2: Run runtime tests to verify RED**

Run: `node --test tests/runtime-scheduler.test.js`

Expected: freshness recreates revision/identity state or ignores mismatched root IDs.

- [x] **Step 3: Implement non-allocating freshness**

Add an internal identity peek that returns `null` when the `WeakMap` lacks the element. Compare that ID to `work.rootId`, then compare the existing revision-map entry without calling allocation helpers. Audit all `isRootRevisionCurrent` callers and test doubles.

- [x] **Step 4: Run runtime tests to verify GREEN**

Run: `node --test tests/runtime-scheduler.test.js`

Expected: runtime tests pass.

### Task 3: Exact descriptor-only child-list sanitation

**Files:**
- Modify: `tests/dynamic-dom-controller.test.js`
- Modify: `apps/extension/src/shared/dynamic-dom-controller.js`

**Interfaces:**
- Consumes: expected operation descriptors and actual mutation records.
- Produces: one-at-a-time deterministic complete descriptor subtraction and bounded pending diagnostics.

- [x] **Step 1: Write failing descriptor tests**

Add wrong-target private-node, two-identical-descriptor/two-record, partial-then-complete, complete-plus-extras, and pending-count tests. Assert no complete exact descriptor means the record passes intact.

- [x] **Step 2: Run controller tests to verify RED**

Run: `node --test tests/dynamic-dom-controller.test.js`

Expected: identity-only fallback suppresses a record, partial overlap blocks later complete matching, or pending descriptors do not drain exactly.

- [x] **Step 3: Implement descriptor-only matching**

Remove structural filtering by `privateNodes`. For each child-list record, repeatedly locate the first fully matchable descriptor for the exact target, consume/subtract exactly that descriptor, and continue against the remaining nodes. Leave partial/unmatched nodes visible without consuming their descriptor. Expose only a bounded numeric pending count for diagnostics.

- [x] **Step 4: Run controller tests to verify GREEN**

Run: `node --test tests/dynamic-dom-controller.test.js`

Expected: controller tests pass and renderer-only integration remains silent.

### Task 4: Per-root refresh isolation

**Files:**
- Modify: `tests/runtime-scheduler.test.js`
- Modify: `apps/extension/src/content.js`

**Interfaces:**
- Consumes: `runtime.pendingChangedRoots`, `discovery.refreshRoots([root], { alreadyInvalidated: true })`.
- Produces: aggregate successful refresh count and per-root success deletion/failure retention.

- [x] **Step 1: Write failing isolated-refresh tests**

Cover first-success/second-throw, first-throw/second-success, repeated failure with a bounded set, retry of only failed roots, and detached/route cleanup clearing pending state.

- [x] **Step 2: Run runtime tests to verify RED**

Run: `node --test tests/runtime-scheduler.test.js`

Expected: one failure retains or repeats already successful peers.

- [x] **Step 3: Implement per-root refresh**

Iterate a stable snapshot of pending roots. Call discovery once per root, delete that root immediately only on success, report a failure without escaping, and continue. Sum successful refresh counts. Ensure removal and route cleanup clear pending roots through existing lifecycle paths.

- [x] **Step 4: Run runtime tests to verify GREEN**

Run: `node --test tests/runtime-scheduler.test.js`

Expected: runtime tests pass.

### Task 5: Browser assertions, verification, report, and commit

**Files:**
- Modify: `tests/browser/reversible-renderer.e2e.test.js`
- Modify: `tests/browser/dynamic-dom.e2e.test.js`
- Modify: `.superpowers/sdd/2026-08-25-browser-runtime-ux-v0.4.0/task-7-report.md`

**Interfaces:**
- Consumes: completed renderer/content/controller contracts.
- Produces: authored adversarial browser coverage and exact round-4 evidence.

- [x] **Step 1: Extend browser adversarial assertions**

Add journal-before-grant and released-identity/no-stale-response assertions where feasible, preserving existing lifecycle coverage.

- [x] **Step 2: Run focused/full/browser/syntax/diff verification**

Run:

```bash
node --test tests/reversible-renderer.test.js tests/dynamic-dom-controller.test.js tests/runtime-scheduler.test.js tests/sentence-pipeline.test.js tests/source-contract.test.js
node --test tests/*.test.js
node --test tests/browser/reversible-renderer.e2e.test.js tests/browser/dynamic-dom.e2e.test.js
node --check apps/extension/src/shared/reversible-renderer.js
node --check apps/extension/src/shared/dynamic-dom-controller.js
node --check apps/extension/src/content.js
git diff --check
```

Expected: focused/full/syntax/diff checks pass; browser invocation fails explicitly only because Chromium is unavailable and reports zero skips.

- [x] **Step 3: Append report and commit**

Append exact RED/GREEN commands, changed files, contract decisions, browser blocker, concerns, and commit placeholder to the ignored report. Stage only round-4 source/tests/plan changes, commit with a focused message, resolve the exact hash, and record it without editing the ledger.
