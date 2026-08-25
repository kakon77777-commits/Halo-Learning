const test = require('node:test');
const assert = require('node:assert/strict');

const Scheduler = require('../apps/extension/src/shared/runtime-scheduler');
const Content = require('../apps/extension/src/content');
const Progressive = require('../apps/extension/src/shared/progressive-runtime');

const generousBudgets = Object.freeze({
  maxTextNodes: 100,
  maxCharacters: 100000,
  maxSentences: 100,
  maxSemanticTokens: 10000,
  maxShardIds: 100,
  timeSliceMs: 1000,
  maxQueuedRoots: 200
});

function work(id, overrides) {
  return {
    id,
    rootId: `root-${id}`,
    epoch: 1,
    priority: 'inferred',
    visible: true,
    textNodes: 1,
    characters: 10,
    sentences: 1,
    semanticTokens: 2,
    shardIds: [`shard-${id}`],
    ...overrides
  };
}

test('each batch budget independently stops otherwise eligible work', async () => {
  const dimensions = [
    ['maxTextNodes', 'textNodes', 2, 1],
    ['maxCharacters', 'characters', 10, 6],
    ['maxSentences', 'sentences', 2, 1],
    ['maxSemanticTokens', 'semanticTokens', 10, 6],
    ['maxShardIds', 'shardIds', 2, null]
  ];

  for (const [budgetName, workName, limit, amount] of dimensions) {
    const scheduler = Scheduler.createRuntimeScheduler({
      budgets: { ...generousBudgets, [budgetName]: limit }
    });
    scheduler.enqueue([0, 1, 2].map((index) => work(`${budgetName}-${index}`, {
      [workName]: workName === 'shardIds' ? [`unique-${index}`] : amount
    })));

    const batch = await scheduler.nextBatch();

    assert.equal(batch.items.length, workName === 'shardIds' || amount === 1 ? 2 : 1, budgetName);
    assert.ok(batch.textNodes <= scheduler.status().budgets.maxTextNodes, budgetName);
    assert.ok(batch.characters <= scheduler.status().budgets.maxCharacters, budgetName);
    assert.ok(batch.sentences <= scheduler.status().budgets.maxSentences, budgetName);
    assert.ok(batch.semanticTokens <= scheduler.status().budgets.maxSemanticTokens, budgetName);
    assert.ok(batch.shardIds.size <= scheduler.status().budgets.maxShardIds, budgetName);
  }
});

test('the main-thread time slice stops batch assembly independently', async () => {
  let milliseconds = -4;
  const scheduler = Scheduler.createRuntimeScheduler({
    budgets: { ...generousBudgets, timeSliceMs: 8 },
    clock: { now: () => { milliseconds += 4; return milliseconds; } }
  });
  scheduler.enqueue([work('a'), work('b'), work('c'), work('d')]);

  const batch = await scheduler.nextBatch();

  assert.equal(batch.items.length, 2);
  assert.equal(scheduler.status().queuedRoots, 2);
});

test('explicit visible work outranks and displaces stale offscreen inferred work', () => {
  const scheduler = Scheduler.createRuntimeScheduler({
    budgets: { ...generousBudgets, maxQueuedRoots: 2 }
  });
  scheduler.enqueue(work('old', { priority: 'background', visible: false, stale: true }));
  scheduler.enqueue(work('inferred', { priority: 'inferred', visible: false }));
  const accepted = scheduler.enqueue(work('click', { priority: 'explicit', visible: true }));

  assert.equal(accepted, true);
  assert.equal(scheduler.peek().id, 'click');
  assert.deepEqual([...scheduler.status().queuedRootIds].sort(), ['root-click', 'root-inferred']);
  assert.equal(scheduler.status().droppedRoots, 1);
});

test('inferred work cannot evict or displace explicit work under backpressure', () => {
  const scheduler = Scheduler.createRuntimeScheduler({
    budgets: { ...generousBudgets, maxQueuedRoots: 2 }
  });
  scheduler.enqueue(work('one', { priority: 'explicit', visible: true }));
  scheduler.enqueue(work('two', { priority: 'explicit', visible: false }));

  assert.equal(scheduler.enqueue(work('hover', { priority: 'inferred', visible: true })), false);
  assert.deepEqual([...scheduler.status().queuedRootIds].sort(), ['root-one', 'root-two']);
  assert.equal(scheduler.status().droppedRoots, 1);
});

test('queue backpressure counts distinct roots and evicts every chunk of the selected root', () => {
  const scheduler = Scheduler.createRuntimeScheduler({
    budgets: { ...generousBudgets, maxQueuedRoots: 2 }
  });
  scheduler.enqueue([
    work('old-a', { rootId: 'root-old', visible: false, stale: true }),
    work('old-b', { rootId: 'root-old', visible: false, stale: true }),
    work('other', { rootId: 'root-other' })
  ]);
  assert.equal(scheduler.status().queuedRoots, 2);

  assert.equal(scheduler.enqueue(work('click', {
    rootId: 'root-click',
    priority: 'explicit',
    visible: true
  })), true);

  assert.deepEqual([...scheduler.status().queuedRootIds].sort(), ['root-click', 'root-other']);
  assert.equal(scheduler.status().droppedRoots, 1);
});

