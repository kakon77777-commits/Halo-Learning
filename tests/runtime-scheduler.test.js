const test = require('node:test');
const assert = require('node:assert/strict');

const Scheduler = require('../apps/extension/src/shared/runtime-scheduler');
const Content = require('../apps/extension/src/content');
const Progressive = require('../apps/extension/src/shared/progressive-runtime');
const Contracts = require('../packages/contracts/semantic-contracts');
const Dictionary = require('../apps/extension/src/shared/dictionary-provider');
const Semantic = require('../apps/extension/src/shared/semantic-annotations');
const Grammar = require('../apps/extension/src/shared/grammar-annotations');

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

test('inferred backpressure cannot evict a root containing any explicit chunk', () => {
  const scheduler = Scheduler.createRuntimeScheduler({
    budgets: { ...generousBudgets, maxQueuedRoots: 1 }
  });
  scheduler.enqueue([
    work('mixed-background', { rootId: 'root-mixed', priority: 'background', visible: false, stale: true }),
    work('mixed-explicit', { rootId: 'root-mixed', priority: 'explicit', visible: true })
  ]);

  assert.equal(scheduler.enqueue(work('new-inferred', {
    rootId: 'root-new',
    priority: 'inferred',
    visible: true
  })), false);

  assert.deepEqual(scheduler.status().queuedRootIds, ['root-mixed']);
  assert.equal(scheduler.peek().priority, 'explicit');
});

