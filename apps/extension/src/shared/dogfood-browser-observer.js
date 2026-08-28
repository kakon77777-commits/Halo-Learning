(function (root, factory) {
  const runtimeModule = typeof module === 'object' && module.exports
    ? require('./dogfood-runtime')
    : root.HaloDogfoodRuntime;
  const contentModule = typeof module === 'object' && module.exports
    ? require('./dogfood-content')
    : root.HaloDogfoodContent;
  const api = factory(root, runtimeModule, contentModule);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDogfoodBrowserObserver = api;
  if (!(typeof module === 'object' && module.exports)) {
    try { api.installDogfoodBrowserObservation({ root }); } catch (_error) {}
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (globalRoot, Runtime, DogfoodContent) {
  'use strict';

  function freezeFacade(base, overrides) {
    return Object.freeze({ ...base, ...overrides });
  }

  function installDogfoodBrowserObservation(options) {
    const settings = options || {};
    const root = settings.root || globalRoot;
    if (!root || typeof root !== 'object') throw new TypeError('root: required');
    if (root.__HALO_DOGFOOD_OBSERVATION_RUNTIME__) return root.__HALO_DOGFOOD_OBSERVATION_RUNTIME__;
    if (!Runtime || typeof Runtime.createDogfoodObservationRuntime !== 'function') throw new Error('dogfood observation runtime unavailable');
    if (!root.HaloSitePolicy || typeof root.HaloSitePolicy.classifySite !== 'function') throw new Error('site policy unavailable');

    const client = settings.client || (() => {
      if (!DogfoodContent || typeof DogfoodContent.createDogfoodContentClient !== 'function') throw new Error('dogfood content client unavailable');
      return DogfoodContent.createDogfoodContentClient({
        cryptoApi: root.crypto,
        sendMessage: root.chrome && root.chrome.runtime && typeof root.chrome.runtime.sendMessage === 'function'
          ? root.chrome.runtime.sendMessage.bind(root.chrome.runtime)
          : undefined,
        onError: () => {}
      });
    })();
    const runtime = Runtime.createDogfoodObservationRuntime({
      client,
      windowLike: root,
      sitePolicyModule: root.HaloSitePolicy,
      maxContexts: settings.maxContexts
    });
    root.__HALO_DOGFOOD_OBSERVATION_RUNTIME__ = runtime;

    const BaseSettings = root.HaloSettings;
    const BasePipeline = root.HaloSentencePipeline;
    const BaseProjection = root.HaloProjection;
    const BaseDynamic = root.HaloDynamicDomController;
    if (!BaseSettings || typeof BaseSettings.normalizeSettings !== 'function' ||
        !BasePipeline || typeof BasePipeline.buildSentenceRecords !== 'function' ||
        !BaseProjection || typeof BaseProjection.createMarkingPlan !== 'function' ||
        !BaseDynamic || typeof BaseDynamic.createDynamicDomController !== 'function') {
      delete root.__HALO_DOGFOOD_OBSERVATION_RUNTIME__;
      throw new Error('v0.4 browser observation boundaries unavailable');
    }

    let lastProfile = null;

    function rememberProfile(value) {
      lastProfile = value || lastProfile;
      return value;
    }

    root.HaloSettings = freezeFacade(BaseSettings, {
      normalizeSettings(input) {
        return rememberProfile(BaseSettings.normalizeSettings(input));
      },
      migrateSettings(input) {
        return rememberProfile(BaseSettings.migrateSettings(input));
      }
    });

    root.HaloSentencePipeline = freezeFacade(BasePipeline, {
      buildSentenceRecords(element, options) {
        const records = BasePipeline.buildSentenceRecords(element, options);
        runtime.rememberSentenceRecords(element, records);
        return records;
      }
    });

    root.HaloProjection = freezeFacade(BaseProjection, {
      createMarkingPlan(tokens, profile) {
        const plan = BaseProjection.createMarkingPlan(tokens, profile);
        const algorithmVersion = root.HaloSemanticAnnotations && root.HaloSemanticAnnotations.ENGINE
          ? root.HaloSemanticAnnotations.ENGINE.version
          : null;
        runtime.rememberPlan(plan, profile, algorithmVersion);
        return plan;
      }
    });

    root.HaloDynamicDomController = freezeFacade(BaseDynamic, {
      createDynamicDomController(input) {
        const original = input || {};
        const wrapped = { ...original };
        const onRootsInvalidated = original.onRootsInvalidated;
        const onRouteCleanup = original.onRouteCleanup;
        const onRouteStart = original.onRouteStart;
        wrapped.onRootsInvalidated = function (roots, metadata) {
          const removed = metadata && Array.isArray(metadata.removedRoots) ? metadata.removedRoots : [];
          runtime.clearRoots([...(Array.isArray(roots) ? roots : []), ...removed]);
          return typeof onRootsInvalidated === 'function' ? onRootsInvalidated.apply(this, arguments) : undefined;
        };
        wrapped.onRouteCleanup = function () {
          runtime.routeCleanup().catch(() => null);
          return typeof onRouteCleanup === 'function' ? onRouteCleanup.apply(this, arguments) : undefined;
        };
        wrapped.onRouteStart = function () {
          const result = typeof onRouteStart === 'function' ? onRouteStart.apply(this, arguments) : undefined;
          runtime.routeChanged().catch(() => null);
          return result;
        };
        const controller = BaseDynamic.createDynamicDomController(wrapped);
        if (original.policyOnly === false && lastProfile) runtime.applyAllowedProfile(lastProfile).catch(() => null);
        return controller;
      }
    });

    function tokenFromEvent(event) {
      let current = null;
      try { current = event && event.target; } catch (_error) { current = null; }
      const visited = new Set();
      while (current && (typeof current === 'object' || typeof current === 'function') && visited.size < 128 && !visited.has(current)) {
        visited.add(current);
        try {
          if (typeof current.getAttribute === 'function' && current.getAttribute('data-halo-owned') === 'token') return current;
        } catch (_error) {}
        try { current = current.parentElement || current.parentNode || current.host || null; } catch (_error) { current = null; }
      }
      return null;
    }

    if (root.document && typeof root.document.addEventListener === 'function') {
      root.document.addEventListener('click', (event) => {
        const token = tokenFromEvent(event);
        if (token) runtime.noteExplicitToken(token);
      }, true);
    }

    if (root.chrome && root.chrome.runtime && root.chrome.runtime.onMessage &&
        typeof root.chrome.runtime.onMessage.addListener === 'function') {
      root.chrome.runtime.onMessage.addListener((message) => {
        if (!message || message.type !== 'HALO_REMOVE_MARKING') return false;
        try { runtime.recordUserRemove(); } catch (_error) {}
        return false;
      });
    }

    if (root.chrome && root.chrome.storage && root.chrome.storage.onChanged &&
        typeof root.chrome.storage.onChanged.addListener === 'function') {
      root.chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes || !changes.haloSettings) return;
        try {
          const previous = BaseSettings.migrateSettings(changes.haloSettings.oldValue);
          const next = BaseSettings.migrateSettings(changes.haloSettings.newValue);
          lastProfile = next;
          runtime.recordProfileDiff(previous, next);
        } catch (_error) {}
      });
    }

    return runtime;
  }

  return Object.freeze({ installDogfoodBrowserObservation });
});