test('root, epoch, and batch cancellation remove queued work and abort in-flight work', async () => {
  let release;
  let observedSignal;
  const processing = new Promise((resolve) => { release = resolve; });
  const scheduler = Scheduler.createRuntimeScheduler({
    budgets: generousBudgets,
    processBatch: async (batch, context) => {
      observedSignal = context.signal;
      await processing;
      return batch.items.length;
    },
    requestIdleCallback: (callback) => { callback({ didTimeout: false, timeRemaining: () => 50 }); return 7; },
    cancelIdleCallback: () => {}
  });
  scheduler.enqueue([
    work('root-cancel'),
    work('epoch-cancel', { epoch: 2 }),
    work('batch-cancel', { priority: 'explicit' })
  ]);
  assert.equal(scheduler.cancelRoot('root-root-cancel'), 1);
  assert.equal(scheduler.cancelEpoch(2), 1);
  const flushing = scheduler.flush();
  await Promise.resolve();
  const batchId = scheduler.status().inFlightBatchIds[0];

  assert.equal(scheduler.cancelBatch(batchId), true);
  assert.equal(observedSignal.aborted, true);
  release();
  await flushing;
  assert.equal(scheduler.status().inFlightBatches, 0);
  assert.equal(scheduler.status().queuedRoots, 0);
});

test('cancelling one in-flight root requeues unaffected explicit work from the aborted batch', async () => {
  const batches = [];
  let releaseFirst;
  const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
  const scheduler = Scheduler.createRuntimeScheduler({
    budgets: generousBudgets,
    processBatch: async (batch, context) => {
      batches.push({ ids: batch.items.map((item) => item.id), signal: context.signal });
      if (batches.length === 1) await firstPending;
    },
    requestIdleCallback: (callback) => { callback({ didTimeout: false, timeRemaining: () => 50 }); return 1; },
    cancelIdleCallback: () => {}
  });
  scheduler.enqueue([
    work('hover', { priority: 'inferred' }),
    work('click', { priority: 'explicit' })
  ]);
  const flushing = scheduler.flush();
  await Promise.resolve();

  assert.equal(scheduler.cancelRoot('root-hover'), 1);
  assert.equal(batches[0].signal.aborted, true);
  releaseFirst();
  await flushing;

  assert.deepEqual(batches.map((batch) => batch.ids), [
    ['click', 'hover'],
    ['click']
  ]);
});

test('flush schedules through requestIdleCallback with a bounded timeout', async () => {
  const idleCalls = [];
  const processed = [];
  const scheduler = Scheduler.createRuntimeScheduler({
    budgets: generousBudgets,
    processBatch: async (batch) => processed.push(batch.items.map((item) => item.id)),
    requestIdleCallback: (callback, options) => {
      idleCalls.push(options);
      callback({ didTimeout: false, timeRemaining: () => 50 });
      return idleCalls.length;
    },
    cancelIdleCallback: () => {}
  });
  scheduler.enqueue(work('idle'));

  await scheduler.flush();

  assert.deepEqual(processed, [['idle']]);
  assert.equal(idleCalls.length, 1);
  assert.ok(idleCalls[0].timeout >= scheduler.status().budgets.timeSliceMs);
  assert.ok(idleCalls[0].timeout <= 1000);
});

test('flush falls back to setTimeout when requestIdleCallback is unavailable', async () => {
  const delays = [];
  const scheduler = Scheduler.createRuntimeScheduler({
    budgets: generousBudgets,
    processBatch: async () => {},
    setTimeout: (callback, delay) => {
      delays.push(delay);
      callback();
      return delays.length;
    },
    clearTimeout: () => {}
  });
  scheduler.enqueue(work('timer'));

  await scheduler.flush();

  assert.deepEqual(delays, [0]);
});

function candidate(id) {
  return {
    id,
    nodeType: 1,
    tagName: 'P',
    isConnected: true,
    matches: () => true,
    closest: () => null
  };
}

