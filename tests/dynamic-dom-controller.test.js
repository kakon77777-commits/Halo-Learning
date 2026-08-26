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
  sanitizer.expect({ type: 'childList', target: article, addedNodes: [halo], removedNodes: [] });
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

test('child-list sanitation consumes only complete expected node multisets', () => {
  const target = element('article');
  const removed = element('removed', { parent: target });
  const added = element('added', { parent: target });

  for (const [name, actual] of [
    ['remove-only', mutation({ target, removedNodes: [removed] })],
    ['add-only', mutation({ target, addedNodes: [added] })]
  ]) {
    const sanitizer = Dynamic.createRendererMutationSanitizer();
    sanitizer.trackNode(added);
    sanitizer.expect({ type: 'childList', target, addedNodes: [added], removedNodes: [removed] });

    assert.deepEqual(sanitizer.sanitize(actual), actual, name);
    assert.equal(sanitizer.sanitize(mutation({
      target,
      addedNodes: [added],
      removedNodes: [removed]
    })), null, `${name} did not consume the complete expectation`);
    assert.equal(sanitizer.status().pendingOperations, 0);
  }

  const wrongTargetSanitizer = Dynamic.createRendererMutationSanitizer();
  const otherTarget = element('aside');
  wrongTargetSanitizer.trackNode(added);
  wrongTargetSanitizer.expect({ type: 'childList', target, addedNodes: [added], removedNodes: [removed] });
  const unexpectedMove = mutation({ target: otherTarget, addedNodes: [added] });
  assert.deepEqual(
    wrongTargetSanitizer.sanitize(unexpectedMove),
    unexpectedMove,
    'private identity cannot authorize an operation against a different parent'
  );
  assert.equal(wrongTargetSanitizer.status().pendingOperations, 1);

  const identityOnlySanitizer = Dynamic.createRendererMutationSanitizer();
  identityOnlySanitizer.trackNode(added);
  const identityOnlyRecord = mutation({ target, addedNodes: [added] });
  assert.deepEqual(
    identityOnlySanitizer.sanitize(identityOnlyRecord),
    identityOnlyRecord,
    'tracked node identity alone cannot suppress a structural record'
  );
});

test('identical child-list descriptors consume one matching record each', () => {
  const sanitizer = Dynamic.createRendererMutationSanitizer();
  const target = element('article');
  const added = element('added', { parent: target });
  const removed = element('removed', { parent: target });
  const descriptor = { type: 'childList', target, addedNodes: [added], removedNodes: [removed] };
  sanitizer.expect(descriptor);
  sanitizer.expect(descriptor);
  const matchingRecord = mutation({ target, addedNodes: [added], removedNodes: [removed] });

  assert.equal(sanitizer.sanitize(matchingRecord), null);
  assert.equal(sanitizer.status().pendingOperations, 1);
  assert.equal(sanitizer.sanitize(matchingRecord), null);
  assert.equal(sanitizer.status().pendingOperations, 0);
  assert.deepEqual(sanitizer.sanitize(matchingRecord), matchingRecord);
});

