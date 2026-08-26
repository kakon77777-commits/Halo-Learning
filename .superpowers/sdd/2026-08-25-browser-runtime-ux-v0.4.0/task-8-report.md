# Task 8 report — V040-08 Trigger controller and explicit interaction priority

## Status

`IMPLEMENTED_WITH_BROWSER_BLOCKER`

Implemented on `workbench/v0.4.0-browser-runtime` from base
`38926254b95ddf64fa7c11622ee74d3c626c5733`.

The complete real-Chromium trigger acceptance test is authored without a skip
or fake pass. It cannot execute in this environment because no supported
Chromium executable is installed.

## Contract decisions

- Added a deterministic controller for exactly `adaptive-hover`,
  `explicit-only`, and `hybrid`, with only the canonical states and events from
  the Task 8 brief. Explicit opens and modifier-hover cancel inferred hover
  generations before opening; `explicit-only` never schedules plain hover.
- Hover uses two injected timer stages (`candidate` -> `primed` -> `core-open`)
  and delayed pointer dismissal. Hover and dismissal callbacks carry a target
  plus generation, so cancelled callbacks cannot open or close later targets.
  Explicit actions retain priority even if an inferred event has an older
  logical timestamp; stale inferred events are ignored.
- Esc, outside click, target switching, token/panel re-entry, focus/pointer
  transitions, route cleanup, and cancellation are deterministic. Terminal
  cleanup clears all timers, removes content listeners, closes the Task 7 panel
  through `closePanel`, and permanently rejects later callbacks.
- Content interaction delegates all panel DOM work to Task 7 `openPanel` and
  `closePanel`. Token admission requires Task 7's private `ownsToken`
  capability. The displayed data is a frozen snapshot of the current
  projection; the controller does not write semantic or DOM truth.
- Normal page clicks and links are never cancelled. Only a privately owned
  Halo token click calls `preventDefault`/`stopPropagation` before the explicit
  open.
- MarkingProfile/v2 now carries exact `triggerMode` contract/schema validation.
  Existing stored profiles deterministically migrate to `hybrid`. UI merges
  preserve hidden runtime/compatibility fields and increment the profile
  revision under the existing cross-context lock. Overlapping trigger and
  visual edits remain serialized.
- Added one shared packaged browser entry. Popup Apply, popup Analyze
  Selection, context-menu, and command handlers inject the same frozen local
  file list, then use the exact `{ type: 'HALO_EXPLICIT_SELECTION', action:
  'analyze-selection' }` envelope.
- The manifest adds only `contextMenus` and the `halo-analyze-selection`
  command (`Alt+Shift+H`). It still has no host permissions, content-script
  declaration, or remote code.
- Install/update removes and recreates exactly one selection-only context menu.
  Worker registration is idempotent per worker lifetime; event handlers contain
  tab-close, injection, message, and API failures and reconstruct their work
  from packaged constants without resident-worker assumptions.
- Content reinjection remains guarded by `__HALO_CONTENT_INITIALIZED__`.
  Explicit actions validate the exact message, reread an actual live nonempty
  user selection, and reject collapsed, empty, oversized, forged, or throwing
  page selection inputs. Selected text is never added to extension messages,
  storage, enrichment requests, or remote requests.
- The popup exposes trigger mode and an explicit current-tab Analyze Selection
  action. It uses the existing locked persistence boundary, and all browser
  entry failures produce local UI status only.

## Strict TDD RED evidence

### RED 1 — controller module absent

```text
node --test tests/trigger-controller.test.js
Error: Cannot find module '../apps/extension/src/shared/trigger-controller'
tests 1
pass 0
fail 1
```

### RED 2 — trigger settings/profile migration absent

```text
node --test tests/profile-migration.test.js
tests 10
pass 6
fail 4

Expected triggerMode "hybrid" / accepted modes; actual undefined.
Expected revision 9 after trigger edit; actual 8.
```

### RED 3 — canonical browser entry absent

```text
node --test tests/browser-trigger-entry.test.js
Error: Cannot find module '../apps/extension/src/shared/browser-entry'
tests 1
pass 0
fail 1
```

### RED 4 — content trigger boundary absent

```text
node --test tests/content-trigger-runtime.test.js
tests 5
pass 0
fail 5

Content.validateExplicitSelectionMessage / panelModelForToken /
createContentTriggerRuntime were not functions.
```

### RED 5 — canonical MarkingProfile and popup controls absent

```text
node --test tests/semantic-contracts.test.js tests/source-contract.test.js
tests 16
pass 14
fail 2

MarkingProfile triggerMode was undefined; popup triggerMode/action controls
were absent.
```

### RED 6 — inferred dismissal left an orphaned candidate

```text
node --test --test-name-pattern="cancel pending inferred" tests/trigger-controller.test.js
tests 1
pass 0
fail 1

Expected dismissed/escape; actual candidate/pending.
```

Esc/outside dismissal now invalidates the pending generation and enters a
recoverable dismissed state.

### RED 7 — hostile selection API escaped the fail-closed boundary

