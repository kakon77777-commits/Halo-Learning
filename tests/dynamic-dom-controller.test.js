const test = require('node:test');
const assert = require('node:assert/strict');

const Dynamic = require('../apps/extension/src/shared/dynamic-dom-controller');

function element(name, options) {
  const settings = options || {};
  const node = {
    nodeType: 1,
    name,
    parentElement: settings.parent || null,
    isConnected: settings.isConnected !== false,
    owned: Boolean(settings.owned),
    closest(selector) {
      if (!selector.includes('data-halo')) return null;
      for (let current = node; current; current = current.parentElement) {
        if (current.owned) return current;
      }
      return null;
    },
    contains(candidate) {
      for (let current = candidate; current; current = current.parentElement) {
        if (current === node) return true;
      }
      return false;
    }
  };
  return node;
}

function textNode(parent) {
  return { nodeType: 3, parentElement: parent, parentNode: parent, isConnected: true };
}

function isPrivatelyOwned(node) {
  const elementNode = node && node.nodeType === 1 ? node : node && (node.parentElement || node.parentNode);
  for (let current = elementNode; current; current = current.parentElement) {
    if (current.owned) return true;
  }
  return false;
}

function mutation(overrides) {
  return {
    type: 'childList',
    target: element('target'),
    addedNodes: [],
    removedNodes: [],
    ...overrides
  };
}

function fakeClock() {
  let now = 0;
  let sequence = 0;
  const tasks = new Map();
  return {
    setTimeout(callback, delay) {
      const id = ++sequence;
      tasks.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    tick(milliseconds) {
      const end = now + milliseconds;
      while (true) {
        const next = [...tasks.entries()]
          .filter(([, task]) => task.at <= end)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
        if (!next) break;
        tasks.delete(next[0]);
        now = next[1].at;
        next[1].callback();
      }
      now = end;
    },
    pending() {
      return tasks.size;
    }
  };
}

function fakeMicrotasks() {
  const tasks = [];
  return {
    queueMicrotask(callback) {
      tasks.push(callback);
    },
    flush() {
      while (tasks.length) tasks.shift()();
    },
    pending() {
      return tasks.length;
    }
  };
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      if (listeners.has(type)) listeners.get(type).delete(listener);
    },
    dispatch(type) {
      for (const listener of listeners.get(type) || []) listener({ type });
    },
    count(type) {
      return (listeners.get(type) || new Set()).size;
    }
  };
}

function observerFixture(calls) {
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.records = [];
      FakeMutationObserver.instances.push(this);
    }

    observe(document, options) {
      this.document = document;
      this.options = options;
      calls.push('observe');
    }

    disconnect() {
      calls.push('disconnect');
      this.document = null;
    }

    takeRecords() {
      const records = this.records;
      this.records = [];
      return records;
    }

    emit(records) {
      this.callback(records, this);
    }
  }
  FakeMutationObserver.instances = [];
  return FakeMutationObserver;
}

test('Halo-owned mutations never become article work', () => {
  const article = element('article');
  const halo = element('halo', { parent: article, owned: true });
  const result = Dynamic.coalesceMutations([
    mutation({ target: halo, addedNodes: [element('nested', { parent: halo, owned: true })] })
  ], (node) => Boolean(node && node.owned));

  assert.deepEqual(result.roots, []);
});

test('public token and panel markers are not permanent observer authority', () => {
  for (const ownership of ['token', 'panel']) {
    const owned = {
      nodeType: 1,
      dataset: { haloOwned: ownership },
      parentElement: null,
      closest: () => null
    };
    const result = Dynamic.classifyMutation(mutation({ target: owned, addedNodes: [owned] }));
    assert.deepEqual(result.roots, [owned], ownership);
    assert.equal(result.ignored, false, ownership);
  }
});

test('external token text, children, and semantic attributes invalidate synchronously', () => {
  const clock = fakeClock();
  const invalidated = [];
  const calls = [];
  const MutationObserver = observerFixture(calls);
  const token = element('token');
  token.dataset = { haloOwned: 'token' };
  const tokenText = textNode(token);
  const inserted = element('third-party', { parent: token });
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onRootsInvalidated: (roots) => invalidated.push(roots)
  });
  controller.observe({ body: element('body') });
  const observer = MutationObserver.instances[0];

  assert.equal(observer.options.attributes, true);
  assert.equal(observer.options.attributeOldValue, true);
  assert.equal(observer.options.characterDataOldValue, true);
  assert.ok(observer.options.attributeFilter.includes('data-halo-pos'));
  assert.ok(observer.options.attributeFilter.includes('data-halo-owned'));
  observer.emit([{ type: 'characterData', target: tokenText }]);
  observer.emit([mutation({ target: token, addedNodes: [inserted] })]);
  observer.emit([{ type: 'attributes', target: token, attributeName: 'data-halo-pos' }]);

  assert.deepEqual(invalidated, [[token], [inserted], [token]]);
});