test('complete child-list expectations subtract once and preserve legitimate extras', () => {
  const sanitizer = Dynamic.createRendererMutationSanitizer();
  const target = element('article');
  const firstAdded = element('first-added', { parent: target });
  const firstRemoved = element('first-removed', { parent: target });
  const secondAdded = element('second-added', { parent: target });
  const secondRemoved = element('second-removed', { parent: target });
  const legitimateAdded = element('legitimate-added', { parent: target });
  const legitimateRemoved = element('legitimate-removed', { parent: target });
  sanitizer.trackNode(firstAdded);
  sanitizer.trackNode(secondAdded);
  sanitizer.expect({
    type: 'childList',
    target,
    addedNodes: [firstAdded],
    removedNodes: [firstRemoved]
  });
  sanitizer.expect({
    type: 'childList',
    target,
    addedNodes: [secondAdded],
    removedNodes: [secondRemoved]
  });
  const complete = mutation({
    target,
    addedNodes: [firstAdded, legitimateAdded, secondAdded],
    removedNodes: [secondRemoved, legitimateRemoved, firstRemoved]
  });

  assert.deepEqual(sanitizer.sanitize(complete), {
    type: 'childList',
    target,
    addedNodes: [legitimateAdded],
    removedNodes: [legitimateRemoved]
  });
  assert.equal(sanitizer.status().pendingOperations, 0);
  assert.deepEqual(sanitizer.sanitize(complete), complete, 'consumed descriptors cannot sanitize a later record');
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
  scope.expect({ type: 'childList', target: article, addedNodes: [halo], removedNodes: [] });
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
  scope.expect({ type: 'childList', target: article, addedNodes: [halo], removedNodes: [] });
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

test('policy-relevant form insertions and attributes are reported synchronously after renderer sanitation', () => {
  const calls = [];
  const observed = [];
  const MutationObserver = observerFixture(calls);
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    onMutationsObserved: (records) => observed.push(records)
  });
  controller.observe({ body: element('body') });
  const observer = MutationObserver.instances[0];
  const input = element('input');

  assert.ok(observer.options.attributeFilter.includes('type'));
  assert.ok(observer.options.attributeFilter.includes('autocomplete'));
  assert.ok(observer.options.attributeFilter.includes('inputmode'));
  assert.ok(observer.options.attributeFilter.includes('name'));
  assert.ok(observer.options.attributeFilter.includes('role'));
  observer.emit([mutation({ addedNodes: [input] })]);
  observer.emit([{ type: 'attributes', target: input, attributeName: 'autocomplete' }]);

  assert.equal(observed.length, 2);
  assert.equal(observed[0][0].addedNodes[0], input);
  assert.equal(observed[1][0].attributeName, 'autocomplete');
});

test('policy-only observation excludes text and presentation attributes until a fresh allow upgrade', () => {
  const calls = [];
  const invalidated = [];
  const changed = [];
  const clock = fakeClock();
  const MutationObserver = observerFixture(calls);
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    policyOnly: true,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onRootsInvalidated: (roots) => invalidated.push(roots),
    onRootsChanged: (roots) => changed.push(roots)
  });
  controller.observe({ body: element('body') });
  const observer = MutationObserver.instances[0];

  assert.equal(observer.options.childList, true);
  assert.equal(observer.options.characterData, false);
  assert.deepEqual(observer.options.attributeFilter.sort(), [
    'autocomplete', 'data-1p-ignore', 'data-bwignore', 'data-private', 'data-sensitive',
    'inputmode', 'name', 'role', 'type'
  ]);
  observer.emit([mutation({ addedNodes: [element('password-input')] })]);
  clock.tick(300);
  assert.deepEqual(invalidated, []);
  assert.deepEqual(changed, []);
  assert.equal(clock.pending(), 0);

  assert.equal(controller.setPolicyOnly(false), true);
  assert.equal(observer.options.characterData, true);
  assert.ok(observer.options.attributeFilter.includes('class'));
  assert.ok(observer.options.attributeFilter.includes('data-halo-owned'));
  assert.equal(controller.setPolicyOnly(false), false);
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

