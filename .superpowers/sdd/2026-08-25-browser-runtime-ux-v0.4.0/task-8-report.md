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
