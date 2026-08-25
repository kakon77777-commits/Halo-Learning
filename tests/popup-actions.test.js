'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const PopupActions = require('../apps/extension/src/shared/popup-actions');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('one popup mutex disables every control and rejects overlapping actions', async () => {
  const controls = [{ disabled: false }, { disabled: false }, { disabled: true }];
  const gate = deferred();
  const mutex = PopupActions.createActionMutex(controls);
  const first = mutex.run(async () => { await gate.promise; return 'apply'; });
  assert.deepEqual(controls.map((control) => control.disabled), [true, true, true]);
  assert.deepEqual(await mutex.run(async () => 'remove'), { accepted: false, busy: true });
  assert.deepEqual(controls.map((control) => control.disabled), [true, true, true]);
  gate.resolve();
  assert.equal(await first, 'apply');
  assert.deepEqual(controls.map((control) => control.disabled), [false, false, true]);
});

test('the owning popup action alone releases controls after failure', async () => {
  const controls = [{ disabled: false }, { disabled: false }];
  const mutex = PopupActions.createActionMutex(controls);
  await assert.rejects(mutex.run(async () => { throw new Error('failed'); }), /failed/);
  assert.deepEqual(controls.map((control) => control.disabled), [false, false]);
  assert.equal(await mutex.run(async () => 'selection'), 'selection');
});