test('cleanup retains and retries only failed listener, observer, and history capabilities', () => {
  const location = { href: 'https://example.test/a' };
  const listeners = new Map();
  const removalAttempts = { popstate: 0, hashchange: 0 };
  let failPopstateRemoval = false;
  const events = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      removalAttempts[type] += 1;
      if (type === 'popstate' && failPopstateRemoval) throw new Error('popstate removal failed');
      listeners.get(type).delete(listener);
    },
    count(type) { return listeners.get(type).size; }
  };
  let failDisconnect = false;
  let disconnectAttempts = 0;
  let takeRecordsAttempts = 0;
  class ThrowingObserver {
    constructor() { ThrowingObserver.instance = this; }
    observe(document) { this.document = document; }
    disconnect() {
      disconnectAttempts += 1;
      if (failDisconnect) throw new Error('observer disconnect failed');
      this.document = null;
    }
    takeRecords() { takeRecordsAttempts += 1; return []; }
  }
  let nativePushCalls = 0;
  const originalPushState = function () { nativePushCalls += 1; return 'native-push'; };
  const originalReplaceState = function () { return 'native-replace'; };
  let currentPushState = originalPushState;
  let currentReplaceState = originalReplaceState;
  let failPushRestore = false;
  let pushRestoreAttempts = 0;
  let replaceRestoreAttempts = 0;
  const history = {};
  Object.defineProperties(history, {
    pushState: {
      configurable: true,
      get() { return currentPushState; },
      set(next) {
        if (next === originalPushState) {
          pushRestoreAttempts += 1;
          if (failPushRestore) throw new Error('pushState restoration failed');
        }
        currentPushState = next;
      }
    },
    replaceState: {
      configurable: true,
      get() { return currentReplaceState; },
      set(next) {
        if (next === originalReplaceState) replaceRestoreAttempts += 1;
        currentReplaceState = next;
      }
    }
  });
  let finalCleanupCalls = 0;
  const errors = [];
  const controller = Dynamic.createDynamicDomController({
    MutationObserver: ThrowingObserver,
    history,
    location,
    eventTarget: events,
    onRouteCleanup(metadata) {
      if (metadata.reason === 'cleanup') finalCleanupCalls += 1;
    },
    onError(error, metadata) { errors.push([error.message, metadata.phase]); }
  });
  controller.observe({ body: element('body') });
  const installedPushWrapper = history.pushState;
  failPopstateRemoval = true;
  failDisconnect = true;
  failPushRestore = true;

  const pending = controller.cleanup();
  assert.deepEqual(pending, {
    schemaVersion: 1,
    cleanupStarted: true,
    cleaned: false,
    cleanupPending: true,
    pendingStages: ['observer-disconnect', 'popstate-listener', 'push-state-hook']
  });
  assert.equal(Object.isFrozen(pending), true);
  assert.equal(finalCleanupCalls, 1);
  assert.equal(removalAttempts.popstate, 1);
  assert.equal(removalAttempts.hashchange, 1);
  assert.equal(disconnectAttempts, 1);
  assert.equal(takeRecordsAttempts, 1);
  assert.equal(pushRestoreAttempts, 1);
  assert.equal(replaceRestoreAttempts, 1);
  assert.equal(events.count('popstate'), 1);
  assert.equal(events.count('hashchange'), 0);
  assert.equal(history.pushState, installedPushWrapper);
  assert.equal(history.replaceState, originalReplaceState);
  assert.equal(history.pushState({}, '', '/ignored'), 'native-push');
  assert.equal(nativePushCalls, 1, 'failed restoration keeps native history behavior');

  failPopstateRemoval = false;
  failDisconnect = false;
  failPushRestore = false;
  const cleaned = controller.cleanup();
  assert.deepEqual(cleaned, {
    schemaVersion: 1,
    cleanupStarted: true,
    cleaned: true,
    cleanupPending: false,
    pendingStages: []
  });
  assert.deepEqual(controller.status(), cleaned);
  assert.equal(finalCleanupCalls, 1);
  assert.equal(removalAttempts.popstate, 2);
  assert.equal(removalAttempts.hashchange, 1, 'successful listener removal is not repeated');
  assert.equal(disconnectAttempts, 2);
  assert.equal(pushRestoreAttempts, 2);
  assert.equal(replaceRestoreAttempts, 1, 'successful history restoration is not repeated');
  assert.equal(events.count('popstate'), 0);
  assert.equal(history.pushState, originalPushState);
  assert.equal(history.replaceState, originalReplaceState);
  assert.ok(errors.some(([message, phase]) => message === 'observer disconnect failed' && phase === 'cleanup-observer'));
  assert.ok(errors.some(([message, phase]) => message === 'popstate removal failed' && phase === 'cleanup-popstate-listener'));
  assert.ok(errors.some(([message, phase]) => message === 'pushState restoration failed' && phase === 'cleanup-push-state-hook'));

  controller.cleanup();
  assert.equal(removalAttempts.popstate, 2);
  assert.equal(disconnectAttempts, 2);
  assert.equal(pushRestoreAttempts, 2);
});

function inheritedHistoryRestorationHarness(wrapHistory) {
  const errors = [];
  const nativeCalls = { pushState: 0, replaceState: 0 };
  const prototype = {
    pushState() {
      nativeCalls.pushState += 1;
      return 'native-push';
    },
    replaceState() {
      nativeCalls.replaceState += 1;
      return 'native-replace';
    }
  };
  const target = Object.create(prototype);
  const history = typeof wrapHistory === 'function' ? wrapHistory(target) : target;
  const controller = Dynamic.createDynamicDomController({
    MutationObserver: observerFixture([]),
    eventTarget: eventTarget(),
    history,
    location: { href: 'https://example.test/a' },
    onError(error, metadata) { errors.push([error.message, metadata.phase]); }
  });
  controller.observe({ body: element('body') });
  return { controller, errors, history, nativeCalls, prototype, target };
}

