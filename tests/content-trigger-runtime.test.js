'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Content = require('../apps/extension/src/content');
const Trigger = require('../apps/extension/src/shared/trigger-controller');

function eventTargetFixture() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      if (listeners.has(type)) listeners.get(type).delete(listener);
    },
    emit(type, event) {
      for (const listener of [...(listeners.get(type) || [])]) listener(event);
    },
    listenerCount() {
      return [...listeners.values()].reduce((total, values) => total + values.size, 0);
    }
  };
}

function elementFixture(options) {
  const settings = options || {};
  const attributes = new Map(Object.entries(settings.attributes || {}));
  const element = {
    nodeType: 1,
    parentElement: settings.parentElement || null,
    textContent: settings.textContent || '',
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    closest(selector) {
      if (selector === '[data-halo-owned="panel"]' && attributes.get('data-halo-owned') === 'panel') return element;
      return element.parentElement && typeof element.parentElement.closest === 'function'
        ? element.parentElement.closest(selector)
        : null;
    },
    getBoundingClientRect() {
      return settings.rect || { left: 10, bottom: 30 };
    }
  };
  return element;
}

function eventFor(target, overrides) {
  let prevented = 0;
  let stopped = 0;
  return {
    target,
    relatedTarget: null,
    altKey: false,
    shiftKey: false,
    key: '',
    composedPath: () => [target],
    preventDefault() { prevented += 1; },
    stopPropagation() { stopped += 1; },
    prevented: () => prevented,
    stopped: () => stopped,
    ...(overrides || {})
  };
}

function rendererFixture(owned) {
  const opened = [];
  const closed = [];
  return {
    opened,
    closed,
    ownsToken(element) { return owned.has(element); },
    openPanel(model) { opened.push(model); return { action: 'opened' }; },
    closePanel(reason) { closed.push(reason); return { action: 'closed' }; }
  };
}

test('explicit-selection envelope is exact and selection must be live, ranged, and nonempty', () => {
  assert.equal(Content.validateExplicitSelectionMessage({
    type: 'HALO_EXPLICIT_SELECTION',
    action: 'analyze-selection'
  }), true);
  for (const value of [
    null,
    { type: 'HALO_EXPLICIT_SELECTION' },
    { type: 'HALO_EXPLICIT_SELECTION', action: 'other' },
    { type: 'HALO_EXPLICIT_SELECTION', action: 'analyze-selection', text: 'forged' }
  ]) {
    assert.equal(Content.validateExplicitSelectionMessage(value), false);
  }

  const selection = {
    rangeCount: 1,
    isCollapsed: false,
    toString: () => '  selected locally  ',
    getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 12, bottom: 24 }) })
  };
  const request = Content.readExplicitSelection({ getSelection: () => selection });
  assert.deepEqual(request, {
    text: 'selected locally',
    anchor: { x: 12, y: 32 }
  });
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Content.readExplicitSelection({
    getSelection: () => ({ ...selection, isCollapsed: true })
  }), null);
  assert.equal(Content.readExplicitSelection({
    getSelection: () => ({ ...selection, toString: () => '   ' })
  }), null);
  assert.equal(Content.readExplicitSelection({
    getSelection() { throw new Error('page override'); }
  }), null);
  assert.equal(Content.readExplicitSelection({
    getSelection: () => ({ ...selection, toString() { throw new Error('page override'); } })
  }), null);
});

test('token panel models require private renderer ownership and are immutable projection snapshots', () => {
  const owned = new Set();
  const renderer = rendererFixture(owned);
  const token = elementFixture({
    textContent: 'model',
    attributes: {
      'data-halo-pos': 'n',
      'data-halo-meta': 'lemma: model',
      'data-halo-gloss': 'a representation',
      'data-halo-confidence': '0.92'
    },
    rect: { left: 20, bottom: 40 }
  });

  assert.equal(Content.panelModelForToken(token, renderer), null);
  owned.add(token);
  const model = Content.panelModelForToken(token, renderer);
  assert.deepEqual(model, {
    title: 'model',
    body: 'n · lemma: model · a representation',
    status: 'Confidence 0.92',
    anchor: { x: 20, y: 48 }
  });
  assert.equal(Object.isFrozen(model), true);
  assert.equal(Object.isFrozen(model.anchor), true);
});

