'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stopExtensionServiceWorker } = require('./browser/helpers/service-worker-cdp');

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