test('operation-scoped sanitation subtracts only private nodes and exact renderer records', () => {
  const sanitizer = Dynamic.createRendererMutationSanitizer();
  const article = element('article');
  const halo = element('halo', { parent: article, owned: true });
  const legitimate = element('legitimate', { parent: article });
  const pageText = textNode(article);
  const token = element('token', { parent: article, owned: true });
  sanitizer.trackNode(halo);
  sanitizer.expect({ type: 'characterData', target: pageText, oldValue: 'before' });
  sanitizer.expect({ type: 'attributes', target: token, attributeName: 'data-halo-pos', oldValue: 'n' });

  assert.deepEqual(sanitizer.sanitize(mutation({
    target: article,
    addedNodes: [halo, legitimate]
  })), {
    type: 'childList',
    target: article,
    addedNodes: [legitimate],
    removedNodes: []
  });
  assert.equal(sanitizer.sanitize({
    type: 'characterData',
    target: pageText,
    oldValue: 'before'
  }), null);
  assert.equal(sanitizer.sanitize({
    type: 'attributes',
    target: token,
    attributeName: 'data-halo-pos',
    oldValue: 'n'
  }), null);
  assert.deepEqual(sanitizer.sanitize({
    type: 'attributes',
    target: article,
    attributeName: 'class',
    oldValue: 'before'
  }), {
    type: 'attributes',
    target: article,
    attributeName: 'class',
    oldValue: 'before'
  });
  assert.deepEqual(sanitizer.sanitize({
    type: 'characterData',
    target: pageText,
    oldValue: 'third-party-value'
  }), {
    type: 'characterData',
    target: pageText,
    oldValue: 'third-party-value'
  }, 'an expected record is consumed once and cannot hide a later page change');
});

test('renderer suppression preserves monkey-patched page side effects while renderer-only records stay silent', () => {
  const clock = fakeClock();
  const invalidated = [];
  const changed = [];
  const calls = [];
  const MutationObserver = observerFixture(calls);
  let scope = null;
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    sanitizeRendererRecord: (record) => scope ? scope.sanitize(record) : record,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onRootsInvalidated: (roots) => invalidated.push(roots),
    onRootsChanged: (roots) => changed.push(roots)
  });
  controller.observe({ body: element('body') });
  const observer = MutationObserver.instances[0];
  const article = element('article');
  const halo = element('halo', { parent: article, owned: true });
  const legitimateSibling = element('legitimate-sibling', { parent: article });
  const legitimateText = textNode(article);

  scope = Dynamic.createRendererMutationSanitizer();
  scope.trackNode(halo);
  scope.expect({ type: 'characterData', target: legitimateText, oldValue: 'renderer-old' });
  controller.suppressRendererMutations(() => {
    observer.records.push(
      mutation({ target: article, addedNodes: [halo, legitimateSibling] }),
      { type: 'characterData', target: legitimateText, oldValue: 'renderer-old' },
      { type: 'characterData', target: legitimateText, oldValue: 'page-old' },
      { type: 'attributes', target: article, attributeName: 'class', oldValue: 'page-before' }
    );
  });
  scope = null;

  assert.deepEqual(invalidated, [[article]]);
  assert.deepEqual(changed, []);
  clock.tick(80);
  assert.deepEqual(changed, [[article]]);

  scope = Dynamic.createRendererMutationSanitizer();
  scope.trackNode(halo);
  scope.expect({ type: 'characterData', target: legitimateText, oldValue: 'renderer-only' });
  controller.suppressRendererMutations(() => {
    observer.records.push(
      mutation({ target: article, addedNodes: [halo] }),
      { type: 'characterData', target: legitimateText, oldValue: 'renderer-only' }
    );
  });
  scope = null;
  clock.tick(300);
  assert.equal(invalidated.length, 1);
  assert.equal(changed.length, 1);
});

