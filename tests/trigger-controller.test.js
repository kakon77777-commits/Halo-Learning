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

test('state is committed before effects and reentrant terminal dispatch wins', () => {
  let controller;
  const fixture = fixtureOptions({
    openPanel() { controller.dispatch({ type: 'CANCEL', at: 1 }); }
  });
  controller = Trigger.createTriggerController(fixture.options);
  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'first', at: 0 });
  assert.deepEqual(controller.state(), { name: 'cancelled' });
  assert.deepEqual(fixture.closed, ['cancel']);
  assert.equal(fixture.pending().length, 0);
});

test('a newer reentrant explicit open from closePanel is never overwritten', () => {
  let controller;
  const opened = [];
  const fixture = fixtureOptions({
    openPanel(value) { opened.push(value.targetId); },
    closePanel() { controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'newer', at: 2 }); }
  });
  controller = Trigger.createTriggerController(fixture.options);
  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'old', at: 0 });
  controller.dispatch({ type: 'ESCAPE', at: 1 });
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 'newer', source: 'explicit' });
  assert.deepEqual(opened, ['old', 'newer']);
});

test('effect failures are contained while terminal cancellation remains permanent', () => {
  const errors = [];
  const fixture = fixtureOptions({
    openPanel() { throw new Error('open failed'); },
    closePanel() { throw new Error('close failed'); },
    onError(error) { errors.push(error.message); }
  });
  const controller = Trigger.createTriggerController(fixture.options);
  assert.doesNotThrow(() => controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'one', at: 0 }));
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 'one', source: 'explicit' });
  assert.doesNotThrow(() => controller.dispatch({ type: 'ROUTE_CLEANUP', at: 1 }));
  assert.deepEqual(controller.state(), { name: 'cancelled' });
  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'late', at: 2 });
  assert.deepEqual(controller.state(), { name: 'cancelled' });
  assert.deepEqual(errors, ['open failed', 'close failed']);
});

test('explicit-only same-target re-entry cancels dismissal while another plain target is ignored', () => {
  const fixture = fixtureOptions({ mode: 'explicit-only' });
  const controller = Trigger.createTriggerController(fixture.options);
  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'owned', at: 0 });
  controller.dispatch({ type: 'POINTER_LEAVE', targetId: 'owned', at: 1 });
  const stale = fixture.pending()[0][0];
  controller.dispatch({ type: 'POINTER_ENTER', targetId: 'owned', at: 2 });
  controller.dispatch({ type: 'POINTER_ENTER', targetId: 'other', at: 3 });
  fixture.fire(stale, 70);
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 'owned', source: 'explicit' });
  assert.deepEqual(fixture.closed, []);
});

test('equal-time inferred events cannot displace explicit authority but explicit ties preempt inferred work', () => {
  const fixture = fixtureOptions();
  const controller = Trigger.createTriggerController(fixture.options);
  controller.dispatch({ type: 'POINTER_ENTER', targetId: 'candidate', at: 5 });
  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'explicit', at: 5 });
  controller.dispatch({ type: 'POINTER_ENTER', targetId: 'forged-tie', at: 5 });
  controller.dispatch({ type: 'POINTER_LEAVE', targetId: 'explicit', at: 5 });
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 'explicit', source: 'explicit' });
  assert.equal(fixture.pending().length, 1);
  controller.dispatch({ type: 'POINTER_ENTER', targetId: 'explicit', at: 5 });
  assert.equal(fixture.pending().length, 0);
  controller.dispatch({ type: 'OUTSIDE_CLICK', at: 5 });
  assert.deepEqual(controller.state(), { name: 'dismissed', targetId: 'explicit', reason: 'outside-click' });

  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'second', at: 5 });
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 'second', source: 'explicit' });

  const staleClock = fixtureOptions();
  const staleController = Trigger.createTriggerController(staleClock.options);
  staleController.dispatch({ type: 'POINTER_ENTER', targetId: 'newer-clock', at: 20 });
  staleController.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'stale-clock-explicit', at: 5 });
  staleController.dispatch({ type: 'POINTER_ENTER', targetId: 'inferred-tie', at: 20 });
  assert.deepEqual(staleController.state(), { name: 'core-open', targetId: 'stale-clock-explicit', source: 'explicit' });
});