for (const methodName of ['pushState', 'replaceState']) {
  test(`cleanup removes the own Halo ${methodName} wrapper from an inherited history method`, () => {
    const harness = inheritedHistoryRestorationHarness();
    const nativeMethod = harness.prototype[methodName];
    const capturedWrapper = harness.history[methodName];
    assert.equal(Object.hasOwn(harness.target, methodName), true);
    assert.notEqual(capturedWrapper, nativeMethod);

    const cleaned = harness.controller.cleanup();

    assert.equal(cleaned.cleaned, true);
    assert.equal(Object.hasOwn(harness.target, methodName), false);
    assert.equal(harness.history[methodName], nativeMethod);
    const epoch = harness.controller.routeEpoch();
    assert.equal(capturedWrapper.call(harness.history),
      methodName === 'pushState' ? 'native-push' : 'native-replace');
    assert.equal(harness.nativeCalls[methodName], 1);
    assert.equal(harness.controller.routeEpoch(), epoch,
      'a captured Halo wrapper remains inactive after exact topology restoration');
  });

  test(`cleanup exposes a replacement inherited ${methodName} method without a stale own shadow`, () => {
    const harness = inheritedHistoryRestorationHarness();
    const updatedMethod = function () { return `updated-${methodName}`; };
    harness.prototype[methodName] = updatedMethod;

    const cleaned = harness.controller.cleanup();

    assert.equal(cleaned.cleaned, true);
    assert.equal(Object.hasOwn(harness.target, methodName), false);
    assert.equal(harness.history[methodName], updatedMethod);
    assert.equal(harness.history[methodName](), `updated-${methodName}`);
  });

  test(`failed deletion of an inherited ${methodName} wrapper stays pending and retries exactly`, () => {
    let rejectDelete = true;
    let deleteAttempts = 0;
    const harness = inheritedHistoryRestorationHarness((target) => new Proxy(target, {
      deleteProperty(innerTarget, property) {
        if (property === methodName) {
          deleteAttempts += 1;
          if (rejectDelete) return false;
        }
        return Reflect.deleteProperty(innerTarget, property);
      }
    }));
    const capturedWrapper = harness.history[methodName];

    const pending = harness.controller.cleanup();

    assert.equal(pending.cleaned, false);
    assert.equal(pending.cleanupPending, true);
    assert.deepEqual(pending.pendingStages,
      [methodName === 'pushState' ? 'push-state-hook' : 'replace-state-hook']);
    assert.equal(deleteAttempts, 1);
    assert.deepEqual(harness.errors, [[
      `${methodName} wrapper deletion failed`,
      `cleanup-${methodName === 'pushState' ? 'push-state' : 'replace-state'}-hook`
    ]]);
    assert.equal(Object.hasOwn(harness.target, methodName), true);
    assert.equal(harness.history[methodName], capturedWrapper);
    const epoch = harness.controller.routeEpoch();
    assert.equal(capturedWrapper.call(harness.history),
      methodName === 'pushState' ? 'native-push' : 'native-replace');
    assert.equal(harness.controller.routeEpoch(), epoch);

    rejectDelete = false;
    const cleaned = harness.controller.cleanup();
    assert.equal(cleaned.cleaned, true);
    assert.equal(cleaned.cleanupPending, false);
    assert.equal(deleteAttempts, 2);
    assert.equal(Object.hasOwn(harness.target, methodName), false);
    assert.equal(harness.history[methodName], harness.prototype[methodName]);
    harness.controller.cleanup();
    assert.equal(deleteAttempts, 2, 'verified deletion is never repeated');
  });

  test(`failed post-delete verification for ${methodName} stays pending without recreating a shadow`, () => {
    let rejectVerification = false;
    let verificationFailures = 0;
    const harness = inheritedHistoryRestorationHarness((target) => new Proxy(target, {
      deleteProperty(innerTarget, property) {
        const deleted = Reflect.deleteProperty(innerTarget, property);
        if (property === methodName && deleted) rejectVerification = true;
        return deleted;
      },
      getOwnPropertyDescriptor(innerTarget, property) {
        if (property === methodName && rejectVerification) {
          rejectVerification = false;
          verificationFailures += 1;
          throw new Error(`${methodName} topology verification failed`);
        }
        return Reflect.getOwnPropertyDescriptor(innerTarget, property);
      }
    }));

    const pending = harness.controller.cleanup();

    assert.equal(pending.cleaned, false);
    assert.equal(pending.cleanupPending, true);
    assert.deepEqual(pending.pendingStages,
      [methodName === 'pushState' ? 'push-state-hook' : 'replace-state-hook']);
    assert.equal(verificationFailures, 1);
    assert.deepEqual(harness.errors, [[
      `${methodName} topology verification failed`,
      `cleanup-${methodName === 'pushState' ? 'push-state' : 'replace-state'}-hook`
    ]]);
    assert.equal(Object.hasOwn(harness.target, methodName), false,
      'a verification failure must not recreate the deleted own wrapper');
    assert.equal(harness.history[methodName], harness.prototype[methodName]);

    const cleaned = harness.controller.cleanup();
    assert.equal(cleaned.cleaned, true);
    assert.equal(cleaned.cleanupPending, false);
    assert.equal(Object.hasOwn(harness.target, methodName), false);
    assert.equal(harness.history[methodName], harness.prototype[methodName]);
  });
}

