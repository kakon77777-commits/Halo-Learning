(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDynamicDomController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function defaultIsHaloOwned() {
    return false;
  }

  function elementFor(node, fallback) {
    if (node && node.nodeType === 1) return node;
    if (node && node.parentElement) return node.parentElement;
    if (fallback && fallback.nodeType === 1) return fallback;
    return fallback && fallback.parentElement ? fallback.parentElement : null;
  }

  function classifyMutation(record, ownershipPredicate) {
    const isHaloOwned = typeof ownershipPredicate === 'function' ? ownershipPredicate : defaultIsHaloOwned;
    if (!record || !['childList', 'characterData', 'attributes'].includes(record.type)) {
      return Object.freeze({ roots: Object.freeze([]), removedRoots: Object.freeze([]), ignored: true });
    }
    if (isHaloOwned(record.target)) {
      return Object.freeze({ roots: Object.freeze([]), removedRoots: Object.freeze([]), ignored: true });
    }

    if (record.type !== 'childList') {
      const rootElement = elementFor(record.target, null);
      const roots = rootElement && !isHaloOwned(rootElement) ? [rootElement] : [];
      return Object.freeze({
        roots: Object.freeze(roots),
        removedRoots: Object.freeze([]),
        ignored: roots.length === 0
      });
    }

    const addedNodes = Array.from(record.addedNodes || []);
    const removedNodes = Array.from(record.removedNodes || []);
    const roots = [];
    const removedRoots = [];
    for (const node of addedNodes) {
      if (isHaloOwned(node)) continue;
      const rootElement = elementFor(node, record.target);
      if (rootElement && !isHaloOwned(rootElement)) roots.push(rootElement);
    }
    if (!roots.length && removedNodes.length) {
      const target = elementFor(record.target, null);
      if (target && !isHaloOwned(target)) roots.push(target);
    }
    for (const node of removedNodes) {
      if (!node || node.nodeType !== 1 || isHaloOwned(node)) continue;
      removedRoots.push(node);
    }
    return Object.freeze({
      roots: Object.freeze(roots),
      removedRoots: Object.freeze(removedRoots),
      ignored: roots.length === 0 && removedRoots.length === 0
    });
  }

  function contains(ancestor, candidate) {
    if (ancestor === candidate) return true;
    if (ancestor && typeof ancestor.contains === 'function') return ancestor.contains(candidate);
    for (let current = candidate && candidate.parentElement; current; current = current.parentElement) {
      if (current === ancestor) return true;
    }
    return false;
  }

  function coalesceMutations(records, ownershipPredicate) {
    const roots = [];
    const removedRoots = [];
    function addCoalesced(values, candidate) {
      if (!candidate || values.some((current) => contains(current, candidate))) return;
      for (let index = values.length - 1; index >= 0; index -= 1) {
        if (contains(candidate, values[index])) values.splice(index, 1);
      }
      values.push(candidate);
    }
    for (const record of Array.from(records || [])) {
      const classified = classifyMutation(record, ownershipPredicate);
      for (const candidate of classified.roots) addCoalesced(roots, candidate);
      for (const candidate of classified.removedRoots) addCoalesced(removedRoots, candidate);
    }
    return Object.freeze({ roots: Object.freeze(roots), removedRoots: Object.freeze(removedRoots) });
  }

  function createRendererMutationSanitizer() {
    const privateNodes = new Set();
    const operations = [];

    function trackNode(node) {
      if (node) privateNodes.add(node);
      return node;
    }

    function expect(operation) {
      if (!operation || !['childList', 'characterData', 'attributes'].includes(operation.type) || !operation.target) {
        throw new TypeError('renderer mutation operation: must have a supported type and target');
      }
      operations.push({
        ...operation,
        addedNodes: Array.from(operation.addedNodes || []),
        removedNodes: Array.from(operation.removedNodes || []),
        consumed: false
      });
      return operation;
    }

    function matchingOperation(record) {
      return operations.find((operation) => {
        if (operation.consumed || operation.type !== record.type || operation.target !== record.target) return false;
        if (record.type === 'attributes' && operation.attributeName !== record.attributeName) return false;
        if (Object.prototype.hasOwnProperty.call(operation, 'oldValue') && operation.oldValue !== record.oldValue) return false;
        return true;
      }) || null;
    }

    function containsNodeMultiset(values, expected) {
      const remaining = Array.from(values || []);
      for (const node of Array.from(expected || [])) {
        const index = remaining.indexOf(node);
        if (index < 0) return false;
        remaining.splice(index, 1);
      }
      return true;
    }

    function subtractNodeMultiset(values, expected) {
      const remaining = Array.from(values || []);
      for (const node of Array.from(expected || [])) {
        const index = remaining.indexOf(node);
        if (index >= 0) remaining.splice(index, 1);
      }
      return remaining;
    }

    function discardConsumedOperations() {
      for (let index = operations.length - 1; index >= 0; index -= 1) {
        if (operations[index].consumed) operations.splice(index, 1);
      }
    }

    function sanitize(record) {
      if (!record) return null;
      if (record.type === 'characterData' || record.type === 'attributes') {
        const operation = matchingOperation(record);
        if (!operation) return record;
        operation.consumed = true;
        discardConsumedOperations();
        return null;
      }
      if (record.type !== 'childList') return record;
      const matching = operations.filter((operation) =>
        !operation.consumed && operation.type === 'childList' && operation.target === record.target
      );
      const originalAdded = Array.from(record.addedNodes || []);
      const originalRemoved = Array.from(record.removedNodes || []);
      let addedNodes = originalAdded;
      let removedNodes = originalRemoved;
      const complete = [];
      for (const operation of matching) {
        const hasCompleteAdded = containsNodeMultiset(addedNodes, operation.addedNodes);
        const hasCompleteRemoved = containsNodeMultiset(removedNodes, operation.removedNodes);
        const overlaps = operation.addedNodes.some((node) => originalAdded.includes(node)) ||
          operation.removedNodes.some((node) => originalRemoved.includes(node));
        if (!hasCompleteAdded || !hasCompleteRemoved) {
          if (overlaps) return record;
          continue;
        }
        addedNodes = subtractNodeMultiset(addedNodes, operation.addedNodes);
        removedNodes = subtractNodeMultiset(removedNodes, operation.removedNodes);
        complete.push(operation);
      }
      for (const operation of complete) {
        operation.consumed = true;
        for (const node of [...operation.addedNodes, ...operation.removedNodes]) privateNodes.delete(node);
      }
      discardConsumedOperations();
      const pendingNodes = new Set();
      for (const operation of operations) {
        if (operation.consumed || operation.type !== 'childList') continue;
        for (const node of [...operation.addedNodes, ...operation.removedNodes]) pendingNodes.add(node);
      }
      addedNodes = addedNodes.filter((node) => !privateNodes.has(node) || pendingNodes.has(node));
      removedNodes = removedNodes.filter((node) => !privateNodes.has(node) || pendingNodes.has(node));
      if (!addedNodes.length && !removedNodes.length) return null;
      return {
        type: record.type,
        target: record.target,
        addedNodes,
        removedNodes
      };
    }

    return Object.freeze({ trackNode, expect, sanitize });
  }

  function createDynamicDomController(options) {
    const settings = options || {};
    const MutationObserverClass = settings.MutationObserver || root.MutationObserver;
    if (typeof MutationObserverClass !== 'function') throw new TypeError('MutationObserver: must be a function');
    const debounceMs = Math.max(0, Number.isFinite(Number(settings.debounceMs)) ? Number(settings.debounceMs) : 80);
    const maxWaitMs = Math.max(debounceMs, Number.isFinite(Number(settings.maxWaitMs)) ? Number(settings.maxWaitMs) : 250);
    const scheduleTimeout = typeof settings.setTimeout === 'function'
      ? settings.setTimeout
      : root.setTimeout.bind(root);
    const cancelTimeout = typeof settings.clearTimeout === 'function'
      ? settings.clearTimeout
      : root.clearTimeout.bind(root);
    const deferMicrotask = typeof settings.queueMicrotask === 'function'
      ? settings.queueMicrotask
      : (typeof root.queueMicrotask === 'function'
          ? root.queueMicrotask.bind(root)
          : (callback) => Promise.resolve().then(callback));
    const isHaloOwned = typeof settings.isHaloOwned === 'function' ? settings.isHaloOwned : defaultIsHaloOwned;
    const scopedRendererSanitizer = typeof settings.sanitizeRendererRecord === 'function'
      ? settings.sanitizeRendererRecord
      : null;
    const onRootsInvalidated = typeof settings.onRootsInvalidated === 'function'
      ? settings.onRootsInvalidated
      : () => {};
    const onRootsChanged = typeof settings.onRootsChanged === 'function' ? settings.onRootsChanged : () => {};
    const onRouteCleanup = typeof settings.onRouteCleanup === 'function' ? settings.onRouteCleanup : () => {};
    const onRouteStart = typeof settings.onRouteStart === 'function' ? settings.onRouteStart : () => {};
    const onError = typeof settings.onError === 'function' ? settings.onError : null;
    const history = settings.history || root.history || null;
    const location = settings.location || root.location || null;
    const eventTarget = settings.eventTarget || root;

    let epoch = 1;
    let documentRef = null;
    let debounceHandle = null;
    let maxWaitHandle = null;
    let pendingRecords = [];
    let suppressionDepth = 0;
    let observing = false;
    let cleaned = false;
    let hooksInstalled = false;
    let observedUrl = location && location.href ? String(location.href) : '';
    let originalPushState = null;
    let originalReplaceState = null;
    let pushStateWrapper = null;
    let replaceStateWrapper = null;
    let transitioning = false;
    let queuedTransition = null;
    let routeStartToken = 0;
    let pendingRouteStart = null;

    function reportError(error, phase, metadata) {
      const details = Object.freeze({ phase, ...(metadata || {}) });
      if (onError) {
        try {
          onError(error, details);
          return;
        } catch (_hookError) {
          // Error hooks must never escape into native history or cleanup.
        }
      }
      try {
        if (typeof root.reportError === 'function') root.reportError(error);
        else if (root.console && typeof root.console.error === 'function') root.console.error(error);
      } catch (_reportError) {
        // Lifecycle remains usable even when the host's reporter fails.
      }
    }

    function invokeLifecycle(callback, metadata, phase) {
      try {
        const result = callback(metadata);
        if (result && typeof result.then === 'function') {
          result.catch((error) => reportError(error, phase, metadata));
        }
      } catch (error) {
        reportError(error, phase, metadata);
      }
    }

    function clearPending() {
      if (debounceHandle !== null) cancelTimeout(debounceHandle);
      if (maxWaitHandle !== null) cancelTimeout(maxWaitHandle);
      debounceHandle = null;
      maxWaitHandle = null;
      pendingRecords = [];
    }

    function flushMutations() {
      if (debounceHandle !== null) cancelTimeout(debounceHandle);
      if (maxWaitHandle !== null) cancelTimeout(maxWaitHandle);
      debounceHandle = null;
      maxWaitHandle = null;
      const records = pendingRecords;
      pendingRecords = [];
      if (cleaned || suppressionDepth || !records.length) return;
      const result = coalesceMutations(records, isHaloOwned);
      if (result.roots.length || result.removedRoots.length) {
        onRootsChanged(result.roots, Object.freeze({
          epoch,
          removedRoots: result.removedRoots
        }));
      }
    }

    function sanitizeRendererRecord(record) {
      if (scopedRendererSanitizer) return scopedRendererSanitizer(record);
      if (!record || isHaloOwned(record.target)) return null;
      if (record.type !== 'childList') return record;
      const addedNodes = Array.from(record.addedNodes || []).filter((node) => !isHaloOwned(node));
      const removedNodes = Array.from(record.removedNodes || []).filter((node) => !isHaloOwned(node));
      if (!addedNodes.length && !removedNodes.length) return null;
      return {
        type: record.type,
        target: record.target,
        addedNodes,
        removedNodes
      };
    }

    function queueMutationRecords(records, filterRendererRecords) {
      if (cleaned) return;
      const retained = Array.from(records || []).map((record) =>
        filterRendererRecords ? sanitizeRendererRecord(record) : record
      ).filter(Boolean);
      if (!retained.length) return;
      const invalidated = coalesceMutations(retained, isHaloOwned);
      if (invalidated.roots.length || invalidated.removedRoots.length) {
        try {
          onRootsInvalidated(invalidated.roots, Object.freeze({
            epoch,
            removedRoots: invalidated.removedRoots
          }));
        } catch (error) {
          reportError(error, 'root-invalidation', { epoch });
        }
      }
      if (pendingRouteStart) return;
      pendingRecords.push(...retained);
      if (debounceHandle !== null) cancelTimeout(debounceHandle);
      debounceHandle = scheduleTimeout(flushMutations, debounceMs);
      if (maxWaitHandle === null) maxWaitHandle = scheduleTimeout(flushMutations, maxWaitMs);
    }

    function mutationObserved(records) {
      queueMutationRecords(records, suppressionDepth > 0);
    }

    const observer = new MutationObserverClass(mutationObserved);

    function currentUrl() {
      return location && location.href ? String(location.href) : observedUrl;
    }

    function navigationEvent() {
      routeChanged(observedUrl, currentUrl());
    }

    function installHooks() {
      if (hooksInstalled || cleaned) return;
      hooksInstalled = true;
      if (eventTarget && typeof eventTarget.addEventListener === 'function') {
        eventTarget.addEventListener('popstate', navigationEvent);
        eventTarget.addEventListener('hashchange', navigationEvent);
      }
      if (!history) return;
      if (typeof history.pushState === 'function') {
        originalPushState = history.pushState;
        pushStateWrapper = function (...args) {
          const previousUrl = currentUrl();
          const result = originalPushState.apply(this, args);
          routeChanged(previousUrl, currentUrl());
          return result;
        };
        history.pushState = pushStateWrapper;
      }
      if (typeof history.replaceState === 'function') {
        originalReplaceState = history.replaceState;
        replaceStateWrapper = function (...args) {
          const previousUrl = currentUrl();
          const result = originalReplaceState.apply(this, args);
          routeChanged(previousUrl, currentUrl());
          return result;
        };
        history.replaceState = replaceStateWrapper;
      }
    }

    function restoreHooks() {
      if (!hooksInstalled) return;
      hooksInstalled = false;
      if (eventTarget && typeof eventTarget.removeEventListener === 'function') {
        eventTarget.removeEventListener('popstate', navigationEvent);
        eventTarget.removeEventListener('hashchange', navigationEvent);
      }
      if (history) {
        if (pushStateWrapper && history.pushState === pushStateWrapper) history.pushState = originalPushState;
        if (replaceStateWrapper && history.replaceState === replaceStateWrapper) history.replaceState = originalReplaceState;
      }
      originalPushState = null;
      originalReplaceState = null;
      pushStateWrapper = null;
      replaceStateWrapper = null;
    }

    function startObservation() {
      if (!documentRef || observing || cleaned) return;
      observer.observe(documentRef.body || documentRef.documentElement || documentRef, {
        subtree: true,
        childList: true,
        characterData: true,
        characterDataOldValue: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: [
          'class', 'title',
          'data-halo-owned', 'data-halo-run', 'data-halo-root', 'data-halo-original',
          'data-halo-node', 'data-halo-start', 'data-halo-end', 'data-halo-index',
          'data-halo-boundary', 'data-halo-revision', 'data-halo-carrier',
          'data-halo-pos', 'data-halo-meta', 'data-halo-gloss', 'data-halo-confidence'
        ]
      });
      observing = true;
    }

    function stopObservation() {
      if (!observing) return;
      try {
        observer.disconnect();
      } finally {
        try {
          observer.takeRecords();
        } finally {
          observing = false;
        }
      }
    }

    function observe(document) {
      if (!document || cleaned) return false;
      if (documentRef === document && observing) return false;
      stopObservation();
      documentRef = document;
      installHooks();
      startObservation();
      return true;
    }

    function cancelPendingRouteStart() {
      routeStartToken += 1;
      pendingRouteStart = null;
    }

    function deferRouteStart(metadata) {
      if (cleaned) return;
      const token = ++routeStartToken;
      pendingRouteStart = metadata;
      const firstTurn = () => {
        if (cleaned || token !== routeStartToken) return;
        const mutationTurn = () => {
          if (cleaned || token !== routeStartToken) return;
          pendingRouteStart = null;
          invokeLifecycle(onRouteStart, metadata, 'route-start');
        };
        try {
          deferMicrotask(mutationTurn);
        } catch (error) {
          pendingRouteStart = null;
          reportError(error, 'route-start-schedule', metadata);
        }
      };
      try {
        deferMicrotask(firstTurn);
      } catch (error) {
        pendingRouteStart = null;
        reportError(error, 'route-start-schedule', metadata);
      }
    }

    function performRouteTransition(previous, next) {
      cancelPendingRouteStart();
      clearPending();
      const oldEpoch = epoch;
      epoch += 1;
      observedUrl = next;
      const cleanupMetadata = Object.freeze({ epoch: oldEpoch, previousUrl: previous, nextUrl: next });
      const startMetadata = Object.freeze({ epoch, previousUrl: previous, nextUrl: next });
      transitioning = true;
      try {
        invokeLifecycle(onRouteCleanup, cleanupMetadata, 'route-cleanup');
      } finally {
        clearPending();
        try {
          stopObservation();
        } catch (error) {
          reportError(error, 'route-observer-stop', cleanupMetadata);
        }
        try {
          startObservation();
        } catch (error) {
          reportError(error, 'route-observer-start', startMetadata);
        }
        transitioning = false;
      }
      if (cleaned) {
        queuedTransition = null;
        cancelPendingRouteStart();
        return;
      }
      if (queuedTransition) {
        const queued = queuedTransition;
        queuedTransition = null;
        if (queued.nextUrl !== observedUrl) performRouteTransition(observedUrl, queued.nextUrl);
      } else {
        deferRouteStart(startMetadata);
      }
    }

    function routeChanged(previousUrl, nextUrl) {
      if (cleaned) return epoch;
      const previous = previousUrl === undefined || previousUrl === null ? observedUrl : String(previousUrl);
      const next = nextUrl === undefined || nextUrl === null ? currentUrl() : String(nextUrl);
      if (previous === next || observedUrl === next || (queuedTransition && queuedTransition.nextUrl === next)) {
        return epoch;
      }
      if (transitioning) {
        queuedTransition = { previousUrl: observedUrl, nextUrl: next };
        return epoch;
      }
      performRouteTransition(previous, next);
      return epoch;
    }

    function suppressRendererMutations(callback) {
      if (typeof callback !== 'function') throw new TypeError('callback: must be a function');
      queueMutationRecords(observer.takeRecords(), true);
      suppressionDepth += 1;
      try {
        return callback();
      } finally {
        suppressionDepth -= 1;
        queueMutationRecords(observer.takeRecords(), true);
      }
    }

    function routeEpoch() {
      return epoch;
    }

    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      cancelPendingRouteStart();
      queuedTransition = null;
      clearPending();
      const metadata = Object.freeze({ epoch, previousUrl: observedUrl, nextUrl: null, reason: 'cleanup' });
      try {
        invokeLifecycle(onRouteCleanup, metadata, 'cleanup');
      } finally {
        try {
          stopObservation();
        } catch (error) {
          reportError(error, 'cleanup-observer', metadata);
        }
        try {
          restoreHooks();
        } catch (error) {
          reportError(error, 'cleanup-hooks', metadata);
        }
        documentRef = null;
        transitioning = false;
      }
    }

    return Object.freeze({
      observe,
      routeChanged,
      suppressRendererMutations,
      routeEpoch,
      cleanup
    });
  }

  return Object.freeze({
    classifyMutation,
    coalesceMutations,
    createRendererMutationSanitizer,
    createDynamicDomController
  });
});
