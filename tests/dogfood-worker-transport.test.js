'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ServiceWorker = require('../apps/extension/src/service-worker');

function fixture(options = {}) {
  const calls = [];
  const service = {
    status() { calls.push(['status']); return { schemaVersion: 1, mode: 'ready', captureEnabled: true, lastErrorCode: null }; },
    async persistCapture(envelope) { calls.push(['capture', envelope]); return { status: 'inserted', eventId: 'event:one' }; }
  };
  const transport = ServiceWorker.createDogfoodWorkerTransport({
    getService: async () => service,
    authorizeSender: async () => options.authorized !== false
  });
  return { calls, transport };
}

test('HALO_DOGFOOD_CAPTURE fails closed before data service access', async () => {
  const { calls, transport } = fixture({ authorized: false });
  const result = await transport.handleMessage(
    { type: 'HALO_DOGFOOD_CAPTURE', envelope: { marker: 1 } },
    { tab: { id: 1, url: 'https://bank.example/account' } }
  );
  assert.deepEqual(result, { accepted: false, error: 'SENSITIVE_SITE_BLOCKED' });
  assert.deepEqual(calls, []);
});

test('authorized capture delegates exactly one normalized envelope', async () => {
  const { calls, transport } = fixture({ authorized: true });
  const envelope = { marker: 1 };
  const result = await transport.handleMessage(
    { type: 'HALO_DOGFOOD_CAPTURE', envelope },
    { tab: { id: 2, url: 'https://example.com/article' } }
  );
  assert.deepEqual(result, { accepted: true, result: { status: 'inserted', eventId: 'event:one' } });
  assert.deepEqual(calls, [['capture', envelope]]);
});

test('HALO_DOGFOOD_STATUS is a small local status read and unknown messages are ignored', async () => {
  const { calls, transport } = fixture();
  const status = await transport.handleMessage({ type: 'HALO_DOGFOOD_STATUS' }, {});
  assert.deepEqual(status, { schemaVersion: 1, mode: 'ready', captureEnabled: true, lastErrorCode: null });
  assert.deepEqual(calls, [['status']]);
  assert.equal(await transport.handleMessage({ type: 'HALO_EXPORT_EVERYTHING' }, {}), null);
});
