# Task 9 report — V040-09 Sensitive-site and user-denylist policy

## Status

`IMPLEMENTED_WITH_BROWSER_BLOCKER`

Task 9 was implemented on `workbench/v0.4.0-browser-runtime` from base
`d944afa683cb8e0e37b4c5516ad1e248ef757da6`. Fix round 1 was applied from
clean Task 9 commit `f7b7b09726946bb8cdb638869dc5d998acf4ea34`.
Fix round 2 was applied from clean commit
`9708dda462b83837694bbe6309dd4ab6f5c518fb`.

The installed-extension browser gate remains an explicit failure with zero
skips because this environment has no Chromium executable. No browser result
below is represented as executed evidence.

## Carried Task 8 breaker

The independently tracked `panelOpenTarget` is reconciled closed on terminal
cleanup regardless of whether reentry left the public state named `dismissed`,
`candidate`, or `core-open`. The targeted regression proves one close effect,
no duplicate close, nested new-open/CANCEL authority, and timer release.

Original RED:

```text
node --test --test-name-pattern='independently tracked panel' tests/trigger-controller.test.js
tests 1; pass 0; fail 1
Expected close effects: ['cancel']; actual: []
```

## Fix-round RED evidence

All production changes in this round followed an observed adversarial RED.
Representative evidence:

```text
node --test tests/site-policy.test.js
tests 14; pass 10; fail 4
Failures: Chase representative allowed; query/hash route not classified;
dense descriptor extras accepted; unstable/zero-node scan boundary accepted.

node --test --test-name-pattern='renderer cleanup' tests/runtime-scheduler.test.js
tests 3; pass 1; fail 2
TypeError: Content.reconcileRendererCleanup is not a function

node --test tests/content-policy-lifecycle.test.js
tests 2; pass 0; fail 2
Malformed APPLY left scheduler/listeners live; missing policy module returned a
non-blocked status over existing annotations.

node --test --test-name-pattern='allowed-to-blocked storage transition' \
  tests/content-policy-lifecycle.test.js
tests 1; pass 0; fail 1
Cleanup stayed pending after a later storage-triggered allow retry.

node --test --test-name-pattern='explicit selection cannot' \
  tests/content-policy-lifecycle.test.js
tests 1; pass 0; fail 1
Actual code: NO_SELECTION; required: SENSITIVE_PAGE_CLEANUP_PENDING.

node --test --test-name-pattern='locked site-host operations' \
  tests/profile-migration.test.js
tests 1; pass 0; fail 1
TypeError: persistence.saveTransform is not a function

node --test --test-name-pattern='denylist snapshots' tests/site-policy.test.js
tests 1; pass 0; fail 1
A transparent Proxy was accepted.

node --test --test-name-pattern='truthy but incomplete runtime module' \
  tests/content-policy-lifecycle.test.js
tests 1; pass 0; fail 1
The newly observed controller was never cleaned after a partial runtime failed.

node --test --test-name-pattern='failed controller cleanup retains authority' \
  tests/content-policy-lifecycle.test.js
tests 1; pass 0; fail 1
A failed old-controller cleanup was overwritten and cleanupPending became false.

node --test --test-name-pattern='allowed APPLY response stamps' \
  tests/content-policy-lifecycle.test.js
tests 1; pass 0; fail 1
APPLY reported zero TextRun extractions while immediate HALO_STATUS reported one.

node --test --test-name-pattern='successful non-empty batch' \
  tests/content-policy-lifecycle.test.js
tests 1; pass 0; fail 1
A successful semantic batch dropped cleanupPending and remainingArtifacts.

node --test --test-name-pattern='cancellation after shard callback' \
  tests/extension-semantic-service.test.js
tests 1; pass 0; fail 1
A late cancel returned the already-built lexical result instead of cancelled.
```

The worker delayed-authorization test also failed before implementation:
CANCEL returned `not-found` while authorization was pending, proving that the
request controller was registered too late.

### Fix-round 2 RED evidence

The three adjudicated round-2 issues each received a focused adversarial RED
before implementation:

```text
node --test --test-name-pattern='forged known-host suffix' tests/site-policy.test.js
tests 1; pass 0; fail 1
https://chase.com.attacker.test/login: expected allow false; actual true

node --test --test-name-pattern='cleanup retains and retries' \
  tests/dynamic-dom-controller.test.js
tests 1; pass 0; fail 1
Expected a versioned pending cleanup status; actual undefined.

node --test --test-name-pattern='failed controller cleanup retains authority' \
  tests/content-policy-lifecycle.test.js
tests 1; pass 0; fail 1
Expected cleanupPending true after a non-throwing residual teardown; actual false.

node --test --test-name-pattern='production resource fetch attempts' \
  tests/extension-semantic-service.test.js
tests 1; pass 0; fail 1
TypeError: ServiceWorker.createNetworkActivityCounter is not a function

node --test --test-name-pattern='successful non-empty batch' \
  tests/content-policy-lifecycle.test.js
tests 1; pass 0; fail 1
Expected observed worker fetch attempts 2; actual 0.

node --test --test-name-pattern='observer drain authority survives' \
  tests/dynamic-dom-controller.test.js
tests 1; pass 0; fail 1
After setPolicyOnly disconnected successfully but takeRecords threw, cleanup
reported cleaned true with no pending stages and never retried the record drain.
```

## Policy contract

- `PolicyDecision/v1` remains frozen and closed to the five canonical fields.
  Categories, reasons, and evidence are exact allowlists and contain no page
  data. `AMBIGUOUS_URL` is the only new sanitized reason.
- The bounded, frozen service registry explicitly distinguishes exact hosts
  and label-boundary suffix hosts. It covers representative banking,
  payment/checkout, password vault, webmail, private messaging,
  medical/insurance, government-personal, and developer-secret services. It
  includes Chase, Outlook webmail, Discord channels, UHC member pages, AWS
  Secrets Manager, Google Secret Manager, and Azure Key Vault/secrets.
- This registry is deliberately representative and auditable; it is not
  claimed to classify the web exhaustively. Known-host suffix tricks such as
  `vault.bitwarden.com.attacker.test` suppress only forged host evidence; they
  still pass through independent route and form rules. Thus benign paths remain
  allowed, while `/login`, `/checkout`, `/password-reset`, their single-encoded
  equivalents, and ambiguous multiply encoded routes block without treating
  the attacker host as the registered service.
- Route evidence is taken from bounded path, search, and hash tokens after safe
  normalization. Credentials, encoded separators/backslashes/dot ambiguity,
  multiple encoding, malformed percent escapes, residual `%xx`, token excess,
  and route excess return `AMBIGUOUS_URL`. `%256cogin` and `%252Flogin` are
  blocked, not decoded into an allow.
- Denylists are snapshotted from one dense set of own data descriptors. Holes,
  accessors, extra string/symbol properties, subclasses, hostile descriptor
  traps, transparent Proxies, unstable/invalid length, uncloneable entries,
  and all earlier hostname ambiguity fail closed. No entry or length getter is
  used.
- Security scans sample finite monotonic time before query, immediately after
  query, after every element (including hidden elements), and finally even for
  zero results. Query result length must remain a safe stable integer, items
  must be non-null, and every count/time violation blocks.
- The scan still reads only `tagName`, bounded `type`, `autocomplete`,
  `inputmode`, `name`, `role`, and allowlisted presence attributes. Tests place
  throwing getters on `value`, `textContent`, and `innerText` and observe zero
  reads. Hidden inputs stop after `type`.

## Runtime cleanup and fail-closed authority

- Allowed-to-blocked shutdown removes trigger listeners/timers and detaches,
  cancels, and disconnects runtime work before renderer cleanup.
- Renderer authority is released only after `removeAll()` and `status()` verify
  zero wrappers and a closed panel. A transactional failure retains the exact
  renderer reference and reports `cleanupPending` with numeric remaining
  wrapper/panel counts, or `unknown` when status cannot be verified.
- Runtime, trigger, renderer, and failed controller-cleanup targets remain
  available for retry without remaining active semantic authority. Storage,
  route, observer, explicit-selection, APPLY, and REMOVE paths retry cleanup.
  An allow decision cannot start a new epoch until cleanup verifies clean.
- Failed dynamic-controller cleanup targets are retained independently. A new
  controller cannot overwrite them: APPLY returns cleanup-pending until every
  retained target cleans, while renderer cleanup can still use the retained
  observer's mutation-suppression boundary.
- Dynamic-controller teardown is transactional per capability. Every cleanup
  attempt best-effort tries all still-pending timers, observer disconnect and
  record drain, event listeners, and history hooks. A capability flag and its
  exact restoration authority are released only after that stage succeeds;
  successful stages are not repeated, failures remain in a frozen allowlisted
  status for retry, and failed history restoration leaves the installed wrapper
  calling the original native method. Content deletes the exact controller
  target only after the controller reports verified clean.