```text
node --test --test-name-pattern="selection must be live" tests/content-trigger-runtime.test.js
tests 1
pass 0
fail 1

Error: page override
  at Object.getSelection
  at Object.readExplicitSelection
```

All page-controlled selection acquisition, string conversion, range access,
and geometry reads now share one fail-closed boundary.

## GREEN and regression evidence

Focused controller/content verification:

```text
node --test tests/trigger-controller.test.js tests/content-trigger-runtime.test.js
tests 15
pass 15
fail 0
skipped 0
```

Focused browser-entry/service verification:

```text
node --test tests/browser-trigger-entry.test.js tests/extension-semantic-service.test.js
tests 14
pass 14
fail 0
skipped 0
```

Final complete Node regression:

```text
node --test tests/*.test.js
tests 329
pass 329
fail 0
cancelled 0
skipped 0
todo 0
```

All changed JavaScript passed `node --check`. The extension manifest and
MarkingProfile schema parsed as JSON. `git diff --check` exited zero with no
output.

## Browser acceptance: authored and explicitly blocked

```text
node --test tests/browser/trigger-controller.e2e.test.js
tests 1
pass 0
fail 1
cancelled 0
skipped 0
todo 0

Error: Chromium executable is required for Halo browser gates
```

The authored installed-extension test covers private-token click, the shared
message/shortcut/context/popup selection path, modifier hover, all three modes,
Esc, outside click, delayed dismissal and panel re-entry, stale hover/dismiss
generations, route cleanup, ordinary-link preservation, exact invalid-envelope
rejection, and content reinjection without duplicate listeners.

## Files

- Created `apps/extension/src/shared/trigger-controller.js` and the shared
  `browser-entry.js` injection boundary.
- Modified manifest, service worker, content runtime, popup UI/styles, settings,
  profile controls, and the MarkingProfile runtime/schema contract.
- Added pure controller, content integration, browser-entry/service-worker, and
  real-browser E2E tests; extended migration, semantic-contract, fixture, and
  source-contract coverage.
- Added this report. `progress.md` was not edited.

## Remaining concern

- Chromium is absent, so real DOM event ordering, installed MV3 injection,
  native command/context delivery, Shadow DOM focus/pointer retargeting, and
  popup-to-tab behavior remain unexecuted here. The authored browser gate fails
  explicitly with zero skips rather than claiming coverage from Node tests.

## Fix round 1 — adversarial controller/runtime hardening

The review findings were reproduced with new tests before production changes.
The first focused RED run had 53 tests, 44 passing and 9 failing. The failures
covered reentrant `openPanel`/`closePanel`, throwing effects, explicit-only
re-entry, equal-time event priority, exact selection validation, composed-path
lookup, cleanup exceptions, and missing private panel ownership. The popup RED
failed because `shared/popup-actions.js` did not exist, and the schema RED
reported `profileRevision` and `runtimeBudgets` as forbidden additional fields.

The controller now commits its frozen transition and timer generations before
calling renderer effects. Effects are contained through a non-throwing
`onError` boundary, so a reentrant terminal or newer explicit dispatch remains
authoritative and terminal cleanup stays permanent even when panel closure
throws. Equal-time ordering records explicit/terminal priority, including an
explicit event carrying an older timestamp. In `explicit-only`, same-target
re-entry cancels delayed dismissal before plain-hover rejection.

Selection admission now requires exactly one non-collapsed range, consistent
non-collapsed selection state, three connected boundary nodes owned by the
current document, bounded nonempty text, and safe geometry. Every hostile
getter, range, string, and geometry failure returns `NO_SELECTION`; selected
text remains absent from messages and storage. Event lookup uses a guarded
`composedPath()` before fallback traversal. Task 7 now exposes a private
WeakSet-backed `ownsPanel` capability, so page-authored panel markers have no
dismissal authority.

Runtime cleanup enters the controller's terminal state first, attempts every
listener removal, retains failed removals for retry, and exposes completion so
the browser runtime is not discarded early. Popup Apply, Remove, and Analyze
Selection share one owner-token mutex that preserves prior disabled state,
blocks overlapping actions, and releases controls only from the owning
operation's `finally` path.

The MarkingProfile schema and runtime contract now include required
`profileRevision` and the complete, closed `runtimeBudgets` object with the same
integer ranges as settings normalization. The tests use a strict recursive
schema validator that checks required fields, additional properties, types,
and numeric bounds rather than only parsing JSON.

The browser fixture was replaced with an installed MV3 test. It launches the
unpacked extension, discovers the real extension ID from its service-worker
URL, uses a loopback fixture server and the actual popup document, performs
packaged injection through Chrome APIs, exercises token click, all modes,
modifier hover, dismissal/recovery, popup selection, the native command
shortcut, ordinary-link preservation, reinjection, and worker termination and
restart. Chromium's native context-menu UI is not exposed by Playwright; the
test states that limitation inline and verifies the registered menu through
the installed worker's real `chrome.contextMenus` API without claiming native
click delivery.

Final fix-round verification:

```text
node --test tests/*.test.js
tests 341
pass 341
fail 0
cancelled 0
skipped 0
todo 0
```

