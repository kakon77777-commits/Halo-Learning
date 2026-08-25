# Task 7 Transactional Ownership Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Task 7 renderer failure-atomic, lifecycle-bounded, privately owned, mutation-aware, and cross-root safe.

**Architecture:** Renderer calls use temporary DOM snapshots as rollback journals and commit state only after successful suppressed mutation. Renderer-created wrappers are authorized by private weak capabilities and per-root weak/strong-fallback handles; discovery’s private root identity map drives detached-root cleanup. Dynamic DOM suppression filters only nodes tracked during the active renderer epoch, so later third-party token mutations invalidate normally.

**Tech Stack:** Browser-safe JavaScript, Node `node:test`, fake DOM unit fixtures, Playwright Chromium extension E2E.

**Spec:** `.superpowers/sdd/2026-08-25-browser-runtime-ux-v0.4.0/task-7-brief.md`

## Global Constraints

- Do not use `innerHTML` in extension runtime code.
- Preserve containing element identity, exact source text/order, third-party children, semantic/projection separation, and a non-color carrier.
- Retain Task 6 stale-revision cancellation and scoped mutation suppression with no permission or network expansion.
- Browser tests must fail explicitly, never skip, when Chromium is absent.

---

### Task 1: Transactional renderer and panel operations

**Files:**
- Modify: `tests/reversible-renderer.test.js`
- Modify: `apps/extension/src/shared/reversible-renderer.js`

**Interfaces:**
- Consumes: existing `apply`, `reconcile`, `removeRoot`, `removeAll`, `openPanel`, `closePanel` calls.
- Produces: the same calls with all-or-nothing DOM and state behavior.

- [x] **Step 1: Write failing fault-injection tests**

Add real fake-DOM failures for second-node split/replace, projection attribute update, rebuild unwrap/apply, suppression post-callback throw, normalization, anchor getters, append-after-insert, and `attachShadow`. Assert the pre-call node identities/text/attributes/status survive and `removeAll()` remains coherent.

- [x] **Step 2: Run RED**

Run: `node --test --test-name-pattern="transaction|failure|atomic" tests/reversible-renderer.test.js`

Expected: partial wrappers, changed attributes/text, stale panel state, or untracked hosts demonstrate each defect.

- [x] **Step 3: Implement minimal rollback journals**

Capture affected root child topology, text values, and element attributes before mutation. Run mutation under suppression; on failure, restore the snapshots in a fresh suppression epoch and leave renderer state/last action unchanged. Precompute throwing panel inputs before append, retain the old panel until the new panel is fully positioned, and remove/restore hosts on failure.

- [x] **Step 4: Run GREEN**

Run: `node --test tests/reversible-renderer.test.js`

Expected: all renderer unit tests pass.

### Task 2: Private ownership, lifetime, and cross-root safety

**Files:**
- Modify: `tests/reversible-renderer.test.js`
- Modify: `apps/extension/src/shared/reversible-renderer.js`

**Interfaces:**
- Consumes: render requests and explicit remove lifecycle.
- Produces: private wrapper capabilities, weak handles with strong fallback, and cross-root validation.

- [x] **Step 1: Write failing ownership/lifetime tests**

Cover `WeakRef: null`, detach→status→reattach→`removeAll`, public marker tampering, a fully forged lookalike, third-party children, malicious cross-root fragments, and legitimate same-root reconcile.

- [x] **Step 2: Run RED**

Run: `node --test --test-name-pattern="WeakRef|detach|tamper|forged|cross-root" tests/reversible-renderer.test.js`

Expected: missing cleanup, forged-node deletion, or nested token creation.

- [x] **Step 3: Implement private capabilities**

Track wrapper identity in a private `WeakSet`/`WeakMap`, store only weak wrapper/root handles when available and bounded strong handles otherwise, stop pruning merely detached roots, and validate fragment ancestry against another live private owner before mutation.

- [x] **Step 4: Run GREEN**

Run: `node --test tests/reversible-renderer.test.js`

Expected: all renderer unit tests pass.

### Task 3: Scoped mutation filtering and detached-root cleanup

**Files:**
- Modify: `tests/dynamic-dom-controller.test.js`
- Modify: `tests/runtime-scheduler.test.js`
- Modify: `apps/extension/src/shared/dynamic-dom-controller.js`
- Modify: `apps/extension/src/content.js`

**Interfaces:**
- Consumes: `suppressRendererMutations(callback)`, MutationObserver records, discovery root identities.
- Produces: external token invalidation and `discovery.rootIdsWithin(values)`.

- [x] **Step 1: Write failing integration tests**

Assert external character data, child insertion, and ownership/semantic attribute changes inside tokens synchronously invalidate their canonical roots; renderer records captured during suppression remain ignored. Assert detached removal metadata resolves the previously assigned private root ID before release and route cleanup still removes all state.

- [x] **Step 2: Run RED**

Run: `node --test tests/dynamic-dom-controller.test.js tests/runtime-scheduler.test.js`

Expected: permanent public-marker filtering hides external changes and detached root identity is unavailable.

- [x] **Step 3: Implement scoped behavior**

Observe relevant attributes, make the content ownership predicate consult only the active transient renderer-node set/ancestors, and resolve cleanup from discovery’s private weak element→root-ID mapping over both live and removed roots before releasing them.

- [x] **Step 4: Run GREEN**

Run: `node --test tests/dynamic-dom-controller.test.js tests/runtime-scheduler.test.js`

Expected: both focused suites pass.

### Task 4: Browser contract and verification

**Files:**
- Modify: `tests/browser/dynamic-dom.e2e.test.js`
- Modify: `tests/browser/reversible-renderer.e2e.test.js`
- Modify: `.superpowers/sdd/2026-08-25-browser-runtime-ux-v0.4.0/task-7-report.md`

**Interfaces:**
- Consumes: packaged local extension runtime.
- Produces: authored real-browser evidence for external token mutations and transactional lifecycle behavior.

- [x] **Step 1: Extend browser fixtures**

Add third-party text/child/attribute mutations on rendered tokens and assert re-analysis, no nested wrappers, exact text, preserved third-party child, and route cleanup.

- [x] **Step 2: Run all required verification**

Run: `node --test tests/reversible-renderer.test.js tests/dynamic-dom-controller.test.js tests/runtime-scheduler.test.js tests/source-contract.test.js`

Run: `node --test tests/*.test.js`

Run: `node --test tests/browser/reversible-renderer.e2e.test.js tests/browser/dynamic-dom.e2e.test.js`

Run changed-file `node --check` commands and `git diff --check`.

Expected: Node suites pass; browser gate either passes in Chromium or fails explicitly with the missing-executable blocker and zero skips.

- [x] **Step 3: Record and commit**

Append exact RED/GREEN/browser/review evidence to the Task 7 report, leave `progress.md` untouched, and commit with `fix: harden reversible renderer lifecycle`.
