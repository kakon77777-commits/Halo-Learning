(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloBrowserEntry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const INJECT_FILES = Object.freeze([
    'src/shared/progressive-runtime.js',
    'src/shared/semantic-contracts.js',
    'src/shared/dictionary-provider.js',
    'src/shared/semantic-annotations.js',
    'src/shared/grammar-annotations.js',
    'src/shared/projection.js',
    'src/shared/site-policy.js',
    'src/shared/settings.js',
    'src/shared/sentence-pipeline.js',
    'src/shared/runtime-scheduler.js',
    'src/shared/dynamic-dom-controller.js',
    'src/shared/navigation-route-bridge.js',
    'src/shared/token-child-continuity.js',
    'src/shared/reversible-renderer.js',
    'src/shared/dogfood-renderer.js',
    'src/shared/trigger-controller.js',
    'src/shared/dogfood-contracts.js',
    'src/shared/dogfood-source.js',
    'src/shared/dogfood-capture.js',
    'src/shared/dogfood-content.js',
    'src/shared/dogfood-runtime.js',
    'src/shared/dogfood-browser-observer.js',
    'src/content.js'
  ]);
  const CONTENT_CSS_FILES = Object.freeze(['src/content.css']);
  const STATUS_MESSAGE = Object.freeze({ type: 'HALO_STATUS' });
  const EXPLICIT_SELECTION_MESSAGE = Object.freeze({
    type: 'HALO_EXPLICIT_SELECTION',
    action: 'analyze-selection'
  });

  function validTabId(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function validateChrome(chromeApi) {
    if (!chromeApi || !chromeApi.scripting || !chromeApi.tabs ||
        typeof chromeApi.scripting.insertCSS !== 'function' ||
        typeof chromeApi.scripting.executeScript !== 'function' ||
        typeof chromeApi.tabs.sendMessage !== 'function') {
      throw new TypeError('chrome scripting and tabs APIs are required');
    }
    return chromeApi;
  }

  function isLiveStatus(value) {
    return Boolean(value && typeof value === 'object' && typeof value.active === 'boolean');
  }

  async function hasLivePackagedRuntime(chromeApi, tabId) {
    try {
      return isLiveStatus(await chromeApi.tabs.sendMessage(tabId, STATUS_MESSAGE));
    } catch (_error) {
      return false;
    }
  }

  async function injectPackagedRuntime(options) {
    const settings = options || {};
    const chromeApi = validateChrome(settings.chrome);
    if (!validTabId(settings.tabId)) throw new TypeError('tabId: must be a non-negative safe integer');
    if (await hasLivePackagedRuntime(chromeApi, settings.tabId)) {
      return Object.freeze({ tabId: settings.tabId, reused: true });
    }
    const target = { tabId: settings.tabId };
    await chromeApi.scripting.insertCSS({ target, files: CONTENT_CSS_FILES });
    await chromeApi.scripting.executeScript({ target, files: INJECT_FILES });
    return Object.freeze({ tabId: settings.tabId, reused: false });
  }

  async function injectAndSendExplicitSelection(options) {
    const settings = options || {};
    const chromeApi = validateChrome(settings.chrome);
    await injectPackagedRuntime(settings);
    return chromeApi.tabs.sendMessage(settings.tabId, EXPLICIT_SELECTION_MESSAGE);
  }

  return Object.freeze({
    INJECT_FILES,
    CONTENT_CSS_FILES,
    EXPLICIT_SELECTION_MESSAGE,
    injectPackagedRuntime,
    injectAndSendExplicitSelection
  });
});