test('cleanup restores original own history data descriptors after hostile assignment semantics', () => {
  const originals = {
    pushState() { return 'native-push'; },
    replaceState() { return 'native-replace'; }
  };
  const target = {};
  for (const methodName of ['pushState', 'replaceState']) {
    Object.defineProperty(target, methodName, {
      value: originals[methodName],
      writable: false,
      enumerable: false,
      configurable: true
    });
  }
  const originalDescriptors = Object.freeze({
    pushState: Object.freeze({ ...Object.getOwnPropertyDescriptor(target, 'pushState') }),
    replaceState: Object.freeze({ ...Object.getOwnPropertyDescriptor(target, 'replaceState') })
  });
  const history = new Proxy(target, {
    set(innerTarget, property, value) {
      if (property === 'pushState' || property === 'replaceState') {
        Object.defineProperty(innerTarget, property, {
          value,
          writable: true,
          enumerable: true,
          configurable: true
        });
        return true;
      }
      return Reflect.set(innerTarget, property, value);
    }
  });
  const controller = Dynamic.createDynamicDomController({
    MutationObserver: observerFixture([]),
    eventTarget: eventTarget(),
    history,
    location: { href: 'https://example.test/a' }
  });
  controller.observe({ body: element('body') });
  for (const methodName of ['pushState', 'replaceState']) {
    const installed = Object.getOwnPropertyDescriptor(target, methodName);
    assert.equal(installed.enumerable, true);
    assert.equal(installed.writable, true);
    assert.notEqual(installed.value, originals[methodName]);
  }

  const cleaned = controller.cleanup();

  assert.equal(cleaned.cleaned, true);
  for (const methodName of ['pushState', 'replaceState']) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(target, methodName), originalDescriptors[methodName]);
    assert.equal(history[methodName], originals[methodName]);
  }
});

test('cleanup never deletes a third-party own method installed over an inherited Halo wrapper', () => {
  for (const methodName of ['pushState', 'replaceState']) {
    const harness = inheritedHistoryRestorationHarness();
    const thirdParty = function () { return `third-party-${methodName}`; };
    harness.history[methodName] = thirdParty;

    const cleaned = harness.controller.cleanup();

    assert.equal(cleaned.cleaned, true, methodName);
    assert.equal(Object.hasOwn(harness.target, methodName), true, methodName);
    assert.equal(harness.history[methodName], thirdParty, methodName);
    assert.equal(harness.history[methodName](), `third-party-${methodName}`, methodName);
  }
});

