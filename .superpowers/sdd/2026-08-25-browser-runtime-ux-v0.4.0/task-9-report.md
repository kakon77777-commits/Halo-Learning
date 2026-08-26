# Task 9 report — V040-09 Sensitive-site and user-denylist policy

## Status

`IMPLEMENTED_WITH_BROWSER_BLOCKER`

Implemented on `workbench/v0.4.0-browser-runtime` from base
`d944afa683cb8e0e37b4c5516ad1e248ef757da6`.

The installed-extension sensitive-site acceptance test is authored without a
skip or fake pass. It cannot execute in this environment because no supported
Chromium executable is installed.

## Carried Task 8 breaker prerequisite

The reentrant terminal orphan was reproduced before Task 9 policy work.
`panelOpenTarget` could remain independently live while a reentrant timer
cleanup moved the state to `dismissed`. Terminal cleanup incorrectly derived
panel ownership from `current.name === 'core-open'`, so `CANCEL` left the
Task 7 panel effect open.

Terminal reconciliation now closes whenever the independently tracked
`panelOpenTarget` is non-null, regardless of the current state name. The
existing timer-generation, nested explicit-open/CANCEL, no-duplicate-close,
and reentrant scheduling tests remain green.

RED evidence:

```text
node --test --test-name-pattern='independently tracked panel' tests/trigger-controller.test.js
tests 1
pass 0
fail 1

Expected close effects: ['cancel']
Actual close effects: []
```

Focused GREEN evidence:

```text
node --test tests/trigger-controller.test.js tests/content-trigger-runtime.test.js
tests 34
pass 34
fail 0
skipped 0
```

## Policy contract decisions

- Added a deterministic, frozen `PolicyDecision/v1` with exactly
  `schemaVersion`, `allow`, `category`, `reasonCode`, and `evidenceKind`.
  Category, reason, and evidence values are closed allowlists. Decisions carry
  no URL, hostname, path, attribute value, text, or other page data.
- `normalizeDenylist(values)` accepts only a bounded dense array of exact DNS
  hostnames. It canonicalizes case, one trailing root dot, and browser IDNA;
  deduplicates and sorts; and rejects wildcard, URL, path, port, whitespace,
  control, empty-label, over-count, over-label, and over-length inputs.
- Denylist matching is exact hostname or `.`-delimited subdomain only.
  `private.example.attacker.test`, `notprivate.example`, and other suffix tricks
  do not match `private.example`.
- Default URL rules cover banking, payment/checkout, password-manager vaults,
  authentication, webmail, private messaging, medical/insurance,
  government personal-data routes, and developer secret/credential consoles.
  Rules match exact normalized host/path labels in a fixed audited order, not
  substring suffixes.
- The security scan reads only `tagName`, and bounded `type`, `autocomplete`,
  `inputmode`, `name`, `role`, and allowlisted presence attributes. It never
  reads form `value`, page `textContent`/`innerText`, cookies, history, tokens,
  or arbitrary account state. Hidden inputs stop after the type read.
- The attribute scan is bounded to 128 elements and 8 ms. Missing, throwing,
  ambiguous, hostile, over-count, and over-time scans return sanitized blocked
  results. Tests install hostile private getters and assert all prohibited read
  counters stay exactly zero.
- Canonical settings now require closed `sitePolicy/v1` with an explicit empty
  migration default. A present invalid denylist fails rather than silently
  migrating to a narrower empty list. MarkingProfile runtime/schema parity
  includes canonical hostname syntax, bounds, uniqueness, order, and
  deduplication.

## Runtime and lifecycle decisions

- The site decision runs before TextRun creation, sentence extraction,
  selection acquisition, semantic messaging, renderer creation, or trigger
  listener installation. Missing/unknown policy, URL/location failure,
  settings failure, DOM scan failure, and unsupported protocols fail closed.
- A blocked status contains only zero-work counters, a sanitized error code,
  and the frozen decision. It contains no page data, sentence state, or
  selection state.
- Blocked pages retain only a policy-only observer: child insertion, exact
  security attributes, storage settings changes, and SPA route signals. It
  excludes character data, presentation attributes, discovery coalescing, and
  retained content roots. A fresh allow decision upgrades observation before
  starting a new runtime epoch.
