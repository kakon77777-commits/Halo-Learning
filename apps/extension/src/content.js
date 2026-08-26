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
  const EXPLICIT_SELECTION_KEYS = Object.freeze(['action', 'type']);

  function validateExplicitSelectionMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
    if (message.type !== 'HALO_EXPLICIT_SELECTION' || message.action !== 'analyze-selection') return false;
    return Object.keys(message).sort().join('\u0000') === EXPLICIT_SELECTION_KEYS.join('\u0000');
  }

  function readExplicitSelection(windowLike) {
    try {
      if (!windowLike || typeof windowLike.getSelection !== 'function') return null;
      const document = windowLike.document;
      if (!document || typeof document !== 'object') return null;
      const selection = windowLike.getSelection();
      if (!selection || selection.isCollapsed !== false || selection.rangeCount !== 1) {
        return null;
      }
      const range = selection.getRangeAt(0);
      if (!range || typeof range !== 'object' || range.collapsed !== false) return null;
      for (const node of [range.startContainer, range.endContainer, range.commonAncestorContainer]) {
        if (!node || typeof node !== 'object' || node.isConnected !== true || node.ownerDocument !== document) return null;
      }
      if (typeof range.toString !== 'function') return null;
      const text = String(range.toString()).trim();
      if (!text || text.length > 4000) return null;
      if (typeof selection.toString !== 'function' || String(selection.toString()).trim() !== text) return null;
      if (typeof range.getBoundingClientRect !== 'function') return null;
      const rect = range.getBoundingClientRect();
      if (!rect || typeof rect !== 'object') return null;
      const values = ['left', 'top', 'right', 'bottom', 'width', 'height'].map((name) => rect[name]);
      if (!values.every((value) => typeof value === 'number' && Number.isFinite(value)) ||
          values[4] < 0 || values[5] < 0 || values[2] < values[0] || values[3] < values[1]) return null;
      const [x, , , bottom] = values;
      return Object.freeze({
        text,
        anchor: Object.freeze({ x, y: bottom + 8 })
      });
    } catch (_error) {
      return null;
    }
  }

  const POLICY_FAILURE_DECISION = Object.freeze({
    schemaVersion: 1,
    allow: false,
    category: 'policy-error',
    reasonCode: 'POLICY_INPUT_ERROR',
    evidenceKind: 'POLICY_ERROR'
  });

  function evaluatePagePolicy(windowLike, options) {
    const settings = options || {};
    const Policy = settings.sitePolicyModule;
    if (!Policy || typeof Policy.classifySite !== 'function' ||
        !Array.isArray(Policy.POLICY_CATEGORIES) ||
        !Array.isArray(Policy.POLICY_REASON_CODES) ||
        !Array.isArray(Policy.POLICY_EVIDENCE_KINDS)) return POLICY_FAILURE_DECISION;
    try {
      const decision = Policy.classifySite({
        url: settings.url,
        userDenylist: settings.userDenylist,
        document: windowLike.document
      });
      if (!decision || !Object.isFrozen(decision) || decision.schemaVersion !== 1 ||
          typeof decision.allow !== 'boolean' || !Policy.POLICY_CATEGORIES.includes(decision.category) ||
          !Policy.POLICY_REASON_CODES.includes(decision.reasonCode) ||
          !Policy.POLICY_EVIDENCE_KINDS.includes(decision.evidenceKind) ||
          Object.keys(decision).sort().join('\u0000') !==
            'allow\u0000category\u0000evidenceKind\u0000reasonCode\u0000schemaVersion') {
        return POLICY_FAILURE_DECISION;
      }
      return decision;
    } catch (_error) {
      return POLICY_FAILURE_DECISION;
    }
  }

  function readExplicitSelectionAfterPolicy(windowLike, options) {
    const decision = evaluatePagePolicy(windowLike, options);
    return Object.freeze({
      decision,
      selection: decision.allow === true ? readExplicitSelection(windowLike) : null
    });
  }

  function panelModelForToken(token, renderer) {
    if (!token || !renderer || typeof renderer.ownsToken !== 'function' || !renderer.ownsToken(token)) return null;
    const title = String(token.textContent || '').trim();
    if (!title || title.length > 256 || typeof token.getAttribute !== 'function') return null;
    const details = [
      token.getAttribute('data-halo-pos'),
      token.getAttribute('data-halo-meta'),
      token.getAttribute('data-halo-gloss')
    ].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());
    const confidence = token.getAttribute('data-halo-confidence');
    const rect = typeof token.getBoundingClientRect === 'function' ? token.getBoundingClientRect() : null;
    const x = rect && Number.isFinite(Number(rect.left)) ? Number(rect.left) : 8;
    const bottom = rect && Number.isFinite(Number(rect.bottom)) ? Number(rect.bottom) : 8;
    return Object.freeze({
      title,
      body: details.join(' · '),
      status: typeof confidence === 'string' && confidence.trim() ? `Confidence ${confidence.trim()}` : '',
      anchor: Object.freeze({ x, y: bottom + 8 })
    });
  }

  function createContentTriggerRuntime(options) {
    const settings = options || {};
    const eventTarget = settings.eventTarget;
    const renderer = settings.renderer;
    const Trigger = settings.triggerModule;
    if (!eventTarget || typeof eventTarget.addEventListener !== 'function' ||
        typeof eventTarget.removeEventListener !== 'function') {
      throw new TypeError('eventTarget: must provide addEventListener and removeEventListener');
    }
    if (!renderer || typeof renderer.openPanel !== 'function' || typeof renderer.closePanel !== 'function' ||
        typeof renderer.ownsToken !== 'function' || typeof renderer.ownsPanel !== 'function') {
      throw new TypeError('renderer: panel and private ownership APIs are required');
    }
    if (!Trigger || typeof Trigger.createTriggerController !== 'function') {
      throw new TypeError('triggerModule.createTriggerController: is required');
    }
    const clock = typeof settings.now === 'function' ? settings.now : () => Date.now();
    const tokenIds = new WeakMap();
    const tokenReferences = new Map();
    const selectionModels = new Map();
    const listeners = [];
    const WeakRefClass = Object.prototype.hasOwnProperty.call(settings, 'WeakRef')
      ? settings.WeakRef
      : root.WeakRef;
    let sequence = 0;
    let cleaned = false;

    function reference(value) {
      return typeof WeakRefClass === 'function' ? new WeakRefClass(value) : { deref: () => value };
    }

    function targetIdFor(token) {
      if (!tokenIds.has(token)) {
        const targetId = `token-${++sequence}`;
        tokenIds.set(token, targetId);
        tokenReferences.set(targetId, reference(token));
      }
      return tokenIds.get(token);
    }

    function resolveModel(targetId) {
      if (selectionModels.has(targetId)) return selectionModels.get(targetId);
      const token = tokenReferences.get(targetId);
      return panelModelForToken(token && token.deref(), renderer);
    }

    const controllerOptions = {
      mode: settings.mode,
      now: clock,
      openPanel(value) {
        const model = resolveModel(value.targetId);
        if (!model) throw new Error('Trigger target is no longer available');
        if (typeof settings.onRendererCall === 'function') settings.onRendererCall('open-panel');
        renderer.openPanel(model);
        selectionModels.delete(value.targetId);
      },
      closePanel(reason) {
        if (typeof settings.onRendererCall === 'function') settings.onRendererCall('close-panel');
        renderer.closePanel(reason);
      },
      onError: settings.onError
    };
    for (const name of ['setTimeout', 'clearTimeout', 'primeThresholdMs', 'openThresholdMs', 'dismissDelayMs']) {
      if (Object.prototype.hasOwnProperty.call(settings, name)) controllerOptions[name] = settings[name];
    }
    const controller = Trigger.createTriggerController(controllerOptions);

    function add(type, listener) {
      eventTarget.addEventListener(type, listener);
      listeners.push([type, listener]);
    }

    function safeGet(value, name) {
      try { return value == null ? undefined : value[name]; } catch (_error) { return undefined; }
    }

    function safeOwnership(predicate, value) {
      try { return Boolean(predicate(value)); } catch (_error) { return false; }
    }

    function safeReport(error) {
      if (typeof settings.onError !== 'function') return;
      try { settings.onError(error); } catch (_ignored) {}
    }

    function closestOwned(node, predicate) {
      const visited = new Set();
      let current = node;
      while (current && (typeof current === 'object' || typeof current === 'function') &&
          !visited.has(current) && visited.size < 256) {
        visited.add(current);
        if (safeGet(current, 'nodeType') === 1 && safeOwnership(predicate, current)) return current;
        current = safeGet(current, 'parentElement') || safeGet(current, 'host') || null;
      }
      return null;
    }

    const closestToken = (node) => closestOwned(node, renderer.ownsToken.bind(renderer));
    const closestPanel = (node) => closestOwned(node, renderer.ownsPanel.bind(renderer));

    function eventPath(event) {
      const result = [];
      const composedPath = safeGet(event, 'composedPath');
      if (typeof composedPath === 'function') {
        try {
          const path = composedPath.call(event);
          if (Array.isArray(path)) {
            let length;
            try { length = path.length; } catch (_error) { length = 0; }
            if (!Number.isSafeInteger(length) || length < 0 || length > 256) return [];
            for (let index = 0; index < length; index += 1) {
              try { result.push(path[index]); } catch (_error) {}
            }
            if (result.length) return result;
          }
        } catch (_error) {
        }
      }
      const target = safeGet(event, 'target');
      return target === undefined ? [] : [target];
    }

    function tokenForEvent(event) {
      for (const node of eventPath(event)) {
        const token = closestToken(node);
        if (token) return token;
      }
      return null;
    }

    function isPanelEvent(event) {
      const path = eventPath(event);
      for (let index = 0; index < path.length; index += 1) if (closestPanel(path[index])) return true;
      return false;
    }

    function dispatch(event) {
      if (cleaned) return controller.state();
      try {
        return controller.dispatch({ ...event, at: clock() });
      } catch (error) {
        safeReport(error);
        return controller.state();
      }
    }

    function activeTargetId() {
      const value = controller.state();
      return value && typeof value.targetId === 'string' ? value.targetId : null;
    }

    function enter(event) {
      const token = tokenForEvent(event);
      if (token) {
        const targetId = targetIdFor(token);
        dispatch({
          type: safeGet(event, 'altKey') || safeGet(event, 'shiftKey') ? 'MODIFIER_HOVER' : 'POINTER_ENTER',
          targetId
        });
        return;
      }
      if (isPanelEvent(event)) {
        const targetId = activeTargetId();
        if (targetId) dispatch({ type: 'POINTER_ENTER', targetId });
      }
    }

    function leave(event) {
      const sourceToken = tokenForEvent(event);
      if (!sourceToken && !isPanelEvent(event)) return;
      const relatedTarget = safeGet(event, 'relatedTarget');
      if (closestToken(relatedTarget) || closestPanel(relatedTarget)) return;
      const targetId = sourceToken ? targetIdFor(sourceToken) : activeTargetId();
      if (targetId) dispatch({ type: 'POINTER_LEAVE', targetId });
    }

    add('pointerover', enter);
    add('pointerout', leave);
    add('focusin', enter);
    add('focusout', leave);
    add('click', (event) => {
      const token = tokenForEvent(event);
      if (token) {
        const preventDefault = safeGet(event, 'preventDefault');
        const stopPropagation = safeGet(event, 'stopPropagation');
        try { if (typeof preventDefault === 'function') preventDefault.call(event); } catch (_error) {}
        try { if (typeof stopPropagation === 'function') stopPropagation.call(event); } catch (_error) {}
        dispatch({ type: 'EXPLICIT_OPEN', targetId: targetIdFor(token) });
        return;
      }
      if (!isPanelEvent(event)) dispatch({ type: 'OUTSIDE_CLICK' });
    });
    add('keydown', (event) => {
      if (safeGet(event, 'key') === 'Escape') dispatch({ type: 'ESCAPE' });
    });

    function openSelection(request) {
      if (cleaned || !request || typeof request.text !== 'string' || !request.text.trim() ||
          request.text.length > 4000 || !request.anchor ||
          !Number.isFinite(Number(request.anchor.x)) || !Number.isFinite(Number(request.anchor.y))) return false;
      const targetId = `selection-${++sequence}`;
      selectionModels.set(targetId, Object.freeze({
        title: 'Halo selection',
        body: request.text.trim(),
        status: 'Local selection',
        anchor: Object.freeze({ x: Number(request.anchor.x), y: Number(request.anchor.y) })
      }));
      dispatch({ type: 'EXPLICIT_OPEN', targetId });
      return controller.state().name === 'core-open' && controller.state().targetId === targetId;
    }

    function cleanup(type) {
      if (cleaned) return controller.state();
      try {
        controller.dispatch({ type: type === 'ROUTE_CLEANUP' ? 'ROUTE_CLEANUP' : 'CANCEL', at: clock() });
      } catch (error) {
        safeReport(error);
      }
      const retained = [];
      for (const [eventType, listener] of listeners.splice(0)) {
        try {
          eventTarget.removeEventListener(eventType, listener);
        } catch (error) {
          retained.push([eventType, listener]);
          safeReport(error);
        }
      }
      listeners.push(...retained);
      cleaned = listeners.length === 0;
      if (cleaned) {
        tokenReferences.clear();
        selectionModels.clear();
      }
      return controller.state();
    }

    return Object.freeze({ openSelection, cleanup, state: controller.state, isCleaned: () => cleaned });
  }

  function canonicalContentRoot(element) {
    if (!element || element.nodeType !== 1) return null;
    const contentRoot = typeof element.matches === 'function' && element.matches(CONTENT_ROOT_SELECTOR)
      ? element
      : (typeof element.closest === 'function' ? element.closest(CONTENT_ROOT_SELECTOR) : null);
    if (contentRoot && typeof contentRoot.querySelector === 'function' &&
        contentRoot.querySelector(CONTENT_ROOT_SELECTOR)) return null;
    return contentRoot;
  }

  function isTransientRendererOwned(node, ownedNodes) {
    if (!ownedNodes || typeof ownedNodes.has !== 'function') return false;
    return ownedNodes.has(node);
  }

  function rendererRootIdsForInvalidation(discovery, roots, removedRoots, rendererRootsByContentRoot) {
    if (!discovery || typeof discovery.rootIdsWithin !== 'function') return Object.freeze([]);
    const contentRootIds = discovery.rootIdsWithin([
      ...Array.from(roots || []),
      ...Array.from(removedRoots || [])
    ]);
    const rendererRootIds = [];
    const seen = new Set();
    for (const contentRootId of contentRootIds) {
      const workIds = rendererRootsByContentRoot && rendererRootsByContentRoot.get(contentRootId);
      for (const workId of workIds || []) {
        if (seen.has(workId)) continue;
        seen.add(workId);
        rendererRootIds.push(workId);
      }
    }
    return Object.freeze(rendererRootIds);
  }

  function invalidateRuntimeRoots(runtime, renderer, roots, removedRoots, options) {
    const settings = options || {};
    if (!runtime || !runtime.discovery) return 0;
    const discovery = runtime.discovery;
    const changedContentRoots = discovery.rootsWithin(roots);
    const removedContentRoots = discovery.rootsWithin(removedRoots);
    const affectedContentRoots = [...changedContentRoots, ...removedContentRoots];
    const affectedContentRootIds = discovery.rootIdsWithin(affectedContentRoots);
    const rendererRootIds = rendererRootIdsForInvalidation(
      discovery,
      affectedContentRoots,
      [],
      runtime.rendererRootsByContentRoot
    );
    const report = (error, metadata) => {
      if (typeof settings.onError !== 'function') return;
      try {
        settings.onError(error, Object.freeze(metadata));
      } catch (_reportError) {
        // Mutation invalidation must remain usable when its reporter fails.
      }
    };

    for (const contentRoot of changedContentRoots) runtime.pendingChangedRoots.add(contentRoot);
    for (const contentRoot of removedContentRoots) runtime.pendingChangedRoots.delete(contentRoot);
    try {
      discovery.invalidateRoots(changedContentRoots);
    } catch (error) {
      report(error, { phase: 'root-invalidation' });
    }

    try {
      if (renderer && typeof renderer.removeRoot === 'function') {
        for (const rootId of rendererRootIds) {
          try {
            renderer.removeRoot(rootId);
          } catch (error) {
            report(error, { phase: 'renderer-root-cleanup', rootId });
          }
        }
      }
    } finally {
      try {
        for (const contentRootId of affectedContentRootIds) {
          runtime.rendererRootsByContentRoot.delete(contentRootId);
        }
      } finally {
        try {
          discovery.releaseRoots(removedRoots);
        } catch (error) {
          report(error, { phase: 'detached-root-release' });
        }
      }
    }
    return changedContentRoots.length;
  }

  function refreshInvalidatedRuntimeRoots(runtime, roots, options) {
    if (!runtime || !runtime.discovery) return 0;
    const settings = options || {};
    const changedContentRoots = runtime.discovery.rootsWithin(roots);
    for (const contentRoot of changedContentRoots) runtime.pendingChangedRoots.add(contentRoot);
    const refreshRoots = [...runtime.pendingChangedRoots];
    let refreshed = 0;
    for (const contentRoot of refreshRoots) {
      try {
        refreshed += runtime.discovery.refreshRoots([contentRoot], { alreadyInvalidated: true });
        runtime.pendingChangedRoots.delete(contentRoot);
      } catch (error) {
        if (typeof settings.onError === 'function') {
          try {
            settings.onError(error, Object.freeze({ phase: 'root-refresh', root: contentRoot }));
          } catch (_reportError) {
            // One root's refresh/report failure cannot block its peers.
          }
        }
      }
    }
    return refreshed;
  }

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
    const networkActivity = response.status && response.status.networkActivity;
    if (!networkActivity || typeof networkActivity !== 'object' ||
        Object.keys(networkActivity).sort().join('\u0000') !==
          'fetchAttempts\u0000lifetimeId\u0000schemaVersion\u0000scope' ||
        networkActivity.schemaVersion !== 1 || networkActivity.scope !== 'worker-lifetime' ||
        typeof networkActivity.lifetimeId !== 'string' || networkActivity.lifetimeId.length < 1 ||
        networkActivity.lifetimeId.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(networkActivity.lifetimeId) ||
        !Number.isSafeInteger(networkActivity.fetchAttempts) || networkActivity.fetchAttempts < 0) return null;
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
        : 'degraded',
      networkActivity: Object.freeze({
        schemaVersion: 1,
        scope: 'worker-lifetime',
        lifetimeId: networkActivity.lifetimeId,
        fetchAttempts: networkActivity.fetchAttempts
      })
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
      return revisionSource.isRootRevisionCurrent(payload.element, work.rootId, payload.rootRevision);
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
    if (typeof settings.onTextRunExtraction === 'function') settings.onTextRunExtraction();
    const records = pipeline.buildSentenceRecords(element, {
      rootRevision,
      locale
    });
    if (typeof settings.onSentenceRecords === 'function') settings.onSentenceRecords(records.length);
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

    function report(error, metadata) {
      if (typeof settings.onError !== 'function') return;
      try {
        settings.onError(error, Object.freeze(metadata));
      } catch (_reportError) {
        // Discovery lifecycle work must not depend on an error reporter.
      }
    }

    function candidateRoot(element) {
      return canonicalContentRoot(element);
    }

    function rootIdFor(element) {
      if (!rootIds.has(element)) {
        rootIds.set(element, `halo-root-${++rootSequence}`);
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
      const records = changed.map((contentRoot) => {
        const rootId = rootIdFor(contentRoot);
        const wasObserved = observed.has(contentRoot);
        if (wasObserved || rootRevisions.has(rootId)) {
          rootRevisions.set(rootId, rootRevisionFor(contentRoot) + 1);
        } else {
          rootRevisions.set(rootId, 1);
        }
        return { contentRoot, rootId };
      });
      for (const record of records) {
        try {
          scheduler.cancelRoot(record.rootId);
        } catch (error) {
          report(error, { phase: 'root-cancel', rootId: record.rootId });
        }
      }
      return changed.length;
    }

    function refreshRoots(values, options) {
      if (disconnected) return 0;
      const settings = options || {};
      const changed = changedContentRoots(values);
      const records = changed.map((contentRoot) => {
        const rootId = rootIdFor(contentRoot);
        const wasObserved = observed.has(contentRoot);
        const wasIntersecting = intersecting.has(contentRoot);
        if (!settings.alreadyInvalidated) {
          if (wasObserved || rootRevisions.has(rootId)) {
            rootRevisions.set(rootId, rootRevisionFor(contentRoot) + 1);
          } else {
            rootRevisions.set(rootId, 1);
          }
        }
        return { contentRoot, rootId, wasObserved, wasIntersecting };
      });
      if (!settings.alreadyInvalidated) {
        for (const record of records) {
          try {
            scheduler.cancelRoot(record.rootId);
          } catch (error) {
            report(error, { phase: 'root-cancel', rootId: record.rootId });
          }
        }
      }
      for (const record of records) {
        const { contentRoot, wasObserved, wasIntersecting } = record;
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

    function peekRootId(element) {
      return element && rootIds.has(element) ? rootIds.get(element) : null;
    }

    function isRootRevisionCurrent(element, expectedRootId, revision) {
      if (!element || element.isConnected === false || typeof expectedRootId !== 'string' ||
          !Number.isSafeInteger(revision)) return false;
      const rootId = peekRootId(element);
      return rootId !== null && rootId === expectedRootId &&
        rootRevisions.has(rootId) && rootRevisions.get(rootId) === revision;
    }

    function releaseRoots(values) {
      if (disconnected) return 0;
      const released = new Set();
      for (const value of Array.from(values || [])) {
        for (const contentRoot of contentRootsWithin(value)) {
          if (released.has(contentRoot)) continue;
          released.add(contentRoot);
          const rootId = rootIds.get(contentRoot);
          if (rootId !== undefined) {
            try {
              scheduler.cancelRoot(rootId);
            } catch (error) {
              report(error, { phase: 'root-cancel', rootId });
            }
          }
          try {
            if (typeof observer.unobserve === 'function') observer.unobserve(contentRoot);
          } catch (error) {
            report(error, { phase: 'root-release-unobserve', rootId });
          } finally {
            intersecting.delete(contentRoot);
            observed.delete(contentRoot);
            if (rootId !== undefined) rootRevisions.delete(rootId);
            rootIds.delete(contentRoot);
          }
        }
      }
      return released.size;
    }

    function rootIdsWithin(values) {
      const ids = [];
      const seen = new Set();
      for (const value of Array.from(values || [])) {
        for (const contentRoot of contentRootsWithin(value)) {
          if (!rootIds.has(contentRoot)) continue;
          const rootId = rootIds.get(contentRoot);
          if (seen.has(rootId)) continue;
          seen.add(rootId);
          ids.push(rootId);
        }
      }
      return Object.freeze(ids);
    }

    function rootsWithin(values) {
      const roots = [];
      const seen = new Set();
      for (const value of Array.from(values || [])) {
        for (const contentRoot of contentRootsWithin(value)) {
          if (seen.has(contentRoot)) continue;
          seen.add(contentRoot);
          roots.push(contentRoot);
        }
      }
      return Object.freeze(roots);
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
      return Object.freeze({
        candidatesVisited,
        observedRoots,
        trackedRootRevisions: rootRevisions.size,
        done,
        disconnected
      });
    }

    return Object.freeze({
      start,
      invalidateRoots,
      refreshRoots,
      releaseRoots,
      peekRootId,
      rootIdsWithin,
      rootsWithin,
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

  function closestPrivateToken(element, ownsToken) {
    if (typeof ownsToken !== 'function') return null;
    for (let current = element; current; current = current.parentElement) {
      if (ownsToken(current)) return current;
    }
    return null;
  }

  function shouldSkipElement(element, options) {
    const settings = options || {};
    if (!element || element.nodeType !== 1) return false;
    if (SKIP_TAGS.has(element.tagName)) return true;
    if (closestPrivateToken(element, settings.ownsToken)) return true;
    if (element.closest('[data-halo-owned="panel"]')) return true;
    if (element.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"]')) return true;
    if (element.closest('nav, [aria-hidden="true"]')) return true;
    return false;
  }

  function eligibleTextNode(node, options) {
    const settings = options || {};
    if (!node || !node.parentElement) return false;
    const ownedToken = closestPrivateToken(node.parentElement, settings.ownsToken);
    if (ownedToken) {
      return settings.ownsToken(ownedToken, settings.rendererRootId);
    }
    if (shouldSkipElement(node.parentElement, settings)) return false;
    const text = node.nodeValue || '';
    if (!/[A-Za-z\p{Script=Han}]/u.test(text) || !text.trim()) return false;
    return typeof settings.isVisible !== 'function' || settings.isVisible(node.parentElement);
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

  function cleanupRuntime(runtime, options) {
    const settings = options || {};
    const epoch = settings.epoch === undefined ? runtime && runtime.epoch : settings.epoch;
    const report = (error, phase) => {
      if (typeof settings.onError !== 'function') return;
      try {
        settings.onError(error, Object.freeze({ phase, epoch }));
      } catch (_hookError) {
        // Cleanup must remain best effort even when its reporter fails.
      }
    };
    const attempt = (phase, callback) => {
      if (typeof callback !== 'function') return;
      try {
        callback();
      } catch (error) {
        report(error, phase);
      }
    };

    attempt('runtime-detach', settings.detach);
    attempt('pending-refresh-clear', runtime && runtime.pendingChangedRoots &&
      typeof runtime.pendingChangedRoots.clear === 'function'
      ? () => runtime.pendingChangedRoots.clear()
      : null);
    attempt('cancel-epoch', runtime && runtime.scheduler &&
      typeof runtime.scheduler.cancelEpoch === 'function'
      ? () => runtime.scheduler.cancelEpoch(epoch)
      : null);
    attempt('renderer-cleanup', () => {
      const cleanup = typeof settings.rendererCleanup === 'function' ? settings.rendererCleanup : () => {};
      if (typeof settings.suppressRendererMutations === 'function') {
        settings.suppressRendererMutations(cleanup);
      } else {
        cleanup();
      }
    });
    attempt('discovery-disconnect', runtime && runtime.discovery &&
      typeof runtime.discovery.disconnect === 'function'
      ? () => runtime.discovery.disconnect()
      : null);
    return null;
  }

  function reconcileRendererCleanup(renderer, remove) {
    if (!renderer) {
      return Object.freeze({
        renderer: null,
        cleanupPending: false,
        remainingArtifacts: Object.freeze({ wrapperCount: 0, panelCount: 0 }),
        errorCode: null
      });
    }
    let cleanupFailed = false;
    try {
      const operation = typeof remove === 'function' ? remove : () => renderer.removeAll();
      operation();
    } catch (_error) {
      cleanupFailed = true;
    }
    let wrapperCount = 'unknown';
    let panelCount = 'unknown';
    try {
      if (typeof renderer.status !== 'function') throw new TypeError('renderer status unavailable');
      const status = renderer.status();
      if (!status || !Number.isSafeInteger(status.wrapperCount) || status.wrapperCount < 0 ||
          !status.panel || typeof status.panel.open !== 'boolean') {
        throw new TypeError('renderer status invalid');
      }
      wrapperCount = status.wrapperCount;
      panelCount = status.panel.open ? 1 : 0;
    } catch (_error) {
      cleanupFailed = true;
    }
    const clean = !cleanupFailed && wrapperCount === 0 && panelCount === 0;
    return Object.freeze({
      renderer: clean ? null : renderer,
      cleanupPending: !clean,
      remainingArtifacts: Object.freeze({ wrapperCount, panelCount }),
      errorCode: cleanupFailed ? 'RENDERER_CLEANUP_FAILED' : (clean ? null : 'RENDERER_ARTIFACTS_REMAIN')
    });
  }

  function initBrowser() {
    if (!root.document || !root.chrome || !root.chrome.runtime) return;
    if (root.__HALO_CONTENT_INITIALIZED__) return;
    root.__HALO_CONTENT_INITIALIZED__ = true;

    const boundaryCounterState = {
      policyEvaluations: 0,
      textRunExtractions: 0,
      sentenceRecords: 0,
      selectionReads: 0,
      semanticMessages: 0,
      rendererCalls: 0,
      networkRequests: 0
    };
    const boundaryCounterScope = Object.freeze({
      schemaVersion: 1,
      lifetime: 'content-script-lifetime',
      networkRequests: 'observed-worker-fetch-attempts',
      sourceLifetime: 'worker-lifetime'
    });
    const observedWorkerNetworkAttempts = new Map();
    const boundaryCounters = () => Object.freeze({ ...boundaryCounterState });
    const stampStatus = (value) => Object.freeze({
      ...value,
      boundaryCounters: boundaryCounters(),
      boundaryCounterScope
    });
    const incrementBoundary = (name, amount) => {
      const increment = amount === undefined ? 1 : amount;
      if (Object.hasOwn(boundaryCounterState, name) && Number.isSafeInteger(increment) && increment >= 0) {
        if (boundaryCounterState[name] > Number.MAX_SAFE_INTEGER - increment) {
          throw new RangeError('content boundary counter exhausted');
        }
        boundaryCounterState[name] += increment;
      }
    };
    function observeWorkerNetworkActivity(activity) {
      const previous = observedWorkerNetworkAttempts.get(activity.lifetimeId);
      if (previous === undefined) {
        if (observedWorkerNetworkAttempts.size >= 8) {
          const oldest = observedWorkerNetworkAttempts.keys().next();
          if (!oldest.done) observedWorkerNetworkAttempts.delete(oldest.value);
        }
        observedWorkerNetworkAttempts.set(activity.lifetimeId, activity.fetchAttempts);
        incrementBoundary('networkRequests', activity.fetchAttempts);
        return;
      }
      if (activity.fetchAttempts <= previous) return;
      observedWorkerNetworkAttempts.delete(activity.lifetimeId);
      observedWorkerNetworkAttempts.set(activity.lifetimeId, activity.fetchAttempts);
      incrementBoundary('networkRequests', activity.fetchAttempts - previous);
    }
    const emptyStatus = () => stampStatus({
      active: false,
      textNodesVisited: 0,
      semanticTokens: 0,
      markedTokens: 0,
      providerMode: null,
      cleanupPending: false,
      remainingArtifacts: Object.freeze({ wrapperCount: 0, panelCount: 0 }),
      oversizedWork: Object.freeze([]),
      lastError: null
    });
    let lastStatus = emptyStatus();
    let activeRuntime = null;
    let activeController = null;
    const cleanupControllerTargets = new Set();
    let activeRenderer = null;
    let activeTriggerRuntime = null;
    let cleanupRuntimeTarget = null;
    let cleanupPending = false;
    let remainingArtifacts = Object.freeze({ wrapperCount: 0, panelCount: 0 });
    let activePolicyDecision = POLICY_FAILURE_DECISION;
    let currentSettings = null;
    let markingRequested = false;
    let runtimeEpoch = 0;
    let requestSequence = 0;
    let rendererMutationScope = null;

    function trackRendererNode(node) {
      if (node && rendererMutationScope) rendererMutationScope.trackNode(node);
      return node;
    }

    function trackRendererMutation(operation) {
      if (rendererMutationScope) rendererMutationScope.expect(operation);
      return operation;
    }

    function runRendererMutation(controller, callback) {
      const previousScope = rendererMutationScope;
      const DynamicDom = root.HaloDynamicDomController;
      rendererMutationScope = previousScope || (DynamicDom &&
        typeof DynamicDom.createRendererMutationSanitizer === 'function'
        ? DynamicDom.createRendererMutationSanitizer()
        : null);
      try {
        return controller ? controller.suppressRendererMutations(callback) : callback();
      } finally {
        rendererMutationScope = previousScope;
      }
    }

    function rendererSuppressionController() {
      if (activeController) return activeController;
      const iterator = cleanupControllerTargets.values();
      const next = iterator.next();
      return next.done ? null : next.value;
    }

    function isRendererOwned(node) {
      try {
        return Boolean(activeRenderer &&
          ((typeof activeRenderer.ownsToken === 'function' && activeRenderer.ownsToken(node)) ||
           (typeof activeRenderer.ownsPanel === 'function' && activeRenderer.ownsPanel(node))));
      } catch (_error) {
        return false;
      }
    }

    function isVisible(element) {
      if (!element || !root.getComputedStyle) return true;
      const style = root.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function freshPolicyDecision(settings) {
      try {
        const location = root.location;
        const url = location && location.href;
        if (typeof url !== 'string') return POLICY_FAILURE_DECISION;
        incrementBoundary('policyEvaluations');
        return evaluatePagePolicy(root, {
          sitePolicyModule: root.HaloSitePolicy,
          url,
          userDenylist: settings && settings.sitePolicy && settings.sitePolicy.userDenylist
        });
      } catch (_error) {
        return POLICY_FAILURE_DECISION;
      }
    }

    function ensureRenderer(Renderer) {
      if (!activeRenderer) {
        activeRenderer = Renderer.createReversibleRenderer({
          document: root.document,
          suppressMutations: (callback) => runRendererMutation(activeController, callback),
          trackOwnedNode: trackRendererNode,
          trackMutation: trackRendererMutation
        });
      }
      return activeRenderer;
    }

    function ensureTriggerRuntime(settings) {
      if (activeTriggerRuntime) return activeTriggerRuntime;
      const Trigger = root.HaloTriggerController;
      const Renderer = root.HaloReversibleRenderer;
      if (!Trigger || typeof Trigger.createTriggerController !== 'function' || !Renderer) {
        throw new Error('Halo trigger modules are not loaded');
      }
      activeTriggerRuntime = createContentTriggerRuntime({
        eventTarget: root.document,
        renderer: ensureRenderer(Renderer),
        triggerModule: Trigger,
        mode: settings.triggerMode,
        onRendererCall: () => incrementBoundary('rendererCalls'),
        onError: () => {
          lastStatus = Object.freeze({ ...lastStatus, lastError: 'LOCAL_TRIGGER_ERROR' });
        }
      });
      return activeTriggerRuntime;
    }

    function cleanupTriggerRuntime(type) {
      if (!activeTriggerRuntime) return true;
      const triggerRuntime = activeTriggerRuntime;
      try { triggerRuntime.cleanup(type); } catch (_error) {}
      let cleaned = false;
      try { cleaned = triggerRuntime.isCleaned(); } catch (_error) {}
      if (cleaned && activeTriggerRuntime === triggerRuntime) activeTriggerRuntime = null;
      return cleaned;
    }

    function cleanupAwareStatus(decision, lastError) {
      const wrapperCount = remainingArtifacts.wrapperCount;
      return stampStatus({
        ...(cleanupPending ? lastStatus : emptyStatus()),
        active: false,
        markedTokens: typeof wrapperCount === 'number' ? wrapperCount : 'unknown',
        providerMode: null,
        queuedRoots: 0,
        cleanupPending,
        remainingArtifacts,
        lastError,
        policyDecision: decision
      });
    }

    function cleanupActiveWork(type, preserveController) {
      if (activeRuntime) {
        cleanupRuntimeTarget = activeRuntime;
        activeRuntime = null;
      }
      let runtimeClean = true;
      const runtime = cleanupRuntimeTarget;
      if (runtime) {
        cleanupRuntime(runtime, {
          epoch: runtime.epoch,
          onError: () => { runtimeClean = false; }
        });
        if (runtimeClean && cleanupRuntimeTarget === runtime) cleanupRuntimeTarget = null;
      }
      const triggerClean = cleanupTriggerRuntime(type);
      const rendererCleanup = reconcileRendererCleanup(activeRenderer, activeRenderer
        ? () => {
            incrementBoundary('rendererCalls');
            return runRendererMutation(rendererSuppressionController(), () => activeRenderer.removeAll());
          }
        : null);
      activeRenderer = rendererCleanup.renderer;
      remainingArtifacts = rendererCleanup.remainingArtifacts;
      if (!preserveController && activeController) {
        cleanupControllerTargets.add(activeController);
        activeController = null;
      }
      for (const controller of cleanupControllerTargets) {
        try {
          let status = controller.cleanup();
          if ((!status || typeof status !== 'object') && typeof controller.status === 'function') {
            status = controller.status();
          }
          if (status && status.schemaVersion === 1 && status.cleaned === true &&
              status.cleanupPending === false && Array.isArray(status.pendingStages) &&
              status.pendingStages.length === 0) {
            cleanupControllerTargets.delete(controller);
          }
        } catch (_error) {
          // Retain authority for a later route, storage, APPLY, or REMOVE retry.
        }
      }
      cleanupPending = Boolean(!triggerClean || cleanupRuntimeTarget || rendererCleanup.cleanupPending ||
        cleanupControllerTargets.size || (!preserveController && activeController));
      return Object.freeze({ cleanupPending, remainingArtifacts });
    }

    function blockActivePage(decision) {
      activePolicyDecision = decision;
      cleanupActiveWork('CANCEL', true);
      try {
        if (activeController && typeof activeController.setPolicyOnly === 'function') {
          activeController.setPolicyOnly(true);
        }
      } catch (_error) {
        cleanupActiveWork('CANCEL', false);
      }
      lastStatus = cleanupAwareStatus(decision, cleanupPending
        ? 'SENSITIVE_PAGE_CLEANUP_PENDING'
        : 'SENSITIVE_PAGE_BLOCKED');
      return lastStatus;
    }

    function failRuntimeUnavailable() {
      markingRequested = false;
      currentSettings = null;
      activePolicyDecision = POLICY_FAILURE_DECISION;
      cleanupActiveWork('CANCEL', false);
      lastStatus = cleanupAwareStatus(POLICY_FAILURE_DECISION, cleanupPending
        ? 'SENSITIVE_PAGE_CLEANUP_PENDING'
        : 'POLICY_RUNTIME_UNAVAILABLE');
      return lastStatus;
    }

    function removeMarking() {
      markingRequested = false;
      currentSettings = null;
      cleanupActiveWork('CANCEL', false);
      activePolicyDecision = POLICY_FAILURE_DECISION;
      lastStatus = cleanupPending
        ? cleanupAwareStatus(POLICY_FAILURE_DECISION, 'LOCAL_MARKING_ERROR')
        : emptyStatus();
      return lastStatus;
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
        incrementBoundary('semanticMessages');
        const response = await root.chrome.runtime.sendMessage(request);
        if (context.signal.aborted || !activeRuntime || activeRuntime.epoch !== epoch) return null;
        const validated = validateEnrichmentResponse(response, request, modules.Contracts);
        if (!validated) throw new Error('Local semantic service returned an invalid response');
        observeWorkerNetworkActivity(validated.networkActivity);
        return validated;
      } catch (error) {
        if (context.signal.aborted || !activeRuntime || activeRuntime.epoch !== epoch) return null;
        throw error;
      } finally {
        context.signal.removeEventListener('abort', cancel);
      }
    }

    function renderBatch(batch, results, modules, settings) {
      const byItemId = new Map(results.results.map((result) => [result.rootId, result]));
      let semanticTokens = 0;
      let markedTokens = 0;
      for (const work of batch.items) {
        const payload = work.payload;
        if (!rootWorkIsCurrent(work, activeRuntime && activeRuntime.discovery)) continue;
        incrementBoundary('textRunExtractions');
        const runs = modules.Pipeline.createTextRuns(payload.element, {
          rootRevision: payload.rootRevision,
          includeHaloOwnedTokens: true,
          expectedRootId: work.id,
          ownsToken: modules.Renderer.ownsToken
        });
        const renderFragments = [];
        const analysisKeys = [];
        let runId = null;
        for (let index = 0; index < payload.records.length; index += 1) {
          const record = payload.records[index];
          const semanticResult = byItemId.get(`${work.id}:s${index}`);
          const annotationSet = semanticResult && semanticResult.annotationSet;
          if (!semanticResult || !annotationSet || !Array.isArray(annotationSet.tokens)) continue;
          analysisKeys.push(semanticResult.analysisKey);
          runId = semanticResult.requestId;
          semanticTokens += annotationSet.tokens.length;
          const plan = modules.Projection.createMarkingPlan(annotationSet.tokens, settings);
          for (const item of plan) {
            if (!item.marked) continue;
            const fragments = modules.Pipeline.mapAggregateSpanToFragments(
              runs,
              record.start + item.start,
              record.start + item.end
            );
            for (let fragmentIndex = 0; fragmentIndex < fragments.length; fragmentIndex += 1) {
              const fragment = fragments[fragmentIndex];
              if (!fragment.node || !eligibleTextNode(fragment.node, {
                rendererRootId: work.id,
                ownsToken: modules.Renderer.ownsToken,
                isVisible
              })) continue;
              renderFragments.push({
                node: fragment.node,
                nodeId: fragment.nodeId,
                text: fragment.node.nodeValue.slice(fragment.start, fragment.end),
                start: fragment.start,
                end: fragment.end,
                boundaryKey: `${record.start + item.start}:${record.start + item.end}:${fragmentIndex}`,
                renderPlan: item
              });
            }
          }
        }
        if (renderFragments.length) {
          const analysisKey = analysisKeys.length === 1
            ? analysisKeys[0]
            : `${analysisKeys[0]}:${analysisKeys.length}`;
          incrementBoundary('rendererCalls');
          const rendered = modules.Renderer.apply({
            schemaVersion: modules.RendererSchemaVersion,
            runId: `${runId}:${work.id}`,
            rootId: work.id,
            rootRevision: payload.rootRevision,
            analysisKey,
            root: payload.element,
            fragments: renderFragments
          });
          if (activeRuntime && activeRuntime.rendererRootsByContentRoot) {
            if (!activeRuntime.rendererRootsByContentRoot.has(work.rootId)) {
              activeRuntime.rendererRootsByContentRoot.set(work.rootId, new Set());
            }
            activeRuntime.rendererRootsByContentRoot.get(work.rootId).add(work.id);
          }
          if (rendered.action !== 'duplicate') markedTokens += rendered.wrappers;
        }
      }
      return Object.freeze({
        semanticTokens,
        markedTokens
      });
    }

    async function startRuntime(settings, routeEpoch, decision) {
      if (!decision || decision.allow !== true) return blockActivePage(decision || POLICY_FAILURE_DECISION);
      if (cleanupPending) {
        cleanupActiveWork('CANCEL', true);
        if (cleanupPending) {
          try { if (activeController) activeController.setPolicyOnly(true); } catch (_error) {}
          lastStatus = cleanupAwareStatus(decision, 'SENSITIVE_PAGE_CLEANUP_PENDING');
          return lastStatus;
        }
      }
      try { if (activeController) activeController.setPolicyOnly(false); } catch (_error) {
        return blockActivePage(POLICY_FAILURE_DECISION);
      }
      const epoch = ++runtimeEpoch;
      const Dictionary = root.HaloDictionary;
      const Semantic = root.HaloSemanticAnnotations;
      const Grammar = root.HaloGrammarAnnotations;
      const Projection = root.HaloProjection;
      const Pipeline = root.HaloSentencePipeline;
      const Progressive = root.HaloProgressiveRuntime;
      const RuntimeScheduler = root.HaloRuntimeScheduler;
      const Contracts = root.HaloSemanticContracts;
      const Renderer = root.HaloReversibleRenderer;
      const provider = Dictionary.createBootstrapDictionaryProvider();
      const lexicalVersion = `${provider.id}@${provider.version}`;
      const renderer = ensureRenderer(Renderer);
      ensureTriggerRuntime(settings);
      const modules = {
        Semantic,
        Grammar,
        Projection,
        Pipeline,
        Progressive,
        Contracts,
        Renderer: renderer,
        RendererSchemaVersion: Renderer.RENDER_REQUEST_SCHEMA_VERSION
      };
      const scheduler = RuntimeScheduler.createRuntimeScheduler({
        budgets: settings.runtimeBudgets,
        processBatch: async (batch, context) => {
          const result = await requestEnrichment(batch, context, modules, settings, epoch, lexicalVersion);
          if (!result || context.signal.aborted || !activeRuntime || activeRuntime.epoch !== epoch) return;
          const rendered = renderBatch(batch, result, modules, settings);
          lastStatus = stampStatus({
            ...lastStatus,
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
        onError: () => {
          lastStatus = Object.freeze({ ...lastStatus, lastError: 'LOCAL_MARKING_ERROR' });
        },
        innerWidth: root.innerWidth,
        innerHeight: root.innerHeight,
        makeWork: (element, visible, metadata) => buildRootWork(element, {
          rootId: metadata.rootId,
          rootRevision: metadata.rootRevision,
          epoch,
          priority: metadata.priority,
          visible,
          settings,
          pipeline: Pipeline,
          onTextRunExtraction: () => incrementBoundary('textRunExtractions'),
          onSentenceRecords: (count) => incrementBoundary('sentenceRecords', count)
        })
      });
      activeRuntime = {
        scheduler,
        discovery,
        epoch,
        routeEpoch,
        rendererRootsByContentRoot: new Map(),
        pendingChangedRoots: new Set()
      };
      lastStatus = Object.freeze({ ...emptyStatus(), queuedRoots: 0 });
      discovery.start();
      await scheduler.flush();
      if (!activeRuntime || activeRuntime.epoch !== epoch) return lastStatus;
      lastStatus = stampStatus({
        ...lastStatus,
        queuedRoots: scheduler.status().queuedRoots,
        oversizedWork: scheduler.status().oversizedWork
      });
      return lastStatus;
    }

    function reevaluatePolicy() {
      if (!currentSettings) return POLICY_FAILURE_DECISION;
      const previous = activePolicyDecision;
      const decision = freshPolicyDecision(currentSettings);
      activePolicyDecision = decision;
      if (decision.allow !== true) {
        blockActivePage(decision);
        return decision;
      }
      if ((previous.allow !== true || cleanupPending) && markingRequested && activeController && !activeRuntime) {
        startRuntime(currentSettings, activeController.routeEpoch(), decision).catch(() => {
          failRuntimeUnavailable();
        });
      }
      return decision;
    }

    function hasPolicyRelevantMutation(records) {
      const relevantAttributes = new Set([
        'type', 'autocomplete', 'inputmode', 'name', 'role',
        'data-private', 'data-sensitive', 'data-1p-ignore', 'data-bwignore'
      ]);
      return Array.from(records || []).some((record) => record &&
        (record.type === 'childList' ||
         (record.type === 'attributes' && relevantAttributes.has(record.attributeName))));
    }

    async function applyMarking(rawSettings) {
      markingRequested = false;
      currentSettings = null;
      cleanupActiveWork('CANCEL', false);
      activePolicyDecision = POLICY_FAILURE_DECISION;
      if (cleanupPending) {
        lastStatus = cleanupAwareStatus(POLICY_FAILURE_DECISION, 'SENSITIVE_PAGE_CLEANUP_PENDING');
        return lastStatus;
      }
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
        const Renderer = root.HaloReversibleRenderer;
        const Policy = root.HaloSitePolicy;
        if (!Settings || !Dictionary || !Semantic || !Grammar || !Projection || !Pipeline ||
            !Progressive || !RuntimeScheduler || !Contracts || !DynamicDom || !Renderer || !Policy) {
          throw new Error('Halo shared modules are not loaded');
        }
        const settings = Settings.normalizeSettings(rawSettings);
        if (!settings.enabled) {
          lastStatus = cleanupPending
            ? cleanupAwareStatus(POLICY_FAILURE_DECISION, 'LOCAL_MARKING_ERROR')
            : emptyStatus();
          return lastStatus;
        }
        currentSettings = settings;
        markingRequested = true;
        const initialDecision = freshPolicyDecision(settings);
        activePolicyDecision = initialDecision;
        const controller = DynamicDom.createDynamicDomController({
          policyOnly: initialDecision.allow !== true,
          MutationObserver: root.MutationObserver,
          history: root.history,
          location: root.location,
          eventTarget: root,
          isHaloOwned: isRendererOwned,
          sanitizeRendererRecord: (record) => rendererMutationScope
            ? rendererMutationScope.sanitize(record)
            : record,
          onMutationsObserved: (records) => {
            if (hasPolicyRelevantMutation(records)) reevaluatePolicy();
          },
          onRootsInvalidated: (roots, metadata) => {
            if (!activeRuntime || activeRuntime.routeEpoch !== metadata.epoch) return;
            invalidateRuntimeRoots(activeRuntime, activeRenderer, roots, metadata.removedRoots, {
              onError: () => {
                lastStatus = Object.freeze({ ...lastStatus, lastError: 'LOCAL_MARKING_ERROR' });
              }
            });
          },
          onRootsChanged: (roots, metadata) => {
            if (!activeRuntime || activeRuntime.routeEpoch !== metadata.epoch) return;
            refreshInvalidatedRuntimeRoots(activeRuntime, roots, {
              onError: () => {
                lastStatus = Object.freeze({ ...lastStatus, lastError: 'LOCAL_MARKING_ERROR' });
              }
            });
          },
          onRouteCleanup: ({ epoch }) => {
            if (activeRuntime && activeRuntime.routeEpoch !== epoch) return;
            cleanupActiveWork('ROUTE_CLEANUP', true);
            lastStatus = cleanupPending
              ? cleanupAwareStatus(POLICY_FAILURE_DECISION, 'SENSITIVE_PAGE_CLEANUP_PENDING')
              : emptyStatus();
            activePolicyDecision = POLICY_FAILURE_DECISION;
          },
          onRouteStart: ({ epoch }) => {
            const decision = freshPolicyDecision(currentSettings);
            activePolicyDecision = decision;
            if (decision.allow !== true) {
              blockActivePage(decision);
              return;
            }
            if (!markingRequested) return;
            startRuntime(currentSettings, epoch, decision).catch(() => {
              failRuntimeUnavailable();
            });
          },
          onError: () => {
            lastStatus = Object.freeze({ ...emptyStatus(), lastError: 'LOCAL_MARKING_ERROR' });
          }
        });
        activeController = controller;
        controller.observe(root.document);
        if (initialDecision.allow !== true) return blockActivePage(initialDecision);
        return await startRuntime(settings, controller.routeEpoch(), initialDecision);
      } catch (_error) {
        return failRuntimeUnavailable();
      }
    }

    async function explicitSelection(message) {
      if (!validateExplicitSelectionMessage(message)) {
        return Object.freeze({ accepted: false, code: 'INVALID_ACTION' });
      }
      try {
        const Settings = root.HaloSettings;
        const Policy = root.HaloSitePolicy;
        const Renderer = root.HaloReversibleRenderer;
        const Trigger = root.HaloTriggerController;
        if (!Settings || !Policy || !Renderer || !Trigger || !root.chrome.storage || !root.chrome.storage.local) {
          throw new Error('Halo explicit trigger modules are not loaded');
        }
        const stored = await root.chrome.storage.local.get('haloSettings');
        const settings = Settings.migrateSettings(stored && stored.haloSettings);
        currentSettings = settings;
        const url = root.location && root.location.href;
        incrementBoundary('policyEvaluations');
        const decision = evaluatePagePolicy(root, {
          sitePolicyModule: Policy,
          url,
          userDenylist: settings.sitePolicy.userDenylist
        });
        activePolicyDecision = decision;
        if (decision.allow !== true) {
          blockActivePage(decision);
          return Object.freeze({ accepted: false, code: 'SENSITIVE_PAGE_BLOCKED' });
        }
        if (cleanupPending) {
          cleanupActiveWork('CANCEL', true);
          if (cleanupPending) {
            lastStatus = cleanupAwareStatus(decision, 'SENSITIVE_PAGE_CLEANUP_PENDING');
            return Object.freeze({ accepted: false, code: 'SENSITIVE_PAGE_CLEANUP_PENDING' });
          }
        }
        incrementBoundary('selectionReads');
        const selection = readExplicitSelection(root);
        if (!selection) return Object.freeze({ accepted: false, code: 'NO_SELECTION' });
        ensureRenderer(Renderer);
        const triggerRuntime = ensureTriggerRuntime(settings);
        const accepted = triggerRuntime.openSelection(selection);
        return Object.freeze({
          accepted,
          state: triggerRuntime.state().name
        });
      } catch (_error) {
        blockActivePage(POLICY_FAILURE_DECISION);
        return Object.freeze({ accepted: false, code: 'LOCAL_TRIGGER_UNAVAILABLE' });
      }
    }

    function policyReevaluate(rawSettings) {
      try {
        const Settings = root.HaloSettings;
        if (!Settings) throw new Error('Halo settings are unavailable');
        currentSettings = Settings.normalizeSettings(rawSettings);
        const decision = reevaluatePolicy();
        return Object.freeze({ allow: decision.allow, policyDecision: decision });
      } catch (_error) {
        blockActivePage(POLICY_FAILURE_DECISION);
        return Object.freeze({ allow: false, policyDecision: POLICY_FAILURE_DECISION });
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
        sendResponse(stampStatus(lastStatus));
        return false;
      }
      if (message.type === 'HALO_EXPLICIT_SELECTION') {
        explicitSelection(message).then((result) => sendResponse(result));
        return true;
      }
      if (message.type === 'HALO_POLICY_REEVALUATE') {
        sendResponse(policyReevaluate(message.settings));
        return false;
      }
      return false;
    });

    if (root.chrome.storage && root.chrome.storage.onChanged &&
        typeof root.chrome.storage.onChanged.addListener === 'function') {
      root.chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes || !Object.hasOwn(changes, 'haloSettings')) return;
        const next = changes.haloSettings && changes.haloSettings.newValue;
        try {
          currentSettings = root.HaloSettings.migrateSettings(next);
          reevaluatePolicy();
        } catch (_error) {
          blockActivePage(POLICY_FAILURE_DECISION);
        }
      });
    }
  }

  initBrowser();
  return Object.freeze({
    validateExplicitSelectionMessage,
    readExplicitSelection,
    evaluatePagePolicy,
    readExplicitSelectionAfterPolicy,
    panelModelForToken,
    createContentTriggerRuntime,
    bootstrapAnnotationSets,
    buildSegments,
    shouldSkipElement,
    eligibleTextNode,
    viewportRootMargin,
    buildEnrichmentItems,
    validateEnrichmentResponse,
    rootWorkIsCurrent,
    rendererRootIdsForInvalidation,
    invalidateRuntimeRoots,
    refreshInvalidatedRuntimeRoots,
    isTransientRendererOwned,
    cleanupRuntime,
    reconcileRendererCleanup,
    buildRootWork,
    createViewportDiscovery
  });
});
