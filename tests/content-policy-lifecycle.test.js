'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'apps', 'extension', 'src', 'content.js'), 'utf8');

function allowedDecision() {
  return Object.freeze({
    schemaVersion: 1,
    allow: true,
    category: 'public',
    reasonCode: 'ALLOW',
    evidenceKind: 'NONE'
  });
}

function createHarness(options) {
  const harnessOptions = options || {};
  let messageListener;
  let storageListener;
  let schedulerCancels = 0;
  let controllerCleanups = 0;
  let controllerCreates = 0;
  let controllerObserves = 0;
  let controllerCleanupFails = false;
  let policyAllowed = true;
  const operations = [];
  const eventListeners = new Map();
  const rendererState = { wrapperCount: 2, panelOpen: true, failRemove: false, removeAttempts: 0 };
  const renderer = {
    removeAll() {
      operations.push('renderer-remove');
      rendererState.removeAttempts += 1;
      if (rendererState.failRemove) throw new Error('transactional remove failed');
      rendererState.wrapperCount = 0;
      rendererState.panelOpen = false;
      return { action: 'removed-all', wrappers: 2 };
    },
    status() {
      return {
        wrapperCount: rendererState.wrapperCount,
        panel: { open: rendererState.panelOpen }
      };
    },
    openPanel() { rendererState.panelOpen = true; },
    closePanel() { rendererState.panelOpen = false; },
    ownsToken() { return false; },
    ownsPanel() { return false; },
    apply() { throw new Error('zero-root fixture must not render'); }
  };
  const contentRoot = {
    nodeType: 1,
    isConnected: true,
    matches() { return true; },
    querySelector() { return null; }
  };
  const document = {
    body: {},
    documentElement: {},
    addEventListener(type, listener) {
      if (!eventListeners.has(type)) eventListeners.set(type, new Set());
      eventListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      operations.push('listener-remove');
      const values = eventListeners.get(type);
      if (values) values.delete(listener);
    },
    querySelectorAll() { return []; },
    createTreeWalker() { return { nextNode() { return null; } }; },
    elementsFromPoint() { return harnessOptions.withRootWork ? [contentRoot] : []; }
  };
  const settings = Object.freeze({
    enabled: true,
    triggerMode: 'hybrid',
    languageMode: 'both',
    profileRevision: 1,
    sitePolicy: Object.freeze({ schemaVersion: 1, userDenylist: Object.freeze([]) }),
    runtimeBudgets: Object.freeze({
      maxTextNodes: 24,
      maxCharacters: 12000,
      maxSentences: 24,
      maxSemanticTokens: 600,
      maxShardIds: 24,
      timeSliceMs: 8,
      maxQueuedRoots: 200,
      viewportBufferPx: 1200
    })
  });
  const Policy = {
    POLICY_CATEGORIES: ['public', 'banking', 'policy-error'],
    POLICY_REASON_CODES: ['ALLOW', 'SENSITIVE_URL_CATEGORY', 'POLICY_INPUT_ERROR'],
    POLICY_EVIDENCE_KINDS: ['NONE', 'HOST_LABEL', 'POLICY_ERROR'],
    classifySite() {
      return policyAllowed ? allowedDecision() : Object.freeze({
        schemaVersion: 1,
        allow: false,
        category: 'banking',
        reasonCode: 'SENSITIVE_URL_CATEGORY',
        evidenceKind: 'HOST_LABEL'
      });
    }
  };
  const context = {
    console,
    Object,
    Array,
    Set,
    Map,
    WeakMap,
    WeakSet,
    WeakRef,
    Promise,
    Date,
    Error,
    TypeError,
    AggregateError,
    AbortController,
    setTimeout,
    clearTimeout,
    document,
    location: { href: 'https://public.example/article' },
    history: {},
    innerWidth: 800,
    innerHeight: 600,
    performance: { now: () => 0 },
    NodeFilter: { SHOW_ELEMENT: 1 },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    requestIdleCallback(callback) { callback(); return 1; },
    cancelIdleCallback() {},
    chrome: {
      runtime: {
        onMessage: { addListener(listener) { messageListener = listener; } },
        sendMessage: async (message) => {
          if (!harnessOptions.withBatch || !message || message.type !== 'HALO_ENRICH_BATCH') {
            throw new Error('zero-root fixture must not request semantics');
          }
          return {
            schemaVersion: 1,
            requestId: message.requestId,
            pageEpoch: message.pageEpoch,
            status: { mode: 'ready' },
            results: message.items.map((item) => {
              const generatedAt = '2026-08-26T00:00:00.000Z';
              return {
                schemaVersion: 1,
                requestId: message.requestId,
                pageEpoch: message.pageEpoch,
                rootId: item.rootId,
                rootRevision: item.rootRevision,
                analysisKey: item.analysisKey,
                phase: 'lexical',
                lexicalVersion: item.lexicalVersion,
                generatedAt,
                annotationSet: {
                  textLength: item.text.length,
                  languageMode: item.languageMode,
                  generatedAt,
                  tokens: []
                }
              };
            })
          };
        }
      },
      storage: {
        local: { get: async () => ({ haloSettings: settings }) },
        onChanged: { addListener(listener) { storageListener = listener; } }
      }
    },
    HaloSettings: {
      normalizeSettings(value) {
        if (!value || value.valid !== true) throw new TypeError('malformed settings');
        return settings;
      },
      migrateSettings() { return settings; }
    },
    HaloSitePolicy: Policy,
    HaloDictionary: { createBootstrapDictionaryProvider: () => ({ id: 'fixture', version: '1' }) },
    HaloSemanticAnnotations: { ENGINE: { version: 'semantic-v1' } },
    HaloGrammarAnnotations: { ALGORITHM: { version: 'grammar-v1' } },
    HaloProjection: { createMarkingPlan() { return []; } },
    HaloSentencePipeline: {
      buildSentenceRecords() {
        return harnessOptions.withBatch
          ? Object.freeze([Object.freeze({
              rootRevision: 1,
              text: 'Study.',
              language: 'en',
              start: 0,
              end: 6,
              fragments: Object.freeze([Object.freeze({ nodeId: 'n1', start: 0, end: 6 })])
            })])
          : Object.freeze([]);
      },
      createTextRuns() { return Object.freeze([]); },
      mapAggregateSpanToFragments() { return Object.freeze([]); }
    },
    HaloProgressiveRuntime: { createAnalysisKey(item) { return `key:${item.rootId}`; } },
    HaloSemanticContracts: {
      SEMANTIC_SCHEMA_VERSION: 1,
      normalizeAnnotationSet(value) { return value; }
    },
    HaloRuntimeScheduler: {
      createRuntimeScheduler(runtimeOptions) {
        const queued = [];
        let flushPromise = null;
        return {
          enqueue(items) {
            queued.push(...(Array.isArray(items) ? items : [items]));
            return true;
          },
          cancelRoot() {},
          cancelEpoch() { schedulerCancels += 1; operations.push('scheduler-cancel'); },
          status() { return { queuedRoots: queued.length, oversizedWork: Object.freeze([]) }; },
          flush() {
            if (!harnessOptions.withBatch || (!queued.length && !flushPromise)) return Promise.resolve();
            if (flushPromise) return flushPromise;
            const items = queued.splice(0);
            const textNodes = items.reduce((sum, item) => sum + item.textNodes, 0);
            const controller = new AbortController();
            flushPromise = runtimeOptions.processBatch({ items, textNodes }, { signal: controller.signal })
              .finally(() => { flushPromise = null; });
            return flushPromise;
          }
        };
      }
    },
    HaloDynamicDomController: {
      createRendererMutationSanitizer() { return { trackNode() {}, expect() {}, sanitize: (record) => record }; },
      createDynamicDomController() {
        controllerCreates += 1;
        return {
          observe() { controllerObserves += 1; },
          routeEpoch() { return 1; },
          setPolicyOnly() {},
          suppressRendererMutations(callback) { return callback(); },
          cleanup() {
            controllerCleanups += 1;
            if (controllerCleanupFails) throw new Error('controller cleanup failed');
          }
        };
      }
    },
    HaloReversibleRenderer: {
      RENDER_REQUEST_SCHEMA_VERSION: 1,
      createReversibleRenderer() { return renderer; }
    },
    HaloTriggerController: {
      createTriggerController() {
        let state = Object.freeze({ name: 'idle', targetId: null });
        return {
          dispatch() { return state; },
          state() { return state; }
        };
      }
    }
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'content.js' });

  async function send(message) {
    return new Promise((resolve, reject) => {
      try {
        const asyncResponse = messageListener(message, {}, resolve);
        if (!asyncResponse && message.type !== 'HALO_APPLY_MARKING') {
          // Synchronous handlers invoke resolve before returning.
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  return {
    context,
    rendererState,
    send,
    listenerCount: () => [...eventListeners.values()].reduce((sum, values) => sum + values.size, 0),
    schedulerCancels: () => schedulerCancels,
    controllerCleanups: () => controllerCleanups,
    controllerCreates: () => controllerCreates,
    controllerObserves: () => controllerObserves,
    storageListener: () => storageListener,
    operations,
    setPolicyAllowed(value) { policyAllowed = value; },
    setControllerCleanupFails(value) { controllerCleanupFails = value; }
  };
}

test('malformed APPLY shuts down live work, retains failed renderer authority, and REMOVE retries cleanup', async () => {
  const harness = createHarness();
  await harness.send({ type: 'HALO_APPLY_MARKING', settings: { valid: true } });
  const admittedCounters = (await harness.send({ type: 'HALO_STATUS' })).boundaryCounters;
  assert.equal(admittedCounters.policyEvaluations, 1);
  assert.equal(admittedCounters.textRunExtractions, 0);
  assert.equal(admittedCounters.sentenceRecords, 0);
  assert.equal(admittedCounters.selectionReads, 0);
  assert.equal(admittedCounters.semanticMessages, 0);
  assert.equal(admittedCounters.networkRequests, 0);
  assert.ok(harness.listenerCount() > 0);
  harness.rendererState.failRemove = true;

  const operationStart = harness.operations.length;
  const blocked = await harness.send({ type: 'HALO_APPLY_MARKING', settings: { valid: false } });
  assert.equal(harness.schedulerCancels(), 1);
  assert.equal(harness.listenerCount(), 0);
  assert.equal(blocked.cleanupPending, true);
  assert.equal(blocked.remainingArtifacts.wrapperCount, 2);
  assert.equal(blocked.remainingArtifacts.panelCount, 1);
  assert.equal(blocked.boundaryCounters.policyEvaluations, admittedCounters.policyEvaluations);
  assert.equal(blocked.boundaryCounters.semanticMessages, admittedCounters.semanticMessages);
  assert.equal(harness.rendererState.removeAttempts, 1);
  const shutdownOrder = harness.operations.slice(operationStart);
  assert.ok(shutdownOrder.indexOf('scheduler-cancel') < shutdownOrder.indexOf('listener-remove'));
  assert.ok(shutdownOrder.indexOf('listener-remove') < shutdownOrder.indexOf('renderer-remove'));

  harness.rendererState.failRemove = false;
  const removed = await harness.send({ type: 'HALO_REMOVE_MARKING' });
  assert.equal(removed.cleanupPending, false);
  assert.equal(removed.remainingArtifacts.wrapperCount, 0);
  assert.equal(removed.remainingArtifacts.panelCount, 0);
  assert.equal(harness.rendererState.removeAttempts, 2);
});

test('missing policy module on APPLY fails closed over existing annotations before validation can return', async () => {
  const harness = createHarness();
  await harness.send({ type: 'HALO_APPLY_MARKING', settings: { valid: true } });
  assert.ok(harness.listenerCount() > 0);
  harness.context.HaloSitePolicy = null;

  const blocked = await harness.send({ type: 'HALO_APPLY_MARKING', settings: { valid: true } });
  assert.equal(blocked.active, false);
  assert.equal(blocked.cleanupPending, false);
  assert.equal(blocked.remainingArtifacts.wrapperCount, 0);
  assert.equal(blocked.remainingArtifacts.panelCount, 0);
  assert.equal(blocked.policyDecision.allow, false);
  assert.equal(harness.listenerCount(), 0);
  assert.equal(harness.schedulerCancels(), 1);
});

test('missing dynamic module cannot prevent best-effort renderer cleanup during fail-closed APPLY', async () => {
  const harness = createHarness();
  await harness.send({ type: 'HALO_APPLY_MARKING', settings: { valid: true } });
  harness.context.HaloDynamicDomController = null;

  const blocked = await harness.send({ type: 'HALO_APPLY_MARKING', settings: { valid: true } });
  assert.equal(blocked.active, false);
  assert.equal(blocked.cleanupPending, false);
  assert.equal(blocked.remainingArtifacts.wrapperCount, 0);
  assert.equal(blocked.remainingArtifacts.panelCount, 0);
  assert.equal(harness.listenerCount(), 0);
});

test('truthy but incomplete runtime module cannot leave the newly observed controller live', async () => {
  const harness = createHarness();
  harness.context.HaloDictionary = Object.freeze({});

  const blocked = await harness.send({ type: 'HALO_APPLY_MARKING', settings: { valid: true } });
  assert.equal(blocked.active, false);
  assert.equal(blocked.policyDecision.allow, false);
  assert.equal(blocked.lastError, 'POLICY_RUNTIME_UNAVAILABLE');
  assert.equal(harness.controllerCleanups(), 1);
  assert.equal(harness.listenerCount(), 0);
});

test('failed controller cleanup retains authority and blocks replacement until retry succeeds', async () => {
  const harness = createHarness();
  await harness.send({ type: 'HALO_APPLY_MARKING', settings: { valid: true } });
  assert.equal(harness.controllerCreates(), 1);
  assert.equal(harness.controllerObserves(), 1);
  harness.setControllerCleanupFails(true);

  const pending = await harness.send({ type: 'HALO_APPLY_MARKING', settings: { valid: true } });
  assert.equal(pending.cleanupPending, true);
  assert.equal(harness.controllerCreates(), 1);
  assert.equal(harness.controllerObserves(), 1);

  harness.setControllerCleanupFails(false);
  const restarted = await harness.send({ type: 'HALO_APPLY_MARKING', settings: { valid: true } });
  assert.equal(restarted.cleanupPending, false);
  assert.equal(harness.controllerCreates(), 2);
  assert.equal(harness.controllerObserves(), 2);
});

test('allowed APPLY response stamps the same monotonic boundary counters as HALO_STATUS', async () => {
  const harness = createHarness({ withRootWork: true });

  const applied = await harness.send({ type: 'HALO_APPLY_MARKING', settings: { valid: true } });
  const status = await harness.send({ type: 'HALO_STATUS' });
  assert.equal(status.boundaryCounters.textRunExtractions, 1);
  assert.deepEqual(applied.boundaryCounters, status.boundaryCounters);
});

test('successful non-empty batch preserves truthful cleanup status fields', async () => {
  const harness = createHarness({ withRootWork: true, withBatch: true });

  const applied = await harness.send({ type: 'HALO_APPLY_MARKING', settings: { valid: true } });
  assert.equal(applied.cleanupPending, false);
  assert.equal(applied.remainingArtifacts.wrapperCount, 0);
  assert.equal(applied.remainingArtifacts.panelCount, 0);
  const status = await harness.send({ type: 'HALO_STATUS' });
  assert.equal(status.cleanupPending, false);
  assert.equal(status.remainingArtifacts.wrapperCount, 0);
  assert.equal(status.remainingArtifacts.panelCount, 0);
  assert.equal(status.boundaryCounters.semanticMessages, 1);
});

test('allowed-to-blocked storage transition cannot restart until failed cleanup is retried and verified', async () => {
  const harness = createHarness();
  await harness.send({ type: 'HALO_APPLY_MARKING', settings: { valid: true } });
  harness.setPolicyAllowed(false);
  harness.rendererState.failRemove = true;
  harness.storageListener()({ haloSettings: { newValue: { valid: true } } }, 'local');

  const pending = await harness.send({ type: 'HALO_STATUS' });
  assert.equal(pending.active, false);
  assert.equal(pending.cleanupPending, true);
  assert.equal(pending.remainingArtifacts.wrapperCount, 2);
  assert.equal(harness.listenerCount(), 0);
  assert.equal(harness.schedulerCancels(), 1);

  harness.setPolicyAllowed(true);
  harness.storageListener()({ haloSettings: { newValue: { valid: true } } }, 'local');
  await new Promise((resolve) => setImmediate(resolve));
  const stillPending = await harness.send({ type: 'HALO_STATUS' });
  assert.equal(stillPending.active, false);
  assert.equal(stillPending.cleanupPending, true);
  assert.equal(harness.listenerCount(), 0);

  harness.rendererState.failRemove = false;
  harness.storageListener()({ haloSettings: { newValue: { valid: true } } }, 'local');
  await new Promise((resolve) => setImmediate(resolve));
  const restarted = await harness.send({ type: 'HALO_STATUS' });
  assert.equal(restarted.cleanupPending, false);
  assert.ok(harness.listenerCount() > 0);
  assert.equal(harness.rendererState.wrapperCount, 0);
});

test('explicit selection cannot read or resurrect while renderer cleanup remains pending', async () => {
  const harness = createHarness();
  await harness.send({ type: 'HALO_APPLY_MARKING', settings: { valid: true } });
  harness.rendererState.failRemove = true;
  const pending = await harness.send({ type: 'HALO_APPLY_MARKING', settings: { valid: false } });
  const readsBefore = pending.boundaryCounters.selectionReads;

  const result = await harness.send({ type: 'HALO_EXPLICIT_SELECTION', action: 'analyze-selection' });
  assert.equal(result.accepted, false);
  assert.equal(result.code, 'SENSITIVE_PAGE_CLEANUP_PENDING');
  const status = await harness.send({ type: 'HALO_STATUS' });
  assert.equal(status.cleanupPending, true);
  assert.equal(status.boundaryCounters.selectionReads, readsBefore);
  assert.equal(harness.listenerCount(), 0);
});
