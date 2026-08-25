(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloContent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'CODE', 'PRE', 'KBD', 'SAMP', 'BUTTON', 'SVG', 'MATH'
  ]);
  const CONTENT_ROOT_SELECTOR = [
    'article', 'main', 'section', 'p', 'li', 'blockquote', 'figure', 'figcaption',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'dd', 'dt'
  ].join(',');

  function normalizedViewportBuffer(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 1200;
    return Math.min(1200, Math.max(0, Math.round(number)));
  }

  function viewportRootMargin(value) {
    const buffer = normalizedViewportBuffer(value);
    return `${buffer}px 0px ${buffer}px 0px`;
  }

  function buildEnrichmentItems(records, options, Progressive) {
    const settings = options || {};
    if (!Progressive || typeof Progressive.createAnalysisKey !== 'function') {
      throw new TypeError('Canonical progressive analysis key module is unavailable');
    }
    return Object.freeze((Array.isArray(records) ? records : []).map((record, index) => {
      const languageMode = ['en', 'zh-Hant', 'both'].includes(settings.languageMode)
        ? settings.languageMode
        : (['en', 'zh-Hant', 'both'].includes(record.language) ? record.language : 'both');
      const item = {
        rootId: `${settings.rootId}:s${index}`,
        rootRevision: record.rootRevision,
        text: record.text,
        languageMode,
        semanticVersion: settings.semanticVersion,
        grammarVersion: settings.grammarVersion,
        profileRevision: settings.profileRevision,
        lexicalVersion: settings.lexicalVersion
      };
      item.analysisKey = Progressive.createAnalysisKey(item);
      return Object.freeze(item);
    }));
  }

  function validateEnrichmentResponse(response, request, Contracts) {
    if (!Contracts || typeof Contracts.normalizeAnnotationSet !== 'function' ||
        !Number.isInteger(Contracts.SEMANTIC_SCHEMA_VERSION)) {
      throw new TypeError('canonical semantic contracts are required');
    }
    const schemaVersion = Contracts.SEMANTIC_SCHEMA_VERSION;
    if (!response || typeof response !== 'object' || response.error ||
        response.schemaVersion !== schemaVersion ||
        response.requestId !== request.requestId || response.pageEpoch !== request.pageEpoch ||
        !Array.isArray(request.items) || !Array.isArray(response.results) ||
        response.results.length !== request.items.length) return null;
    const expectedByRoot = new Map(request.items.map((item) => [item.rootId, item]));
    if (expectedByRoot.size !== request.items.length) return null;
    const seen = new Set();
    const normalized = [];
    try {
      for (const result of response.results) {
        if (!result || typeof result !== 'object' || result.schemaVersion !== schemaVersion ||
            seen.has(result.rootId)) return null;
        const expected = expectedByRoot.get(result.rootId);
        if (!expected || result.requestId !== request.requestId ||
            result.pageEpoch !== request.pageEpoch || result.rootRevision !== expected.rootRevision ||
            result.analysisKey !== expected.analysisKey || !['bootstrap', 'lexical'].includes(result.phase) ||
            result.lexicalVersion !== expected.lexicalVersion || typeof result.generatedAt !== 'string') return null;
        const annotationSet = Contracts.normalizeAnnotationSet(result.annotationSet);
        if (annotationSet.textLength !== expected.text.length ||
            annotationSet.languageMode !== expected.languageMode ||
            annotationSet.generatedAt !== result.generatedAt ||
            annotationSet.tokens.some((token) => expected.text.slice(token.start, token.end) !== token.surface)) return null;
        seen.add(result.rootId);
        normalized.push(Object.freeze({ ...result, annotationSet }));
      }
    } catch (_error) {
      return null;
    }
    if (seen.size !== expectedByRoot.size) return null;
    return Object.freeze({
      results: Object.freeze(normalized),
      providerMode: response.status && ['ready', 'degraded', 'bootstrap-only'].includes(response.status.mode)
        ? response.status.mode
        : 'degraded'
    });
  }

  function estimateSemanticTokens(text) {
    let count = 0;
    for (const _match of String(text || '').matchAll(/\p{Script=Han}|[\p{Script=Latin}\p{M}]+(?:['’][\p{Script=Latin}\p{M}]+)*/gu)) {
      count += 1;
    }
    return count;
  }

  function rootWorkIsCurrent(work, revisionSource) {
    const payload = work && work.payload;
    if (!payload || !payload.element || payload.element.isConnected === false ||
        !revisionSource || typeof revisionSource.isRootRevisionCurrent !== 'function') return false;
    try {
      return revisionSource.isRootRevisionCurrent(payload.element, payload.rootRevision);
    } catch (_error) {
      return false;
    }
  }

  function buildRootWork(element, options) {
    const settings = options || {};
    const pipeline = settings.pipeline;
    if (!pipeline || typeof pipeline.buildSentenceRecords !== 'function') {
      throw new TypeError('pipeline.buildSentenceRecords: must be a function');
    }
    const runtimeSettings = settings.settings || {};
    const budgets = runtimeSettings.runtimeBudgets || {};
    const rootRevision = Number.isSafeInteger(settings.rootRevision) && settings.rootRevision > 0
      ? settings.rootRevision
      : 1;
    const locale = runtimeSettings.languageMode === 'en' ? 'en' : 'zh-Hant';
    const records = pipeline.buildSentenceRecords(element, {
      rootRevision,
      locale
    });
    const chunks = [];
    let current = null;

    function blankChunk() {
      return { records: [], nodeIds: new Set(), characters: 0, semanticTokens: 0 };
    }

    function appendChunk() {
      if (!current || !current.records.length) return;
      const index = chunks.length;
      chunks.push(Object.freeze({
        id: `${settings.rootId}:w${index}`,
        rootId: settings.rootId,
        epoch: settings.epoch,
        priority: settings.priority,
        visible: Boolean(settings.visible),
        textNodes: current.nodeIds.size,
        characters: current.characters,
        sentences: current.records.length,
        semanticTokens: current.semanticTokens,
        shardIds: Object.freeze([]),
        payload: Object.freeze({
          element,
          rootRevision,
          locale,
          records: Object.freeze([...current.records])
        })
      }));
      current = blankChunk();
    }

    current = blankChunk();
    for (const record of records) {
      const nextNodeIds = new Set(current.nodeIds);
      for (const fragment of record.fragments || []) nextNodeIds.add(fragment.nodeId);
      const nextCharacters = current.characters + record.text.length;
      const nextSemanticTokens = current.semanticTokens + estimateSemanticTokens(record.text);
      const exceeds = current.records.length > 0 && (
        nextNodeIds.size > budgets.maxTextNodes ||
        nextCharacters > budgets.maxCharacters ||
        current.records.length + 1 > budgets.maxSentences ||
        nextSemanticTokens > budgets.maxSemanticTokens
      );
      if (exceeds) {
        appendChunk();
        nextNodeIds.clear();
        for (const fragment of record.fragments || []) nextNodeIds.add(fragment.nodeId);
      }
      current.records.push(record);
      current.nodeIds = nextNodeIds;
      current.characters += record.text.length;
      current.semanticTokens += estimateSemanticTokens(record.text);
    }
    appendChunk();
    return Object.freeze(chunks);
  }

  function createViewportDiscovery(options) {
    const settings = options || {};
    const document = settings.document;
    const NodeFilter = settings.NodeFilter;
    const IntersectionObserverClass = settings.IntersectionObserver;
    const scheduler = settings.scheduler;
    if (!document || typeof document.createTreeWalker !== 'function') {
      throw new TypeError('document.createTreeWalker: must be a function');
    }
    if (!NodeFilter || NodeFilter.SHOW_ELEMENT === undefined) throw new TypeError('NodeFilter.SHOW_ELEMENT: is required');
    if (typeof IntersectionObserverClass !== 'function') throw new TypeError('IntersectionObserver: is required');
    if (!scheduler || typeof scheduler.enqueue !== 'function' || typeof scheduler.cancelRoot !== 'function') {
      throw new TypeError('scheduler enqueue/cancelRoot: are required');
    }
    if (typeof settings.makeWork !== 'function') throw new TypeError('makeWork: must be a function');
    const budgets = settings.budgets || {};
    const timeSliceMs = Math.min(8, Math.max(1, Number(budgets.timeSliceMs) || 8));
    const now = settings.clock && typeof settings.clock.now === 'function'
      ? () => settings.clock.now()
      : () => root.performance && typeof root.performance.now === 'function' ? root.performance.now() : Date.now();
    const requestIdle = typeof settings.requestIdleCallback === 'function'
      ? settings.requestIdleCallback
      : (typeof root.requestIdleCallback === 'function' ? root.requestIdleCallback.bind(root) : null);
    const cancelIdle = typeof settings.cancelIdleCallback === 'function'
      ? settings.cancelIdleCallback
      : (typeof root.cancelIdleCallback === 'function' ? root.cancelIdleCallback.bind(root) : null);
    const scheduleTimeout = typeof settings.setTimeout === 'function'
      ? settings.setTimeout
      : root.setTimeout.bind(root);
    const cancelTimeout = typeof settings.clearTimeout === 'function'
      ? settings.clearTimeout
      : root.clearTimeout.bind(root);
    const observed = new WeakSet();
    const intersecting = new WeakSet();
    const rootIds = new WeakMap();
    const rootRevisions = new Map();
    const walker = document.createTreeWalker(
      document.body || document.documentElement,
      NodeFilter.SHOW_ELEMENT
    );
    let rootSequence = 0;
    let candidatesVisited = 0;
    let observedRoots = 0;
    let scheduledHandle = null;
    let scheduledKind = null;
    let done = false;
    let disconnected = false;

    function candidateRoot(element) {
      if (!element || element.nodeType !== 1) return null;
      const contentRoot = typeof element.matches === 'function' && element.matches(CONTENT_ROOT_SELECTOR)
        ? element
        : (typeof element.closest === 'function' ? element.closest(CONTENT_ROOT_SELECTOR) : null);
      if (contentRoot && typeof contentRoot.querySelector === 'function' &&
          contentRoot.querySelector(CONTENT_ROOT_SELECTOR)) return null;
      return contentRoot;
    }

    function rootIdFor(element) {
      if (!rootIds.has(element)) {
        const hint = typeof element.id === 'string' && element.id.length <= 96 &&
          /^[A-Za-z0-9._:-]+$/.test(element.id) ? element.id : null;
        rootIds.set(element, hint || `halo-root-${++rootSequence}`);
      }
      return rootIds.get(element);
    }

    function rootRevisionFor(element) {
      const rootId = rootIdFor(element);
      if (!rootRevisions.has(rootId)) rootRevisions.set(rootId, 1);
      return rootRevisions.get(rootId);
    }

    function enqueueVisible(element, priority) {
      if (!element || element.isConnected === false) return false;
      const rootId = rootIdFor(element);
      const workValue = settings.makeWork(element, true, {
        rootId,
        priority,
        rootRevision: rootRevisionFor(element)
      });
      if (!workValue) return false;
      if (Array.isArray(workValue)) {
        const accepted = scheduler.enqueue(workValue.map((item) => ({ ...item, rootId, priority, visible: true })));
        if (typeof scheduler.flush === 'function') scheduler.flush();
        return accepted;
      }
      const accepted = scheduler.enqueue({ ...workValue, rootId, priority, visible: true });
      if (typeof scheduler.flush === 'function') scheduler.flush();
      return accepted;
    }

    function observe(element) {
      const contentRoot = candidateRoot(element);
      if (!contentRoot || observed.has(contentRoot)) return null;
      observed.add(contentRoot);
      rootIdFor(contentRoot);
      rootRevisionFor(contentRoot);
      observer.observe(contentRoot);
      observedRoots += 1;
      return contentRoot;
    }

    const observer = new IntersectionObserverClass((entries) => {
      for (const entry of entries || []) {
        const contentRoot = candidateRoot(entry.target);
        if (!contentRoot) continue;
        if (entry.isIntersecting) {
          if (intersecting.has(contentRoot)) continue;
          intersecting.add(contentRoot);
          enqueueVisible(contentRoot, 'inferred');
        } else {
          intersecting.delete(contentRoot);
          scheduler.cancelRoot(rootIdFor(contentRoot));
        }
      }
    }, {
      root: null,
      rootMargin: viewportRootMargin(budgets.viewportBufferPx),
      threshold: 0
    });

    function initialRoots() {
      if (typeof document.elementsFromPoint !== 'function') return [];
      const width = Math.max(1, Number(settings.innerWidth) || Number(root.innerWidth) || 1);
      const height = Math.max(1, Number(settings.innerHeight) || Number(root.innerHeight) || 1);
      const roots = [];
      const seen = new Set();
      for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
        const y = Math.min(height - 1, Math.max(0, Math.round((height - 1) * ratio)));
        for (const element of document.elementsFromPoint(Math.round(width / 2), y) || []) {
          const contentRoot = candidateRoot(element);
          if (!contentRoot || seen.has(contentRoot)) continue;
          seen.add(contentRoot);
          roots.push(contentRoot);
        }
      }
      return roots.slice(0, 32);
    }

    function discoverSlice() {
      scheduledHandle = null;
      scheduledKind = null;
      if (disconnected || done) return;
      const startedAt = now();
      let visitedThisSlice = 0;
      while (visitedThisSlice < 32) {
        if (visitedThisSlice && now() - startedAt >= timeSliceMs) break;
        const candidate = walker.nextNode();
        if (!candidate) {
          done = true;
          break;
        }
        candidatesVisited += 1;
        visitedThisSlice += 1;
        observe(candidate);
      }
      if (!done) scheduleDiscovery();
    }

    function scheduleDiscovery() {
      if (disconnected || done || scheduledHandle !== null) return;
      if (requestIdle) {
        scheduledKind = 'idle';
        let invoked = false;
        scheduledHandle = true;
        const handle = requestIdle(() => {
          invoked = true;
          scheduledHandle = null;
          discoverSlice();
        }, { timeout: Math.max(32, timeSliceMs * 4) });
        if (!invoked) scheduledHandle = handle;
      } else {
        scheduledKind = 'timeout';
        let invoked = false;
        scheduledHandle = true;
        const handle = scheduleTimeout(() => {
          invoked = true;
          scheduledHandle = null;
          discoverSlice();
        }, 0);
        if (!invoked) scheduledHandle = handle;
      }
    }

    function start() {
      if (disconnected) return status();
      for (const contentRoot of initialRoots()) {
        observe(contentRoot);
        intersecting.add(contentRoot);
        enqueueVisible(contentRoot, 'explicit');
      }
      scheduleDiscovery();
      return status();
    }

    function contentRootsWithin(value) {
      const element = value && value.nodeType === 1 ? value : value && value.parentElement;
      if (!element) return [];
      const direct = candidateRoot(element);
      if (direct) return [direct];
      if (typeof element.querySelectorAll !== 'function') return [];
      const roots = [];
      const seen = new Set();
      for (const descendant of element.querySelectorAll(CONTENT_ROOT_SELECTOR)) {
        const contentRoot = candidateRoot(descendant);
        if (!contentRoot || seen.has(contentRoot)) continue;
        seen.add(contentRoot);
        roots.push(contentRoot);
      }
      return roots;
    }

    function changedContentRoots(values) {
      const changed = [];
      const seen = new Set();
      for (const value of Array.from(values || [])) {
        for (const contentRoot of contentRootsWithin(value)) {
          if (seen.has(contentRoot) || contentRoot.isConnected === false) continue;
          seen.add(contentRoot);
          changed.push(contentRoot);
        }
      }
      return changed;
    }

    function invalidateRoots(values) {
      if (disconnected) return 0;
      const changed = changedContentRoots(values);
      for (const contentRoot of changed) {
        const rootId = rootIdFor(contentRoot);
        const wasObserved = observed.has(contentRoot);
        scheduler.cancelRoot(rootId);
        if (wasObserved || rootRevisions.has(rootId)) {
          rootRevisions.set(rootId, rootRevisionFor(contentRoot) + 1);
        } else {
          rootRevisions.set(rootId, 1);
        }
      }
      return changed.length;
    }

    function refreshRoots(values, options) {
      if (disconnected) return 0;
      const settings = options || {};
      const changed = changedContentRoots(values);
      for (const contentRoot of changed) {
        const rootId = rootIdFor(contentRoot);
        const wasObserved = observed.has(contentRoot);
        const wasIntersecting = intersecting.has(contentRoot);
        if (!settings.alreadyInvalidated) {
          scheduler.cancelRoot(rootId);
          if (wasObserved || rootRevisions.has(rootId)) {
            rootRevisions.set(rootId, rootRevisionFor(contentRoot) + 1);
          } else {
            rootRevisions.set(rootId, 1);
          }
        }
        if (wasObserved && typeof observer.unobserve === 'function') observer.unobserve(contentRoot);
        if (!wasObserved) {
          observed.add(contentRoot);
          observedRoots += 1;
        }
        intersecting.delete(contentRoot);
        observer.observe(contentRoot);
        if (wasIntersecting) {
          intersecting.add(contentRoot);
          enqueueVisible(contentRoot, 'inferred');
        }
      }
      return changed.length;
    }

    function isRootRevisionCurrent(element, revision) {
      return Boolean(element && element.isConnected !== false &&
        Number.isSafeInteger(revision) && rootRevisionFor(element) === revision);
    }

    function releaseRoots(values) {
      if (disconnected) return 0;
      const released = new Set();
      for (const value of Array.from(values || [])) {
        for (const contentRoot of contentRootsWithin(value)) {
          if (released.has(contentRoot)) continue;
          released.add(contentRoot);
          scheduler.cancelRoot(rootIdFor(contentRoot));
          intersecting.delete(contentRoot);
          if (typeof observer.unobserve === 'function') observer.unobserve(contentRoot);
        }
      }
      return released.size;
    }

    function disconnect() {
      disconnected = true;
      observer.disconnect();
      if (scheduledHandle !== null) {
        if (scheduledKind === 'idle' && cancelIdle) cancelIdle(scheduledHandle);
        if (scheduledKind === 'timeout') cancelTimeout(scheduledHandle);
      }
      scheduledHandle = null;
      scheduledKind = null;
      rootRevisions.clear();
    }

    function status() {
      return Object.freeze({ candidatesVisited, observedRoots, done, disconnected });
    }

    return Object.freeze({
      start,
      invalidateRoots,
      refreshRoots,
      releaseRoots,
      isRootRevisionCurrent,
      disconnect,
      status
    });
  }

  function buildSegments(text, renderPlan) {
    const source = String(text || '');
    const marked = (Array.isArray(renderPlan) ? renderPlan : [])
      .filter((item) => item && item.marked && Number.isInteger(item.start) && Number.isInteger(item.end))
      .filter((item) => item.start >= 0 && item.end <= source.length && item.end > item.start)
      .sort((left, right) => left.start - right.start || left.end - right.end);

    const out = [];
    let cursor = 0;
    for (const item of marked) {
      if (item.start < cursor) continue;
      if (item.start > cursor) out.push({ text: source.slice(cursor, item.start), marked: false });
      out.push({
        text: source.slice(item.start, item.end),
        marked: true,
        pos: item.pos,
        label: item.label,
        colorClass: item.colorClass,
        labelPosition: item.labelPosition,
        confidence: item.confidence,
        metaLabel: item.metaLabel,
        glossHint: item.glossHint,
        chunkClass: item.chunkClass
      });
      cursor = item.end;
    }
    if (cursor < source.length) out.push({ text: source.slice(cursor), marked: false });
    if (!out.length && source) out.push({ text: source, marked: false });
    return out;
  }

  function shouldSkipElement(element) {
    if (!element || element.nodeType !== 1) return false;
    if (SKIP_TAGS.has(element.tagName)) return true;
    if (element.closest('[data-halo-token="1"]')) return true;
    if (element.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"]')) return true;
    if (element.closest('nav, [aria-hidden="true"]')) return true;
    return false;
  }

  function bootstrapAnnotationSets(texts, settings, Dictionary, Semantic, generatedAt) {
    if (!Dictionary || typeof Dictionary.createBootstrapDictionaryProvider !== 'function') {
      throw new TypeError('Dictionary bootstrap provider is unavailable');
    }
    if (!Semantic || typeof Semantic.createSemanticEngine !== 'function') {
      throw new TypeError('Semantic engine is unavailable');
    }
    const provider = Dictionary.createBootstrapDictionaryProvider();
    const engine = Semantic.createSemanticEngine({ provider });
    return Object.freeze((Array.isArray(texts) ? texts : []).map((text) => engine.annotateText(text, {
      languageMode: settings && settings.languageMode ? settings.languageMode : 'both',
      generatedAt
    })));
  }

  function initBrowser() {
    if (!root.document || !root.chrome || !root.chrome.runtime) return;
    if (root.__HALO_CONTENT_INITIALIZED__) return;
    root.__HALO_CONTENT_INITIALIZED__ = true;

    const emptyStatus = () => Object.freeze({
      active: false,
      textNodesVisited: 0,
      semanticTokens: 0,
      markedTokens: 0,
      providerMode: null,
      oversizedWork: Object.freeze([]),
      lastError: null
    });
    let lastStatus = emptyStatus();
    let activeRuntime = null;
    let activeController = null;
    let requestSequence = 0;

    function isVisible(element) {
      if (!element || !root.getComputedStyle) return true;
      const style = root.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function eligibleTextNode(node) {
      if (!node || !node.parentElement) return false;
      if (shouldSkipElement(node.parentElement)) return false;
      const text = node.nodeValue || '';
      if (!/[A-Za-z\p{Script=Han}]/u.test(text)) return false;
      if (!text.trim()) return false;
      return isVisible(node.parentElement);
    }

    function isSensitivePage() {
      const location = root.location;
      if (!location || !['http:', 'https:'].includes(location.protocol)) return true;
      if (/(?:^|\/)(?:login|signin|sign-in|auth|checkout|payment|banking)(?:\/|$)/i.test(location.pathname || '')) {
        return true;
      }
      return Boolean(root.document.querySelector(
        'input[type="password"], input[autocomplete="current-password"], input[autocomplete="new-password"], input[autocomplete="one-time-code"]'
      ));
    }

    function removeRenderedDom() {
      const parents = new Set();
      const markedNodes = Array.from(root.document.querySelectorAll('[data-halo-token="1"]'));
      for (const span of markedNodes) {
        const parent = span.parentNode;
        if (!parent) continue;
        parents.add(parent);
        parent.replaceChild(root.document.createTextNode(span.dataset.haloOriginal || span.textContent || ''), span);
      }
      for (const parent of parents) if (typeof parent.normalize === 'function') parent.normalize();
    }

    function removeMarking() {
      if (activeController) {
        const controller = activeController;
        controller.cleanup();
        if (activeController === controller) activeController = null;
      } else {
        if (activeRuntime) {
          activeRuntime.discovery.disconnect();
          activeRuntime.scheduler.cancelAll();
          activeRuntime = null;
        }
        removeRenderedDom();
      }
      lastStatus = emptyStatus();
      return lastStatus;
    }

    function spanFor(segment) {
      const span = root.document.createElement('span');
      span.dataset.haloToken = '1';
      span.dataset.haloOriginal = segment.text;
      if (segment.label) span.dataset.haloPos = segment.label;
      if (segment.metaLabel) span.dataset.haloMeta = segment.metaLabel;
      if (segment.glossHint) {
        span.dataset.haloGloss = segment.glossHint;
        span.title = segment.glossHint;
      }
      if (Number.isFinite(segment.confidence)) span.dataset.haloConfidence = String(segment.confidence);
      span.className = 'halo-token';
      if (segment.label) span.classList.add(`halo-label-${segment.labelPosition || 'top-right'}`);
      if (segment.metaLabel) span.classList.add('halo-has-meta');
      if (segment.colorClass) span.classList.add(segment.colorClass);
      if (segment.chunkClass) span.classList.add(segment.chunkClass);
      span.textContent = segment.text;
      return span;
    }

    function replaceTextNode(node, segments) {
      if (!segments.some((segment) => segment.marked)) return 0;
      const fragment = root.document.createDocumentFragment();
      let count = 0;
      for (const segment of segments) {
        if (segment.marked) {
          fragment.appendChild(spanFor(segment));
          count += 1;
        } else if (segment.text) {
          fragment.appendChild(root.document.createTextNode(segment.text));
        }
      }
      node.parentNode.replaceChild(fragment, node);
      return count;
    }

    async function requestEnrichment(batch, context, modules, settings, epoch, lexicalVersion) {
      const items = [];
      for (const work of batch.items) {
        const workRecords = work.payload.records;
        items.push(...buildEnrichmentItems(workRecords, {
          rootId: work.id,
          languageMode: settings.languageMode,
          semanticVersion: modules.Semantic.ENGINE.version,
          grammarVersion: modules.Grammar.ALGORITHM.version,
          profileRevision: settings.profileRevision,
          lexicalVersion
        }, modules.Progressive));
      }
      const request = {
        type: 'HALO_ENRICH_BATCH',
        requestId: `req-${epoch}-${++requestSequence}`,
        pageEpoch: epoch,
        items
      };
      const cancel = () => {
        root.chrome.runtime.sendMessage({ type: 'HALO_CANCEL_REQUEST', requestId: request.requestId }).catch(() => {});
      };
      context.signal.addEventListener('abort', cancel, { once: true });
      try {
        const response = await root.chrome.runtime.sendMessage(request);
        if (context.signal.aborted || !activeRuntime || activeRuntime.epoch !== epoch) return null;
        const validated = validateEnrichmentResponse(response, request, modules.Contracts);
        if (!validated) throw new Error('Local semantic service returned an invalid response');
        return validated;
      } catch (error) {
        if (context.signal.aborted || !activeRuntime || activeRuntime.epoch !== epoch) return null;
        throw error;
      } finally {
        context.signal.removeEventListener('abort', cancel);
      }
    }

    function renderBatch(batch, results, modules, settings) {
      const byItemId = new Map(results.results.map((result) => [result.rootId, result.annotationSet]));
      const plansByNode = new Map();
      let semanticTokens = 0;
      for (const work of batch.items) {
        const payload = work.payload;
        if (!rootWorkIsCurrent(work, activeRuntime && activeRuntime.discovery)) continue;
        const runs = modules.Pipeline.createTextRuns(payload.element, { rootRevision: payload.rootRevision });
        for (let index = 0; index < payload.records.length; index += 1) {
          const record = payload.records[index];
          const annotationSet = byItemId.get(`${work.id}:s${index}`);
          if (!annotationSet || !Array.isArray(annotationSet.tokens)) continue;
          semanticTokens += annotationSet.tokens.length;
          const plan = modules.Projection.createMarkingPlan(annotationSet.tokens, settings);
          for (const item of plan) {
            if (!item.marked) continue;
            const fragments = modules.Pipeline.mapAggregateSpanToFragments(
              runs,
              record.start + item.start,
              record.start + item.end
            );
            for (const fragment of fragments) {
              if (!fragment.node || !eligibleTextNode(fragment.node)) continue;
              if (!plansByNode.has(fragment.node)) plansByNode.set(fragment.node, []);
              plansByNode.get(fragment.node).push({
                ...item,
                text: fragment.node.nodeValue.slice(fragment.start, fragment.end),
                start: fragment.start,
                end: fragment.end
              });
            }
          }
        }
      }
      let markedTokens = 0;
      const render = () => {
        for (const [node, plan] of plansByNode) {
          if (!node.parentNode) continue;
          markedTokens += replaceTextNode(node, buildSegments(node.nodeValue || '', plan));
        }
      };
      if (activeController) activeController.suppressRendererMutations(render);
      else render();
      return Object.freeze({
        semanticTokens,
        markedTokens
      });
    }

    async function startRuntime(settings, epoch) {
      const Dictionary = root.HaloDictionary;
      const Semantic = root.HaloSemanticAnnotations;
      const Grammar = root.HaloGrammarAnnotations;
      const Projection = root.HaloProjection;
      const Pipeline = root.HaloSentencePipeline;
      const Progressive = root.HaloProgressiveRuntime;
      const RuntimeScheduler = root.HaloRuntimeScheduler;
      const Contracts = root.HaloSemanticContracts;
      if (isSensitivePage()) {
        lastStatus = Object.freeze({ ...emptyStatus(), lastError: 'SENSITIVE_PAGE_BLOCKED' });
        return lastStatus;
      }
      const provider = Dictionary.createBootstrapDictionaryProvider();
      const lexicalVersion = `${provider.id}@${provider.version}`;
      const modules = { Semantic, Grammar, Projection, Pipeline, Progressive, Contracts };
      const scheduler = RuntimeScheduler.createRuntimeScheduler({
        budgets: settings.runtimeBudgets,
        processBatch: async (batch, context) => {
          const result = await requestEnrichment(batch, context, modules, settings, epoch, lexicalVersion);
          if (!result || context.signal.aborted || !activeRuntime || activeRuntime.epoch !== epoch) return;
          const rendered = renderBatch(batch, result, modules, settings);
          lastStatus = Object.freeze({
            active: lastStatus.active || rendered.markedTokens > 0,
            textNodesVisited: lastStatus.textNodesVisited + batch.textNodes,
            semanticTokens: lastStatus.semanticTokens + rendered.semanticTokens,
            markedTokens: lastStatus.markedTokens + rendered.markedTokens,
            providerMode: result.providerMode,
            queuedRoots: scheduler.status().queuedRoots,
            oversizedWork: scheduler.status().oversizedWork,
            lastError: null
          });
        },
        onQuarantine: (outcome) => {
          const retained = [...lastStatus.oversizedWork, outcome].slice(-settings.runtimeBudgets.maxQueuedRoots);
          lastStatus = Object.freeze({ ...lastStatus, oversizedWork: Object.freeze(retained) });
        },
        onError: () => {
          lastStatus = Object.freeze({ ...lastStatus, lastError: 'LOCAL_MARKING_ERROR' });
        }
      });
      const discovery = createViewportDiscovery({
        document: root.document,
        NodeFilter: root.NodeFilter,
        IntersectionObserver: root.IntersectionObserver,
        scheduler,
        budgets: settings.runtimeBudgets,
        innerWidth: root.innerWidth,
        innerHeight: root.innerHeight,
        makeWork: (element, visible, metadata) => buildRootWork(element, {
          rootId: metadata.rootId,
          rootRevision: metadata.rootRevision,
          epoch,
          priority: metadata.priority,
          visible,
          settings,
          pipeline: Pipeline
        })
      });
      activeRuntime = { scheduler, discovery, epoch };
      lastStatus = Object.freeze({ ...emptyStatus(), queuedRoots: 0 });
      discovery.start();
      await scheduler.flush();
      if (!activeRuntime || activeRuntime.epoch !== epoch) return lastStatus;
      lastStatus = Object.freeze({
        ...lastStatus,
        queuedRoots: scheduler.status().queuedRoots,
        oversizedWork: scheduler.status().oversizedWork
      });
      return lastStatus;
    }

    async function applyMarking(rawSettings) {
      try {
        const Settings = root.HaloSettings;
        const Dictionary = root.HaloDictionary;
        const Semantic = root.HaloSemanticAnnotations;
        const Grammar = root.HaloGrammarAnnotations;
        const Projection = root.HaloProjection;
        const Pipeline = root.HaloSentencePipeline;
        const Progressive = root.HaloProgressiveRuntime;
        const RuntimeScheduler = root.HaloRuntimeScheduler;
        const Contracts = root.HaloSemanticContracts;
        const DynamicDom = root.HaloDynamicDomController;
        if (!Settings || !Dictionary || !Semantic || !Grammar || !Projection || !Pipeline ||
            !Progressive || !RuntimeScheduler || !Contracts || !DynamicDom) {
          throw new Error('Halo shared modules are not loaded');
        }
        const settings = Settings.normalizeSettings(rawSettings);
        removeMarking();
        if (!settings.enabled) return lastStatus;
        const controller = DynamicDom.createDynamicDomController({
          MutationObserver: root.MutationObserver,
          history: root.history,
          location: root.location,
          eventTarget: root,
          onRootsInvalidated: (roots, metadata) => {
            if (!activeRuntime || activeRuntime.epoch !== metadata.epoch) return;
            activeRuntime.discovery.releaseRoots(metadata.removedRoots);
            activeRuntime.discovery.invalidateRoots(roots);
          },
          onRootsChanged: (roots, metadata) => {
            if (!activeRuntime || activeRuntime.epoch !== metadata.epoch) return;
            activeRuntime.discovery.refreshRoots(roots, { alreadyInvalidated: true });
          },
          onRouteCleanup: ({ epoch }) => {
            if (activeRuntime && activeRuntime.epoch === epoch) {
              activeRuntime.scheduler.cancelEpoch(epoch);
              controller.suppressRendererMutations(removeRenderedDom);
              activeRuntime.discovery.disconnect();
              activeRuntime = null;
            } else {
              controller.suppressRendererMutations(removeRenderedDom);
            }
            lastStatus = emptyStatus();
          },
          onRouteStart: ({ epoch }) => {
            startRuntime(settings, epoch).catch(() => {
              lastStatus = Object.freeze({ ...emptyStatus(), lastError: 'LOCAL_MARKING_ERROR' });
            });
          },
          onError: () => {
            lastStatus = Object.freeze({ ...emptyStatus(), lastError: 'LOCAL_MARKING_ERROR' });
          }
        });
        activeController = controller;
        controller.observe(root.document);
        return await startRuntime(settings, controller.routeEpoch());
      } catch (_error) {
        lastStatus = Object.freeze({ ...emptyStatus(), lastError: 'LOCAL_MARKING_ERROR' });
        return lastStatus;
      }
    }

    root.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || !message.type) return false;
      if (message.type === 'HALO_APPLY_MARKING') {
        applyMarking(message.settings || {}).then((status) => sendResponse(status));
        return true;
      }
      if (message.type === 'HALO_REMOVE_MARKING') {
        sendResponse(removeMarking());
        return false;
      }
      if (message.type === 'HALO_STATUS') {
        sendResponse(lastStatus);
        return false;
      }
      return false;
    });
  }

  initBrowser();
  return Object.freeze({
    bootstrapAnnotationSets,
    buildSegments,
    shouldSkipElement,
    viewportRootMargin,
    buildEnrichmentItems,
    validateEnrichmentResponse,
    rootWorkIsCurrent,
    buildRootWork,
    createViewportDiscovery
  });
});
