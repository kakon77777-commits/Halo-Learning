if (typeof importScripts === 'function') {
  importScripts(
    'shared/browser-entry.js',
    'shared/site-policy.js',
    'shared/settings.js',
    'shared/progressive-runtime.js',
    'shared/semantic-contracts.js',
    'shared/runtime-shard-browser.js',
    'shared/dictionary-provider.js',
    'shared/sharded-dictionary-provider.js',
    'shared/semantic-annotations.js',
    'shared/grammar-annotations.js'
  );
}

(function (root, factory) {
  const progressiveModule = typeof module === 'object' && module.exports
    ? require('./shared/progressive-runtime')
    : root.HaloProgressiveRuntime;
  const contractsModule = typeof module === 'object' && module.exports
    ? require('./shared/semantic-contracts')
    : root.HaloSemanticContracts;
  const browserEntryModule = typeof module === 'object' && module.exports
    ? require('./shared/browser-entry')
    : root.HaloBrowserEntry;
  const sitePolicyModule = typeof module === 'object' && module.exports
    ? require('./shared/site-policy')
    : root.HaloSitePolicy;
  const settingsModule = typeof module === 'object' && module.exports
    ? require('./shared/settings')
    : root.HaloSettings;
  const api = factory(root, progressiveModule, contractsModule, browserEntryModule, sitePolicyModule, settingsModule);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloSemanticService = api;
  if (!(typeof module === 'object' && module.exports)) {
    api.initializeBrowser();
    api.initializeBrowserTriggers();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Progressive, Contracts, BrowserEntry, SitePolicy, Settings) {
  'use strict';

  if (!Contracts || !Number.isInteger(Contracts.SEMANTIC_SCHEMA_VERSION)) {
    throw new Error('Canonical semantic contracts are unavailable');
  }
  const SCHEMA_VERSION = Contracts.SEMANTIC_SCHEMA_VERSION;
  const SHARD_ROOT = 'data/lexical-v0.4.0';
  const MANIFEST_PATH = 'data/lexical-v0.4.0/manifest.json';
  const BATCH_LIMITS = Object.freeze({
    items: 24,
    characters: 12000,
    estimatedTokens: 600,
    distinctShards: 24
  });
  const LANGUAGE_MODES = new Set(['en', 'zh-Hant', 'both']);
  const CONTEXT_MENU_ID = 'halo-analyze-selection';
  const COMMAND_ID = 'halo-analyze-selection';
  if (!Progressive || typeof Progressive.createAnalysisKey !== 'function' ||
      typeof Progressive.isAnalysisKey !== 'function') {
    throw new Error('Canonical progressive analysis key module is unavailable');
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }

  function validStableId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
  }

  function stableFailureCode(error, fallback) {
    return error && typeof error.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(error.code)
      ? error.code
      : fallback;
  }

  function sanitizedStatus(source, defaults) {
    const fallback = defaults || {};
    const raw = source && typeof source.status === 'function' ? source.status() : (source || fallback);
    const mode = ['ready', 'degraded', 'bootstrap-only'].includes(raw && raw.mode)
      ? raw.mode
      : (fallback.mode || 'degraded');
    const failures = Array.isArray(raw && raw.failures) ? raw.failures : (fallback.failures || []);
    const codes = [...new Set(failures.map((failure) => stableFailureCode(failure, 'CORPUS_UNAVAILABLE')))];
    return deepFreeze({
      mode,
      fallbackActivated: Boolean(raw && raw.fallbackActivated),
      failures: codes.sort().map((code) => ({ code }))
    });
  }

  function bootstrapIdentity(provider) {
    const id = provider && typeof provider.id === 'string' && provider.id ? provider.id : 'authored-bootstrap';
    const version = provider && typeof provider.version === 'string' && provider.version
      ? provider.version
      : 'unspecified';
    return `${id}@${version}`;
  }

  function estimateTokens(text) {
    let count = 0;
    for (const _match of text.matchAll(/\p{Script=Han}|[\p{Script=Latin}\p{M}]+(?:['’][\p{Script=Latin}\p{M}]+)*/gu)) {
      count += 1;
    }
    return count;
  }

  function normalizeItem(raw, index) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError(`items[${index}]: must be an object`);
    }
    if (!validStableId(raw.rootId)) throw new TypeError(`items[${index}].rootId: must be a stable ID`);
    if (!Number.isSafeInteger(raw.rootRevision) || raw.rootRevision < 1) {
      throw new TypeError(`items[${index}].rootRevision: must be a positive integer`);
    }
    if (typeof raw.text !== 'string' || !raw.text) throw new TypeError(`items[${index}].text: must be non-empty`);
    if (!LANGUAGE_MODES.has(raw.languageMode)) {
      throw new TypeError(`items[${index}].languageMode: must be en, zh-Hant, or both`);
    }
    if (!Progressive.isAnalysisKey(raw.analysisKey)) {
      throw new TypeError(`items[${index}].analysisKey: must be a canonical analysis key`);
    }
    let analysisKey;
    try {
      analysisKey = Progressive.createAnalysisKey({
        text: raw.text,
        languageMode: raw.languageMode,
        semanticVersion: raw.semanticVersion,
        grammarVersion: raw.grammarVersion,
        profileRevision: raw.profileRevision,
        lexicalVersion: raw.lexicalVersion
      });
    } catch (_error) {
      throw new TypeError(`items[${index}]: analysis key inputs are invalid`);
    }
    if (raw.analysisKey !== analysisKey) {
      throw new TypeError(`items[${index}]: analysis key does not match its analysis inputs`);
    }
    return Object.freeze({
      rootId: raw.rootId,
      rootRevision: raw.rootRevision,
      text: raw.text,
      languageMode: raw.languageMode,
      semanticVersion: raw.semanticVersion,
      grammarVersion: raw.grammarVersion,
      profileRevision: raw.profileRevision,
      lexicalVersion: raw.lexicalVersion,
      analysisKey
    });
  }

  function validateEnrichmentRequest(message, runtime) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.type !== 'HALO_ENRICH_BATCH') {
      throw new TypeError('message: must be HALO_ENRICH_BATCH');
    }
    if (!validStableId(message.requestId)) throw new TypeError('requestId: must be a stable ID');
    if (!Number.isSafeInteger(message.pageEpoch) || message.pageEpoch < 1) {
      throw new TypeError('pageEpoch: must be a positive integer');
    }
    if (!Array.isArray(message.items) || message.items.length < 1) {
      throw new TypeError('items: must be a non-empty array');
    }
    if (message.items.length > BATCH_LIMITS.items) {
      throw new TypeError('enrichment batch exceeds the local item limit');
    }
    const items = message.items.map(normalizeItem);
    const totalCharacters = items.reduce((total, value) => total + value.text.length, 0);
    if (totalCharacters > BATCH_LIMITS.characters) {
      throw new TypeError('enrichment batch exceeds the local character limit');
    }
    const estimatedTokens = items.reduce((total, value) => total + estimateTokens(value.text), 0);
    if (estimatedTokens > BATCH_LIMITS.estimatedTokens) {
      throw new TypeError('enrichment batch exceeds the local estimated token limit');
    }
    const shardIds = new Set();
    if (runtime) {
      if (typeof runtime.requiredShardIds !== 'function') throw new TypeError('runtime.requiredShardIds: is required');
      for (const value of items) {
        const required = runtime.requiredShardIds([value.text], value.languageMode);
        if (!Array.isArray(required)) throw new TypeError('runtime.requiredShardIds: must return an array');
        for (const shardId of required) {
          if (!validStableId(shardId)) throw new TypeError('runtime.requiredShardIds: returned an invalid shard ID');
          shardIds.add(shardId);
        }
      }
    }
    if (shardIds.size > BATCH_LIMITS.distinctShards) {
      throw new TypeError('enrichment batch exceeds the local distinct shard limit');
    }
    return deepFreeze({
      requestId: message.requestId,
      pageEpoch: message.pageEpoch,
      items,
      totalCharacters,
      estimatedTokens,
      shardIds: [...shardIds].sort()
    });
  }

  function createBrowserShardLoader(options) {
    const settings = options || {};
    const shardModule = settings.shardModule || root.HaloRuntimeShardBrowser;
    const bootstrapProvider = settings.bootstrapProvider || (root.HaloDictionary &&
      root.HaloDictionary.createBootstrapDictionaryProvider());
    if (!bootstrapProvider || typeof bootstrapProvider.lookup !== 'function') {
      throw new TypeError('bootstrapProvider.lookup: must be a function');
    }
    if (!shardModule || typeof shardModule.loadBrowserLexicalManifest !== 'function') {
      throw new TypeError('shardModule.loadBrowserLexicalManifest: must be a function');
    }
    const readText = settings.readText || (async (resourcePath) => {
      const resourceUrl = root.chrome.runtime.getURL(resourcePath);
      const response = await fetch(resourceUrl, { cache: 'no-store' });
      if (!response.ok) throw Object.assign(new Error('Packaged browser lexical resource is unavailable'), {
        code: resourcePath === MANIFEST_PATH ? 'MANIFEST_UNAVAILABLE' : 'SHARD_LOAD_FAILED'
      });
      return response.text();
    });
    return async function loadShardRuntime() {
      try {
        const serializedManifest = await readText(MANIFEST_PATH);
        const manifest = await shardModule.loadBrowserLexicalManifest(serializedManifest);
        if (typeof shardModule.createBrowserLexicalRuntime !== 'function') {
          throw new TypeError('shardModule.createBrowserLexicalRuntime: must be a function');
        }
        const runtime = shardModule.createBrowserLexicalRuntime({
          manifest,
          maxResidentShards: BATCH_LIMITS.distinctShards,
          readText: (relativePath) => readText(`${SHARD_ROOT}/${relativePath}`)
        });
        const lexicalVersion = manifest.rootHash && manifest.rootHash.value;
        if (typeof lexicalVersion !== 'string' || !lexicalVersion) throw new TypeError('manifest root hash is unavailable');
        return Object.freeze({
          runtime,
          lexicalVersion,
          bootstrapProvider,
          status: () => sanitizedStatus({
            mode: runtime.status().failures.length ? 'degraded' : 'ready',
            fallbackActivated: false,
            failures: runtime.status().failures
          })
        });
      } catch (error) {
        const code = stableFailureCode(error, 'MANIFEST_UNAVAILABLE');
        return Object.freeze({
          runtime: null,
          lexicalVersion: bootstrapIdentity(bootstrapProvider),
          bootstrapProvider,
          status: () => sanitizedStatus({
            mode: 'degraded',
            fallbackActivated: true,
            failures: [{ code }]
          })
        });
      }
    };
  }

  function createShardSemanticService(options) {
    const settings = options || {};
    if (typeof settings.loadShardRuntime !== 'function') {
      throw new TypeError('loadShardRuntime: must be a function');
    }
    if (!settings.semanticModule || typeof settings.semanticModule.createSemanticEngine !== 'function') {
      throw new TypeError('semanticModule.createSemanticEngine: must be a function');
    }
    if (!settings.grammarModule || typeof settings.grammarModule.annotateGrammar !== 'function') {
      throw new TypeError('grammarModule.annotateGrammar: must be a function');
    }
    if (!settings.shardedProviderModule ||
        typeof settings.shardedProviderModule.createShardedDictionaryProvider !== 'function') {
      throw new TypeError('shardedProviderModule.createShardedDictionaryProvider: must be a function');
    }
    const now = typeof settings.now === 'function' ? settings.now : () => new Date().toISOString();
    const authorizeSender = typeof settings.authorizeSender === 'function' ? settings.authorizeSender : null;
    let contextPromise = null;
    const controllers = new Map();

    function getContext() {
      if (!contextPromise) contextPromise = Promise.resolve().then(() => settings.loadShardRuntime());
      return contextPromise;
    }

    function senderTabId(sender) {
      const value = sender && sender.tab && sender.tab.id;
      if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('sender.tab.id: is required');
      return value;
    }

    function controllerKey(tabId, requestId) {
      return `${tabId}\u0000${requestId}`;
    }

    function createEngine(provider) {
      return settings.semanticModule.createSemanticEngine({
        provider,
        grammarAnnotator: settings.grammarModule.annotateGrammar
      });
    }

    function annotate(validated, provider, phase, lexicalVersion, generatedAt) {
      const engine = createEngine(provider);
      return deepFreeze(validated.items.map((value) => ({
        schemaVersion: SCHEMA_VERSION,
        requestId: validated.requestId,
        pageEpoch: validated.pageEpoch,
        rootId: value.rootId,
        rootRevision: value.rootRevision,
        analysisKey: value.analysisKey,
        phase,
        annotationSet: engine.annotateText(value.text, {
          languageMode: value.languageMode,
          generatedAt
        }),
        lexicalVersion,
        generatedAt
      })));
    }

    function bootstrapResponse(validated, context, generatedAt, failure) {
      const lexicalVersion = bootstrapIdentity(context.bootstrapProvider);
      const engineStatus = failure
        ? sanitizedStatus({
            mode: 'degraded',
            fallbackActivated: true,
            failures: [{ code: stableFailureCode(failure, 'SHARD_LOAD_FAILED') }]
          })
        : sanitizedStatus(context.status(), { mode: 'degraded', failures: [{ code: 'MANIFEST_UNAVAILABLE' }] });
      const runtimeStatus = context.runtime ? sanitizedStatus({
        mode: context.runtime.status().failures.length ? 'degraded' : engineStatus.mode,
        fallbackActivated: true,
        failures: context.runtime.status().failures.length ? context.runtime.status().failures : engineStatus.failures
      }) : engineStatus;
      return deepFreeze({
        schemaVersion: SCHEMA_VERSION,
        requestId: validated.requestId,
        pageEpoch: validated.pageEpoch,
        results: annotate(validated, context.bootstrapProvider, 'bootstrap', lexicalVersion, generatedAt),
        status: runtimeStatus
      });
    }

    function cancelledResponse(validated) {
      return deepFreeze({
        schemaVersion: SCHEMA_VERSION,
        requestId: validated.requestId,
        pageEpoch: validated.pageEpoch,
        status: 'cancelled',
        results: []
      });
    }

    function validateRequestEnvelope(message) {
      if (!message || typeof message !== 'object' || Array.isArray(message) || message.type !== 'HALO_ENRICH_BATCH') {
        throw new TypeError('message: must be HALO_ENRICH_BATCH');
      }
      if (!validStableId(message.requestId)) throw new TypeError('requestId: must be a stable ID');
      if (!Number.isSafeInteger(message.pageEpoch) || message.pageEpoch < 1) {
        throw new TypeError('pageEpoch: must be a positive integer');
      }
      return Object.freeze({ requestId: message.requestId, pageEpoch: message.pageEpoch });
    }

    async function enrichBatch(message, sender) {
      const envelope = validateRequestEnvelope(message);
      const tabId = senderTabId(sender);
      const key = controllerKey(tabId, envelope.requestId);
      if (controllers.has(key)) throw new TypeError('requestId: is already active for this sender');
      const controller = new AbortController();
      controllers.set(key, controller);
      try {
        if (authorizeSender) {
          let allowed = false;
          try { allowed = await authorizeSender(sender); } catch (_error) { allowed = false; }
          if (controller.signal.aborted) return cancelledResponse(envelope);
          if (allowed !== true) return deepFreeze({ error: 'SENSITIVE_SITE_BLOCKED' });
        }
        if (controller.signal.aborted) return cancelledResponse(envelope);
        const shallow = validateEnrichmentRequest(message, null);
        if (controller.signal.aborted) return cancelledResponse(shallow);
        const context = await getContext();
        if (controller.signal.aborted) return cancelledResponse(shallow);
        if (!context || !context.bootstrapProvider || typeof context.bootstrapProvider.lookup !== 'function') {
          throw new Error('Local bootstrap provider is unavailable');
        }
        const validated = validateEnrichmentRequest(message, context.runtime);
        if (controller.signal.aborted) return cancelledResponse(validated);
        const generatedAt = now();
        if (controller.signal.aborted) return cancelledResponse(validated);
        if (!context.runtime) return bootstrapResponse(validated, context, generatedAt);
        try {
          if (typeof context.runtime.withEnsuredShards !== 'function') {
            throw new TypeError('runtime.withEnsuredShards: is required');
          }
          const response = await context.runtime.withEnsuredShards(
            validated.shardIds,
            { signal: controller.signal },
            (pinnedShards) => {
              if (controller.signal.aborted) return cancelledResponse(validated);
              const provider = settings.shardedProviderModule.createShardedDictionaryProvider({
                runtime: context.runtime,
                pinnedShards,
                bootstrapProvider: context.bootstrapProvider
              });
              return deepFreeze({
                schemaVersion: SCHEMA_VERSION,
                requestId: validated.requestId,
                pageEpoch: validated.pageEpoch,
                results: annotate(validated, provider, 'lexical', context.lexicalVersion, generatedAt),
                status: sanitizedStatus(provider)
              });
            }
          );
          return controller.signal.aborted ? cancelledResponse(validated) : response;
        } catch (error) {
          if (controller.signal.aborted || stableFailureCode(error, '') === 'ABORTED') {
            return cancelledResponse(validated);
          }
          return bootstrapResponse(validated, context, generatedAt, error);
        }
      } finally {
        if (controllers.get(key) === controller) controllers.delete(key);
      }
    }

    function cancelRequest(message, sender) {
      if (!message || typeof message !== 'object' || !validStableId(message.requestId)) {
        throw new TypeError('requestId: must be a stable ID');
      }
      const tabId = senderTabId(sender);
      const controller = controllers.get(controllerKey(tabId, message.requestId));
      if (!controller) {
        return deepFreeze({ schemaVersion: SCHEMA_VERSION, requestId: message.requestId, status: 'not-found' });
      }
      controller.abort();
      return deepFreeze({ schemaVersion: SCHEMA_VERSION, requestId: message.requestId, status: 'cancelled' });
    }

    async function handleMessage(message, sender) {
      if (!message || typeof message !== 'object') return null;
      if (message.type === 'HALO_ENRICH_BATCH') return enrichBatch(message, sender);
      if (message.type === 'HALO_CANCEL_REQUEST') return cancelRequest(message, sender);
      if (message.type === 'HALO_DICTIONARY_STATUS') return sanitizedStatus((await getContext()).status());
      return null;
    }

    return Object.freeze({ enrichBatch, cancelRequest, handleMessage });
  }

  function createWorkerPolicyAuthorizer(options) {
    const settings = options || {};
    const storage = settings.storage;
    const policyModule = settings.sitePolicyModule || SitePolicy;
    const settingsModule = settings.settingsModule || Settings;
    if (!storage || typeof storage.get !== 'function' || !policyModule ||
        typeof policyModule.classifySite !== 'function' || !settingsModule ||
        typeof settingsModule.migrateSettings !== 'function') {
      return async () => false;
    }
    return async function authorizeSender(sender) {
      try {
        const url = sender && sender.tab && sender.tab.url;
        if (typeof url !== 'string') return false;
        const stored = await storage.get('haloSettings');
        const profile = settingsModule.migrateSettings(stored && stored.haloSettings);
        const decision = policyModule.classifySite({
          url,
          userDenylist: profile.sitePolicy.userDenylist,
          sensitiveAttributes: []
        });
        return decision.allow === true;
      } catch (_error) {
        return false;
      }
    };
  }

  function createBrowserTriggerService(options) {
    const settings = options || {};
    const chromeApi = settings.chrome;
    const browserEntry = settings.browserEntry || BrowserEntry;
    if (!chromeApi || !chromeApi.runtime || !chromeApi.contextMenus || !chromeApi.commands || !chromeApi.tabs) {
      throw new TypeError('Chrome trigger APIs are unavailable');
    }
    if (!browserEntry || typeof browserEntry.injectAndSendExplicitSelection !== 'function') {
      throw new TypeError('Canonical browser entry is unavailable');
    }
    let registered = false;

    function runSafely(callback) {
      return Promise.resolve()
        .then(callback)
        .then((value) => value === false ? false : true, () => false);
    }

    function callbackCall(method, args, ignoreLastError) {
      return new Promise((resolve, reject) => {
        method(...args, () => {
          const lastError = chromeApi.runtime.lastError;
          if (lastError && !ignoreLastError) {
            reject(new Error('Chrome trigger API request failed'));
            return;
          }
          resolve(!lastError);
        });
      });
    }

    async function installContextMenu() {
      await callbackCall(
        chromeApi.contextMenus.remove.bind(chromeApi.contextMenus),
        [CONTEXT_MENU_ID],
        true
      );
      return callbackCall(
        chromeApi.contextMenus.create.bind(chromeApi.contextMenus),
        [{
          id: CONTEXT_MENU_ID,
          title: 'Analyze selection with Halo Learning',
          contexts: ['selection']
        }],
        false
      );
    }

    function invoke(tabId) {
      return browserEntry.injectAndSendExplicitSelection({ chrome: chromeApi, tabId });
    }

    function handleContextClick(info, tab) {
      if (!info || info.menuItemId !== CONTEXT_MENU_ID ||
          !tab || !Number.isSafeInteger(tab.id) || tab.id < 0) return Promise.resolve(false);
      return runSafely(() => invoke(tab.id));
    }

    function handleCommand(command) {
      if (command !== COMMAND_ID) return Promise.resolve(false);
      return runSafely(async () => {
        const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
        const tab = Array.isArray(tabs) ? tabs.find((value) => value && Number.isSafeInteger(value.id) && value.id >= 0) : null;
        if (!tab) return false;
        await invoke(tab.id);
        return true;
      });
    }

    function register() {
      if (registered) return false;
      registered = true;
      chromeApi.runtime.onInstalled.addListener(() => { runSafely(installContextMenu); });
      chromeApi.contextMenus.onClicked.addListener((info, tab) => { handleContextClick(info, tab); });
      chromeApi.commands.onCommand.addListener((command) => { handleCommand(command); });
      return true;
    }

    return Object.freeze({
      installContextMenu,
      handleContextClick,
      handleCommand,
      runSafely,
      register
    });
  }

  function initializeBrowser() {
    if (!root.chrome || !root.chrome.runtime || !root.chrome.runtime.onMessage) return null;
    if (root.__HALO_SEMANTIC_SERVICE_INITIALIZED__) return root.__HALO_SEMANTIC_SERVICE_INITIALIZED__;
    const service = createShardSemanticService({
      loadShardRuntime: createBrowserShardLoader(),
      semanticModule: root.HaloSemanticAnnotations,
      grammarModule: root.HaloGrammarAnnotations,
      shardedProviderModule: root.HaloShardedDictionaryProvider,
      authorizeSender: createWorkerPolicyAuthorizer({ storage: root.chrome.storage && root.chrome.storage.local })
    });
    root.__HALO_SEMANTIC_SERVICE_INITIALIZED__ = service;
    root.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || !['HALO_ENRICH_BATCH', 'HALO_CANCEL_REQUEST', 'HALO_DICTIONARY_STATUS'].includes(message.type)) {
        return false;
      }
      service.handleMessage(message, sender)
        .then((response) => sendResponse(response))
        .catch((error) => sendResponse({
          error: 'SEMANTIC_SERVICE_ERROR',
          detail: error instanceof TypeError ? 'INVALID_REQUEST' : 'LOCAL_SERVICE_UNAVAILABLE'
        }));
      return true;
    });
    return service;
  }

  function initializeBrowserTriggers() {
    if (!root.chrome || !root.chrome.runtime || !root.chrome.runtime.onInstalled ||
        !root.chrome.contextMenus || !root.chrome.commands || !root.chrome.tabs) return null;
    if (root.__HALO_BROWSER_TRIGGER_INITIALIZED__) return root.__HALO_BROWSER_TRIGGER_INITIALIZED__;
    const service = createBrowserTriggerService({ chrome: root.chrome, browserEntry: BrowserEntry });
    service.register();
    root.__HALO_BROWSER_TRIGGER_INITIALIZED__ = service;
    return service;
  }

  return Object.freeze({
    SCHEMA_VERSION,
    BATCH_LIMITS,
    validateEnrichmentRequest,
    createBrowserShardLoader,
    createShardSemanticService,
    createWorkerPolicyAuthorizer,
    createBrowserTriggerService,
    initializeBrowser,
    initializeBrowserTriggers
  });
});