function assertCapturedHistoryWrapperStaysNativeAfterCleanup(methodName) {
  const calls = [];
  const MutationObserver = observerFixture(calls);
  const events = eventTarget();
  const microtasks = fakeMicrotasks();
  let currentHref = 'https://example.test/a';
  let rejectLocationReads = false;
  const location = {
    get href() {
      if (rejectLocationReads) throw new Error('location read after cleanup start');
      return currentHref;
    }
  };
  const nativeCalls = { pushState: 0, replaceState: 0 };
  const assignments = { pushState: 0, replaceState: 0 };
  const current = {
    pushState(_state, _unused, url) {
      nativeCalls.pushState += 1;
      currentHref = new URL(url, currentHref).href;
      return 'native-push';
    },
    replaceState(_state, _unused, url) {
      nativeCalls.replaceState += 1;
      currentHref = new URL(url, currentHref).href;
      return 'native-replace';
    }
  };
  const native = { ...current };
  const history = {};
  for (const name of ['pushState', 'replaceState']) {
    Object.defineProperty(history, name, {
      configurable: true,
      get() { return current[name]; },
      set(next) {
        assignments[name] += 1;
        current[name] = next;
      }
    });
  }

  let controller;
  let capturedHaloWrapper;
  let cleanupReentryStatus;
  let routeStartCalls = 0;
  let duringCleanupResult;
  const lifecycleErrors = [];
  controller = Dynamic.createDynamicDomController({
    MutationObserver,
    history,
    location,
    eventTarget: events,
    queueMicrotask: microtasks.queueMicrotask,
    onRouteCleanup(metadata) {
      if (metadata.reason !== 'cleanup') return;
      rejectLocationReads = true;
      try {
        cleanupReentryStatus = controller.cleanup();
        duringCleanupResult = capturedHaloWrapper({}, '', `/${methodName}-during-cleanup`);
      } finally {
        rejectLocationReads = false;
      }
    },
    onRouteStart() { routeStartCalls += 1; },
    onError(error, metadata) { lifecycleErrors.push([error.message, metadata.phase]); }
  });
  controller.observe({ body: element('body') });
  capturedHaloWrapper = history[methodName];
  let outerCalls = 0;
  const thirdPartyOuter = function (...args) {
    outerCalls += 1;
    return capturedHaloWrapper.apply(this, args);
  };
  history[methodName] = thirdPartyOuter;
  const epochBeforeCleanup = controller.routeEpoch();

  const cleaned = controller.cleanup();
  assert.deepEqual(cleaned, {
    schemaVersion: 1,
    cleanupStarted: true,
    cleaned: true,
    cleanupPending: false,
    pendingStages: []
  });
  assert.equal(cleanupReentryStatus.cleanupStarted, true);
  assert.equal(cleanupReentryStatus.cleaned, false);
  assert.equal(duringCleanupResult, `native-${methodName === 'pushState' ? 'push' : 'replace'}`);
  assert.equal(history[methodName], thirdPartyOuter, 'cleanup must not overwrite a third-party outer wrapper');
  assert.equal(controller.routeEpoch(), epochBeforeCleanup);

  assert.equal(capturedHaloWrapper({}, '', `/${methodName}-captured-after-cleanup`),
    `native-${methodName === 'pushState' ? 'push' : 'replace'}`);
  assert.equal(history[methodName]({}, '', `/${methodName}-outer-after-cleanup`),
    `native-${methodName === 'pushState' ? 'push' : 'replace'}`);
  microtasks.flush();
  assert.equal(routeStartCalls, 0, 'deactivated captured wrappers cannot schedule route work');
  assert.deepEqual(lifecycleErrors, []);
  assert.equal(controller.routeEpoch(), epochBeforeCleanup);
  assert.equal(nativeCalls[methodName], 3);
  assert.equal(outerCalls, 1);

  const otherMethod = methodName === 'pushState' ? 'replaceState' : 'pushState';
  assert.equal(history[otherMethod], native[otherMethod]);
  assert.equal(assignments[methodName], 2, 'Halo install plus third-party outer install only');
  assert.equal(assignments[otherMethod], 2, 'Halo install plus one exact restoration only');
  assert.deepEqual(controller.cleanup(), cleaned);
  assert.equal(assignments[methodName], 2);
  assert.equal(assignments[otherMethod], 2);
}

test('captured pushState wrapper remains native-only when a third-party outer survives cleanup', () => {
  assertCapturedHistoryWrapperStaysNativeAfterCleanup('pushState');
});

test('captured replaceState wrapper remains native-only when a third-party outer survives cleanup', () => {
  assertCapturedHistoryWrapperStaysNativeAfterCleanup('replaceState');
});

test('re-observation never rereads already-installed hostile history properties', () => {
  const calls = [];
  const MutationObserver = observerFixture(calls);
  const events = eventTarget();
  const location = { href: 'https://example.test/a' };
  const nativePushState = function () {};
  const nativeReplaceState = function () {};
  const current = { pushState: nativePushState, replaceState: nativeReplaceState };
  let rejectReads = false;
  let rejectedReads = 0;
  const history = {};
  for (const name of ['pushState', 'replaceState']) {
    Object.defineProperty(history, name, {
      configurable: true,
      get() {
        if (rejectReads) {
          rejectedReads += 1;
          throw new Error(`${name} getter must not be reread`);
        }
        return current[name];
      },
      set(next) { current[name] = next; }
    });
  }
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    history,
    location,
    eventTarget: events
  });
  controller.observe({ body: element('first') });
  rejectReads = true;
  assert.doesNotThrow(() => controller.observe({ body: element('second') }));
  assert.equal(rejectedReads, 0);
  rejectReads = false;
  assert.equal(controller.cleanup().cleaned, true);
  assert.equal(history.pushState, nativePushState);
  assert.equal(history.replaceState, nativeReplaceState);
});

