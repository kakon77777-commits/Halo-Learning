(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloRuntimeScheduler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const DEFAULT_BUDGETS = Object.freeze({
    maxTextNodes: 24,
    maxCharacters: 12000,
    maxSentences: 24,
    maxSemanticTokens: 600,
    maxShardIds: 24,
    timeSliceMs: 8,
    maxQueuedRoots: 200,
    viewportBufferPx: 1200
  });
  const PRIORITY = Object.freeze({ background: 0, inferred: 1, explicit: 2 });

  function boundedInteger(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.round(number)));
  }

  function normalizeBudgets(input) {
    const raw = input && typeof input === 'object' ? input : {};
    const normalized = {};
    for (const name of [
      'maxTextNodes', 'maxCharacters', 'maxSentences', 'maxSemanticTokens',
      'maxShardIds', 'timeSliceMs', 'maxQueuedRoots'
    ]) {
      normalized[name] = boundedInteger(raw[name], DEFAULT_BUDGETS[name], 1, DEFAULT_BUDGETS[name]);
    }
    normalized.viewportBufferPx = boundedInteger(
      raw.viewportBufferPx,
      DEFAULT_BUDGETS.viewportBufferPx,
      0,
      DEFAULT_BUDGETS.viewportBufferPx
    );
    return Object.freeze(normalized);
  }

  function metric(value, fallback) {
    return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  }

  function estimatedTokens(text) {
    const source = String(text || '');
    let count = 0;
    for (const _match of source.matchAll(/\p{Script=Han}|[\p{Script=Latin}\p{M}]+(?:['’][\p{Script=Latin}\p{M}]+)*/gu)) {
      count += 1;
    }
    return count;
  }

  function normalizeWork(raw, sequence) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('work: must be an object');
    const id = raw.id === undefined || raw.id === null ? '' : String(raw.id);
    const rootId = raw.rootId === undefined || raw.rootId === null ? id : String(raw.rootId);
    if (!id || !rootId) throw new TypeError('work.id and work.rootId: are required');
    if (!Number.isSafeInteger(raw.epoch) || raw.epoch < 1) throw new TypeError('work.epoch: must be a positive integer');
    const priority = Object.hasOwn(PRIORITY, raw.priority) ? raw.priority : 'background';
    const text = typeof raw.text === 'string' ? raw.text : '';
    const sentenceCount = Array.isArray(raw.sentences) ? raw.sentences.length : metric(raw.sentences, 1);
    const shardIds = new Set(raw.shardIds instanceof Set ? raw.shardIds : (Array.isArray(raw.shardIds) ? raw.shardIds : []));
    for (const shardId of shardIds) {
      if (typeof shardId !== 'string' || !shardId) throw new TypeError('work.shardIds: must contain non-empty strings');
    }
    return {
      ...raw,
      id,
      rootId,
      epoch: raw.epoch,
      priority,
      visible: Boolean(raw.visible),
      stale: Boolean(raw.stale),
      textNodes: metric(raw.textNodes, 1),
      characters: metric(raw.characters, text.length),
      sentences: sentenceCount,
      semanticTokens: metric(raw.semanticTokens, estimatedTokens(text)),
      shardIds,
      sequence
    };
  }

  function createRuntimeScheduler(options) {
    const settings = options || {};
    const budgets = normalizeBudgets(settings.budgets);
    const now = settings.clock && typeof settings.clock.now === 'function'
      ? () => settings.clock.now()
      : () => root.performance && typeof root.performance.now === 'function' ? root.performance.now() : Date.now();
    const requestIdle = typeof settings.requestIdleCallback === 'function'
      ? settings.requestIdleCallback
      : (typeof root.requestIdleCallback === 'function' ? root.requestIdleCallback.bind(root) : null);
    const cancelIdle = typeof settings.cancelIdleCallback === 'function'
      ? settings.cancelIdleCallback
      : (typeof root.cancelIdleCallback === 'function' ? root.cancelIdleCallback.bind(root) : null);
    const scheduleTimeout = typeof settings.setTimeout === 'function'
      ? settings.setTimeout
      : root.setTimeout.bind(root);
    const cancelTimeout = typeof settings.clearTimeout === 'function'
      ? settings.clearTimeout
      : root.clearTimeout.bind(root);
    const AbortControllerClass = settings.AbortController || root.AbortController;
    const processBatch = typeof settings.processBatch === 'function' ? settings.processBatch : async (batch) => batch;
    const onError = typeof settings.onError === 'function' ? settings.onError : () => {};
    const onQuarantine = typeof settings.onQuarantine === 'function' ? settings.onQuarantine : () => {};
    const idleTimeout = boundedInteger(settings.idleTimeoutMs, Math.max(32, budgets.timeSliceMs * 4), budgets.timeSliceMs, 1000);
    const queue = [];
    const quarantinedWork = [];
    const inFlight = new Map();
    const waiters = new Set();
    let sequence = 0;
    let batchSequence = 0;
    let droppedRoots = 0;
    let cancelledRoots = 0;
    let completedBatches = 0;
    let failedBatches = 0;
    let scheduledHandle = null;
    let scheduledKind = null;
    let processing = false;

    function priorityOrder(left, right) {
      return PRIORITY[right.priority] - PRIORITY[left.priority] ||
        Number(right.visible) - Number(left.visible) ||
        Number(left.stale) - Number(right.stale) ||
        right.sequence - left.sequence;
    }

    function evictionOrder(left, right) {
      return Number(left.visible) - Number(right.visible) ||
        Number(right.stale) - Number(left.stale) ||
        PRIORITY[left.priority] - PRIORITY[right.priority] ||
        left.sequence - right.sequence;
    }

    function canEvict(candidate, incoming) {
      if (candidate.priority === 'explicit' && incoming.priority !== 'explicit') return false;
      if (incoming.priority === 'explicit' && candidate.priority !== 'explicit') return true;
      if (!candidate.visible && incoming.visible) return true;
      if (candidate.stale && !incoming.stale) return true;
      return PRIORITY[incoming.priority] >= PRIORITY[candidate.priority] && incoming.sequence > candidate.sequence;
    }

    function queuedRootIds() {
      return [...new Set(queue.map((item) => item.rootId))];
    }

    function queuedRootSummaries() {
      const values = new Map();
      for (const item of queue) {
        const current = values.get(item.rootId);
        if (!current) {
          values.set(item.rootId, {
            rootId: item.rootId,
            priority: item.priority,
            visible: item.visible,
            stale: item.stale,
            sequence: item.sequence
          });
          continue;
        }
        if (PRIORITY[item.priority] > PRIORITY[current.priority]) current.priority = item.priority;
        current.visible = current.visible || item.visible;
        current.stale = current.stale && item.stale;
        current.sequence = Math.min(current.sequence, item.sequence);
      }
      return [...values.values()];
    }

    function oversizedDimensions(item) {
      const dimensions = [];
      if (item.textNodes > budgets.maxTextNodes) dimensions.push('maxTextNodes');
      if (item.characters > budgets.maxCharacters) dimensions.push('maxCharacters');
      if (item.sentences > budgets.maxSentences) dimensions.push('maxSentences');
      if (item.semanticTokens > budgets.maxSemanticTokens) dimensions.push('maxSemanticTokens');
      if (item.shardIds.size > budgets.maxShardIds) dimensions.push('maxShardIds');
      return dimensions;
    }

    function enqueueOne(raw) {
      const item = normalizeWork(raw, ++sequence);
      const dimensions = oversizedDimensions(item);
      if (dimensions.length) {
        const outcome = Object.freeze({
          id: item.id,
          rootId: item.rootId,
          reason: 'WORK_EXCEEDS_BUDGET',
          dimensions: Object.freeze(dimensions)
        });
        if (quarantinedWork.length >= budgets.maxQueuedRoots) quarantinedWork.shift();
        quarantinedWork.push(outcome);
        onQuarantine(outcome);
        return false;
      }
      const existingRoot = queue.some((value) => value.rootId === item.rootId);
      if (!existingRoot && queuedRootIds().length >= budgets.maxQueuedRoots) {
        const candidate = queuedRootSummaries().sort(evictionOrder).find((value) => canEvict(value, item));
        if (!candidate) {
          droppedRoots += 1;
          return false;
        }
        for (let index = queue.length - 1; index >= 0; index -= 1) {
          if (queue[index].rootId === candidate.rootId) queue.splice(index, 1);
        }
        droppedRoots += 1;
      }
      queue.push(item);
      return true;
    }

    function enqueue(raw) {
      if (Array.isArray(raw)) return raw.map(enqueueOne);
      return enqueueOne(raw);
    }

    function peek() {
      return queue.length ? [...queue].sort(priorityOrder)[0] : null;
    }

    function fits(batch, item) {
      if (batch.textNodes + item.textNodes > budgets.maxTextNodes) return false;
      if (batch.characters + item.characters > budgets.maxCharacters) return false;
      if (batch.sentences + item.sentences > budgets.maxSentences) return false;
      if (batch.semanticTokens + item.semanticTokens > budgets.maxSemanticTokens) return false;
      const shards = new Set(batch.shardIds);
      for (const shardId of item.shardIds) shards.add(shardId);
      return shards.size <= budgets.maxShardIds;
    }

    async function nextBatch() {
      const batch = {
        id: `batch-${++batchSequence}`,
        items: [],
        textNodes: 0,
        characters: 0,
        sentences: 0,
        semanticTokens: 0,
        shardIds: new Set()
      };
      const startedAt = now();
      const ordered = [...queue].sort(priorityOrder);
      for (const item of ordered) {
        if (batch.items.length && now() - startedAt >= budgets.timeSliceMs) break;
        if (!fits(batch, item)) continue;
        queue.splice(queue.indexOf(item), 1);
        batch.items.push(item);
        batch.textNodes += item.textNodes;
        batch.characters += item.characters;
        batch.sentences += item.sentences;
        batch.semanticTokens += item.semanticTokens;
        for (const shardId of item.shardIds) batch.shardIds.add(shardId);
      }
      return batch;
    }

    function settleWaiters() {
      if (queue.length || inFlight.size || processing || scheduledHandle !== null) return;
      for (const resolve of waiters) resolve(status());
      waiters.clear();
    }

    async function runSlice() {
      scheduledHandle = null;
      scheduledKind = null;
      if (processing) return;
      processing = true;
      try {
        const batch = await nextBatch();
        if (batch.items.length) {
          if (typeof AbortControllerClass !== 'function') throw new Error('AbortController is unavailable');
          const controller = new AbortControllerClass();
          inFlight.set(batch.id, { batch, controller, cancelledItemIds: new Set() });
          try {
            await processBatch(batch, { signal: controller.signal });
            completedBatches += 1;
          } catch (error) {
            if (!controller.signal.aborted) {
              failedBatches += 1;
              onError(error, batch);
            }
          } finally {
            inFlight.delete(batch.id);
          }
        }
      } finally {
        processing = false;
        if (queue.length) scheduleNext();
        else settleWaiters();
      }
    }

    function scheduleNext() {
      if (scheduledHandle !== null || processing || !queue.length) return;
      if (requestIdle) {
        scheduledKind = 'idle';
        let invoked = false;
        scheduledHandle = true;
        const handle = requestIdle(() => {
          invoked = true;
          scheduledHandle = null;
          runSlice();
        }, { timeout: idleTimeout });
        if (!invoked) scheduledHandle = handle;
      } else {
        scheduledKind = 'timeout';
        let invoked = false;
        scheduledHandle = true;
        const handle = scheduleTimeout(() => {
          invoked = true;
          scheduledHandle = null;
          runSlice();
        }, 0);
        if (!invoked) scheduledHandle = handle;
      }
    }

    function flush() {
      if (!queue.length && !inFlight.size && !processing) return Promise.resolve(status());
      const promise = new Promise((resolve) => waiters.add(resolve));
      scheduleNext();
      return promise;
    }

    function cancelBatch(batchId) {
      const active = inFlight.get(String(batchId));
      if (!active) return false;
      for (const item of active.batch.items) active.cancelledItemIds.add(item.id);
      active.controller.abort();
      return true;
    }

    function cancelMatching(predicate) {
      const cancelledIds = new Set();
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        if (!predicate(queue[index])) continue;
        cancelledIds.add(queue[index].rootId);
        queue.splice(index, 1);
      }
      for (const active of inFlight.values()) {
        const cancelledItems = active.batch.items.filter((item) =>
          !active.cancelledItemIds.has(item.id) && predicate(item));
        if (!cancelledItems.length) continue;
        for (const item of cancelledItems) active.cancelledItemIds.add(item.id);
        active.controller.abort();
        for (const item of cancelledItems) cancelledIds.add(item.rootId);
        for (const item of active.batch.items) {
          if (active.cancelledItemIds.has(item.id) || queue.some((queued) => queued.id === item.id)) continue;
          enqueueOne(item);
        }
      }
      const count = cancelledIds.size;
      cancelledRoots += count;
      settleWaiters();
      return count;
    }

    function cancelRoot(rootId) {
      return cancelMatching((item) => item.rootId === String(rootId));
    }

    function cancelEpoch(epoch) {
      return cancelMatching((item) => item.epoch === epoch);
    }

    function cancelAll() {
      const count = cancelMatching(() => true);
      if (scheduledHandle !== null) {
        if (scheduledKind === 'idle' && cancelIdle) cancelIdle(scheduledHandle);
        if (scheduledKind === 'timeout') cancelTimeout(scheduledHandle);
        scheduledHandle = null;
        scheduledKind = null;
      }
      settleWaiters();
      return count;
    }

    function status() {
      return Object.freeze({
        budgets,
        queuedRoots: queuedRootIds().length,
        queuedRootIds: Object.freeze(queuedRootIds()),
        inFlightBatches: inFlight.size,
        inFlightBatchIds: Object.freeze([...inFlight.keys()]),
        droppedRoots,
        cancelledRoots,
        completedBatches,
        failedBatches,
        oversizedWork: Object.freeze([...quarantinedWork])
      });
    }

    return Object.freeze({
      enqueue,
      peek,
      nextBatch,
      cancelBatch,
      cancelRoot,
      cancelEpoch,
      cancelAll,
      flush,
      status
    });
  }

  return Object.freeze({ DEFAULT_BUDGETS, normalizeBudgets, createRuntimeScheduler });
});
