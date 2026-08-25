'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Trigger = require('../apps/extension/src/shared/trigger-controller');

function fixtureOptions(overrides) {
  const timers = new Map();
  const opened = [];
  const closed = [];
  let sequence = 0;
  let now = 0;
  const options = {
    mode: 'hybrid',
    primeThresholdMs: 40,
    openThresholdMs: 100,
    dismissDelayMs: 60,
    now: () => now,
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, delay, cancelled: false });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.get(id);
      if (timer) timer.cancelled = true;
    },
    openPanel(value) {
      opened.push(value);
    },
    closePanel(reason) {
      closed.push(reason);
    },
    ...(overrides || {})
  };
  return {
    options,
    opened,
    closed,
    timers,
    setNow(value) { now = value; },
    fire(id, value) {
      const timer = timers.get(id);
      assert.ok(timer, `timer ${id} must exist`);
      now = value;
      timer.cancelled = true;
      timer.callback();
    },
    pending() {
      return [...timers.entries()].filter(([, timer]) => !timer.cancelled);
    }
  };
}

test('accepted trigger modes are exact and every state snapshot is immutable', () => {
  for (const mode of ['adaptive-hover', 'explicit-only', 'hybrid']) {
    const fixture = fixtureOptions({ mode });
    const controller = Trigger.createTriggerController(fixture.options);
    assert.deepEqual(controller.state(), { name: 'idle' });
    assert.equal(Object.isFrozen(controller.state()), true);
  }
  assert.throws(
    () => Trigger.createTriggerController(fixtureOptions({ mode: 'hover' }).options),
    /mode.*adaptive-hover.*explicit-only.*hybrid/i
  );
});

test('explicit action preempts a pending adaptive hover and stale threshold cannot reopen it', () => {
  const fixture = fixtureOptions({ mode: 'adaptive-hover' });
  const controller = Trigger.createTriggerController(fixture.options);
  controller.dispatch({ type: 'POINTER_ENTER', targetId: 's1', at: 0 });
  const staleThreshold = fixture.pending()[0][0];

  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 's2', at: 10 });
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 's2', source: 'explicit' });
  assert.deepEqual(fixture.opened, [{ targetId: 's2', source: 'explicit' }]);

  fixture.fire(staleThreshold, 40);
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 's2', source: 'explicit' });
  assert.deepEqual(fixture.opened, [{ targetId: 's2', source: 'explicit' }]);
});

test('explicit-only ignores plain hover but modifier hover and explicit actions open immediately', () => {
  const fixture = fixtureOptions({ mode: 'explicit-only' });
  const controller = Trigger.createTriggerController(fixture.options);
  controller.dispatch({ type: 'POINTER_ENTER', targetId: 'plain', at: 0 });
  assert.deepEqual(controller.state(), { name: 'idle' });
  assert.equal(fixture.pending().length, 0);

  controller.dispatch({ type: 'MODIFIER_HOVER', targetId: 'modifier', at: 1 });
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 'modifier', source: 'explicit' });
  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'selection', at: 2 });
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 'selection', source: 'explicit' });
  assert.deepEqual(fixture.opened, [
    { targetId: 'modifier', source: 'explicit' },
    { targetId: 'selection', source: 'explicit' }
  ]);
});

test('adaptive-hover and hybrid advance candidate to primed to hover-open', () => {
  for (const mode of ['adaptive-hover', 'hybrid']) {
    const fixture = fixtureOptions({ mode });
    const controller = Trigger.createTriggerController(fixture.options);
    controller.dispatch({ type: 'POINTER_ENTER', targetId: 's1', at: 0 });
    assert.deepEqual(controller.state(), { name: 'candidate', targetId: 's1' });

    fixture.fire(fixture.pending()[0][0], 40);
    assert.deepEqual(controller.state(), { name: 'primed', targetId: 's1' });

    fixture.fire(fixture.pending()[0][0], 100);
    assert.deepEqual(controller.state(), { name: 'core-open', targetId: 's1', source: 'hover' });
    assert.deepEqual(fixture.opened, [{ targetId: 's1', source: 'hover' }]);
  }
});

test('target switching invalidates both generations of the former hover', () => {
  const fixture = fixtureOptions();
  const controller = Trigger.createTriggerController(fixture.options);
  controller.dispatch({ type: 'POINTER_ENTER', targetId: 'first', at: 0 });
  const firstPrime = fixture.pending()[0][0];
  fixture.fire(firstPrime, 40);
  const firstOpen = fixture.pending()[0][0];

  controller.dispatch({ type: 'POINTER_ENTER', targetId: 'second', at: 50 });
  const secondPrime = fixture.pending()[0][0];
  fixture.fire(firstOpen, 100);
  assert.deepEqual(controller.state(), { name: 'candidate', targetId: 'second' });

  fixture.fire(secondPrime, 90);
  const secondOpen = fixture.pending()[0][0];
  fixture.fire(secondOpen, 150);
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 'second', source: 'hover' });
  assert.deepEqual(fixture.opened, [{ targetId: 'second', source: 'hover' }]);
});