All changed JavaScript passed `node --check`; the manifest and MarkingProfile
schema parsed as JSON; `git diff --check` exited zero. The installed browser
gate remains an explicit environmental failure with one failed test and zero
skips:

```text
Error: Chromium executable is required for Halo browser gates
```

`progress.md` was not edited.

## Fix round 3 — dispatch intent, strict migration, and CDP termination

Adversarial RED tests reproduced same-state timer reentry, nested leave during
explicit open, coercive rectangle geometry, inherited canonical fields,
unbounded hostile paths, and the absence of a supported worker-termination
helper. The controller now increments a monotonic serial at every dispatch
entry; timer clears and effects abort remaining outer intent when nested
dispatch changes that serial. Newest nested state and timer intent wins.

Selection geometry accepts only finite primitive numbers (with nonnegative
sizes), never numeric strings, booleans, bigint, missing values, or coercion.
Composed paths require a real array with a safe integer length no greater than
256; fallback parent/host traversal is cycle-aware and bounded to 256 nodes.

Canonical profile validation now requires every field as an own property at
the profile, channels, and runtime-budget levels. `normalizeSettings` is the
strict canonical path; `migrateSettings` alone accepts legacy/missing storage,
fills defaults, removes aliases, and then invokes strict validation. Storage
loads explicitly migrate, while apply/save/current profile paths normalize
strictly. Tests prove legacy rejection on the strict path and canonical
round-trip after migration.

The installed MV3 harness now terminates its worker through the supported CDP
`ServiceWorker.enable` / `workerVersionUpdated` / `stopWorker(versionId)` flow.
A pure helper test proves exact script-URL matching, version selection, command
shape, cleanup, mismatch handling, and timeout behavior without Chromium.

Final regression: 353 tests passed with zero failures or skips. The browser gate
remains explicitly blocked only by the absent Chromium executable (one failure,
zero skips). `progress.md` was not edited.

## Fix round 2 — hostile boundaries and canonical parity

This round began with adversarial tests for the six review areas. The focused
RED run contained 30 tests: 24 passed and 6 failed for range-derived selection,
throwing terminal cleanup, hostile composed-path traversal, schema/runtime
parity, equal-time dismissal, and `clearTimeout` reentry. A seventh isolated
RED then proved that reentry from `clearTimeout` during candidate departure was
overwritten by the outer `POINTER_LEAVE` transition.

Timer handles are now detached and generations advanced before an injected
`clearTimeout` is called. Clear failures and even a throwing `onError` observer
are contained. Every transition that can clear a timer commits first and uses a
transition generation so reentrant dispatch wins. Terminal cleanup commits the
permanent cancelled state before clearing either timer or closing Task 7's
panel. Content cleanup independently attempts terminal dispatch and every
listener removal, retains only failed removals for retry, and reports complete
only once no listener remains.

Explicit selection now performs all document and Selection access in one
fail-closed boundary. It requires one non-collapsed Range, connected
same-document start/end/common-ancestor nodes, text derived only from
`Range.toString()` (with Selection consistency), and a callable geometry API
returning finite coordinates and nonnegative dimensions. Missing, null, NaN,
throwing, adopted, disconnected, inconsistent, and outside-range inputs are
rejected without fallback coordinates.

Event traversal now uses guarded property reads and per-node traversal through
`parentElement` or Shadow DOM `host`. Hostile event targets, composed paths,
array entries, node getters, and renderer ownership predicates cannot escape;
a hostile early path entry does not prevent discovery of a later privately
owned token or panel.

MarkingProfile/v2 is now one strict canonical boundary. The runtime validator
requires every schema field and rejects unknown profile, channel, and runtime
budget fields. Compatibility cap ranges are aligned at `50..2000` text nodes
and `100..10000` marked tokens across settings, runtime, and JSON Schema.
Legacy stored values remain accepted only through `migrateSettings`, which
fills defaults and emits a canonical profile. One valid/invalid corpus is run
through both the recursive JSON Schema validator and runtime normalizer to
prove accept/reject parity.

Equal-time ordering now blocks only inferred opens or target switches that
would displace explicit authority. Same-target entry cancels delayed dismiss,
while pointer leave, delayed timeout, outside click, Escape, and terminal events
remain effective at the same logical time.

The installed MV3 test now makes native `Alt+Shift+H` on the active fixture tab
the first injection attempt, establishing the `activeTab` grant before popup or
worker scripting. It explicitly asserts outside-click closure, invalid-envelope
rejection, stale-hover generation safety, route cleanup, and exactly one panel
addition after repeated reinjection. Worker termination is validated by
functional command recovery without assuming a distinct Playwright Worker
object; forced idle suspension is identified as unavailable. Native
context-menu UI delivery remains an explicit automation limitation, while the
real installed menu registration is asserted through Chrome APIs.

Fix-round verification:

```text
node --test tests/*.test.js
tests 347
pass 347
fail 0
cancelled 0
skipped 0
todo 0
```

The installed browser gate remains explicitly blocked with one failure and no
skip because Chromium is absent:

```text
Error: Chromium executable is required for Halo browser gates
```

`progress.md` was not edited.
