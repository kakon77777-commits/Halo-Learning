(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDynamicDomController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const CLEANUP_STAGE_CODES = Object.freeze([
    'debounce-timer', 'hashchange-listener', 'max-wait-timer',
    'observer-disconnect', 'observer-records', 'popstate-listener',
    'push-state-hook', 'replace-state-hook'
  ]);

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
    const operations = [];

    function trackNode(node) {
      return node;
    }

    function expect(operation) {
      if (!operation || !['childList', 'characterData', 'attributes'].includes(operation.type) || !operation.target) {
        throw new TypeError('renderer mutation operation: must have a supported type and target');
      }
      operations.push({
        ...operation,
        addedNodes: Array.from(operation.addedNodes || []),
        removedNodes: Array.from(operation.removedNodes || [])
      });
      return operation;
    }

    function matchingOperationIndex(record) {
      return operations.findIndex((operation) => {
        if (operation.type !== record.type || operation.target !== record.target) return false;
        if (record.type === 'attributes' && operation.attributeName !== record.attributeName) return false;
        if (Object.prototype.hasOwnProperty.call(operation, 'oldValue') && operation.oldValue !== record.oldValue) return false;
        return true;
      });
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

    function sanitize(record) {
      if (!record) return null;
      if (record.type === 'characterData' || record.type === 'attributes') {
        const operationIndex = matchingOperationIndex(record);
        if (operationIndex < 0) return record;
        operations.splice(operationIndex, 1);
        return null;
      }
      if (record.type !== 'childList') return record;
      let addedNodes = Array.from(record.addedNodes || []);
      let removedNodes = Array.from(record.removedNodes || []);
      let consumed = false;
      while (true) {
        const operationIndex = operations.findIndex((operation) =>
          operation.type === 'childList' && operation.target === record.target &&
          containsNodeMultiset(addedNodes, operation.addedNodes) &&
          containsNodeMultiset(removedNodes, operation.removedNodes)
        );
        if (operationIndex < 0) break;
        const [operation] = operations.splice(operationIndex, 1);
        addedNodes = subtractNodeMultiset(addedNodes, operation.addedNodes);
        removedNodes = subtractNodeMultiset(removedNodes, operation.removedNodes);
        consumed = true;
      }
      if (!consumed) return record;
      if (!addedNodes.length && !removedNodes.length) return null;
      return {
        type: record.type,
        target: record.target,
        addedNodes,
        removedNodes
      };
    }

    function status() {
      return Object.freeze({ pendingOperations: operations.length });
    }

    return Object.freeze({ trackNode, expect, sanitize, status });
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
    const onMutationsObserved = typeof settings.onMutationsObserved === 'function'
      ? settings.onMutationsObserved
      : () => {};
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
    let policyOnly = settings.policyOnly === true;
    let cleanupStarted = false;
    let cleanupInProgress = false;
    let finalCleanupNotified = false;
    let cleaned = false;
    let popstateListenerInstalled = false;
    let hashchangeListenerInstalled = false;
    let observedUrl = location && location.href ? String(location.href) : '';
    let originalPushState = null;
    let originalReplaceState = null;
    let pushStateWrapper = null;
    let replaceStateWrapper = null;
    let pushStateHookInstalled = false;
    let replaceStateHookInstalled = false;
    let observerRecordsPending = false;
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
      if (cleanupStarted || suppressionDepth || !records.length) return;
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
      if (cleanupStarted) return;
      const retained = Array.from(records || []).map((record) =>
        filterRendererRecords ? sanitizeRendererRecord(record) : record
      ).filter(Boolean);
      if (!retained.length) return;
      try {
        onMutationsObserved(Object.freeze(retained), Object.freeze({ epoch }));
      } catch (error) {
        reportError(error, 'mutation-policy', { epoch });
      }
      if (policyOnly) return;
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
      if (cleanupStarted) return;
      if (eventTarget && typeof eventTarget.addEventListener === 'function') {
        if (!popstateListenerInstalled) {
          eventTarget.addEventListener('popstate', navigationEvent);
          popstateListenerInstalled = true;
        }
        if (!hashchangeListenerInstalled) {
          eventTarget.addEventListener('hashchange', navigationEvent);
          hashchangeListenerInstalled = true;
        }
      }
      if (!history) return;
      if (!pushStateHookInstalled && !pushStateWrapper && typeof history.pushState === 'function') {
        originalPushState = history.pushState;
        pushStateWrapper = function (...args) {
          const previousUrl = currentUrl();
          const result = originalPushState.apply(this, args);
          routeChanged(previousUrl, currentUrl());
          return result;
        };
        try {
          history.pushState = pushStateWrapper;
          if (history.pushState !== pushStateWrapper) throw new Error('pushState hook installation was not retained');
          pushStateHookInstalled = true;
        } catch (error) {
          try { pushStateHookInstalled = history.pushState === pushStateWrapper; } catch (_readError) {}
          throw error;
        }
      }
      if (!replaceStateHookInstalled && !replaceStateWrapper && typeof history.replaceState === 'function') {
        originalReplaceState = history.replaceState;
        replaceStateWrapper = function (...args) {
          const previousUrl = currentUrl();
          const result = originalReplaceState.apply(this, args);
          routeChanged(previousUrl, currentUrl());
          return result;
        };
        try {
          history.replaceState = replaceStateWrapper;
          if (history.replaceState !== replaceStateWrapper) throw new Error('replaceState hook installation was not retained');
          replaceStateHookInstalled = true;
        } catch (error) {
          try { replaceStateHookInstalled = history.replaceState === replaceStateWrapper; } catch (_readError) {}
          throw error;
        }
      }
    }

    function restoreHooks(metadata) {
      if (popstateListenerInstalled) {
        try {
          if (!eventTarget || typeof eventTarget.removeEventListener !== 'function') {
            throw new TypeError('popstate listener removal is unavailable');
          }
          eventTarget.removeEventListener('popstate', navigationEvent);
          popstateListenerInstalled = false;
        } catch (error) {
          reportError(error, 'cleanup-popstate-listener', metadata);
        }
      }
      if (hashchangeListenerInstalled) {
        try {
          if (!eventTarget || typeof eventTarget.removeEventListener !== 'function') {
            throw new TypeError('hashchange listener removal is unavailable');
          }
          eventTarget.removeEventListener('hashchange', navigationEvent);
          hashchangeListenerInstalled = false;
        } catch (error) {
          reportError(error, 'cleanup-hashchange-listener', metadata);
        }
      }
      if (pushStateHookInstalled) {
        try {
          if (!history) throw new TypeError('pushState restoration is unavailable');
          if (history.pushState === pushStateWrapper) {
            history.pushState = originalPushState;
            if (history.pushState !== originalPushState) throw new Error('pushState restoration was not retained');
          }
          pushStateHookInstalled = false;
          originalPushState = null;
          pushStateWrapper = null;
        } catch (error) {
          reportError(error, 'cleanup-push-state-hook', metadata);
        }
      } else if (pushStateWrapper) {
        originalPushState = null;
        pushStateWrapper = null;
      }
      if (replaceStateHookInstalled) {
        try {
          if (!history) throw new TypeError('replaceState restoration is unavailable');
          if (history.replaceState === replaceStateWrapper) {
            history.replaceState = originalReplaceState;
            if (history.replaceState !== originalReplaceState) throw new Error('replaceState restoration was not retained');
          }
          replaceStateHookInstalled = false;
          originalReplaceState = null;
          replaceStateWrapper = null;
        } catch (error) {
          reportError(error, 'cleanup-replace-state-hook', metadata);
        }
      } else if (replaceStateWrapper) {
        originalReplaceState = null;
        replaceStateWrapper = null;
      }
    }

    function startObservation() {
      if (!documentRef || observing || cleanupStarted) return;
      const securityAttributes = [
        'type', 'autocomplete', 'inputmode', 'name', 'role',
        'data-private', 'data-sensitive', 'data-1p-ignore', 'data-bwignore'
      ];
      const fullAttributes = [
        'class', 'title',
        ...securityAttributes,
        'data-halo-owned', 'data-halo-run', 'data-halo-root', 'data-halo-original',
        'data-halo-node', 'data-halo-start', 'data-halo-end', 'data-halo-index',
        'data-halo-boundary', 'data-halo-revision', 'data-halo-carrier',
        'data-halo-pos', 'data-halo-meta', 'data-halo-gloss', 'data-halo-confidence'
      ];
      observer.observe(documentRef.body || documentRef.documentElement || documentRef, {
        subtree: true,
        childList: true,
        characterData: !policyOnly,
        characterDataOldValue: !policyOnly,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: policyOnly ? securityAttributes : fullAttributes
      });
      observing = true;
    }

    function stopObservation() {
      if (observing) {
        observer.disconnect();
        observing = false;
        observerRecordsPending = true;
      }
      if (observerRecordsPending) {
        observer.takeRecords();
        observerRecordsPending = false;
      }
    }

    function observe(document) {
      if (!document || cleanupStarted) return false;
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
      if (cleanupStarted) return;
      const token = ++routeStartToken;
      pendingRouteStart = metadata;
      const firstTurn = () => {
        if (cleanupStarted || token !== routeStartToken) return;
        const mutationTurn = () => {
          if (cleanupStarted || token !== routeStartToken) return;
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
      if (cleanupStarted) {
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
      if (cleanupStarted) return epoch;
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

    function setPolicyOnly(value) {
      const next = value === true;
      if (cleanupStarted || next === policyOnly) return false;
      policyOnly = next;
      clearPending();
      stopObservation();
      startObservation();
      return true;
    }

    function routeEpoch() {
      return epoch;
    }

    function cleanupStatus() {
      const pending = new Set();
      if (debounceHandle !== null) pending.add('debounce-timer');
      if (hashchangeListenerInstalled) pending.add('hashchange-listener');
      if (maxWaitHandle !== null) pending.add('max-wait-timer');
      if (observing) pending.add('observer-disconnect');
      if (observerRecordsPending) pending.add('observer-records');
      if (popstateListenerInstalled) pending.add('popstate-listener');
      if (pushStateHookInstalled) pending.add('push-state-hook');
      if (replaceStateHookInstalled) pending.add('replace-state-hook');
      const pendingStages = Object.freeze(CLEANUP_STAGE_CODES.filter((stage) => pending.has(stage)));
      return Object.freeze({
        schemaVersion: 1,
        cleanupStarted,
        cleaned,
        cleanupPending: cleanupStarted && !cleaned,
        pendingStages
      });
    }

    function cancelCleanupTimer(name, metadata) {
      const handle = name === 'debounce-timer' ? debounceHandle : maxWaitHandle;
      if (handle === null) return;
      try {
        cancelTimeout(handle);
        if (name === 'debounce-timer') debounceHandle = null;
        else maxWaitHandle = null;
      } catch (error) {
        reportError(error, `cleanup-${name}`, metadata);
      }
    }

    function cleanupObservation(metadata) {
      if (observing) {
        try {
          observer.disconnect();
          observing = false;
          observerRecordsPending = true;
        } catch (error) {
          reportError(error, 'cleanup-observer', metadata);
        }
      }
      if (observing || observerRecordsPending) {
        try {
          observer.takeRecords();
          if (!observing) observerRecordsPending = false;
        } catch (error) {
          observerRecordsPending = true;
          reportError(error, 'cleanup-observer-records', metadata);
        }
      }
    }

    function cleanup() {
      if (cleaned || cleanupInProgress) return cleanupStatus();
      cleanupStarted = true;
      cleanupInProgress = true;
      const metadata = Object.freeze({ epoch, previousUrl: observedUrl, nextUrl: null, reason: 'cleanup' });
      try {
        cancelPendingRouteStart();
        queuedTransition = null;
        cancelCleanupTimer('debounce-timer', metadata);
        cancelCleanupTimer('max-wait-timer', metadata);
        pendingRecords = [];
        if (!finalCleanupNotified) {
          finalCleanupNotified = true;
          invokeLifecycle(onRouteCleanup, metadata, 'cleanup');
        }
        cleanupObservation(metadata);
        restoreHooks(metadata);
        transitioning = false;
        const pending = cleanupStatus().pendingStages;
        if (!pending.length) {
          documentRef = null;
          cleaned = true;
        }
      } finally {
        cleanupInProgress = false;
      }
      return cleanupStatus();
    }

    return Object.freeze({
      observe,
      routeChanged,
      suppressRendererMutations,
      setPolicyOnly,
      routeEpoch,
      cleanup,
      status: cleanupStatus
    });
  }

  return Object.freeze({
    classifyMutation,
    coalesceMutations,
    CLEANUP_STAGE_CODES,
    createRendererMutationSanitizer,
    createDynamicDomController
  });
});
