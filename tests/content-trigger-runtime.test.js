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
  const panels = new Set();
  return {
    opened,
    closed,
    panels,
    ownsToken(element) { return owned.has(element); },
    ownsPanel(element) { return panels.has(element); },
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

  const document = {};
  const boundary = { isConnected: true, ownerDocument: document };
  const range = {
    collapsed: false,
    startContainer: boundary,
    endContainer: boundary,
    commonAncestorContainer: boundary,
    toString: () => '  selected locally  ',
    getBoundingClientRect: () => ({ left: 12, top: 10, right: 42, bottom: 24, width: 30, height: 14 })
  };
  const selection = {
    rangeCount: 1,
    isCollapsed: false,
    toString: () => '  selected locally  ',
    getRangeAt: () => range
  };
  const request = Content.readExplicitSelection({ document, getSelection: () => selection });
  assert.deepEqual(request, {
    text: 'selected locally',
    anchor: { x: 12, y: 32 }
  });
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Content.readExplicitSelection({
    document, getSelection: () => ({ ...selection, isCollapsed: true })
  }), null);
  assert.equal(Content.readExplicitSelection({
    document, getSelection: () => ({ ...selection, toString: () => '   ' })
  }), null);
  assert.equal(Content.readExplicitSelection({
    getSelection() { throw new Error('page override'); }
  }), null);
  assert.equal(Content.readExplicitSelection({
    document, getSelection: () => ({ ...selection, toString() { throw new Error('page override'); } })
  }), null);

  for (const invalid of [
    { ...selection, rangeCount: 2 },
    { ...selection, getRangeAt: () => null },
    { ...selection, getRangeAt: () => ({ ...range, collapsed: true }) },
    { ...selection, getRangeAt: () => ({ ...range, startContainer: { isConnected: false, ownerDocument: document } }) },
    { ...selection, getRangeAt: () => ({ ...range, commonAncestorContainer: { isConnected: true, ownerDocument: {} } }) },
    { ...selection, toString: () => 'outside range' },
    { ...selection, getRangeAt: () => ({ ...range, toString: () => '   ' }) },
    { ...selection, getRangeAt: () => ({ ...range, getBoundingClientRect: undefined }) },
    { ...selection, getRangeAt: () => ({ ...range, getBoundingClientRect: () => null }) },
    { ...selection, getRangeAt: () => ({ ...range, getBoundingClientRect: () => ({ left: NaN, top: 0, right: 1, bottom: 1, width: 1, height: 1 }) }) }
  ]) assert.equal(Content.readExplicitSelection({ document, getSelection: () => invalid }), null);
  assert.equal(Content.readExplicitSelection({
    document,
    getSelection: () => ({ ...selection, getRangeAt() { throw new Error('range override'); } })
  }), null);
  assert.equal(Content.readExplicitSelection(new Proxy({}, {
    get(_target, name) { if (name === 'getSelection') throw new Error('getter override'); return undefined; }
  })), null);
  assert.equal(Content.readExplicitSelection({
    document,
    getSelection: () => ({ ...selection, getRangeAt: () => ({ ...range, getBoundingClientRect() { throw new Error('geometry override'); } }) })
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
  let now = 0;
  const runtime = Content.createContentTriggerRuntime({
    eventTarget: events,
    renderer,
    triggerModule: Trigger,
    mode: 'hybrid',
    now: () => ++now
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
  renderer.panels.add(panel);
  const normal = elementFixture();
  let now = 0;
  const runtime = Content.createContentTriggerRuntime({
    eventTarget: events,
    renderer,
    triggerModule: Trigger,
    mode: 'hybrid',
    now: () => ++now
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

test('retargeted composed paths find private tokens and panels while forged or throwing paths fail safely', () => {
  const events = eventTargetFixture();
  const owned = new Set();
  const renderer = rendererFixture(owned);
  const retarget = elementFixture();
  const token = elementFixture({ textContent: 'private', attributes: { 'data-halo-pos': 'n' } });
  const panel = elementFixture({ attributes: { 'data-halo-owned': 'panel' } });
  const forged = elementFixture({ attributes: { 'data-halo-owned': 'panel' } });
  owned.add(token);
  renderer.panels.add(panel);
  let now = 0;
  const runtime = Content.createContentTriggerRuntime({ eventTarget: events, renderer, triggerModule: Trigger, mode: 'hybrid', now: () => ++now });

  const click = eventFor(retarget, { composedPath: () => [retarget, token] });
  events.emit('click', click);
  assert.equal(click.prevented(), 1);
  assert.equal(renderer.opened.length, 1);
  events.emit('click', eventFor(retarget, { composedPath: () => [retarget, panel] }));
  assert.equal(renderer.closed.length, 0);
  events.emit('click', eventFor(forged));
  assert.deepEqual(renderer.closed, ['outside-click']);
  assert.doesNotThrow(() => events.emit('click', eventFor(retarget, { composedPath() { throw new Error('hostile'); } })));
  runtime.cleanup('CANCEL');
});

test('cleanup removes listeners even when controller close effect fails and remains idempotent', () => {
  const events = eventTargetFixture();
  const owned = new Set();
  const renderer = rendererFixture(owned);
  renderer.closePanel = () => { throw new Error('close failed'); };
  const errors = [];
  const runtime = Content.createContentTriggerRuntime({ eventTarget: events, renderer, triggerModule: Trigger, mode: 'hybrid', now: () => 4, onError: (error) => errors.push(error.message) });
  runtime.openSelection({ text: 'safe', anchor: { x: 1, y: 2 } });
  assert.doesNotThrow(() => runtime.cleanup('ROUTE_CLEANUP'));
  assert.equal(events.listenerCount(), 0);
  assert.deepEqual(runtime.state(), { name: 'cancelled' });
  assert.doesNotThrow(() => runtime.cleanup('ROUTE_CLEANUP'));
  assert.deepEqual(errors, ['close failed']);
});

test('cleanup retains a live runtime until hostile listener teardown can be retried', () => {
  const events = eventTargetFixture();
  const remove = events.removeEventListener.bind(events);
  let fail = true;
  events.removeEventListener = (type, listener) => {
    if (fail && type === 'pointerover') {
      fail = false;
      throw new Error('temporary teardown failure');
    }
    remove(type, listener);
  };
  const errors = [];
  const renderer = rendererFixture(new Set());
  const runtime = Content.createContentTriggerRuntime({
    eventTarget: events,
    renderer,
    triggerModule: Trigger,
    mode: 'hybrid',
    now: () => 5,
    onError: (error) => errors.push(error.message)
  });
  runtime.cleanup('CANCEL');
  assert.equal(runtime.isCleaned(), false);
  assert.equal(events.listenerCount(), 1);
  runtime.cleanup('CANCEL');
  assert.equal(runtime.isCleaned(), true);
  assert.equal(events.listenerCount(), 0);
  assert.deepEqual(errors, ['temporary teardown failure']);
});

test('cleanup attempts every listener removal when terminal dispatch and error reporting throw', () => {
  const events = eventTargetFixture();
  const removed = [];
  events.removeEventListener = (type) => { removed.push(type); };
  const renderer = rendererFixture(new Set());
  const triggerModule = {
    createTriggerController() {
      return { state: () => ({ name: 'idle' }), dispatch() { throw new Error('terminal failure'); } };
    }
  };
  const runtime = Content.createContentTriggerRuntime({
    eventTarget: events,
    renderer,
    triggerModule,
    mode: 'hybrid',
    onError() { throw new Error('hostile error observer'); }
  });
  assert.doesNotThrow(() => runtime.cleanup('CANCEL'));
  assert.deepEqual(removed.sort(), ['click', 'focusin', 'focusout', 'keydown', 'pointerout', 'pointerover']);
  assert.equal(runtime.isCleaned(), true);
});

test('hostile event and path getters fail closed while later private path entries remain discoverable', () => {
  const events = eventTargetFixture();
  const token = elementFixture({ textContent: 'later', attributes: { 'data-halo-pos': 'n' } });
  const owned = new Set([token]);
  const renderer = rendererFixture(owned);
  const hostileNode = new Proxy({}, { get() { throw new Error('node getter'); } });
  const originalOwnsToken = renderer.ownsToken;
  renderer.ownsToken = (node) => {
    if (node === hostileNode) throw new Error('predicate');
    return originalOwnsToken(node);
  };
  const runtime = Content.createContentTriggerRuntime({ eventTarget: events, renderer, triggerModule: Trigger, mode: 'hybrid', now: () => 10 });
  const retargeted = eventFor(null, { composedPath: () => [hostileNode, token] });
  Object.defineProperty(retargeted, 'target', { get() { throw new Error('target getter'); } });
  assert.doesNotThrow(() => events.emit('click', retargeted));
  assert.equal(renderer.opened.length, 1);
  assert.doesNotThrow(() => events.emit('click', new Proxy({}, { get() { throw new Error('event getter'); } })));
  const modifier = eventFor(token);
  Object.defineProperty(modifier, 'altKey', { get() { throw new Error('modifier getter'); } });
  assert.doesNotThrow(() => events.emit('pointerover', modifier));
  runtime.cleanup('CANCEL');
});