test('owned token click opens through the renderer while an ordinary link click remains native', () => {
  const events = eventTargetFixture();
  const owned = new Set();
  const renderer = rendererFixture(owned);
  const token = elementFixture({ textContent: 'learns', attributes: { 'data-halo-pos': 'v' } });
  const link = elementFixture({ textContent: 'ordinary link' });
  owned.add(token);
  const runtime = Content.createContentTriggerRuntime({
    eventTarget: events,
    renderer,
    triggerModule: Trigger,
    mode: 'hybrid',
    now: () => 1
  });

  const tokenClick = eventFor(token);
  events.emit('click', tokenClick);
  assert.equal(tokenClick.prevented(), 1);
  assert.equal(tokenClick.stopped(), 1);
  assert.equal(renderer.opened.length, 1);
  assert.equal(renderer.opened[0].title, 'learns');

  const linkClick = eventFor(link);
  events.emit('click', linkClick);
  assert.equal(linkClick.prevented(), 0);
  assert.equal(linkClick.stopped(), 0);
  assert.deepEqual(renderer.closed, ['outside-click']);
  runtime.cleanup('CANCEL');
});

test('modifier hover opens in explicit-only while plain hover does not', () => {
  const events = eventTargetFixture();
  const owned = new Set();
  const renderer = rendererFixture(owned);
  const token = elementFixture({ textContent: 'model', attributes: { 'data-halo-pos': 'n' } });
  owned.add(token);
  const runtime = Content.createContentTriggerRuntime({
    eventTarget: events,
    renderer,
    triggerModule: Trigger,
    mode: 'explicit-only',
    now: () => 1
  });

  events.emit('pointerover', eventFor(token));
  assert.equal(renderer.opened.length, 0);
  events.emit('pointerover', eventFor(token, { altKey: true }));
  assert.equal(renderer.opened.length, 1);
  assert.equal(runtime.state().source, 'explicit');
  runtime.cleanup('CANCEL');
});

test('selection action, Esc, panel focus recovery, outside click, and cleanup share one controller', () => {
  const events = eventTargetFixture();
  const owned = new Set();
  const renderer = rendererFixture(owned);
  const panel = elementFixture({ attributes: { 'data-halo-owned': 'panel' } });
  const normal = elementFixture();
  const runtime = Content.createContentTriggerRuntime({
    eventTarget: events,
    renderer,
    triggerModule: Trigger,
    mode: 'hybrid',
    now: () => 2
  });

  assert.equal(runtime.openSelection({ text: 'local selection', anchor: { x: 5, y: 6 } }), true);
  assert.equal(renderer.opened[0].body, 'local selection');
  events.emit('focusin', eventFor(panel));
  events.emit('keydown', eventFor(panel, { key: 'Escape' }));
  assert.deepEqual(renderer.closed, ['escape']);
  assert.equal(runtime.openSelection({ text: '', anchor: { x: 0, y: 0 } }), false);
  assert.equal(runtime.openSelection({ text: 'again', anchor: { x: 5, y: 6 } }), true);
  events.emit('click', eventFor(normal));
  assert.deepEqual(renderer.closed, ['escape', 'outside-click']);

  assert.ok(events.listenerCount() > 0);
  runtime.cleanup('ROUTE_CLEANUP');
  assert.equal(events.listenerCount(), 0);
  const before = renderer.opened.length;
  events.emit('click', eventFor(normal));
  assert.equal(renderer.opened.length, before);
  assert.deepEqual(runtime.state(), { name: 'cancelled' });
});
