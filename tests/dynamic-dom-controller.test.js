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

test('renderer suppression discards observer records and resets after an exception', () => {
  const clock = fakeClock();
  const changed = [];
  const calls = [];
  const MutationObserver = observerFixture(calls);
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onRootsChanged: (roots) => changed.push(roots)
  });
  controller.observe({ body: element('body') });
  const observer = MutationObserver.instances[0];
  const owned = element('halo', { owned: true });

  assert.throws(() => controller.suppressRendererMutations(() => {
    observer.records.push(mutation({ addedNodes: [owned] }));
    observer.emit([mutation({ addedNodes: [element('renderer-text')] })]);
    throw new Error('renderer failed');
  }), /renderer failed/);
  clock.tick(300);
  assert.deepEqual(changed, []);

  observer.emit([mutation({ addedNodes: [element('article-change')] })]);
  clock.tick(80);
  assert.equal(changed.length, 1);
});

test('one route change cancels old work, removes old DOM, disconnects, and starts one new epoch', () => {
  const calls = [];
  const MutationObserver = observerFixture(calls);
  const controller = Dynamic.createDynamicDomController({
    MutationObserver,
    onRouteCleanup: ({ epoch }) => calls.push(`cancel:${epoch}`, `remove:${epoch}`),
    onRouteStart: ({ epoch }) => calls.push(`start:${epoch}`)
  });
  controller.observe({ body: element('body') });
  calls.length = 0;

  controller.routeChanged('/article/a', '/article/b');
  controller.routeChanged('/article/b', '/article/b');

  assert.deepEqual(calls, ['cancel:1', 'remove:1', 'disconnect', 'start:2', 'observe']);
  assert.equal(controller.routeEpoch(), 2);
});

test('history and browser navigation signals are deduplicated and cleanup restores every hook', () => {
  const calls = [];
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
    onRouteCleanup: ({ epoch }) => calls.push(`cleanup:${epoch}`),
    onRouteStart: ({ epoch }) => calls.push(`start:${epoch}`)
  });
  controller.observe({ body: element('body') });
  calls.length = 0;

  assert.equal(history.pushState({}, '', '/b'), 'push-result');
  assert.equal(history.replaceState({}, '', '/c'), 'replace-result');
  events.dispatch('popstate');
  location.href = 'https://example.test/c#lesson';
  events.dispatch('hashchange');

  assert.deepEqual(calls.filter((call) => call.startsWith('start:')), ['start:2', 'start:3', 'start:4']);
  assert.equal(controller.routeEpoch(), 4);
  controller.cleanup();

  assert.equal(history.pushState, originalPushState);
  assert.equal(history.replaceState, originalReplaceState);
  assert.equal(events.count('popstate'), 0);
  assert.equal(events.count('hashchange'), 0);
});
