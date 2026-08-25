# Task 7 Review Round 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make renderer normalization descriptors exactly match the WHATWG DOM `Node.normalize()` MutationRecord topology so renderer cleanup cannot invalidate its own content root.

**Architecture:** Freeze each container's pre-normalization child topology, partition direct exclusive Text children into contiguous runs, and emit the records implied by the DOM Standard before invoking `normalize()`. Each nonempty run survivor receives one character-data expectation, while every removed Text node receives its own exact-target child-list expectation in tree order; nested element runs are planned independently.

**Tech Stack:** Manifest V3 JavaScript, Node `node:test`, repository fake DOM fixtures, Playwright Chromium E2E.

**Spec:** [WHATWG DOM `Node.normalize()`](https://dom.spec.whatwg.org/#dom-node-normalize) and `docs/superpowers/specs/2026-08-25-browser-runtime-ux-v0.4.0-design.md`

## Global Constraints

- Follow strict RED -> GREEN -> REFACTOR.
- Derive expectations from frozen pre-normalization topology, never from post-mutation DOM.
- Preserve exact page text, inline identity, private ownership, transaction rollback, stale-work cancellation, and descriptor-only sanitation.
- Legitimate mixed, partial, extra, and wrong-target records must remain visible.
- Do not edit `.superpowers/sdd/2026-08-25-browser-runtime-ux-v0.4.0/progress.md`.
- Run browser gates and report absent Chromium as an explicit failure with zero skips.

---

### Task 1: Normative normalization record regression

**Files:**
- Modify: `tests/reversible-renderer.test.js`

**Interfaces:**
- Consumes: renderer `trackMutation(operation)`, `Dynamic.createRendererMutationSanitizer()`, and `Dynamic.coalesceMutations(records)`.
- Produces: a direct integration test for normative record consumption and a standard-shaped fake `normalize()`.

- [x] **Step 1: Write the failing normative integration test**

Construct direct Text runs around a real renderer wrapper, plus comment and element boundaries:

```js
['', 'A', '', ownedText, 'B', comment, 'C', 'D', nestedElement, '', comment, 'S']
```

Feed these hand-derived DOM Standard records into the real sanitizer:

```js
childList(parent, removed = [''])
characterData('A', oldValue = 'A')
childList(parent, removed = [''])
childList(parent, removed = [ownedText])
childList(parent, removed = ['B'])
characterData('C', oldValue = 'C')
childList(parent, removed = ['D'])
characterData('E', oldValue = 'E')
childList(nested, removed = [''])
childList(nested, removed = ['F'])
childList(parent, removed = [''])
characterData('S', oldValue = 'S')
```

Assert zero retained records, zero coalesced roots, and zero pending descriptors. Repeat with a legitimate extra added node in one otherwise expected child-list record and assert exactly that extra remains visible while every expected descriptor is consumed.

- [x] **Step 2: Run the renderer suite to verify RED**

Run: `node --test tests/reversible-renderer.test.js`

Expected: the normative sequence retains records and leaves pending descriptors because current production combines removals and emits incremental character-data expectations.

- [x] **Step 3: Align the fake DOM normalize algorithm with the standard**

Process direct children from left to right: remove leading/all empty Text nodes individually, concatenate every following contiguous Text into the first nonempty survivor in one assignment, remove each following Text individually in tree order, and recursively normalize non-Text descendants. Add a comment-node fixture so comment and element boundaries are explicit.

- [x] **Step 4: Run the test again and confirm production remains RED**

Run: `node --test tests/reversible-renderer.test.js`

Expected: the same normative sanitizer assertions fail; changing the fake alone cannot satisfy descriptor consumption.

### Task 2: Frozen-topology normalization descriptor planner

**Files:**
- Modify: `apps/extension/src/shared/reversible-renderer.js`
- Test: `tests/reversible-renderer.test.js`

**Interfaces:**
- Consumes: a parent node before `parent.normalize()` and existing `expectMutation` / `expectChildList` tracking.
- Produces: exact per-run character-data and per-node removal descriptors.

- [x] **Step 1: Implement the minimal descriptor fix**

For each frozen direct-child run:

```js
const survivorIndex = group.findIndex((node) => node.nodeValue !== '');
if (survivorIndex < 0) {
  for (const node of group) expectChildList(container, [], [node]);
} else {
  for (const node of group.slice(0, survivorIndex)) expectChildList(container, [], [node]);
  const survivor = group[survivorIndex];
  expectMutation({ type: 'characterData', target: survivor, oldValue: survivor.nodeValue });
  for (const node of group.slice(survivorIndex + 1)) expectChildList(container, [], [node]);
}
```

Flush before every non-Text boundary, recurse into element children after the boundary flush, and flush the final run. Do not combine removal descriptors or emit incremental old values.

- [x] **Step 2: Run focused GREEN**

Run: `node --test tests/reversible-renderer.test.js tests/dynamic-dom-controller.test.js`

Expected: all renderer and sanitizer tests pass, including mixed/extra record visibility.

- [x] **Step 3: Extend authored browser evidence if feasible**

Add adjacent Text runs with empty nodes and an element/comment boundary to the renderer browser fixture, remove the renderer root, and require exact text plus no duplicate/self-rediscovered marking. Keep the gate fail-closed when Chromium is absent.

### Task 3: Verification, report, and commit

**Files:**
- Modify: `.superpowers/sdd/2026-08-25-browser-runtime-ux-v0.4.0/task-7-report.md`

**Interfaces:**
- Consumes: the final source/tests/browser diff.
- Produces: focused/full/browser/syntax/diff evidence and exact round-5 commit.

- [x] **Step 1: Run all gates**

```bash
node --test tests/reversible-renderer.test.js tests/dynamic-dom-controller.test.js tests/runtime-scheduler.test.js tests/sentence-pipeline.test.js tests/source-contract.test.js
node --test tests/*.test.js
node --test tests/browser/reversible-renderer.e2e.test.js tests/browser/dynamic-dom.e2e.test.js
node --check apps/extension/src/shared/reversible-renderer.js
node --check apps/extension/src/shared/dynamic-dom-controller.js
node --check apps/extension/src/content.js
node --check tests/browser/reversible-renderer.e2e.test.js
node --check tests/browser/dynamic-dom.e2e.test.js
git diff --check
```

Expected: focused/full/syntax/diff checks pass. Browser tests fail explicitly only because Chromium is unavailable, with zero skipped tests.

- [x] **Step 2: Append exact report evidence**

Record the standard-derived contract, RED/GREEN counts, files, browser blocker, remaining concerns, and `PENDING` commit without editing the ledger.

- [x] **Step 3: Commit and resolve the report hash**

Stage only round-5 source, tests, browser fixture if changed, and this plan. Commit with `fix: match DOM normalization mutation records`, replace `PENDING` in the ignored report with the exact hash, and verify a clean worktree plus `git show --check`.