- Observer record-drain authority is acquired immediately after every verified
  disconnect, including policy-mode and route reconfiguration outside final
  cleanup. Re-observation cannot erase it, and only a successful `takeRecords()`
  releases it; an intermediate failure therefore remains visible and retriable
  during final cleanup.
- A malformed APPLY or disappearing shared module performs best-effort shutdown
  before module/settings validation. Missing dynamic-controller globals cannot
  prevent a retained controller from suppressing and completing renderer
  cleanup. Old listeners and the active semantic epoch are not left live.
- Status is truthful: verified clean state reports zero current artifacts;
  failed cleanup reports retained counts/unknown and never fabricates zero.
  Monotonic production boundary counters for policy evaluations, TextRun
  extraction, sentence records, selection reads, semantic messages, renderer
  calls, and observed worker packaged-resource fetch attempts are stamped into
  status and are never reset within that content-script lifetime.
  Allowed APPLY responses are stamped after discovery and scheduler flushing,
  so they agree with the immediately following HALO_STATUS snapshot.
- Explicit selection rechecks policy and pending cleanup before touching the
  live Selection API. A pending cleanup returns
  `SENSITIVE_PAGE_CLEANUP_PENDING` with no selection read or trigger restart.

## Worker and popup concurrency

- The worker validates only the request envelope (`requestId`, `pageEpoch`) and
  sender tab, then registers its `AbortController` before awaiting policy and
  storage authorization. It does not read `items`/text or load lexical data at
  that stage. CANCEL, duplicate IDs, authorization exceptions, and post-auth
  races all converge through signal checks and `finally` removal.
  A final signal check after the awaited pinned-shard operation discards a
  lexical result if cancellation arrived after its callback but before settle.
- Popup host add/remove is now a transform executed after rereading the latest
  profile inside the existing exclusive settings lock. Parallel distinct
  hosts are preserved, identical edits converge without an extra revision, and
  serialized remove/add races produce the lock order's final value.
- No host permissions, remote policy dependency, remote script, or language
  scope were added.

### Network boundary accounting

- A counter owned by one service-worker lifetime increments immediately before
  every actual packaged lexical-resource `fetch` call, including attempts whose
  fetch later rejects or is aborted. URL construction failures and runtime
  messages are not counted because no fetch was attempted.
- The worker returns only frozen, sanitized
  `{schemaVersion, scope: "worker-lifetime", lifetimeId, fetchAttempts}` data
  through the same lexical response/status path used by production and
  `HALO_DICTIONARY_STATUS`; it never exposes a resource URL or page data.
- Content observes worker-lifetime snapshots and accumulates only monotonic
  deltas into its own explicitly scoped `content-script-lifetime` status. A
  worker restart creates a new lifetime ID and is added as a new observed
  source; neither scope is represented as globally monotonic across restarts.

## Browser acceptance authored; execution blocked

The installed-runtime test now:

- routes local fixture HTML under the real representative service URLs above;
- installs prohibited getters in the extension `ISOLATED` world through
  `chrome.scripting.executeScript` before Halo files;
- first drives an allowed installed-page lexical marking canary through the
  production response/status plumbing and requires the manifest and shard
  fetch-attempt counts to become non-zero in both content and worker status;
- then asserts sensitive fixtures do not increase the real worker-lifetime
  fetch-attempt counter, alongside zero extraction, sentence, selection,
  semantic, wrapper, and panel work;
- exercises installed exact-host, subdomain, and suffix-trick denylist behavior,
  popup add and remove, dynamic form insertion/attribute change, SPA blocking,
  cleanup failure/retry, storage-authorization failure, and a held stale
  semantic response released after route cancellation.

The first command no longer depends on a URL-filtered tab query before the
native gesture grants `activeTab`: it brings the fixture forward and resolves
only `{active: true, currentWindow: true}`. Later popup actions reuse the
already-known tab ID.

The gate is not skipped or replaced by direct popup calls:

```text
node --test tests/browser/sensitive-site.e2e.test.js
tests 1
pass 0
fail 1
skipped 0
Error: Chromium executable is required for Halo browser gates
```

Accordingly, native command delivery, the test-time isolated-world hooks, and
real MutationObserver/service-worker timing remain unexecuted concerns in this
environment.

## Final verification

```text
node --test tests/*.test.js
tests 402
pass 402
fail 0
cancelled 0
skipped 0
todo 0
```

All changed JavaScript passed `node --check`; the extension manifest and
canonical MarkingProfile schema parsed as JSON; `git diff --check` exited zero.

`progress.md` was not edited.
