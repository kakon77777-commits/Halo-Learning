# Task 7 Review Round 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five Task 7 round-3 review findings while preserving reversible ownership, exact mutation invalidation, and stale-work safety.

**Architecture:** Renderer authority will be granted only after detached wrapper construction and render-state preparation complete, with revocation around the mutation transaction. Runtime roots will receive per-element private identities independent of page IDs, while token remapping compares immutable private owner metadata. Mutation sanitation will consume complete child-list descriptors atomically, and content invalidation will mark every root stale before best-effort cancellation while retaining failed refresh work for retry.

**Tech Stack:** Manifest V3 JavaScript, Node `node:test`, repository fake DOM fixtures, Playwright Chromium E2E.

**Spec:** `docs/superpowers/specs/2026-08-25-browser-runtime-ux-v0.4.0-design.md`

## Global Constraints

- Follow strict RED -> GREEN -> REFACTOR for every behavior group.
- Never use `innerHTML`, public page IDs or public marker strings as ownership authority, remote services, or expanded permissions.
- Preserve exact source text, inline element identity, third-party content, semantic/projection separation, and prior rollback/lifetime guarantees.
- Do not edit `.superpowers/sdd/2026-08-25-browser-runtime-ux-v0.4.0/progress.md`.
- Run the browser gates and report absent Chromium as an explicit failure with zero skips.

---

### Task 1: Precommit capability authority and immutable token ownership

**Files:**
- Modify: `tests/reversible-renderer.test.js`
- Modify: `tests/sentence-pipeline.test.js`
- Modify: `apps/extension/src/shared/reversible-renderer.js`
- Modify: `apps/extension/src/shared/sentence-pipeline.js`
- Modify: `apps/extension/src/content.js`

**Interfaces:**
- Consumes: `createReversibleRenderer(options)`, render requests, pipeline ownership predicate.
- Produces: revocable wrapper authority and `ownsToken(element, expectedRootId)` backed only by immutable private metadata.

- [x] **Step 1: Write failing capability and owner-binding tests**

Add renderer tests that inject a throwing `WeakRef` and precommit preparation hook, capture detached candidates through the existing tracking seam, and assert no captured element is authorized, no DOM artifact remains, and `rootCount` is zero. Add tampered-marker tests proving a genuine token remains authorized for its immutable root but not another root, while a fully forged token never remaps.

- [x] **Step 2: Run focused tests to verify RED**

Run: `node --test tests/reversible-renderer.test.js tests/sentence-pipeline.test.js`

Expected: detached candidates retain private authority after preparation failure, and root binding still depends on public `data-halo-root`.

- [x] **Step 3: Implement minimal precommit grant and owner binding**

Construct and decorate detached wrappers without granting authority. Prepare all weak state handles and invoke a validated optional preparation hook first, then grant frozen private metadata immediately before the mutation transaction and revoke every new grant on failure. Extend `ownsToken` to compare an optional expected root ID and pass that predicate through pipeline/content without consulting public attributes.

- [x] **Step 4: Run focused tests to verify GREEN**

Run: `node --test tests/reversible-renderer.test.js tests/sentence-pipeline.test.js`

Expected: both suites pass.

### Task 2: Per-element runtime root identity and cancellation ordering

**Files:**
- Modify: `tests/runtime-scheduler.test.js`
- Modify: `apps/extension/src/content.js`

**Interfaces:**
- Consumes: viewport discovery roots, scheduler `cancelRoot`, renderer registry.
- Produces: unique stable internal root IDs, revision-first invalidation, exact release, and retry-safe pending refresh.

- [x] **Step 1: Write failing identity/revision tests**

Add duplicate-DOM-ID tests proving two live elements receive distinct work IDs and independent revisions/cancellation. Add remove/reinsert/reuse/churn tests proving the same live element remains stable, released elements do not affect peers, stale work cannot become current, and revision maps remain bounded. Add cancellation-throw tests proving all roots are revised before best-effort cancellation and failed refresh roots remain queued exactly once for retry.