test('coalescing keeps independent inserted roots and folds nested redraw records', () => {
  const article = element('article');
  const first = element('first', { parent: article });
  const nested = element('nested', { parent: first });
  const second = element('second', { parent: article });

  const result = Dynamic.coalesceMutations([
    mutation({ target: article, addedNodes: [first] }),
    mutation({ target: first, addedNodes: [nested] }),
    mutation({ target: article, addedNodes: [second] })
  ]);

  assert.deepEqual(result.roots, [first, second]);
});

test('framework replacement reports the detached root for observer release', () => {
  const article = element('article');
  const previous = element('previous', { parent: article, isConnected: false });
  const replacement = element('replacement', { parent: article });

  const result = Dynamic.coalesceMutations([
    mutation({ target: article, addedNodes: [replacement], removedNodes: [previous] })
  ]);

  assert.deepEqual(result.roots, [replacement]);
  assert.deepEqual(result.removedRoots, [previous]);
});

test('text replacement refreshes the containing element while removals refresh their live target', () => {
  const paragraph = element('paragraph');

  const result = Dynamic.coalesceMutations([
    mutation({ target: paragraph, addedNodes: [textNode(paragraph)] }),
    mutation({ target: paragraph, removedNodes: [textNode(paragraph)] })
  ]);

  assert.deepEqual(result.roots, [paragraph]);
});

test('mutation bursts debounce for 80ms but flush by the 250ms maximum wait', () => {
  const clock = fakeClock();
  const changed = [];
  const calls = [];
  const MutationObserver = observerFixture(calls);
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onRootsChanged: (roots, metadata) => changed.push({ roots, epoch: metadata.epoch })
  });
  controller.observe({ body: element('body') });
  const observer = MutationObserver.instances[0];

  for (let elapsed = 0; elapsed < 240; elapsed += 60) {
    const paragraph = element(`p-${elapsed}`);
    observer.emit([mutation({ addedNodes: [paragraph] })]);
    clock.tick(60);
  }
  assert.equal(changed.length, 0);
  clock.tick(10);

  assert.equal(changed.length, 1);
  assert.equal(changed[0].roots.length, 4);
  assert.equal(changed[0].epoch, 1);
});

test('non-Halo mutation invalidates its root synchronously before debounced discovery', () => {
  const clock = fakeClock();
  const invalidated = [];
  const changed = [];
  const calls = [];
  const MutationObserver = observerFixture(calls);
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onRootsInvalidated: (roots) => invalidated.push(roots),
    onRootsChanged: (roots) => changed.push(roots)
  });
  controller.observe({ body: element('body') });
  const paragraph = element('paragraph');

  MutationObserver.instances[0].emit([mutation({ addedNodes: [paragraph] })]);

  assert.deepEqual(invalidated, [[paragraph]]);
  assert.deepEqual(changed, []);
  clock.tick(80);
  assert.deepEqual(changed, [[paragraph]]);
});

test('renderer suppression preserves non-Halo records before and during a throwing callback', () => {
  const clock = fakeClock();
  const changed = [];
  const calls = [];
  const MutationObserver = observerFixture(calls);
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    isHaloOwned: isPrivatelyOwned,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onRootsChanged: (roots) => changed.push(roots)
  });
  controller.observe({ body: element('body') });
  const observer = MutationObserver.instances[0];
  const owned = element('halo', { owned: true });
  const prequeued = element('prequeued');
  const queuedDuring = element('queued-during');
  const deliveredDuring = element('delivered-during');

  observer.records.push(
    mutation({ addedNodes: [prequeued] }),
    mutation({ addedNodes: [owned] })
  );

  assert.throws(() => controller.suppressRendererMutations(() => {
    observer.records.push(
      mutation({ addedNodes: [queuedDuring] }),
      mutation({ addedNodes: [owned] })
    );
    observer.emit([
      mutation({ addedNodes: [deliveredDuring] }),
      mutation({ addedNodes: [owned] })
    ]);
    throw new Error('renderer failed');
  }), /renderer failed/);
  clock.tick(80);

  assert.deepEqual(changed, [[prequeued, deliveredDuring, queuedDuring]]);
});