test('pointer departure dismisses after delay while token or panel re-entry cancels dismissal', () => {
  const fixture = fixtureOptions();
  const controller = Trigger.createTriggerController(fixture.options);
  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 's1', at: 0 });
  controller.dispatch({ type: 'POINTER_LEAVE', targetId: 's1', at: 1 });
  const firstDismiss = fixture.pending()[0][0];
  controller.dispatch({ type: 'POINTER_ENTER', targetId: 's1', at: 2 });
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 's1', source: 'explicit' });

  fixture.fire(firstDismiss, 61);
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 's1', source: 'explicit' });
  assert.deepEqual(fixture.closed, []);

  controller.dispatch({ type: 'POINTER_LEAVE', targetId: 's1', at: 62 });
  const secondDismiss = fixture.pending()[0][0];
  fixture.fire(secondDismiss, 122);
  assert.deepEqual(controller.state(), { name: 'dismissed', targetId: 's1', reason: 'pointer-leave' });
  assert.deepEqual(fixture.closed, ['pointer-leave']);
});

test('Esc and outside dismissal are recoverable and stale dismissal cannot close a newer target', () => {
  const fixture = fixtureOptions();
  const controller = Trigger.createTriggerController(fixture.options);
  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 's1', at: 0 });
  controller.dispatch({ type: 'POINTER_LEAVE', targetId: 's1', at: 1 });
  const staleDismiss = fixture.pending()[0][0];
  controller.dispatch({ type: 'ESCAPE', at: 2 });
  assert.deepEqual(controller.state(), { name: 'dismissed', targetId: 's1', reason: 'escape' });

  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 's2', at: 3 });
  fixture.fire(staleDismiss, 61);
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 's2', source: 'explicit' });
  controller.dispatch({ type: 'OUTSIDE_CLICK', at: 62 });
  assert.deepEqual(controller.state(), { name: 'dismissed', targetId: 's2', reason: 'outside-click' });

  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 's1', at: 63 });
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 's1', source: 'explicit' });
  assert.deepEqual(fixture.closed, ['escape', 'outside-click']);
});

test('Esc and outside click cancel pending inferred hover without leaving an orphaned candidate', () => {
  for (const type of ['ESCAPE', 'OUTSIDE_CLICK']) {
    const fixture = fixtureOptions();
    const controller = Trigger.createTriggerController(fixture.options);
    controller.dispatch({ type: 'POINTER_ENTER', targetId: 'pending', at: 0 });
    const stalePrime = fixture.pending()[0][0];
    controller.dispatch({ type, at: 1 });
    assert.deepEqual(controller.state(), {
      name: 'dismissed',
      targetId: 'pending',
      reason: type === 'ESCAPE' ? 'escape' : 'outside-click'
    });

    fixture.fire(stalePrime, 40);
    assert.equal(fixture.opened.length, 0);
    controller.dispatch({ type: 'POINTER_ENTER', targetId: 'recovered', at: 41 });
    assert.deepEqual(controller.state(), { name: 'candidate', targetId: 'recovered' });
  }
});

test('out-of-order inferred events are ignored but an explicit action still preempts', () => {
  const fixture = fixtureOptions();
  const controller = Trigger.createTriggerController(fixture.options);
  controller.dispatch({ type: 'POINTER_ENTER', targetId: 'newer', at: 20 });
  controller.dispatch({ type: 'POINTER_ENTER', targetId: 'older', at: 10 });
  assert.deepEqual(controller.state(), { name: 'candidate', targetId: 'newer' });

  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'explicit', at: 5 });
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 'explicit', source: 'explicit' });
  assert.deepEqual(fixture.opened, [{ targetId: 'explicit', source: 'explicit' }]);
});

test('route cleanup and cancel dispose every timer and permanently reject later callbacks', () => {
  for (const terminalType of ['ROUTE_CLEANUP', 'CANCEL']) {
    const fixture = fixtureOptions();
    const controller = Trigger.createTriggerController(fixture.options);
    controller.dispatch({ type: 'POINTER_ENTER', targetId: 's1', at: 0 });
    const stalePrime = fixture.pending()[0][0];
    controller.dispatch({ type: terminalType, at: 1 });
    assert.deepEqual(controller.state(), { name: 'cancelled' });
    assert.equal(fixture.pending().length, 0);

    fixture.fire(stalePrime, 40);
    controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'late', at: 41 });
    assert.deepEqual(controller.state(), { name: 'cancelled' });
    assert.deepEqual(fixture.opened, []);
  }
});
