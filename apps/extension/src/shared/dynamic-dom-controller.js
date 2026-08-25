(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDynamicDomController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function defaultIsHaloOwned(node) {
    const element = node && node.nodeType === 1 ? node : node && (node.parentElement || node.parentNode);
    if (!element) return false;
    if (element.owned === true) return true;
    if (element.dataset && (element.dataset.haloToken === '1' || element.dataset.haloOwned === '1')) return true;
    return typeof element.closest === 'function' &&
      Boolean(element.closest('[data-halo-token="1"], [data-halo-owned="1"]'));
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
    const isHaloOwned = typeof settings.isHaloOwned === 'function' ? settings.isHaloOwned : defaultIsHaloOwned;
    const onRootsChanged = typeof settings.onRootsChanged === 'function' ? settings.onRootsChanged : () => {};
    const onRouteCleanup = typeof settings.onRouteCleanup === 'function' ? settings.onRouteCleanup : () => {};
    const onRouteStart = typeof settings.onRouteStart === 'function' ? settings.onRouteStart : () => {};
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

    function mutationObserved(records) {
      if (cleaned || suppressionDepth) return;
      pendingRecords.push(...Array.from(records || []));
      if (debounceHandle !== null) cancelTimeout(debounceHandle);
      debounceHandle = scheduleTimeout(flushMutations, debounceMs);
      if (maxWaitHandle === null) maxWaitHandle = scheduleTimeout(flushMutations, maxWaitMs);
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
        characterData: true
      });
      observing = true;
    }

    function stopObservation() {
      if (!observing) return;
      observer.disconnect();
      observer.takeRecords();
      observing = false;
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

    function routeChanged(previousUrl, nextUrl) {
      if (cleaned) return epoch;
      const previous = previousUrl === undefined || previousUrl === null ? observedUrl : String(previousUrl);
      const next = nextUrl === undefined || nextUrl === null ? currentUrl() : String(nextUrl);
      if (previous === next || observedUrl === next) return epoch;
      const oldEpoch = epoch;
      clearPending();
      onRouteCleanup(Object.freeze({ epoch: oldEpoch, previousUrl: previous, nextUrl: next }));
      stopObservation();
      epoch += 1;
      observedUrl = next;
      onRouteStart(Object.freeze({ epoch, previousUrl: previous, nextUrl: next }));
      startObservation();
      return epoch;
    }

    function suppressRendererMutations(callback) {
      if (typeof callback !== 'function') throw new TypeError('callback: must be a function');
      suppressionDepth += 1;
      try {
        return callback();
      } finally {
        observer.takeRecords();
        suppressionDepth -= 1;
      }
    }

    function routeEpoch() {
      return epoch;
    }

    function cleanup() {
      if (cleaned) return;
      clearPending();
      onRouteCleanup(Object.freeze({ epoch, previousUrl: observedUrl, nextUrl: null, reason: 'cleanup' }));
      stopObservation();
      restoreHooks();
      documentRef = null;
      cleaned = true;
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
    createDynamicDomController
  });
});