test('renderer suppression filters Halo nodes but preserves a legitimate sibling in one added list', () => {
  const clock = fakeClock();
  const changed = [];
  const calls = [];
  const MutationObserver = observerFixture(calls);
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    isHaloOwned: isPrivatelyOwned,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onRootsChanged: (roots) => changed.push(roots)
  });
  controller.observe({ body: element('body') });
  const legitimate = element('legitimate');
  const halo = element('halo', { owned: true });

  controller.suppressRendererMutations(() => {
    MutationObserver.instances[0].records.push(mutation({ addedNodes: [legitimate, halo] }));
  });
  clock.tick(80);

  assert.deepEqual(changed, [[legitimate]]);
});

test('renderer suppression preserves target context and detached roots from a mixed removed list', () => {
  const clock = fakeClock();
  const changed = [];
  const calls = [];
  const MutationObserver = observerFixture(calls);
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    isHaloOwned: isPrivatelyOwned,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onRootsChanged: (roots, metadata) => changed.push({ roots, removedRoots: metadata.removedRoots })
  });
  controller.observe({ body: element('body') });
  const target = element('article');
  const legitimate = element('detached', { parent: target, isConnected: false });
  const halo = element('halo', { parent: target, owned: true, isConnected: false });

  controller.suppressRendererMutations(() => {
    MutationObserver.instances[0].records.push(mutation({
      target,
      removedNodes: [legitimate, halo]
    }));
  });
  clock.tick(80);

  assert.deepEqual(changed, [{ roots: [target], removedRoots: [legitimate] }]);
});

test('renderer suppression ignores Halo-only and nested target-owned mutations', () => {
  const clock = fakeClock();
  const changed = [];
  const calls = [];
  const MutationObserver = observerFixture(calls);
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    isHaloOwned: isPrivatelyOwned,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onRootsChanged: (roots) => changed.push(roots)
  });
  controller.observe({ body: element('body') });
  const article = element('article');
  const halo = element('halo', { parent: article, owned: true });
  const nested = element('nested', { parent: halo });

  controller.suppressRendererMutations(() => {
    MutationObserver.instances[0].records.push(
      mutation({ target: article, addedNodes: [halo] }),
      mutation({ target: halo, addedNodes: [nested] })
    );
  });
  clock.tick(300);

  assert.deepEqual(changed, []);
  assert.equal(clock.pending(), 0);
});

test('one route change cancels old work, removes old DOM, disconnects, and starts one new epoch', () => {
  const calls = [];
  const microtasks = fakeMicrotasks();
  const MutationObserver = observerFixture(calls);
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    queueMicrotask: microtasks.queueMicrotask,
    onRouteCleanup: ({ epoch }) => calls.push(`cancel:${epoch}`, `remove:${epoch}`),
    onRouteStart: ({ epoch }) => calls.push(`start:${epoch}`)
  });
  controller.observe({ body: element('body') });
  calls.length = 0;

  controller.routeChanged('/article/a', '/article/b');
  controller.routeChanged('/article/b', '/article/b');

  assert.deepEqual(calls, ['cancel:1', 'remove:1', 'disconnect', 'observe']);
  assert.equal(controller.routeEpoch(), 2);
  microtasks.flush();
  assert.deepEqual(calls, ['cancel:1', 'remove:1', 'disconnect', 'observe', 'start:2']);
});

test('history-first navigation defers route discovery until the new view is rendered', () => {
  const calls = [];
  const microtasks = fakeMicrotasks();
  const MutationObserver = observerFixture(calls);
  const location = { href: 'https://example.test/a' };
  const document = { body: element('body') };
  document.body.view = 'old-view';
  const history = {
    pushState(_state, _unused, url) {
      location.href = new URL(url, location.href).href;
      return 'native-result';
    },
    replaceState() {}
  };
  const startedViews = [];
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    history,
    location,
    queueMicrotask: microtasks.queueMicrotask,
    onRouteStart: () => startedViews.push(document.body.view)
  });
  controller.observe(document);

  assert.equal(history.pushState({}, '', '/b'), 'native-result');
  document.body.view = 'new-view';
  MutationObserver.instances[0].emit([
    mutation({ target: document.body, addedNodes: [element('new-paragraph', { parent: document.body })] })
  ]);

  assert.deepEqual(startedViews, []);
  microtasks.flush();
  assert.deepEqual(startedViews, ['new-view']);
  assert.equal(controller.routeEpoch(), 2);
});