test('viewport discovery samples visible roots first and only enqueues intersecting roots', () => {
  const candidates = Array.from({ length: 40 }, (_value, index) => candidate(`p-${index}`));
  let walkerIndex = 0;
  const slices = [];
  const enqueued = [];
  const cancelled = [];
  let observer;
  class FixtureIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.observed = [];
      observer = this;
    }
    observe(value) { this.observed.push(value); }
    disconnect() {}
  }
  const document = {
    body: candidate('body'),
    documentElement: candidate('html'),
    elementsFromPoint: () => [candidates[35]],
    createTreeWalker: () => ({
      nextNode: () => candidates[walkerIndex++] || null
    })
  };
  const discovery = Content.createViewportDiscovery({
    document,
    NodeFilter: { SHOW_ELEMENT: 1 },
    IntersectionObserver: FixtureIntersectionObserver,
    scheduler: {
      enqueue: (value) => { enqueued.push(value); return true; },
      cancelRoot: (rootId) => { cancelled.push(rootId); return 1; }
    },
    budgets: { timeSliceMs: 8, viewportBufferPx: 1200 },
    makeWork: (element, visible) => ({
      id: element.id,
      rootId: element.id,
      epoch: 1,
      priority: visible ? 'explicit' : 'inferred',
      visible
    }),
    innerWidth: 1000,
    innerHeight: 800,
    requestIdleCallback: (callback) => { slices.push(callback); return slices.length; },
    cancelIdleCallback: () => {},
    clock: { now: () => 0 }
  });

  discovery.start();

  assert.equal(enqueued[0].rootId, 'p-35', 'initial viewport sample is enqueued before discovery');
  assert.equal(enqueued[0].priority, 'explicit');
  assert.equal(observer.options.rootMargin, '1200px 0px 1200px 0px');
  slices.shift()({ didTimeout: false, timeRemaining: () => 50 });
  assert.equal(discovery.status().candidatesVisited, 32);
  assert.equal(enqueued.length, 1, 'observing offscreen roots performs no semantic enqueue');

  observer.callback([{ target: candidates[10], isIntersecting: false }]);
  assert.equal(enqueued.length, 1);
  assert.deepEqual(cancelled, ['p-10']);
  observer.callback([{ target: candidates[10], isIntersecting: true }]);
  assert.equal(enqueued.at(-1).rootId, 'p-10');
  assert.equal(enqueued.at(-1).priority, 'inferred');
  assert.equal(enqueued.at(-1).visible, true);
  discovery.disconnect();
});

test('enrichment items recompute canonical keys from every semantic input', () => {
  const records = [
    { id: '1:0:17', text: 'The model learns.', language: 'en', rootRevision: 1 },
    { id: '1:18:25', text: '人工智慧。', language: 'zh-Hant', rootRevision: 1 }
  ];
  const items = Content.buildEnrichmentItems(records, {
    rootId: 'root-3',
    languageMode: 'both',
    semanticVersion: 'semantic-v4',
    grammarVersion: 'grammar-v4',
    profileRevision: 'profile-9',
    lexicalVersion: 'halo-bootstrap-dictionary@0.3.0'
  }, Progressive);

  assert.deepEqual(items.map((item) => item.languageMode), ['both', 'both']);
  assert.deepEqual(items.map((item) => item.text), ['The model learns.', '人工智慧。']);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    assert.equal(item.rootId, `root-3:s${index}`);
    assert.equal(item.analysisKey, Progressive.createAnalysisKey({
      text: item.text,
      languageMode: item.languageMode,
      semanticVersion: item.semanticVersion,
      grammarVersion: item.grammarVersion,
      profileRevision: item.profileRevision,
      lexicalVersion: item.lexicalVersion
    }));
    assert.equal(Object.isFrozen(item), true);
  }
});

test('root work is sentence-batched from runtime budgets and ignores legacy caps', () => {
  const pipeline = {
    buildSentenceRecords: () => Object.freeze([
      Object.freeze({ id: '1:0:4', text: 'One.', rootRevision: 1, fragments: [{ nodeId: 'n1', start: 0, end: 4 }] }),
      Object.freeze({ id: '1:5:9', text: 'Two.', rootRevision: 1, fragments: [{ nodeId: 'n2', start: 0, end: 4 }] }),
      Object.freeze({ id: '1:10:16', text: 'Three.', rootRevision: 1, fragments: [{ nodeId: 'n3', start: 0, end: 6 }] })
    ])
  };
  const settings = {
    maxTextNodes: 1,
    maxMarkedTokens: 1,
    runtimeBudgets: {
      maxTextNodes: 2,
      maxCharacters: 100,
      maxSentences: 2,
      maxSemanticTokens: 100,
      maxShardIds: 24,
      timeSliceMs: 8,
      maxQueuedRoots: 200,
      viewportBufferPx: 1200
    }
  };

  const chunks = Content.buildRootWork(candidate('lesson'), {
    rootId: 'lesson',
    rootRevision: 1,
    epoch: 3,
    priority: 'inferred',
    visible: true,
    settings,
    pipeline
  });

  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map((chunk) => chunk.sentences), [2, 1]);
  assert.deepEqual(chunks.map((chunk) => chunk.textNodes), [2, 1]);
  assert.deepEqual(chunks.map((chunk) => chunk.characters), [8, 6]);
  assert.ok(chunks.every((chunk) => chunk.epoch === 3 && chunk.rootId === 'lesson'));
});
