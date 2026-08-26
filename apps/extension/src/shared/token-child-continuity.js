(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloTokenChildContinuity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const insertionDestinations = new WeakMap();

  function safeOwned(predicate, node) {
    if (typeof predicate !== 'function' || !node) return false;
    try { return predicate(node) === true; } catch (_error) { return false; }
  }

  function remember(records, isHaloOwned) {
    for (const record of Array.from(records || [])) {
      if (!record || record.type !== 'childList' || !record.target ||
          !safeOwned(isHaloOwned, record.target)) continue;
      const destination = record.target.parentNode || record.target.parentElement;
      if (!destination) continue;
      for (const node of Array.from(record.addedNodes || [])) {
        if (!node || safeOwned(isHaloOwned, node)) continue;
        insertionDestinations.set(node, destination);
      }
    }
  }

  function protects(node) {
    const visited = new Set();
    for (let current = node; current && !visited.has(current) && visited.size < 256;
      current = current.parentNode || current.parentElement) {
      visited.add(current);
      const destination = insertionDestinations.get(current);
      if (!destination) continue;
      return (current.parentNode || current.parentElement) === destination;
    }
    return false;
  }

  function install() {
    const Pipeline = root.HaloSentencePipeline;
    const DynamicDom = root.HaloDynamicDomController;
    if (!Pipeline || typeof Pipeline.buildSentenceRecords !== 'function' ||
        !DynamicDom || typeof DynamicDom.createDynamicDomController !== 'function') {
      throw new Error('token-child continuity dependencies are unavailable');
    }
    if (Pipeline.__tokenChildContinuityInstalled === true &&
        DynamicDom.__tokenChildContinuityInstalled === true) return true;

    const wrappedPipeline = Object.freeze({
      ...Pipeline,
      __tokenChildContinuityInstalled: true,
      buildSentenceRecords(rootNode, options) {
        const settings = options || {};
        return Pipeline.buildSentenceRecords(rootNode, {
          ...settings,
          isSentenceTerminatorProtected: typeof settings.isSentenceTerminatorProtected === 'function'
            ? settings.isSentenceTerminatorProtected
            : protects
        });
      }
    });
    const wrappedDynamicDom = Object.freeze({
      ...DynamicDom,
      __tokenChildContinuityInstalled: true,
      createDynamicDomController(options) {
        const settings = options || {};
        const callerObserved = settings.onMutationsObserved;
        return DynamicDom.createDynamicDomController({
          ...settings,
          onMutationsObserved(records, metadata) {
            remember(records, settings.isHaloOwned);
            if (typeof callerObserved === 'function') return callerObserved(records, metadata);
            return undefined;
          }
        });
      }
    });
    root.HaloSentencePipeline = wrappedPipeline;
    root.HaloDynamicDomController = wrappedDynamicDom;
    return true;
  }

  install();
  return Object.freeze({ install, protects });
});