test('a superseding route cancels the deferred start and activates only the latest epoch', () => {
  const calls = [];
  const microtasks = fakeMicrotasks();
  const MutationObserver = observerFixture(calls);
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    queueMicrotask: microtasks.queueMicrotask,
    onRouteCleanup: ({ epoch }) => calls.push(`cleanup:${epoch}`),
    onRouteStart: ({ epoch }) => calls.push(`start:${epoch}`)
  });
  controller.observe({ body: element('body') });
  calls.length = 0;

  controller.routeChanged('/article/a', '/article/b');
  controller.routeChanged('/article/b', '/article/c');
  microtasks.flush();

  assert.deepEqual(calls, [
    'cleanup:1', 'disconnect', 'observe',
    'cleanup:2', 'disconnect', 'observe',
    'start:3'
  ]);
  assert.equal(controller.routeEpoch(), 3);
});

test('throwing route start is reported safely and cannot break native history or observation', () => {
  const calls = [];
  const errors = [];
  const microtasks = fakeMicrotasks();
  const MutationObserver = observerFixture(calls);
  const events = eventTarget();
  const location = { href: 'https://example.test/a' };
  const history = {
    pushState(_state, _unused, url) {
      location.href = new URL(url, location.href).href;
      return 'push-result';
    },
    replaceState(_state, _unused, url) {
      location.href = new URL(url, location.href).href;
      return 'replace-result';
    }
  };
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    history,
    location,
    eventTarget: events,
    queueMicrotask: microtasks.queueMicrotask,
    onRouteStart: () => { throw new Error('start failed'); },
    onError: (error, metadata) => errors.push([error.message, metadata.phase])
  });
  controller.observe({ body: element('body') });

  assert.equal(history.pushState({}, '', '/b'), 'push-result');
  assert.doesNotThrow(() => microtasks.flush());
  assert.equal(history.replaceState({}, '', '/c'), 'replace-result');
  assert.doesNotThrow(() => microtasks.flush());

  assert.deepEqual(errors, [['start failed', 'route-start'], ['start failed', 'route-start']]);
  assert.equal(controller.routeEpoch(), 3);
  assert.ok(MutationObserver.instances[0].document, 'observation resumes after a failed route start');
});

test('throwing final cleanup still restores hooks, observation, and timers exactly once', () => {
  const calls = [];
  const errors = [];
  const clock = fakeClock();
  const MutationObserver = observerFixture(calls);
  const events = eventTarget();
  const location = { href: 'https://example.test/a' };
  const originalPushState = function () {};
  const originalReplaceState = function () {};
  const history = { pushState: originalPushState, replaceState: originalReplaceState };
  let cleanupAttempts = 0;
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    history,
    location,
    eventTarget: events,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onRouteCleanup: (metadata) => {
      if (metadata.reason === 'cleanup') {
        cleanupAttempts += 1;
        throw new Error('cleanup failed');
      }
    },
    onError: (error, metadata) => errors.push([error.message, metadata.phase])
  });
  controller.observe({ body: element('body') });
  MutationObserver.instances[0].emit([mutation({ addedNodes: [element('pending')] })]);

  assert.doesNotThrow(() => controller.cleanup());
  assert.doesNotThrow(() => controller.cleanup());

  assert.equal(cleanupAttempts, 1);
  assert.deepEqual(errors, [['cleanup failed', 'cleanup']]);
  assert.equal(history.pushState, originalPushState);
  assert.equal(history.replaceState, originalReplaceState);
  assert.equal(events.count('popstate'), 0);
  assert.equal(events.count('hashchange'), 0);
  assert.equal(clock.pending(), 0);
  assert.equal(calls.filter((call) => call === 'disconnect').length, 1);
});

test('reentrant final cleanup during route cleanup cannot schedule or resurrect route start', () => {
  const calls = [];
  const clock = fakeClock();
  const microtasks = fakeMicrotasks();
  const MutationObserver = observerFixture(calls);
  const events = eventTarget();
  const location = { href: 'https://example.test/a' };
  const originalPushState = function (_state, _unused, url) {
    location.href = new URL(url, location.href).href;
    return 'push-result';
  };
  const originalReplaceState = function () {};
  const history = { pushState: originalPushState, replaceState: originalReplaceState };
  let controller;
  controller = Dynamic.createDynamicDomController({
    MutationObserver,
    history,
    location,
    eventTarget: events,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    queueMicrotask: microtasks.queueMicrotask,
    onRouteCleanup: (metadata) => {
      calls.push(metadata.reason === 'cleanup' ? 'cleanup:final' : `cleanup:route:${metadata.epoch}`);
      if (!metadata.reason) controller.cleanup();
    },
    onRouteStart: ({ epoch }) => calls.push(`start:${epoch}`)
  });
  controller.observe({ body: element('body') });
  calls.length = 0;

  assert.equal(history.pushState({}, '', '/b'), 'push-result');
  assert.equal(microtasks.pending(), 0);
  controller.cleanup();
  microtasks.flush();
  clock.tick(300);

  assert.deepEqual(calls, ['cleanup:route:1', 'cleanup:final', 'disconnect']);
  assert.equal(microtasks.pending(), 0);
  assert.equal(clock.pending(), 0);
  assert.equal(history.pushState, originalPushState);
  assert.equal(history.replaceState, originalReplaceState);
  assert.equal(events.count('popstate'), 0);
  assert.equal(events.count('hashchange'), 0);
  assert.equal(MutationObserver.instances[0].document, null);
});