- [x] **Step 2: Run runtime tests to verify RED**

Run: `node --test tests/runtime-scheduler.test.js`

Expected: duplicate IDs collide, a throwing cancellation prevents staleness/peer processing, and failed refresh clears pending work.

- [x] **Step 3: Implement minimal identity and revision changes**

Allocate a monotonic deterministic private ID per element in a `WeakMap`, keeping page `element.id` only as a non-authoritative hint if needed. Revise all roots before attempting cancellation; report cancellation failures per root while continuing. Release exact element state in deterministic cleanup paths. Add attempted roots to the pending refresh set before refresh and delete them only after successful completion.

- [x] **Step 4: Run runtime tests to verify GREEN**

Run: `node --test tests/runtime-scheduler.test.js`

Expected: all runtime tests pass.

### Task 3: Atomic child-list descriptor sanitation

**Files:**
- Modify: `tests/dynamic-dom-controller.test.js`
- Modify: `apps/extension/src/shared/dynamic-dom-controller.js`

**Interfaces:**
- Consumes: suppression-scoped expected child-list operations and actual mutation records.
- Produces: deterministic complete-multiset matching and subtraction.

- [x] **Step 1: Write failing descriptor tests**

Add exact-replace, remove-only partial, add-only partial, expected-plus-legitimate-extra, and multiple-descriptor tests. Derive literal retained node lists and assert partial records are preserved in full while complete descriptors are consumed once.

- [x] **Step 2: Run controller tests to verify RED**

Run: `node --test tests/dynamic-dom-controller.test.js`

Expected: partial records are incrementally consumed/suppressed and multi-descriptor subtraction is inconsistent.

- [x] **Step 3: Implement minimal atomic matching**

Store ordered expected node arrays. For each actual child-list record, match only descriptors whose complete added and removed node multisets are present, subtract complete matches deterministically once, and leave the original record untouched when a same-operation candidate is partial. Retain legitimate extras and prune consumed descriptors.

- [x] **Step 4: Run controller tests to verify GREEN**

Run: `node --test tests/dynamic-dom-controller.test.js`

Expected: controller tests pass.

### Task 4: Browser assertions, full verification, report, and commit

**Files:**
- Modify: `tests/browser/reversible-renderer.e2e.test.js`
- Modify: `tests/browser/dynamic-dom.e2e.test.js`
- Modify: `.superpowers/sdd/2026-08-25-browser-runtime-ux-v0.4.0/task-7-report.md`

**Interfaces:**
- Consumes: completed renderer/content/controller contracts.
- Produces: authored adversarial browser coverage and exact round-3 evidence.

- [x] **Step 1: Author browser adversarial coverage**

Extend browser fixtures with failed preparation cleanup/private-authority checks, public marker tamper with genuine remapping, duplicate page IDs, and cancellation/retry behavior without weakening the existing lifecycle assertions.

- [x] **Step 2: Run focused/full/browser/syntax/diff verification**

Run:

```bash
node --test tests/reversible-renderer.test.js tests/sentence-pipeline.test.js tests/dynamic-dom-controller.test.js tests/runtime-scheduler.test.js tests/source-contract.test.js
node --test tests/*.test.js
node --test tests/browser/reversible-renderer.e2e.test.js tests/browser/dynamic-dom.e2e.test.js
node --check apps/extension/src/shared/reversible-renderer.js
node --check apps/extension/src/shared/sentence-pipeline.js
node --check apps/extension/src/shared/dynamic-dom-controller.js
node --check apps/extension/src/content.js
git diff --check
```

Expected: focused/full/syntax/diff checks pass; browser invocation fails explicitly only because Chromium is unavailable and reports zero skips.

- [x] **Step 3: Append report and commit**

Append exact RED/GREEN commands and outcomes, changed files, contract decisions, browser blocker, concerns, and commit placeholder to the ignored report. Stage only round-3 source/tests/plan changes, commit with a focused message, resolve the exact commit hash, and record it in the report without editing the ledger.
