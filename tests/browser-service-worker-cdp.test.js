'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  stopExtensionServiceWorker,
  waitForExtensionServiceWorkerVersion
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

function eventSession(onSend, onListen) {
  const listeners = new Map();
  const calls = [];
  return {
    listeners,
    calls,
    on(name, listener) {
      let set = listeners.get(name);
      if (!set) listeners.set(name, set = new Set());
      set.add(listener);
      if (onListen) onListen(name, listener, this);
    },
    off(name, listener) {
      const set = listeners.get(name);
      if (set) { set.delete(listener); if (set.size === 0) listeners.delete(name); }
    },
    emit(event) { for (const listener of [...(listeners.get('ServiceWorker.workerVersionUpdated') || [])]) listener(event); },
    async send(method, params) { calls.push([method, params]); return onSend && onSend(method, params, this); }
  };
}

test('CDP termination matches the installed worker script and stops its version', async () => {
  const listeners = new Map();
  const calls = [];
  const session = {
    on(name, listener) { listeners.set(name, listener); },
    off(name) { listeners.delete(name); },
    async send(method, params) {
      calls.push([method, params]);
      if (method === 'ServiceWorker.enable') listeners.get('ServiceWorker.workerVersionUpdated')({ versions: [{ versionId: 'stale', scriptURL: 'chrome-extension://abc/src/service-worker.js', status: 'redundant', runningStatus: 'stopped' }, { versionId: 'v7', scriptURL: 'chrome-extension://abc/src/service-worker.js', status: 'activated', runningStatus: 'running' }] });
      if (method === 'ServiceWorker.stopWorker') listeners.get('ServiceWorker.workerVersionUpdated')({ versions: [{ versionId: 'v7', scriptURL: 'chrome-extension://abc/src/service-worker.js', status: 'activated', runningStatus: 'stopped' }] });
    }
  };
  assert.equal(await stopExtensionServiceWorker({ session, scriptUrl: 'chrome-extension://abc/src/service-worker.js', timeoutMs: 50 }), 'v7');
  assert.deepEqual(calls, [['ServiceWorker.enable', undefined], ['ServiceWorker.stopWorker', { versionId: 'v7' }]]);
});

test('CDP termination fails on timeout and never stops a mismatched worker', async () => {
  const session = { on(_n, listener) { this.listener = listener; }, off() {}, async send(method) { if (method === 'ServiceWorker.enable') this.listener({ versions: [{ versionId: 'other', scriptURL: 'chrome-extension://other/sw.js' }] }); } };
  await assert.rejects(stopExtensionServiceWorker({ session, scriptUrl: 'chrome-extension://abc/src/service-worker.js', timeoutMs: 5 }), /timed out/);
});

test('CDP stop freezes the selected live version and ignores pre-command or other-version stop events', async () => {
  const timers = controlledTimers();
  const url = 'chrome-extension://abc/src/service-worker.js';
  let stopListenerInstalled = false;
  const session = eventSession((method, params, self) => {
    if (method === 'ServiceWorker.enable') {
      self.emit({ versions: [
        { versionId: 'v7', scriptURL: url, status: 'activated', runningStatus: 'running' },
        { versionId: 'stale', scriptURL: url, status: 'redundant', runningStatus: 'stopped' }
      ] });
    } else if (method === 'ServiceWorker.stopWorker') {
      assert.equal(stopListenerInstalled, true);
      assert.deepEqual(params, { versionId: 'v7' });
      self.emit({ versions: [{ versionId: 'v8', scriptURL: url, status: 'activated', runningStatus: 'running' }] });
      self.emit({ versions: [{ versionId: 'v8', scriptURL: url, status: 'activated', runningStatus: 'stopped' }] });
      self.emit({ versions: [{ versionId: 'v7', scriptURL: url, status: 'activated', runningStatus: 'stopped' }] });
    }
  }, (_name, _listener, self) => {
    if (self.calls.some(([method]) => method === 'ServiceWorker.enable')) {
      stopListenerInstalled = true;
      self.emit({ versions: [{ versionId: 'v7', scriptURL: url, status: 'activated', runningStatus: 'stopped' }] });
    }
  });
  assert.equal(await stopExtensionServiceWorker({
    session, scriptUrl: url, timeoutMs: 50,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout
  }), 'v7');
  assert.deepEqual(session.calls.at(-1), ['ServiceWorker.stopWorker', { versionId: 'v7' }]);
  assert.equal(session.listeners.size, 0);
  assert.equal(timers.count(), 0);
});

test('CDP stop rejects send failure and missing post-command acknowledgement without leaking resources', async () => {
  const url = 'chrome-extension://abc/src/service-worker.js';
  for (const failure of ['send', 'ack']) {
    const timers = controlledTimers();
    const session = eventSession((method, _params, self) => {
      if (method === 'ServiceWorker.enable') self.emit({ versions: [{ versionId: 'v7', scriptURL: url, status: 'activated', runningStatus: 'running' }] });
      if (method === 'ServiceWorker.stopWorker' && failure === 'send') throw new Error('stop rejected');
    });
    const result = stopExtensionServiceWorker({
      session, scriptUrl: url, timeoutMs: 50,
      setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout
    });
    await Promise.resolve();
    await Promise.resolve();
    if (failure === 'ack') {
      assert.equal(timers.count(), 1, 'the stop acknowledgement owns exactly one injectable timer');
      timers.fireAll();
    }
    await assert.rejects(result, failure === 'send' ? /stop rejected/ : /stop timed out/);
    assert.equal(session.listeners.size, 0);
    assert.equal(timers.count(), 0);
  }
});

test('CDP stop requires listener removal support', async () => {
  await assert.rejects(stopExtensionServiceWorker({
    session: { send() {}, on() {} },
    scriptUrl: 'chrome-extension://abc/src/service-worker.js'
  }), /on\/off/);
});

test('CDP fresh-version wait ignores the prior version and other extension workers without leaking resources', async () => {
  const timers = controlledTimers();
  const url = 'chrome-extension://abc/src/service-worker.js';
  const session = eventSession((method, _params, self) => {
    if (method !== 'ServiceWorker.enable') return;
    self.emit({ versions: [
      { versionId: 'v7', scriptURL: url, status: 'activated', runningStatus: 'running' },
      { versionId: 'foreign', scriptURL: 'chrome-extension://other/src/service-worker.js', status: 'activated', runningStatus: 'running' }
    ] });
    self.emit({ versions: [{ versionId: 'v8', scriptURL: url, status: 'activated', runningStatus: 'running' }] });
  });
  assert.equal(await waitForExtensionServiceWorkerVersion({
    session,
    scriptUrl: url,
    previousVersionId: 'v7',
    timeoutMs: 50,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout
  }), 'v8');
  assert.deepEqual(session.calls, [['ServiceWorker.enable', undefined]]);
  assert.equal(session.listeners.size, 0);
  assert.equal(timers.count(), 0);
});