function partialHistoryInstallationHarness(methodName, failureMode) {
  const calls = [];
  const MutationObserver = observerFixture(calls);
  const events = eventTarget();
  const location = { href: 'https://example.test/a' };
  const nativeCalls = { pushState: 0, replaceState: 0 };
  const assignments = { pushState: 0, replaceState: 0 };
  const native = {
    pushState() {
      nativeCalls.pushState += 1;
      location.href = `https://example.test/push-${nativeCalls.pushState}`;
      return 'native-push';
    },
    replaceState() {
      nativeCalls.replaceState += 1;
      location.href = `https://example.test/replace-${nativeCalls.replaceState}`;
      return 'native-replace';
    }
  };
  const current = { ...native };
  let rejectTargetReads = false;
  let armVerificationFailure = failureMode === 'verification-getter';
  let ignoreTargetWrite = failureMode === 'ignored-write';
  const history = {};
  for (const name of ['pushState', 'replaceState']) {
    Object.defineProperty(history, name, {
      configurable: true,
      get() {
        if (name === methodName && rejectTargetReads) {
          throw new Error(`${name} verification getter failed`);
        }
        return current[name];
      },
      set(next) {
        assignments[name] += 1;
        if (name === methodName && ignoreTargetWrite) {
          ignoreTargetWrite = false;
          return;
        }
        current[name] = next;
        if (name === methodName && armVerificationFailure) {
          armVerificationFailure = false;
          rejectTargetReads = true;
        }
      }
    });
  }
  const errors = [];
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    history,
    location,
    eventTarget: events,
    onError(error, metadata) { errors.push([error.message, metadata.phase]); }
  });
  return {
    assignments,
    controller,
    current,
    errors,
    history,
    native,
    nativeCalls,
    recoverGetter() { rejectTargetReads = false; }
  };
}

function assertVerificationGetterInstallFailureRetainsAuthority(methodName) {
  const harness = partialHistoryInstallationHarness(methodName, 'verification-getter');
  assert.throws(
    () => harness.controller.observe({ body: element('first') }),
    new RegExp(`${methodName} verification getter failed`)
  );
  const capturedWrapper = harness.current[methodName];
  assert.notEqual(capturedWrapper, harness.native[methodName]);
  const pending = harness.controller.cleanup();
  assert.deepEqual(pending, {
    schemaVersion: 1,
    cleanupStarted: true,
    cleaned: false,
    cleanupPending: true,
    pendingStages: [methodName === 'pushState' ? 'push-state-hook' : 'replace-state-hook']
  });
  const epoch = harness.controller.routeEpoch();
  assert.equal(capturedWrapper.call(harness.history),
    methodName === 'pushState' ? 'native-push' : 'native-replace');
  assert.equal(harness.nativeCalls[methodName], 1);
  assert.equal(harness.controller.routeEpoch(), epoch);

  harness.recoverGetter();
  const cleaned = harness.controller.cleanup();
  assert.equal(cleaned.cleaned, true);
  assert.equal(cleaned.cleanupPending, false);
  assert.deepEqual(cleaned.pendingStages, []);
  assert.equal(harness.history[methodName], harness.native[methodName]);
  const assignmentCount = harness.assignments[methodName];
  assert.deepEqual(harness.controller.cleanup(), cleaned);
  assert.equal(harness.assignments[methodName], assignmentCount);
}

test('pushState verification-getter failure retains uncertain install authority for cleanup retry', () => {
  assertVerificationGetterInstallFailureRetainsAuthority('pushState');
});

test('replaceState verification-getter failure retains uncertain install authority for cleanup retry', () => {
  assertVerificationGetterInstallFailureRetainsAuthority('replaceState');
});