- Allowed-to-blocked transitions synchronously detach the active runtime,
  cancel the unique epoch, cancel trigger timers/listeners, close panels,
  remove reversible renderer artifacts, release renderer/runtime references,
  and retain no stale semantic authority. Each restart uses a new monotonic
  runtime epoch, so old results cannot project into a later allow generation.
- Renderer-owned mutation records are removed by the existing exact
  operation-scoped sanitizer before policy mutation handling, preventing
  renderer-generated policy loops.
- Explicit-selection admission loads current settings and decides policy
  before calling the live Selection API. The extension context-menu handler
  continues to ignore `selectionText` entirely.
- The MV3 semantic service has defense in depth: browser initialization
  authorizes `HALO_ENRICH_BATCH` from `sender.tab.url` plus freshly loaded
  normalized denylist before request items or text are read and before packaged
  lexical resources are loaded. Cancellation remains available independently.

## Popup and injection decisions

- Popup UI shows the exact current hostname and provides separate bilingual
  block/remove actions. Both execute under the existing single-owner action
  mutex and locked profile persistence boundary.
- Popup changes only `sitePolicy.userDenylist`, preserves hidden profile fields,
  increments the profile revision exactly once when changed, and sends a
  policy-only reevaluation message. Blocking does not inject annotations.
- Canonical packaged injection loads `site-policy.js` before `settings.js` and
  `content.js`. Popup and service-worker import order follows the same local
  dependency order.
- No host permission, content-script declaration, remote script, remote policy
  dependency, or additional language/ontology scope was added.

## Strict TDD evidence

Policy RED:

```text
node --test tests/site-policy.test.js
Error: Cannot find module '../apps/extension/src/shared/site-policy'
tests 1
pass 0
fail 1
```

Settings/schema/entry/worker RED:

```text
node --test tests/profile-migration.test.js tests/marking-profile-schema.test.js \
  tests/browser-trigger-entry.test.js tests/extension-semantic-service.test.js \
  tests/source-contract.test.js
tests 43
pass 35
fail 8

Failures: missing sitePolicy defaults/schema/UI/injection order, missing worker
pre-text authorization, and missing content policy boundary.
```

Explicit-selection RED:

```text
node --test --test-name-pattern='policy boundary|policy decisions' \
  tests/content-trigger-runtime.test.js
tests 2
pass 0
fail 2

TypeError: Content.readExplicitSelectionAfterPolicy is not a function
```

Policy-only observer RED:

```text
node --test --test-name-pattern='policy-only observation' \
  tests/dynamic-dom-controller.test.js
tests 1
pass 0
fail 1

Full character-data observation and retained invalidation work were observed
while the page was blocked.
```

## Final verification

Complete Node regression:

```text
node --test tests/*.test.js
tests 378
pass 378
fail 0
cancelled 0
skipped 0
todo 0
```

All 22 changed JavaScript files passed `node --check`. The extension manifest
and MarkingProfile schema parsed as JSON. `git diff --check` exited zero with
no output.

## Browser acceptance: authored and explicitly blocked

```text
node --test tests/browser/sensitive-site.e2e.test.js
tests 1
pass 0
fail 1
cancelled 0
skipped 0
todo 0

Error: Chromium executable is required for Halo browser gates
```

The installed MV3 matrix covers every required default category; denylist
exact/subdomain/suffix behavior; hostile password/autocomplete value/text
getters; zero TextRun/sentence/semantic/selection/wrapper/panel/fetch-XHR work;
dynamic sensitive insertion; dynamic attribute change; blocked-to-allowed
fresh restart; public-to-sensitive SPA navigation; popup denylist update; and
cleanup of existing annotations.

## Files

- Created `apps/extension/src/shared/site-policy.js`, pure policy tests, and the
  installed sensitive-site browser matrix.
- Updated canonical settings, MarkingProfile runtime/schema, browser injection,
  content lifecycle, dynamic policy-only observation, semantic-worker defense,
  popup controls, and their executable contracts.
- Added the carried Task 8 terminal panel-effect regression and one-line fix.
- `progress.md` was not edited.

## Remaining concern

Chromium is absent. Consequently, real installed-world isolation, `*.localhost`
fixture routing, native command delivery, popup-to-tab cleanup timing, real
MutationObserver ordering, and network observation remain unexecuted here.
The browser gate reports that limitation as one failure with zero skips rather
than substituting Node-only evidence.
