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
  const HISTORY_HOOK_STATE = Object.freeze({
    prepared: 'prepared',
    retryable: 'retryable',
    uncertain: 'uncertain',
    installed: 'installed',
    ownershipLost: 'ownership-lost',
    released: 'released'
  });
  const HISTORY_HOOK_MODE = Object.freeze({
    createdOwnData: 'created-own-data',
    inheritedSetter: 'inherited-setter',
    ownAccessor: 'own-accessor',
    ownData: 'own-data',
    uncertain: 'uncertain'
  });

  function snapshotPropertyDescriptor(descriptor) {
    if (!descriptor) return null;
    if (Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return Object.freeze({
        value: descriptor.value,
        writable: descriptor.writable === true,
        enumerable: descriptor.enumerable === true,
        configurable: descriptor.configurable === true
      });
    }
    return Object.freeze({
      get: descriptor.get,
      set: descriptor.set,
      enumerable: descriptor.enumerable === true,
      configurable: descriptor.configurable === true
    });
  }

  function isDataDescriptor(descriptor) {
    return Boolean(descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value'));
  }

  function samePropertyDescriptor(left, right) {
    if (!left || !right) return left === right;
    if (isDataDescriptor(left) !== isDataDescriptor(right)) return false;
    if (left.enumerable !== right.enumerable || left.configurable !== right.configurable) return false;
    if (isDataDescriptor(left)) {
      return left.value === right.value && left.writable === right.writable;
    }
    return left.get === right.get && left.set === right.set;
  }

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
    let pushStateHookRecord = null;
    let replaceStateHookRecord = null;
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
      const result = coalesceMutations(records);
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
      const invalidated = coalesceMutations(retained);
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

    function historyOwnDescriptor(methodName) {
      return snapshotPropertyDescriptor(Object.getOwnPropertyDescriptor(history, methodName));
    }

    function createHistoryHookRecord(nativeCallable, originalOwnDescriptor) {
      const stateCell = {
        active: false,
        installation: HISTORY_HOOK_STATE.prepared,
        installationMode: HISTORY_HOOK_MODE.uncertain,
        installedOwnDescriptor: null
      };
      const wrapper = function (...args) {
        const previousUrl = stateCell.active ? currentUrl() : null;
        const result = nativeCallable.apply(this, args);
        if (stateCell.active) routeChanged(previousUrl, currentUrl());
        return result;
      };
      return Object.freeze({ nativeCallable, originalOwnDescriptor, stateCell, wrapper });
    }

    function historyHookRecord(methodName) {
      return methodName === 'pushState' ? pushStateHookRecord : replaceStateHookRecord;
    }

    function storeHistoryHookRecord(methodName, record) {
      if (methodName === 'pushState') pushStateHookRecord = record;
      else replaceStateHookRecord = record;
    }

    function rememberHistoryInstallation(record, installedOwnDescriptor) {
      record.stateCell.installedOwnDescriptor = installedOwnDescriptor;
      if (record.originalOwnDescriptor) {
        record.stateCell.installationMode = isDataDescriptor(record.originalOwnDescriptor)
          ? HISTORY_HOOK_MODE.ownData
          : HISTORY_HOOK_MODE.ownAccessor;
      } else if (isDataDescriptor(installedOwnDescriptor) && installedOwnDescriptor.value === record.wrapper) {
        record.stateCell.installationMode = HISTORY_HOOK_MODE.createdOwnData;
      } else if (!installedOwnDescriptor) {
        record.stateCell.installationMode = HISTORY_HOOK_MODE.inheritedSetter;
      } else {
        record.stateCell.installationMode = HISTORY_HOOK_MODE.uncertain;
      }
    }

    function markHistoryInstallFailure(methodName, record) {
      record.stateCell.active = false;
      try {
        rememberHistoryInstallation(record, historyOwnDescriptor(methodName));
        const current = history[methodName];
        if (current === record.wrapper) record.stateCell.installation = HISTORY_HOOK_STATE.installed;
        else if (current === record.nativeCallable) record.stateCell.installation = HISTORY_HOOK_STATE.retryable;
        else record.stateCell.installation = HISTORY_HOOK_STATE.ownershipLost;
      } catch (_error) {
        record.stateCell.installation = HISTORY_HOOK_STATE.uncertain;
      }
    }

    function ensureHistoryHook(methodName) {
      let record = historyHookRecord(methodName);
      if (record && record.stateCell.installation === HISTORY_HOOK_STATE.installed) {
        record.stateCell.active = true;
        return;
      }
      if (record && record.stateCell.installation === HISTORY_HOOK_STATE.ownershipLost) {
        throw new Error(`${methodName} changed before hook retry`);
      }
      let current;
      let currentOwnDescriptor;
      try {
        currentOwnDescriptor = historyOwnDescriptor(methodName);
        current = history[methodName];
      } catch (error) {
        if (record) {
          record.stateCell.active = false;
          record.stateCell.installation = HISTORY_HOOK_STATE.uncertain;
        }
        throw error;
      }
      if (!record) {
        if (typeof current !== 'function') return;
        record = createHistoryHookRecord(current, currentOwnDescriptor);
        storeHistoryHookRecord(methodName, record);
      } else if (current === record.wrapper) {
        rememberHistoryInstallation(record, currentOwnDescriptor);
        record.stateCell.installation = HISTORY_HOOK_STATE.installed;
        record.stateCell.active = true;
        return;
      } else if (current !== record.nativeCallable) {
        record.stateCell.active = false;
        record.stateCell.installation = HISTORY_HOOK_STATE.ownershipLost;
        throw new Error(`${methodName} changed before hook retry`);
      }

      record.stateCell.active = false;
      record.stateCell.installation = HISTORY_HOOK_STATE.uncertain;
      try {
        history[methodName] = record.wrapper;
      } catch (error) {
        markHistoryInstallFailure(methodName, record);
        throw error;
      }
      let retained;
      try {
        rememberHistoryInstallation(record, historyOwnDescriptor(methodName));
        retained = history[methodName];
      } catch (error) {
        record.stateCell.installation = HISTORY_HOOK_STATE.uncertain;
        throw error;
      }
      if (retained === record.wrapper) {
        record.stateCell.installation = HISTORY_HOOK_STATE.installed;
        record.stateCell.active = true;
        return;
      }
      record.stateCell.active = false;
      record.stateCell.installation = retained === record.nativeCallable
        ? HISTORY_HOOK_STATE.retryable
        : HISTORY_HOOK_STATE.ownershipLost;
      throw new Error(`${methodName} hook installation was not retained`);
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
      ensureHistoryHook('pushState');
      ensureHistoryHook('replaceState');
    }

    function deactivateHistoryHooks() {
      if (pushStateHookRecord) pushStateHookRecord.stateCell.active = false;
      if (replaceStateHookRecord) replaceStateHookRecord.stateCell.active = false;
    }

    function releaseHistoryHook(record) {
      record.stateCell.active = false;
      record.stateCell.installation = HISTORY_HOOK_STATE.released;
      return null;
    }

    function restoreCreatedOwnDataHook(methodName, record) {
      const currentOwnDescriptor = historyOwnDescriptor(methodName);
      if (!currentOwnDescriptor) return releaseHistoryHook(record);
      const installedOwnDescriptor = record.stateCell.installedOwnDescriptor;
      if (!isDataDescriptor(currentOwnDescriptor) || currentOwnDescriptor.value !== record.wrapper) {
        return releaseHistoryHook(record);
      }
      if (installedOwnDescriptor && !samePropertyDescriptor(currentOwnDescriptor, installedOwnDescriptor)) {
        return releaseHistoryHook(record);
      }
      if (!Reflect.deleteProperty(history, methodName)) {
        throw new TypeError(`${methodName} wrapper deletion failed`);
      }
      const verifiedOwnDescriptor = historyOwnDescriptor(methodName);
      if (verifiedOwnDescriptor) {
        if (!isDataDescriptor(verifiedOwnDescriptor) || verifiedOwnDescriptor.value !== record.wrapper) {
          return releaseHistoryHook(record);
        }
        throw new Error(`${methodName} wrapper deletion was not retained`);
      }
      return releaseHistoryHook(record);
    }

    function restoreOwnDataHook(methodName, record) {
      const currentOwnDescriptor = historyOwnDescriptor(methodName);
      if (samePropertyDescriptor(currentOwnDescriptor, record.originalOwnDescriptor)) {
        return releaseHistoryHook(record);
      }
      if (!isDataDescriptor(currentOwnDescriptor) || currentOwnDescriptor.value !== record.wrapper) {
        return releaseHistoryHook(record);
      }
      const installedOwnDescriptor = record.stateCell.installedOwnDescriptor;
      if (installedOwnDescriptor && !samePropertyDescriptor(currentOwnDescriptor, installedOwnDescriptor)) {
        return releaseHistoryHook(record);
      }
      Object.defineProperty(history, methodName, record.originalOwnDescriptor);
      if (!samePropertyDescriptor(historyOwnDescriptor(methodName), record.originalOwnDescriptor)) {
        throw new Error(`${methodName} descriptor restoration was not retained`);
      }
      return releaseHistoryHook(record);
    }

    function restoreAccessorHook(methodName, record, inherited) {
      const currentOwnDescriptor = historyOwnDescriptor(methodName);
      if (inherited) {
        if (currentOwnDescriptor) return releaseHistoryHook(record);
      } else {
        const installedOwnDescriptor = record.stateCell.installedOwnDescriptor || record.originalOwnDescriptor;
        if (!samePropertyDescriptor(currentOwnDescriptor, installedOwnDescriptor)) {
          return releaseHistoryHook(record);
        }
      }

      const current = history[methodName];
      if (current === record.nativeCallable) return releaseHistoryHook(record);
      if (current !== record.wrapper) return releaseHistoryHook(record);
      history[methodName] = record.nativeCallable;

      const verifiedOwnDescriptor = historyOwnDescriptor(methodName);
      if (inherited) {
        if (verifiedOwnDescriptor) {
          if (!isDataDescriptor(verifiedOwnDescriptor) || verifiedOwnDescriptor.value !== record.wrapper) {
            return releaseHistoryHook(record);
          }
          throw new Error(`${methodName} inherited topology restoration was not retained`);
        }
      } else if (!samePropertyDescriptor(verifiedOwnDescriptor, record.originalOwnDescriptor)) {
        throw new Error(`${methodName} accessor descriptor restoration was not retained`);
      }

      const retained = history[methodName];
      if (retained === record.nativeCallable) return releaseHistoryHook(record);
      if (retained !== record.wrapper) return releaseHistoryHook(record);
      throw new Error(`${methodName} restoration was not retained`);
    }

    function restoreHistoryHook(methodName, record, metadata) {
      if (!record) return null;
      record.stateCell.active = false;
      try {
        if (!history) throw new TypeError(`${methodName} restoration is unavailable`);
        if (record.stateCell.installationMode === HISTORY_HOOK_MODE.createdOwnData) {
          return restoreCreatedOwnDataHook(methodName, record);
        }
        if (record.stateCell.installationMode === HISTORY_HOOK_MODE.ownData) {
          return restoreOwnDataHook(methodName, record);
        }
        if (record.stateCell.installationMode === HISTORY_HOOK_MODE.ownAccessor) {
          return restoreAccessorHook(methodName, record, false);
        }
        if (record.stateCell.installationMode === HISTORY_HOOK_MODE.inheritedSetter) {
          return restoreAccessorHook(methodName, record, true);
        }

        const currentOwnDescriptor = historyOwnDescriptor(methodName);
        if (!record.originalOwnDescriptor && isDataDescriptor(currentOwnDescriptor) &&
            currentOwnDescriptor.value === record.wrapper) {
          rememberHistoryInstallation(record, currentOwnDescriptor);
          return restoreCreatedOwnDataHook(methodName, record);
        }
        if (record.originalOwnDescriptor && isDataDescriptor(record.originalOwnDescriptor)) {
          record.stateCell.installationMode = HISTORY_HOOK_MODE.ownData;
          return restoreOwnDataHook(methodName, record);
        }
        if (record.originalOwnDescriptor) {
          record.stateCell.installationMode = HISTORY_HOOK_MODE.ownAccessor;
          return restoreAccessorHook(methodName, record, false);
        }
        record.stateCell.installationMode = HISTORY_HOOK_MODE.inheritedSetter;
        return restoreAccessorHook(methodName, record, true);
      } catch (error) {
        record.stateCell.installation = HISTORY_HOOK_STATE.uncertain;
        reportError(error, `cleanup-${methodName === 'pushState' ? 'push-state' : 'replace-state'}-hook`, metadata);
        return record;
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
      pushStateHookRecord = restoreHistoryHook('pushState', pushStateHookRecord, metadata);
      replaceStateHookRecord = restoreHistoryHook('replaceState', replaceStateHookRecord, metadata);
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
      if (pushStateHookRecord) pending.add('push-state-hook');
      if (replaceStateHookRecord) pending.add('replace-state-hook');
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
        deactivateHistoryHooks();
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
