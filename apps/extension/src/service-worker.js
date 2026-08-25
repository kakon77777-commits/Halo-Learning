if (typeof importScripts === 'function') {
  importScripts(
    'shared/runtime-index-browser.js',
    'shared/dictionary-provider.js',
    'shared/runtime-dictionary-provider.js',
    'shared/semantic-annotations.js',
    'shared/grammar-annotations.js'
  );
}

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloSemanticService = api;
  if (!(typeof module === 'object' && module.exports)) api.initializeBrowser();
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function sanitizedStatus(provider) {
    const raw = provider && typeof provider.status === 'function'
      ? provider.status()
      : { mode: 'bootstrap-only', fallbackActivated: true, failures: [] };
    return Object.freeze({
      mode: ['ready', 'degraded', 'bootstrap-only'].includes(raw.mode) ? raw.mode : 'degraded',
      fallbackActivated: Boolean(raw.fallbackActivated),
      failures: Object.freeze((Array.isArray(raw.failures) ? raw.failures : []).map((failure) => Object.freeze({
        code: typeof failure.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(failure.code)
          ? failure.code
          : 'CORPUS_UNAVAILABLE'
      })))
    });
  }

  function createSemanticService(options) {
    const settings = options || {};
    if (typeof settings.loadProvider !== 'function') throw new TypeError('loadProvider: must be a function');
    if (!settings.semanticModule || typeof settings.semanticModule.createSemanticEngine !== 'function') {
      throw new TypeError('semanticModule.createSemanticEngine: must be a function');
    }
    if (!settings.grammarModule || typeof settings.grammarModule.annotateGrammar !== 'function') {
      throw new TypeError('grammarModule.annotateGrammar: must be a function');
    }
    const maxBatchItems = Number.isInteger(settings.maxBatchItems) ? settings.maxBatchItems : 600;
    const maxTextLength = Number.isInteger(settings.maxTextLength) ? settings.maxTextLength : 100000;
    let providerPromise = null;
    let enginePromise = null;

    function getProvider() {
      if (!providerPromise) providerPromise = Promise.resolve().then(() => settings.loadProvider());
      return providerPromise;
    }

    function getEngine() {
      if (!enginePromise) enginePromise = getProvider().then((provider) => settings.semanticModule.createSemanticEngine({
        provider,
        grammarAnnotator: settings.grammarModule.annotateGrammar
      }));
      return enginePromise;
    }

    async function annotateBatch(texts, runOptions) {
      if (!Array.isArray(texts)) throw new TypeError('texts: must be an array');
      if (texts.length > maxBatchItems) throw new TypeError('annotation batch exceeds the local item limit');
      for (let index = 0; index < texts.length; index += 1) {
        if (typeof texts[index] !== 'string') throw new TypeError(`texts[${index}]: must be a string`);
        if (texts[index].length > maxTextLength) throw new TypeError(`texts[${index}]: text length exceeds the local limit`);
      }
      const optionsValue = runOptions || {};
      const optionsWithTime = {
        languageMode: optionsValue.languageMode || 'both',
        generatedAt: optionsValue.generatedAt || new Date().toISOString()
      };
      const [provider, engine] = await Promise.all([getProvider(), getEngine()]);
      const annotationSets = Object.freeze(texts.map((text) => engine.annotateText(text, optionsWithTime)));
      return Object.freeze({ annotationSets, status: sanitizedStatus(provider) });
    }

    async function handleMessage(message) {
      if (!message || typeof message !== 'object') return null;
      if (message.type === 'HALO_ANNOTATE_BATCH') {
        return annotateBatch(message.texts, message.options);
      }
      if (message.type === 'HALO_DICTIONARY_STATUS') {
        return sanitizedStatus(await getProvider());
      }
      return null;
    }

    return Object.freeze({ annotateBatch, handleMessage });
  }

  function createBrowserProviderLoader() {
    return async function loadProvider() {
      const Dictionary = root.HaloDictionary;
      const RuntimeDictionary = root.HaloRuntimeDictionary;
      const BrowserIndex = root.HaloRuntimeIndexBrowser;
      if (!Dictionary || !RuntimeDictionary || !BrowserIndex) throw new Error('Local dictionary modules are unavailable');
      const bootstrapProvider = Dictionary.createBootstrapDictionaryProvider();
      return RuntimeDictionary.loadPackagedDictionaryProvider({
        path: 'data/lexical-runtime-index.json',
        bootstrapProvider,
        readText: async () => {
          const resourceUrl = chrome.runtime.getURL('data/lexical-runtime-index.json');
          const response = await fetch(resourceUrl, { cache: 'no-store' });
          if (!response.ok) {
            const error = new Error('Packaged lexical index is unavailable');
            error.code = 'CORPUS_UNAVAILABLE';
            throw error;
          }
          return response.text();
        },
        loadIndex: (serialized) => BrowserIndex.loadRuntimeLexicalIndex(serialized)
      });
    };
  }

  function initializeBrowser() {
    if (!root.chrome || !root.chrome.runtime || !root.chrome.runtime.onMessage) return null;
    if (root.__HALO_SEMANTIC_SERVICE_INITIALIZED__) return root.__HALO_SEMANTIC_SERVICE_INITIALIZED__;
    const service = createSemanticService({
      loadProvider: createBrowserProviderLoader(),
      semanticModule: root.HaloSemanticAnnotations,
      grammarModule: root.HaloGrammarAnnotations
    });
    root.__HALO_SEMANTIC_SERVICE_INITIALIZED__ = service;
    root.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || !['HALO_ANNOTATE_BATCH', 'HALO_DICTIONARY_STATUS'].includes(message.type)) return false;
      service.handleMessage(message)
        .then((response) => sendResponse(response))
        .catch((error) => sendResponse({
          error: 'SEMANTIC_SERVICE_ERROR',
          detail: error instanceof TypeError ? 'INVALID_REQUEST' : 'LOCAL_SERVICE_UNAVAILABLE'
        }));
      return true;
    });
    return service;
  }

  return Object.freeze({ createSemanticService, createBrowserProviderLoader, initializeBrowser });
});
