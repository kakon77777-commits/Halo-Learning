'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionRoot = path.join(__dirname, '..', 'apps', 'extension');

test('v0.5 manifest background entry composes v0.4 worker with dogfood data plane', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.background.service_worker, 'src/worker-entry.js');
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'contextMenus', 'scripting', 'storage'].sort());
  assert.equal(Object.hasOwn(manifest, 'host_permissions'), false);

  const entry = fs.readFileSync(path.join(extensionRoot, 'src', 'worker-entry.js'), 'utf8');
  for (const required of [
    "'service-worker.js'",
    "'shared/dogfood-contracts.js'",
    "'shared/dogfood-source.js'",
    "'shared/dogfood-storage-schema.js'",
    "'shared/dogfood-store.js'",
    "'shared/dogfood-projector.js'",
    "'shared/dogfood-data-service.js'",
    "'shared/dogfood-worker-transport.js'"
  ]) assert.match(entry, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(entry, /HaloSemanticService\.createWorkerPolicyAuthorizer/);
  assert.match(entry, /HaloDogfoodWorkerTransport\.initializeBrowser/);
  assert.match(entry, /HaloSettings\.migrateSettings/);
  assert.doesNotMatch(entry, /https?:\/\//u);
});
