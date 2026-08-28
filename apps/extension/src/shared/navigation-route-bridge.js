(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloNavigationRouteBridge = api;
  if (!(typeof module === 'object' && module.exports) && root.HaloDynamicDomController) {
    if (!root.__HALO_NAVIGATION_ROUTE_BRIDGED_DYNAMIC__) {
      root.__HALO_NAVIGATION_ROUTE_BRIDGED_DYNAMIC__ = api.wrapDynamicModule(root.HaloDynamicDomController, {
        navigation: root.navigation || null
      });
    }
    root.HaloDynamicDomController = root.__HALO_NAVIGATION_ROUTE_BRIDGED_DYNAMIC__;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const NAVIGATION_STAGE = 'navigation-listener';

  function hasOwn(value, name) {
    return Boolean(value && Object.prototype.hasOwnProperty.call(value, name));
  }

  function supportedNavigation(value) {
    return Boolean(value && typeof value.addEventListener === 'function');
  }

  function mergeCleanupStatus(status, listenerPending) {
    const source = status && typeof status === 'object' ? status : {};
    const sourceStages = Array.isArray(source.pendingStages) ? source.pendingStages : [];
    const pendingStages = listenerPending && !sourceStages.includes(NAVIGATION_STAGE)
      ? [...sourceStages, NAVIGATION_STAGE]
      : sourceStages.filter((stage) => stage !== NAVIGATION_STAGE);
    const cleanupStarted = source.cleanupStarted === true;
    const cleaned = source.cleaned === true && !listenerPending;
    return Object.freeze({
      ...source,
      cleanupStarted,
      cleaned,
      cleanupPending: cleanupStarted && !cleaned,
      pendingStages: Object.freeze(pendingStages)
    });
  }

  function wrapController(controller, navigation, onError) {
    if (!controller || typeof controller.routeChanged !== 'function' ||
        typeof controller.cleanup !== 'function' || typeof controller.status !== 'function') {
      throw new TypeError('dynamic controller route/cleanup/status APIs are required');
    }
    if (!supportedNavigation(navigation)) return controller;

    let listenerInstalled = false;
    let active = true;

    function report(error, phase) {
      if (typeof onError !== 'function') return;
      try { onError(error, Object.freeze({ phase })); } catch (_ignored) {}
    }

    function currentEntryChanged() {
      if (!active) return;
      try {
        controller.routeChanged();
      } catch (error) {
        report(error, 'navigation-route');
      }
    }

    navigation.addEventListener('currententrychange', currentEntryChanged);
    listenerInstalled = true;

    function cleanup() {
      active = false;
      if (listenerInstalled) {
        try {
          if (typeof navigation.removeEventListener !== 'function') {
            throw new TypeError('Navigation API listener removal is unavailable');
          }
          navigation.removeEventListener('currententrychange', currentEntryChanged);
          listenerInstalled = false;
        } catch (error) {
          report(error, 'cleanup-navigation-listener');
        }
      }
      const status = controller.cleanup();
      return mergeCleanupStatus(status, listenerInstalled);
    }

    function status() {
      const source = controller.status();
      return mergeCleanupStatus(source, listenerInstalled && source.cleanupStarted === true);
    }

    return Object.freeze({
      ...controller,
      cleanup,
      status
    });
  }

  function wrapDynamicModule(dynamicModule, options) {
    if (!dynamicModule || typeof dynamicModule.createDynamicDomController !== 'function') {
      throw new TypeError('dynamicModule.createDynamicDomController: is required');
    }
    const defaults = options || {};
    return Object.freeze({
      ...dynamicModule,
      createDynamicDomController(rawOptions) {
        const controllerOptions = rawOptions || {};
        const controller = dynamicModule.createDynamicDomController(controllerOptions);
        const navigation = hasOwn(controllerOptions, 'navigation')
          ? controllerOptions.navigation
          : (hasOwn(defaults, 'navigation') ? defaults.navigation : (root.navigation || null));
        return wrapController(controller, navigation, controllerOptions.onError);
      }
    });
  }

  return Object.freeze({
    NAVIGATION_STAGE,
    mergeCleanupStatus,
    wrapController,
    wrapDynamicModule
  });
});