test('terminal cancellation commits before hostile timer cleanup and contains every injected failure', () => {
  const callbacks = new Map();
  const errors = [];
  const clears = [];
  let sequence = 0;
  let controller;
  controller = Trigger.createTriggerController({
    mode: 'hybrid',
    now: () => 1,
    setTimeout(callback) { callbacks.set(++sequence, callback); return sequence; },
    clearTimeout(id) {
      clears.push(id);
      controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'reentrant', at: 1 });
      throw new Error(`clear ${id}`);
    },
    closePanel() { throw new Error('close'); },
    onError(error) { errors.push(error.message); throw new Error('hostile onError'); }
  });
  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'open', at: 0 });
  controller.dispatch({ type: 'POINTER_LEAVE', targetId: 'open', at: 0.5 });
  assert.doesNotThrow(() => controller.dispatch({ type: 'CANCEL', at: 1 }));
  assert.deepEqual(controller.state(), { name: 'cancelled' });
  assert.deepEqual(clears, [1]);
  assert.deepEqual(errors, ['clear 1', 'close']);
  assert.doesNotThrow(() => callbacks.get(1)());
  assert.deepEqual(controller.state(), { name: 'cancelled' });
});

test('reentry from clearTimeout wins over pointer-leave cancellation without an outer overwrite', () => {
  let controller;
  let reenter = false;
  const fixture = fixtureOptions({
    clearTimeout() {
      if (reenter) controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'newer', at: 2 });
    }
  });
  controller = Trigger.createTriggerController(fixture.options);
  controller.dispatch({ type: 'POINTER_ENTER', targetId: 'candidate', at: 0 });
  reenter = true;
  controller.dispatch({ type: 'POINTER_LEAVE', targetId: 'candidate', at: 1 });
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 'newer', source: 'explicit' });
  assert.deepEqual(fixture.opened, [{ targetId: 'newer', source: 'explicit' }]);
});

test('dispatch serial preserves same-state reentrant timer intent', () => {
  let controller;
  let reenter = false;
  const fixture = fixtureOptions();
  const clear = fixture.options.clearTimeout;
  fixture.options.clearTimeout = (id) => {
    clear(id);
    if (reenter) controller.dispatch({ type: 'POINTER_ENTER', targetId: 'same', at: 3 });
  };
  controller = Trigger.createTriggerController(fixture.options);
  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'same', at: 0 });
  controller.dispatch({ type: 'POINTER_LEAVE', targetId: 'same', at: 1 });
  reenter = true;
  controller.dispatch({ type: 'POINTER_LEAVE', targetId: 'same', at: 2 });
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 'same', source: 'explicit' });
  assert.equal(fixture.pending().length, 0);
});

test('newest nested leave during explicit open keeps its dismiss intent and suppresses outer effect', () => {
  let controller;
  let reenter = false;
  const fixture = fixtureOptions();
  const clear = fixture.options.clearTimeout;
  fixture.options.clearTimeout = (id) => {
    clear(id);
    if (reenter) controller.dispatch({ type: 'POINTER_LEAVE', targetId: 'new', at: 2 });
  };
  controller = Trigger.createTriggerController(fixture.options);
  controller.dispatch({ type: 'POINTER_ENTER', targetId: 'old', at: 0 });
  reenter = true;
  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'new', at: 1 });
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 'new', source: 'explicit' });
  assert.equal(fixture.pending().length, 1);
  assert.deepEqual(fixture.opened, []);
});

test('irrelevant nested dispatch does not starve an authoritative explicit open', () => {
  let controller;
  const fixture = fixtureOptions();
  const clear = fixture.options.clearTimeout;
  fixture.options.clearTimeout = (id) => { clear(id); controller.dispatch({ type: 'POINTER_LEAVE', targetId: 'irrelevant', at: 2 }); };
  controller = Trigger.createTriggerController(fixture.options);
  controller.dispatch({ type: 'POINTER_ENTER', targetId: 'old', at: 0 });
  controller.dispatch({ type: 'EXPLICIT_OPEN', targetId: 'new', at: 1 });
  assert.deepEqual(controller.state(), { name: 'core-open', targetId: 'new', source: 'explicit' });
  assert.deepEqual(fixture.opened, [{ targetId: 'new', source: 'explicit' }]);
});

test('reentrant scheduling never overwrites the newest timer handle', () => {
  const active = new Set();
  let controller;
  let sequence = 0;
  let nested = false;
  controller = Trigger.createTriggerController({ mode: 'hybrid', now: () => 1,
    setTimeout(callback) { const id = ++sequence; active.add(id); if (!nested) { nested = true; controller.dispatch({ type: 'CANCEL', at: 2 }); } return id; },
    clearTimeout(id) { active.delete(id); }
  });
  controller.dispatch({ type: 'POINTER_ENTER', targetId: 'one', at: 0 });
  assert.deepEqual(controller.state(), { name: 'cancelled' });
  assert.deepEqual([...active], []);
});