test('oversized work is quarantined before enqueue with stable dimensions and no processing', async () => {
  const cases = [
    ['maxTextNodes', { textNodes: 3 }, ['maxTextNodes']],
    ['maxCharacters', { characters: 11 }, ['maxCharacters']],
    ['maxSemanticTokens', { semanticTokens: 11 }, ['maxSemanticTokens']],
    ['maxShardIds', { shardIds: ['a', 'b', 'c'] }, ['maxShardIds']]
  ];
  for (const [name, overrides, dimensions] of cases) {
    let processed = 0;
    const scheduler = Scheduler.createRuntimeScheduler({
      budgets: {
        ...generousBudgets,
        maxTextNodes: 2,
        maxCharacters: 10,
        maxSemanticTokens: 10,
        maxShardIds: 2
      },
      processBatch: async () => { processed += 1; }
    });
    const accepted = scheduler.enqueue(work(name, {
      textNodes: 1,
      characters: 1,
      semanticTokens: 1,
      shardIds: ['one'],
      ...overrides
    }));

    assert.equal(accepted, false, name);
    assert.equal(scheduler.status().queuedRoots, 0, name);
    assert.deepEqual(scheduler.status().oversizedWork, [{
      id: name,
      rootId: `root-${name}`,
      reason: 'WORK_EXCEEDS_BUDGET',
      dimensions
    }], name);
    await scheduler.flush();
    assert.equal(processed, 0, name);
    assert.equal(scheduler.status().completedBatches, 0, name);
  }
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

test('sequential root cancellations never resurrect work from the same settling batch', async () => {
  const batches = [];
  let releaseFirst;
  const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
  const scheduler = Scheduler.createRuntimeScheduler({
    budgets: generousBudgets,
    processBatch: async (batch) => {
      batches.push(batch.items.map((item) => item.id));
      if (batches.length === 1) await firstPending;
    },
    requestIdleCallback: (callback) => { callback({ didTimeout: false, timeRemaining: () => 50 }); return 1; },
    cancelIdleCallback: () => {}
  });
  scheduler.enqueue([
    work('a', { priority: 'explicit' }),
    work('b', { priority: 'inferred' }),
    work('c', { priority: 'background' })
  ]);
  const flushing = scheduler.flush();
  await Promise.resolve();

  assert.equal(scheduler.cancelRoot('root-a'), 1);
  assert.equal(scheduler.cancelRoot('root-b'), 1);
  releaseFirst();
  await flushing;

  assert.deepEqual(batches, [['a', 'b', 'c'], ['c']]);
  assert.deepEqual(scheduler.status().queuedRootIds, []);
  assert.equal(scheduler.status().cancelledRoots, 2);
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

test('dynamic root refresh cancels stale work and enqueues one incremented visible revision', () => {
  const paragraph = candidate('lesson');
  const enqueued = [];
  const cancelled = [];
  let observer;
  class FixtureIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      this.unobserved = [];
      observer = this;
    }
    observe(value) { this.observed.push(value); }
    unobserve(value) { this.unobserved.push(value); }
    disconnect() {}
  }
  const document = {
    body: candidate('body'),
    documentElement: candidate('html'),
    elementsFromPoint: () => [paragraph],
    createTreeWalker: () => ({ nextNode: () => null })
  };
  const discovery = Content.createViewportDiscovery({
    document,
    NodeFilter: { SHOW_ELEMENT: 1 },
    IntersectionObserver: FixtureIntersectionObserver,
    scheduler: {
      enqueue: (value) => { enqueued.push(value); return true; },
      cancelRoot: (rootId) => { cancelled.push(rootId); return 1; },
      flush: () => Promise.resolve()
    },
    budgets: { timeSliceMs: 8, viewportBufferPx: 1200 },
    makeWork: (element, visible, metadata) => ({
      id: `${element.id}:r${metadata.rootRevision}`,
      rootId: element.id,
      rootRevision: metadata.rootRevision,
      epoch: 1,
      priority: metadata.priority,
      visible
    }),
    innerWidth: 1000,
    innerHeight: 800,
    requestIdleCallback: (callback) => { callback({ didTimeout: false, timeRemaining: () => 50 }); return 1; },
    cancelIdleCallback: () => {},
    clock: { now: () => 0 }
  });
  discovery.start();

  assert.equal(discovery.isRootRevisionCurrent(paragraph, 1), true);
  discovery.invalidateRoots([paragraph, paragraph]);
  assert.equal(discovery.isRootRevisionCurrent(paragraph, 1), false);
  discovery.refreshRoots([paragraph, paragraph], { alreadyInvalidated: true });
  observer.callback([{ target: paragraph, isIntersecting: true }]);

  assert.deepEqual(cancelled, ['lesson']);
  assert.deepEqual(observer.unobserved, [paragraph]);
  assert.deepEqual(enqueued.map((item) => [item.rootId, item.rootRevision]), [
    ['lesson', 1],
    ['lesson', 2]
  ]);

  discovery.releaseRoots([paragraph]);
  assert.deepEqual(cancelled, ['lesson', 'lesson']);
  assert.deepEqual(observer.unobserved, [paragraph, paragraph]);
});

test('released discovery roots delete revision and identity state under bounded churn and ID reuse', () => {
  const cancelled = [];
  class FixtureIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const document = {
    body: candidate('body'),
    documentElement: candidate('html'),
    elementsFromPoint: () => [],
    createTreeWalker: () => ({ nextNode: () => null })
  };
  const discovery = Content.createViewportDiscovery({
    document,
    NodeFilter: { SHOW_ELEMENT: 1 },
    IntersectionObserver: FixtureIntersectionObserver,
    scheduler: {
      enqueue: () => true,
      cancelRoot: (rootId) => { cancelled.push(rootId); return 1; },
      flush: () => Promise.resolve()
    },
    budgets: { timeSliceMs: 8, viewportBufferPx: 1200 },
    makeWork: () => null,
    innerWidth: 1000,
    innerHeight: 800,
    requestIdleCallback: (callback) => { callback({ didTimeout: false, timeRemaining: () => 50 }); return 1; },
    cancelIdleCallback: () => {},
    clock: { now: () => 0 }
  });

  for (let index = 0; index < 40; index += 1) {
    const transientRoot = candidate(`transient-${index}`);
    assert.equal(discovery.isRootRevisionCurrent(transientRoot, 1), true);
    assert.equal(discovery.status().trackedRootRevisions, 1);
    assert.equal(discovery.releaseRoots([transientRoot]), 1);
    assert.equal(discovery.status().trackedRootRevisions, 0);
  }

  const first = candidate('reused-id');
  assert.equal(discovery.isRootRevisionCurrent(first, 1), true);
  discovery.invalidateRoots([first]);
  assert.equal(discovery.isRootRevisionCurrent(first, 2), true);
  discovery.releaseRoots([first]);
  const replacement = candidate('reused-id');
  assert.equal(discovery.isRootRevisionCurrent(replacement, 1), true);
  assert.equal(discovery.status().trackedRootRevisions, 1);
  assert.ok(cancelled.includes('reused-id'));
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

test('enrichment response validation binds every result field and canonical annotation contract', () => {
  const generatedAt = '2026-08-26T04:00:00.000Z';
  const provider = Dictionary.createBootstrapDictionaryProvider();
  const engine = Semantic.createSemanticEngine({
    provider,
    grammarAnnotator: Grammar.annotateGrammar
  });
  const item = Content.buildEnrichmentItems([
    { text: 'The model learns.', language: 'en', rootRevision: 3 }
  ], {
    rootId: 'lesson:w0',
    languageMode: 'both',
    semanticVersion: Semantic.ENGINE.version,
    grammarVersion: Grammar.ALGORITHM.version,
    profileRevision: 7,
    lexicalVersion: `${provider.id}@${provider.version}`
  }, Progressive)[0];
  const request = {
    requestId: 'req-4-1',
    pageEpoch: 4,
    items: [item]
  };
  const result = {
    schemaVersion: Contracts.SEMANTIC_SCHEMA_VERSION,
    requestId: request.requestId,
    pageEpoch: request.pageEpoch,
    rootId: item.rootId,
    rootRevision: item.rootRevision,
    analysisKey: item.analysisKey,
    phase: 'bootstrap',
    lexicalVersion: item.lexicalVersion,
    generatedAt,
    annotationSet: engine.annotateText(item.text, { languageMode: item.languageMode, generatedAt })
  };
  const response = {
    schemaVersion: Contracts.SEMANTIC_SCHEMA_VERSION,
    requestId: request.requestId,
    pageEpoch: request.pageEpoch,
    results: [result],
    status: { mode: 'degraded' }
  };

  assert.equal(Content.validateEnrichmentResponse(response, request, Contracts).results.length, 1);
  for (const [field, badValue] of [
    ['requestId', 'req-wrong'],
    ['pageEpoch', 5],
    ['rootId', 'other-root'],
    ['rootRevision', 4],
    ['analysisKey', `ak1:${'0'.repeat(64)}`],
    ['phase', 'unknown'],
    ['lexicalVersion', 'other-version'],
    ['generatedAt', '2026-08-26T04:00:01.000Z']
  ]) {
    assert.equal(Content.validateEnrichmentResponse({
      ...response,
      results: [{ ...result, [field]: badValue }]
    }, request, Contracts), null, field);
  }
  assert.equal(Content.validateEnrichmentResponse({
    ...response,
    results: [{ ...result, annotationSet: { ...result.annotationSet, tokens: [{}] } }]
  }, request, Contracts), null);
  for (const value of [undefined, 999]) {
    const outer = { ...response, schemaVersion: value };
    const inner = { ...response, results: [{ ...result, schemaVersion: value }] };
    assert.equal(Content.validateEnrichmentResponse(outer, request, Contracts), null);
    assert.equal(Content.validateEnrichmentResponse(inner, request, Contracts), null);
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

test('same-element replacement invalidates pending root work before projection', () => {
  const root = candidate('pending-root');
  root.text = 'Original sentence.';
  const pipeline = {
    buildSentenceRecords: (element, options) => Object.freeze([
      Object.freeze({
        id: `${options.rootRevision}:0:${element.text.length}`,
        text: element.text,
        language: 'en',
        start: 0,
        end: element.text.length,
        rootRevision: options.rootRevision,
        fragments: Object.freeze([{ nodeId: 'text-1', start: 0, end: element.text.length }])
      })
    ])
  };
  const enqueued = [];
  class FixtureIntersectionObserver {
    observe() {}
    disconnect() {}
  }
  const discovery = Content.createViewportDiscovery({
    document: {
      body: candidate('body'),
      documentElement: candidate('html'),
      elementsFromPoint: () => [root],
      createTreeWalker: () => ({ nextNode: () => null })
    },
    NodeFilter: { SHOW_ELEMENT: 1 },
    IntersectionObserver: FixtureIntersectionObserver,
    scheduler: {
      enqueue: (value) => {
        enqueued.push(...(Array.isArray(value) ? value : [value]));
        return true;
      },
      cancelRoot: () => 1,
      flush: () => Promise.resolve()
    },
    budgets: { timeSliceMs: 8, viewportBufferPx: 1200 },
    makeWork: (element, visible, metadata) => Content.buildRootWork(element, {
      rootId: metadata.rootId,
      rootRevision: metadata.rootRevision,
      epoch: 1,
      priority: metadata.priority,
      visible,
      settings: { languageMode: 'en', runtimeBudgets: generousBudgets },
      pipeline
    }),
    innerWidth: 1000,
    innerHeight: 800,
    requestIdleCallback: (callback) => { callback({ didTimeout: false, timeRemaining: () => 50 }); return 1; },
    cancelIdleCallback: () => {},
    clock: { now: () => 0 }
  });
  discovery.start();
  const work = enqueued[0];

  assert.equal(Content.rootWorkIsCurrent(work, discovery), true);
  root.text = 'Replacement sentence.';
  discovery.invalidateRoots([root]);
  assert.equal(Content.rootWorkIsCurrent(work, discovery), false);
});

test('private discovery identity resolves live descendants and detached removal metadata', () => {
  const paragraph = candidate('lesson-root');
  const cancelled = [];
  const mutatedDescendant = {
    nodeType: 1,
    isConnected: true,
    matches: () => false,
    closest: () => paragraph
  };
  class FixtureIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const discovery = Content.createViewportDiscovery({
    document: {
      body: candidate('body'),
      documentElement: candidate('html'),
      elementsFromPoint: () => [paragraph],
      createTreeWalker: () => ({ nextNode: () => null })
    },
    NodeFilter: { SHOW_ELEMENT: 1 },
    IntersectionObserver: FixtureIntersectionObserver,
    scheduler: {
      enqueue: () => true,
      cancelRoot: (rootId) => { cancelled.push(rootId); return 1; },
      flush: () => Promise.resolve()
    },
    budgets: { timeSliceMs: 8, viewportBufferPx: 1200 },
    makeWork: (_element, _visible, metadata) => ({
      id: metadata.rootId,
      rootId: metadata.rootId,
      rootRevision: metadata.rootRevision
    }),
    innerWidth: 1000,
    innerHeight: 800,
    requestIdleCallback: (callback) => { callback({ didTimeout: false, timeRemaining: () => 50 }); return 1; },
    cancelIdleCallback: () => {},
    clock: { now: () => 0 }
  });
  discovery.start();
  const rendererRoots = new Map([
    ['lesson-root', new Set(['lesson-root:w0', 'lesson-root:w1'])]
  ]);

  assert.deepEqual(
    Content.rendererRootIdsForInvalidation(discovery, [mutatedDescendant], [], rendererRoots),
    ['lesson-root:w0', 'lesson-root:w1']
  );
  const canonicalRoots = discovery.rootsWithin([mutatedDescendant]);
  mutatedDescendant.closest = () => null;
  mutatedDescendant.isConnected = false;
  discovery.invalidateRoots(canonicalRoots);
  assert.deepEqual(cancelled, ['lesson-root']);
  paragraph.isConnected = false;
  assert.deepEqual(
    Content.rendererRootIdsForInvalidation(discovery, [], [paragraph], rendererRoots),
    ['lesson-root:w0', 'lesson-root:w1']
  );
});

test('transient renderer ownership is direct and never expands to page descendants', () => {
  const publicToken = { nodeType: 1, dataset: { haloOwned: 'token' }, parentNode: null };
  const child = { nodeType: 3, parentNode: publicToken };

  assert.equal(Content.isTransientRendererOwned(publicToken, null), false);
  assert.equal(Content.isTransientRendererOwned(publicToken, new Set([publicToken])), true);
  assert.equal(Content.isTransientRendererOwned(child, new Set([publicToken])), false);
  assert.equal(Content.isTransientRendererOwned(publicToken, new Set()), false);
});

test('content eligibility uses private renderer authority instead of public token fields', () => {
  const token = {
    nodeType: 1,
    tagName: 'SPAN',
    getAttribute(name) {
      return ({
        'data-halo-owned': 'token',
        'data-halo-root': 'forged-root',
        'data-halo-run': 'forged-run',
        'data-halo-original': 'model'
      })[name] ?? null;
    }
  };
  const parent = {
    nodeType: 1,
    tagName: 'SPAN',
    closest(selector) {
      return selector.includes('data-halo-owned="token"') ? token : null;
    }
  };
  const node = { nodeType: 3, nodeValue: 'model', parentElement: parent };

  assert.equal(Content.eligibleTextNode(node, {
    rendererRootId: 'real-root',
    ownsToken: () => false,
    isVisible: () => true
  }), true, 'a forged all-public-marker token remains ordinary page content');
  assert.equal(Content.eligibleTextNode(node, {
    rendererRootId: 'real-root',
    ownsToken: (element) => element === token,
    isVisible: () => true
  }), false, 'a private token cannot remap under a different canonical renderer root');
  token.getAttribute = (name) => name === 'data-halo-root' ? 'real-root' :
    (name === 'data-halo-owned' ? 'token' : 'private');
  assert.equal(Content.eligibleTextNode(node, {
    rendererRootId: 'real-root',
    ownsToken: (element) => element === token,
    isVisible: () => true
  }), true, 'the renderer private capability admits legitimate same-root remapping');
});

test('content invalidation cancels first and survives renderer cleanup failure through refresh', () => {
  const changedRoot = candidate('changed-root');
  const detachedRoot = candidate('detached-root');
  detachedRoot.isConnected = false;
  const calls = [];
  const errors = [];
  const discovery = {
    rootsWithin(values) {
      return Array.from(values || []);
    },
    rootIdsWithin(values) {
      return Array.from(values || []).map((root) => root.id);
    },
    invalidateRoots(values) {
      calls.push(`invalidate:${values.map((root) => root.id).join(',')}`);
      return values.length;
    },
    releaseRoots(values) {
      calls.push(`release:${Array.from(values || []).map((root) => root.id).join(',')}`);
      return Array.from(values || []).length;
    },
    refreshRoots(values, options) {
      calls.push(`refresh:${values.map((root) => root.id).join(',')}:${options.alreadyInvalidated}`);
      return values.length;
    }
  };
  const runtime = {
    epoch: 4,
    discovery,
    pendingChangedRoots: new Set(),
    rendererRootsByContentRoot: new Map([
      ['changed-root', new Set(['changed-root:w0'])],
      ['detached-root', new Set(['detached-root:w0'])]
    ])
  };
  const renderer = {
    removeRoot(rootId) {
      calls.push(`remove:${rootId}`);
      if (rootId === 'changed-root:w0') throw new Error('renderer cleanup failed');
      return { action: 'removed' };
    }
  };

  assert.doesNotThrow(() => Content.invalidateRuntimeRoots(runtime, renderer, [changedRoot], [detachedRoot], {
    onError: (error, metadata) => errors.push([error.message, metadata.phase, metadata.rootId])
  }));

  assert.deepEqual(calls, [
    'invalidate:changed-root',
    'remove:changed-root:w0',
    'remove:detached-root:w0',
    'release:detached-root'
  ]);
  assert.deepEqual(errors, [['renderer cleanup failed', 'renderer-root-cleanup', 'changed-root:w0']]);
  assert.deepEqual([...runtime.pendingChangedRoots], [changedRoot]);
  assert.equal(runtime.rendererRootsByContentRoot.size, 0);

  assert.equal(Content.refreshInvalidatedRuntimeRoots(runtime, []), 1);
  assert.deepEqual(calls.at(-1), 'refresh:changed-root:true');
  assert.equal(runtime.pendingChangedRoots.size, 0);
});

test('runtime teardown detaches first and attempts every cleanup stage after independent failures', () => {
  for (const failingStage of ['cancel-epoch', 'renderer-cleanup', 'discovery-disconnect']) {
    const calls = [];
    const errors = [];
    const runtime = {
      epoch: 7,
      scheduler: {
        cancelEpoch(epoch) {
          calls.push(`cancel:${epoch}`);
          if (failingStage === 'cancel-epoch') throw new Error('cancel failed');
        }
      },
      discovery: {
        disconnect() {
          calls.push('disconnect');
          if (failingStage === 'discovery-disconnect') throw new Error('disconnect failed');
        }
      }
    };
    let activeRuntime = runtime;

    const result = Content.cleanupRuntime(runtime, {
      epoch: 7,
      detach: () => {
        calls.push('detach');
        activeRuntime = null;
      },
      suppressRendererMutations: (callback) => {
        calls.push('suppress');
        return callback();
      },
      rendererCleanup: () => {
        calls.push('renderer');
        if (failingStage === 'renderer-cleanup') throw new Error('renderer failed');
      },
      onError: (error, metadata) => errors.push([error.message, metadata.phase])
    });

    assert.equal(result, null, failingStage);
    assert.equal(activeRuntime, null, failingStage);
    assert.deepEqual(calls.filter((call) => !call.startsWith('error:')), [
      'detach', 'cancel:7', 'suppress', 'renderer', 'disconnect'
    ], failingStage);
    assert.equal(errors.length, 1, failingStage);
    assert.equal(errors[0][1], failingStage, failingStage);
  }
});
