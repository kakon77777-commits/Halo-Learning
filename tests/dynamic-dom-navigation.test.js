'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Dynamic = require('../apps/extension/src/shared/dynamic-dom-controller');
const NavigationBridge = require('../apps/extension/src/shared/navigation-route-bridge');

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      if (listeners.has(type)) listeners.get(type).delete(listener);
    },
    dispatch(type) {
      for (const listener of listeners.get(type) || []) listener({ type });
    },
    count(type) {
      return (listeners.get(type) || new Set()).size;
    }
  };
}

function fakeMicrotasks() {
  const tasks = [];
  return {
    queueMicrotask(callback) { tasks.push(callback); },
    flush() { while (tasks.length) tasks.shift()(); }
  };
}

class FakeMutationObserver {
  constructor(callback) { this.callback = callback; }
  observe(document) { this.document = document; }
  disconnect() { this.document = null; }
  takeRecords() { return []; }
}

function body() {
  return {
    nodeType: 1,
    parentElement: null,
    contains(candidate) { return candidate === this; }
  };
}

test('isolated Navigation API observes an external same-document route and cleans up exactly once', () => {
  const calls = [];
  const microtasks = fakeMicrotasks();
  const navigation = eventTarget();
  const windowEvents = eventTarget();
  const location = { href: 'https://example.test/a' };
  const document = { body: body() };
  const BridgedDynamic = NavigationBridge.wrapDynamicModule(Dynamic, { navigation });

  const controller = BridgedDynamic.createDynamicDomController({
    MutationObserver: FakeMutationObserver,
    history: null,
    location,
    eventTarget: windowEvents,
    queueMicrotask: microtasks.queueMicrotask,
    onRouteCleanup: ({ epoch }) => calls.push(`cleanup:${epoch}`),
    onRouteStart: ({ epoch }) => calls.push(`start:${epoch}`)
  });

  controller.observe(document);
  calls.length = 0;

  assert.equal(navigation.count('currententrychange'), 1,
    'the isolated-world Navigation API listener must be installed');

  location.href = 'https://example.test/route-two';
  navigation.dispatch('currententrychange');

  assert.deepEqual(calls, ['cleanup:1']);
  assert.equal(controller.routeEpoch(), 2);
  microtasks.flush();
  assert.deepEqual(calls, ['cleanup:1', 'start:2']);

  const cleaned = controller.cleanup();
  assert.equal(cleaned.cleaned, true);
  assert.equal(cleaned.cleanupPending, false);
  assert.equal(navigation.count('currententrychange'), 0,
    'final cleanup must remove Navigation API authority');
});

test('failed Navigation listener removal remains pending and retries without route resurrection', () => {
  const navigation = eventTarget();
  const remove = navigation.removeEventListener.bind(navigation);
  let failRemoval = true;
  navigation.removeEventListener = (type, listener) => {
    if (failRemoval) throw new Error('navigation removal failed');
    remove(type, listener);
  };
  const location = { href: 'https://example.test/a' };
  const errors = [];
  let routeCleanupCalls = 0;
  const BridgedDynamic = NavigationBridge.wrapDynamicModule(Dynamic, { navigation });
  const controller = BridgedDynamic.createDynamicDomController({
    MutationObserver: FakeMutationObserver,
    history: null,
    location,
    eventTarget: eventTarget(),
    onRouteCleanup() { routeCleanupCalls += 1; },
    onError(error, metadata) { errors.push([error.message, metadata.phase]); }
  });
  controller.observe({ body: body() });

  const pending = controller.cleanup();
  assert.equal(pending.cleaned, false);
  assert.equal(pending.cleanupPending, true);
  assert.ok(pending.pendingStages.includes('navigation-listener'));
  assert.deepEqual(errors, [['navigation removal failed', 'cleanup-navigation-listener']]);

  location.href = 'https://example.test/late';
  navigation.dispatch('currententrychange');
  assert.equal(routeCleanupCalls, 1, 'inactive retained listener cannot schedule another route cleanup');

  failRemoval = false;
  const cleaned = controller.cleanup();
  assert.equal(cleaned.cleaned, true);
  assert.equal(cleaned.cleanupPending, false);
  assert.equal(navigation.count('currententrychange'), 0);
});