function assertIgnoredHistoryInstallRetries(methodName) {
  const harness = partialHistoryInstallationHarness(methodName, 'ignored-write');
  assert.throws(
    () => harness.controller.observe({ body: element('first') }),
    new RegExp(`${methodName} hook installation was not retained`)
  );
  assert.equal(harness.current[methodName], harness.native[methodName]);
  const attemptsBeforeRetry = harness.assignments[methodName];
  assert.doesNotThrow(() => harness.controller.observe({ body: element('second') }));
  assert.notEqual(harness.current[methodName], harness.native[methodName]);
  assert.equal(harness.assignments[methodName], attemptsBeforeRetry + 1);
  const epoch = harness.controller.routeEpoch();
  assert.equal(harness.history[methodName](), methodName === 'pushState' ? 'native-push' : 'native-replace');
  assert.equal(harness.controller.routeEpoch(), epoch + 1);
  const cleaned = harness.controller.cleanup();
  assert.equal(cleaned.cleaned, true);
  assert.equal(harness.history[methodName], harness.native[methodName]);
  const finalAssignments = harness.assignments[methodName];
  harness.controller.cleanup();
  assert.equal(harness.assignments[methodName], finalAssignments);
}

test('ignored pushState installation retries after the original property recovers', () => {
  assertIgnoredHistoryInstallRetries('pushState');
});

test('ignored replaceState installation retries after the original property recovers', () => {
  assertIgnoredHistoryInstallRetries('replaceState');
});

function assertIgnoredInstallNeverOverwritesLaterThirdParty(methodName) {
  const harness = partialHistoryInstallationHarness(methodName, 'ignored-write');
  assert.throws(() => harness.controller.observe({ body: element('first') }));
  const thirdParty = function () { return 'third-party'; };
  harness.history[methodName] = thirdParty;
  const assignmentsBeforeRetry = harness.assignments[methodName];
  assert.throws(
    () => harness.controller.observe({ body: element('second') }),
    new RegExp(`${methodName} changed before hook retry`)
  );
  assert.equal(harness.history[methodName], thirdParty);
  assert.equal(harness.assignments[methodName], assignmentsBeforeRetry);
  const cleaned = harness.controller.cleanup();
  assert.equal(cleaned.cleaned, true);
  assert.equal(harness.history[methodName], thirdParty);
  harness.controller.cleanup();
  assert.equal(harness.assignments[methodName], assignmentsBeforeRetry);
}

test('ignored pushState installation never overwrites a later third-party method', () => {
  assertIgnoredInstallNeverOverwritesLaterThirdParty('pushState');
});

test('ignored replaceState installation never overwrites a later third-party method', () => {
  assertIgnoredInstallNeverOverwritesLaterThirdParty('replaceState');
});

test('observer drain authority survives a pre-cleanup restart failure until a verified retry', () => {
  let disconnectAttempts = 0;
  let takeRecordsAttempts = 0;
  let failTakeRecords = true;
  const errors = [];
  class ThrowingDrainObserver {
    observe(document) { this.document = document; }
    disconnect() {
      disconnectAttempts += 1;
      this.document = null;
    }
    takeRecords() {
      takeRecordsAttempts += 1;
      if (failTakeRecords) throw new Error('observer record drain failed');
      return [];
    }
  }
  const controller = Dynamic.createDynamicDomController({
    MutationObserver: ThrowingDrainObserver,
    eventTarget: eventTarget(),
    location: { href: 'https://example.test/a' },
    onError(error, metadata) { errors.push([error.message, metadata.phase]); }
  });
  controller.observe({ body: element('body') });

  assert.throws(() => controller.setPolicyOnly(true), /observer record drain failed/);
  const pending = controller.cleanup();
  assert.deepEqual(pending, {
    schemaVersion: 1,
    cleanupStarted: true,
    cleaned: false,
    cleanupPending: true,
    pendingStages: ['observer-records']
  });
  assert.equal(disconnectAttempts, 1, 'successful disconnect is not repeated');
  assert.equal(takeRecordsAttempts, 2, 'final cleanup retries the unverified drain');
  assert.deepEqual(errors, [['observer record drain failed', 'cleanup-observer-records']]);

  failTakeRecords = false;
  const cleaned = controller.cleanup();
  assert.deepEqual(cleaned, {
    schemaVersion: 1,
    cleanupStarted: true,
    cleaned: true,
    cleanupPending: false,
    pendingStages: []
  });
  assert.equal(disconnectAttempts, 1);
  assert.equal(takeRecordsAttempts, 3);
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
