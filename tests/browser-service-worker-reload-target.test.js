'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  waitForExtensionServiceWorkerTargetReplacement
} = require('./browser/helpers/service-worker-cdp');

function controlledTimers() {
  let next = 0;
  const active = new Map();
  return {
    setTimeout(callback) { const id = ++next; active.set(id, callback); return id; },
    clearTimeout(id) { active.delete(id); },
    fireAll() { for (const [id, callback] of [...active]) { active.delete(id); callback(); } },
    count() { return active.size; }
  };
}

function targetSession(initialTargets) {
  const listeners = new Map();
  const calls = [];
  return {
    calls,
    listeners,
    on(name, listener) {
      let set = listeners.get(name);
      if (!set) listeners.set(name, set = new Set());
      set.add(listener);
    },
    off(name, listener) {
      const set = listeners.get(name);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) listeners.delete(name);
    },
    emit(name, event) {
      for (const listener of [...(listeners.get(name) || [])]) listener(event);
    },
    async send(method, params) {
      calls.push([method, params]);
      if (method === 'Target.setDiscoverTargets') return {};
      if (method === 'Target.getTargets') return { targetInfos: initialTargets };
      return {};
    }
  };
}

test('B06 target replacement proves old extension worker target ended before accepting a distinct replacement', async () => {
  const timers = controlledTimers();
  const scriptUrl = 'chrome-extension://abc/src/service-worker.js';
  const session = targetSession([
    { targetId: 'old-target', type: 'service_worker', url: scriptUrl },
    { targetId: 'foreign-target', type: 'service_worker', url: 'chrome-extension://other/src/service-worker.js' }
  ]);

  let actionObservedListeners = false;
  const result = waitForExtensionServiceWorkerTargetReplacement({
    session,
    scriptUrl,
    timeoutMs: 50,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    action: async () => {
      actionObservedListeners = session.listeners.has('Target.targetDestroyed') &&
        session.listeners.has('Target.targetCreated');
      session.emit('Target.targetCreated', {
        targetInfo: { targetId: 'foreign-new', type: 'service_worker', url: 'chrome-extension://other/src/service-worker.js' }
      });
      session.emit('Target.targetCreated', {
        targetInfo: { targetId: 'new-target', type: 'service_worker', url: scriptUrl }
      });
      session.emit('Target.targetDestroyed', { targetId: 'other-old' });
      session.emit('Target.targetDestroyed', { targetId: 'old-target' });
    }
  });

  assert.deepEqual(await result, {
    oldTargetId: 'old-target',
    newTargetId: 'new-target'
  });
  assert.equal(actionObservedListeners, true);
  assert.deepEqual(session.calls.slice(0, 2), [
    ['Target.setDiscoverTargets', { discover: true }],
    ['Target.getTargets', undefined]
  ]);
  assert.equal(session.listeners.size, 0);
  assert.equal(timers.count(), 0);
});

test('B06 target replacement rejects when no current matching worker target exists', async () => {
  const timers = controlledTimers();
  const session = targetSession([
    { targetId: 'foreign', type: 'service_worker', url: 'chrome-extension://other/src/service-worker.js' }
  ]);
  await assert.rejects(waitForExtensionServiceWorkerTargetReplacement({
    session,
    scriptUrl: 'chrome-extension://abc/src/service-worker.js',
    action: async () => {},
    timeoutMs: 50,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout
  }), /current extension service-worker target/i);
  assert.equal(session.listeners.size, 0);
  assert.equal(timers.count(), 0);
});