test('reentrant duplicate route callbacks coalesce into one ordered transition', () => {
  const calls = [];
  const microtasks = fakeMicrotasks();
  const MutationObserver = observerFixture(calls);
  let controller;
  controller = Dynamic.createDynamicDomController({
    MutationObserver,
    queueMicrotask: microtasks.queueMicrotask,
    onRouteCleanup: ({ epoch }) => {
      calls.push(`cleanup:${epoch}`);
      controller.routeChanged('/article/a', '/article/b');
    },
    onRouteStart: ({ epoch }) => calls.push(`start:${epoch}`)
  });
  controller.observe({ body: element('body') });
  calls.length = 0;

  controller.routeChanged('/article/a', '/article/b');
  microtasks.flush();

  assert.deepEqual(calls, ['cleanup:1', 'disconnect', 'observe', 'start:2']);
  assert.equal(controller.routeEpoch(), 2);
});

test('reentrant distinct route callbacks serialize cleanup and activate only the final epoch', () => {
  const calls = [];
  const microtasks = fakeMicrotasks();
  const MutationObserver = observerFixture(calls);
  let controller;
  controller = Dynamic.createDynamicDomController({
    MutationObserver,
    queueMicrotask: microtasks.queueMicrotask,
    onRouteCleanup: ({ epoch }) => {
      calls.push(`cleanup:${epoch}`);
      if (epoch === 1) controller.routeChanged('/article/b', '/article/c');
    },
    onRouteStart: ({ epoch }) => calls.push(`start:${epoch}`)
  });
  controller.observe({ body: element('body') });
  calls.length = 0;

  controller.routeChanged('/article/a', '/article/b');
  microtasks.flush();

  assert.deepEqual(calls, [
    'cleanup:1', 'disconnect', 'observe',
    'cleanup:2', 'disconnect', 'observe',
    'start:3'
  ]);
  assert.equal(controller.routeEpoch(), 3);
});

test('history and browser navigation signals are deduplicated and cleanup restores every hook', () => {
  const calls = [];
  const microtasks = fakeMicrotasks();
  const MutationObserver = observerFixture(calls);
  const events = eventTarget();
  const location = { href: 'https://example.test/a' };
  const originalPushState = function (_state, _unused, url) {
    location.href = new URL(url, location.href).href;
    return 'push-result';
  };
  const originalReplaceState = function (_state, _unused, url) {
    location.href = new URL(url, location.href).href;
    return 'replace-result';
  };
  const history = { pushState: originalPushState, replaceState: originalReplaceState };
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    history,
    location,
    eventTarget: events,
    queueMicrotask: microtasks.queueMicrotask,
    onRouteCleanup: ({ epoch }) => calls.push(`cleanup:${epoch}`),
    onRouteStart: ({ epoch }) => calls.push(`start:${epoch}`)
  });
  controller.observe({ body: element('body') });
  calls.length = 0;

  assert.equal(history.pushState({}, '', '/b'), 'push-result');
  microtasks.flush();
  assert.equal(history.replaceState({}, '', '/c'), 'replace-result');
  microtasks.flush();
  events.dispatch('popstate');
  location.href = 'https://example.test/c#lesson';
  events.dispatch('hashchange');
  microtasks.flush();

  assert.deepEqual(calls.filter((call) => call.startsWith('start:')), ['start:2', 'start:3', 'start:4']);
  assert.equal(controller.routeEpoch(), 4);
  controller.cleanup();

  assert.equal(history.pushState, originalPushState);
  assert.equal(history.replaceState, originalReplaceState);
  assert.equal(events.count('popstate'), 0);
  assert.equal(events.count('hashchange'), 0);
});
