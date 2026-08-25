(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloReversibleRenderer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const RENDER_REQUEST_SCHEMA_VERSION = 1;
  const OWNED_TOKEN = 'token';
  const OWNED_PANEL = 'panel';
  const LABEL_POSITIONS = new Set(['top-right', 'top-left', 'bottom-right', 'inline']);
  const SAFE_PROJECTION_CLASS = /^halo-(?:pos|structure)-[a-z0-9-]+$/;
  const PANEL_CSS = `
    :host { all: initial; }
    .halo-core-panel {
      position: fixed;
      box-sizing: border-box;
      z-index: 2147483647;
      width: min(20rem, calc(100vw - 1rem));
      max-height: calc(100vh - 1rem);
      overflow: auto;
      padding: 0.875rem;
      border: 1px solid #64748b;
      border-radius: 0.75rem;
      background: #ffffff;
      color: #172033;
      box-shadow: 0 0.75rem 2rem rgba(15, 23, 42, 0.22);
      font: 400 1rem/1.45 ui-sans-serif, system-ui, sans-serif;
      overflow-wrap: anywhere;
    }
    .halo-core-panel h2 { margin: 0 0 0.5rem; font: 700 1.05rem/1.3 ui-sans-serif, system-ui, sans-serif; }
    .halo-core-panel p { margin: 0.35rem 0; }
    .halo-core-status { font-size: 0.875rem; font-weight: 650; }
  `;

  function frozenResult(value) {
    return Object.freeze(value);
  }

  function nonemptyString(value, name, maximum) {
    if (typeof value !== 'string' || !value || value.length > maximum) {
      throw new TypeError(`${name}: must be a non-empty string of at most ${maximum} characters`);
    }
    return value;
  }

  function optionalString(value, name, maximum) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > maximum) {
      throw new TypeError(`${name}: must be a string of at most ${maximum} characters`);
    }
    return value;
  }

  function groupKey(operation) {
    return operation && operation.node ? operation.node : `node:${operation && operation.nodeId}`;
  }

  function planNodeOperations(fragments) {
    if (!Array.isArray(fragments)) throw new TypeError('fragments: must be an array');
    const nodeOrder = new Map();
    const normalized = fragments.map((fragment, index) => {
      if (!fragment || typeof fragment !== 'object' ||
          typeof fragment.nodeId !== 'string' || !fragment.nodeId ||
          !Number.isInteger(fragment.start) || !Number.isInteger(fragment.end) ||
          fragment.start < 0 || fragment.end <= fragment.start) {
        throw new TypeError('fragment: must have nodeId and valid start/end offsets');
      }
      const key = groupKey(fragment);
      if (!nodeOrder.has(key)) nodeOrder.set(key, nodeOrder.size);
      return { value: fragment, index, key };
    });
    normalized.sort((left, right) =>
      nodeOrder.get(right.key) - nodeOrder.get(left.key) ||
      right.value.start - left.value.start ||
      right.value.end - left.value.end ||
      right.index - left.index
    );
    return Object.freeze(normalized.map((entry) => entry.value));
  }

  function createRenderState(options) {
    const settings = options || {};
    const WeakRefClass = settings.WeakRef || root.WeakRef;
    const entries = new Map();

    function prune() {
      for (const [rootId, entry] of entries) {
        if (!entry.rootRef) continue;
        const node = entry.rootRef.deref();
        if (!node || node.isConnected === false) entries.delete(rootId);
      }
    }

    function record(value) {
      if (!value || typeof value !== 'object') throw new TypeError('render state record: must be an object');
      const rootId = nonemptyString(value.rootId, 'rootId', 256);
      if (!Number.isSafeInteger(value.rootRevision) || value.rootRevision < 0) {
        throw new TypeError('rootRevision: must be a non-negative safe integer');
      }
      const analysisKey = nonemptyString(value.analysisKey, 'analysisKey', 512);
      const runId = value.runId === undefined ? '' : String(value.runId);
      const wrappers = Number.isSafeInteger(value.wrappers) && value.wrappers >= 0 ? value.wrappers : 0;
      const rootRef = value.root && typeof WeakRefClass === 'function' ? new WeakRefClass(value.root) : null;
      const entry = {
        rootId,
        rootRevision: value.rootRevision,
        analysisKey,
        runId,
        wrappers,
        boundarySignature: typeof value.boundarySignature === 'string' ? value.boundarySignature : '',
        rootRef
      };
      entries.set(rootId, entry);
      return entry;
    }

    function classify(value) {
      prune();
      if (!value || typeof value !== 'object') throw new TypeError('render state request: must be an object');
      const current = entries.get(String(value.rootId));
      if (!current) return 'apply';
      return current.rootRevision === value.rootRevision && current.analysisKey === value.analysisKey
        ? 'duplicate'
        : 'reconcile';
    }

    function lookup(rootId) {
      prune();
      return entries.get(String(rootId)) || null;
    }

    function remove(rootId) {
      const key = String(rootId);
      const entry = entries.get(key) || null;
      entries.delete(key);
      return entry;
    }

    function values() {
      prune();
      return [...entries.values()];
    }

    function status() {
      return Object.freeze(values().map((entry) => Object.freeze({
        rootId: entry.rootId,
        rootRevision: entry.rootRevision,
        analysisKey: entry.analysisKey,
        runId: entry.runId,
        wrappers: entry.wrappers
      })));
    }

    return Object.freeze({ record, classify, lookup, remove, values, status });
  }

  function projectionFor(raw, index) {
    const plan = raw && raw.renderPlan && typeof raw.renderPlan === 'object'
      ? raw.renderPlan
      : raw;
    if (!plan || plan.marked !== true) throw new TypeError(`fragments[${index}].renderPlan.marked: must be true`);
    const pos = optionalString(plan.pos, `fragments[${index}].renderPlan.pos`, 48);
    const label = optionalString(plan.label, `fragments[${index}].renderPlan.label`, 96);
    const metaLabel = optionalString(plan.metaLabel, `fragments[${index}].renderPlan.metaLabel`, 256);
    const glossHint = optionalString(plan.glossHint, `fragments[${index}].renderPlan.glossHint`, 512);
    const labelPosition = plan.labelPosition === undefined || plan.labelPosition === null
      ? 'top-right'
      : String(plan.labelPosition);
    if (!LABEL_POSITIONS.has(labelPosition)) throw new TypeError(`fragments[${index}].renderPlan.labelPosition: is invalid`);
    const confidence = plan.confidence === undefined || plan.confidence === null
      ? null
      : Number(plan.confidence);
    if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
      throw new TypeError(`fragments[${index}].renderPlan.confidence: must be between 0 and 1`);
    }
    const classes = [];
    for (const [name, value] of [['colorClass', plan.colorClass], ['chunkClass', plan.chunkClass]]) {
      if (value === undefined || value === null || value === '') continue;
      if (typeof value !== 'string' || !SAFE_PROJECTION_CLASS.test(value)) {
        throw new TypeError(`fragments[${index}].renderPlan.${name}: class is outside the Halo namespace`);
      }
      classes.push(value);
    }
    return Object.freeze({
      pos,
      label,
      metaLabel,
      glossHint,
      labelPosition,
      confidence,
      classes: Object.freeze(classes),
      carrier: label || pos || metaLabel || 'annotation'
    });
  }

  function boundarySignature(fragments) {
    return JSON.stringify(fragments.map((fragment) => [
      fragment.boundaryKey,
      fragment.text
    ]));
  }

  function validateRenderEnvelope(raw, document) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('renderRequest: must be an object');
    if (raw.schemaVersion !== RENDER_REQUEST_SCHEMA_VERSION) {
      throw new TypeError(`renderRequest.schemaVersion: must be ${RENDER_REQUEST_SCHEMA_VERSION}`);
    }
    const runId = nonemptyString(raw.runId, 'renderRequest.runId', 256);
    const rootId = nonemptyString(raw.rootId, 'renderRequest.rootId', 256);
    const analysisKey = nonemptyString(raw.analysisKey, 'renderRequest.analysisKey', 512);
    if (!Number.isSafeInteger(raw.rootRevision) || raw.rootRevision < 0) {
      throw new TypeError('renderRequest.rootRevision: must be a non-negative safe integer');
    }
    if (!raw.root || raw.root.nodeType !== 1 || raw.root.ownerDocument !== document || raw.root.isConnected === false) {
      throw new TypeError('renderRequest.root: must be a connected Element from the renderer document');
    }
    if (!Array.isArray(raw.fragments)) throw new TypeError('renderRequest.fragments: must be an array');
    return Object.freeze({ runId, rootId, rootRevision: raw.rootRevision, analysisKey, root: raw.root });
  }

  function validateRenderRequest(raw, document) {
    const envelope = validateRenderEnvelope(raw, document);
    const fragments = raw.fragments.map((fragment, index) => {
      if (!fragment || typeof fragment !== 'object' || !fragment.node || fragment.node.nodeType !== 3 ||
          fragment.node.ownerDocument !== document || !envelope.root.contains(fragment.node)) {
        throw new TypeError(`fragments[${index}].node: must be a text node inside renderRequest.root`);
      }
      const nodeId = nonemptyString(fragment.nodeId, `fragments[${index}].nodeId`, 256);
      if (!Number.isInteger(fragment.start) || !Number.isInteger(fragment.end) ||
          fragment.start < 0 || fragment.end <= fragment.start || fragment.end > fragment.node.nodeValue.length) {
        throw new RangeError(`fragments[${index}]: offsets are outside the text node`);
      }
      const text = nonemptyString(fragment.text, `fragments[${index}].text`, 12000);
      if (fragment.node.nodeValue.slice(fragment.start, fragment.end) !== text) {
        throw new TypeError(`fragments[${index}]: source text does not match the text node`);
      }
      return Object.freeze({
        node: fragment.node,
        nodeId,
        start: fragment.start,
        end: fragment.end,
        text,
        boundaryKey: fragment.boundaryKey === undefined || fragment.boundaryKey === null
          ? `${nodeId}:${fragment.start}:${fragment.end}`
          : nonemptyString(fragment.boundaryKey, `fragments[${index}].boundaryKey`, 512),
        projection: projectionFor(fragment, index),
        boundaryIndex: index
      });
    });
    const byNode = new Map();
    for (const fragment of fragments) {
      if (!byNode.has(fragment.node)) byNode.set(fragment.node, []);
      byNode.get(fragment.node).push(fragment);
    }
    for (const values of byNode.values()) {
      values.sort((left, right) => left.start - right.start || left.end - right.end);
      for (let index = 1; index < values.length; index += 1) {
        if (values[index].start < values[index - 1].end) {
          throw new RangeError('renderRequest fragments overlap within one text node');
        }
      }
    }
    return Object.freeze({
      schemaVersion: RENDER_REQUEST_SCHEMA_VERSION,
      ...envelope,
      fragments: Object.freeze(fragments),
      boundarySignature: boundarySignature(fragments)
    });
  }

  function setOrRemove(element, name, value) {
    if (value === null || value === undefined || value === '') element.removeAttribute(name);
    else element.setAttribute(name, String(value));
  }

  function applyProjection(wrapper, request, fragment) {
    const projection = fragment.projection;
    wrapper.setAttribute('data-halo-owned', OWNED_TOKEN);
    wrapper.setAttribute('data-halo-run', request.runId);
    wrapper.setAttribute('data-halo-root', request.rootId);
    wrapper.setAttribute('data-halo-original', fragment.text);
    wrapper.setAttribute('data-halo-node', fragment.nodeId);
    wrapper.setAttribute('data-halo-start', String(fragment.start));
    wrapper.setAttribute('data-halo-end', String(fragment.end));
    wrapper.setAttribute('data-halo-index', String(fragment.boundaryIndex));
    wrapper.setAttribute('data-halo-boundary', fragment.boundaryKey);
    wrapper.setAttribute('data-halo-revision', String(request.rootRevision));
    wrapper.setAttribute('data-halo-carrier', projection.carrier);
    setOrRemove(wrapper, 'data-halo-pos', projection.label || projection.pos);
    setOrRemove(wrapper, 'data-halo-meta', projection.metaLabel);
    setOrRemove(wrapper, 'data-halo-gloss', projection.glossHint);
    setOrRemove(wrapper, 'data-halo-confidence', projection.confidence);
    setOrRemove(wrapper, 'title', projection.glossHint);
    const classes = ['halo-token', 'halo-noncolor-marker'];
    if (projection.label || projection.pos) classes.push(`halo-label-${projection.labelPosition}`);
    if (projection.metaLabel) classes.push('halo-has-meta');
    classes.push(...projection.classes);
    wrapper.className = classes.join(' ');
  }

  function createCorePanel(document) {
    if (!document || typeof document.createElement !== 'function') throw new TypeError('document: is required');
    const host = document.createElement('div');
    host.setAttribute('data-halo-owned', OWNED_PANEL);
    const protectedHostStyles = {
      all: 'initial',
      display: 'block',
      position: 'fixed',
      inset: '0 auto auto 0',
      width: '0px',
      height: '0px',
      visibility: 'visible',
      opacity: '1',
      overflow: 'visible',
      transform: 'none',
      filter: 'none',
      perspective: 'none',
      'clip-path': 'none',
      margin: '0',
      padding: '0',
      border: '0',
      'z-index': '2147483647'
    };
    for (const [property, value] of Object.entries(protectedHostStyles)) {
      host.style.setProperty(property, value, 'important');
    }
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    const panel = document.createElement('section');
    panel.className = 'halo-core-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'halo-panel-title');
    const title = document.createElement('h2');
    title.setAttribute('id', 'halo-panel-title');
    const body = document.createElement('p');
    body.className = 'halo-core-body';
    const status = document.createElement('p');
    status.className = 'halo-core-status';
    panel.append(title, body, status);
    shadow.append(style, panel);
    return Object.freeze({ host, shadow, panel, title, body, status });
  }

  function clampPanelPosition(position, viewport, panelSize, margin) {
    const edge = Number.isFinite(Number(margin)) ? Math.max(0, Number(margin)) : 8;
    const viewportWidth = Math.max(0, Number(viewport && viewport.width) || 0);
    const viewportHeight = Math.max(0, Number(viewport && viewport.height) || 0);
    const panelWidth = Math.max(0, Number(panelSize && panelSize.width) || 0);
    const panelHeight = Math.max(0, Number(panelSize && panelSize.height) || 0);
    const maximumLeft = Math.max(edge, viewportWidth - panelWidth - edge);
    const maximumTop = Math.max(edge, viewportHeight - panelHeight - edge);
    return Object.freeze({
      left: Math.min(maximumLeft, Math.max(edge, Number(position && position.x) || edge)),
      top: Math.min(maximumTop, Math.max(edge, Number(position && position.y) || edge))
    });
  }

  function createReversibleRenderer(options) {
    const settings = options || {};
    const document = settings.document || root.document;
    if (!document || typeof document.createElement !== 'function' || typeof document.createTextNode !== 'function') {
      throw new TypeError('document: must provide DOM creation methods');
    }
    const suppressMutations = typeof settings.suppressMutations === 'function'
      ? settings.suppressMutations
      : (callback) => callback();
    const trackOwnedNode = typeof settings.trackOwnedNode === 'function' ? settings.trackOwnedNode : () => {};
    const renderState = createRenderState({ WeakRef: settings.WeakRef });
    let panelParts = null;
    let panelOpen = false;
    let panelCloseReason = null;
    let lastAction = 'idle';

    function track(node) {
      if (node) trackOwnedNode(node);
      return node;
    }

    function rootFor(entry) {
      return entry && entry.rootRef ? entry.rootRef.deref() : null;
    }

    function ownedWrappers(entry) {
      const renderRoot = rootFor(entry);
      if (!renderRoot || typeof renderRoot.querySelectorAll !== 'function') return [];
      return Array.from(renderRoot.querySelectorAll('[data-halo-owned="token"]')).filter((wrapper) =>
        wrapper.getAttribute('data-halo-run') === entry.runId &&
        wrapper.getAttribute('data-halo-root') === entry.rootId
      );
    }

    function unwrapEntry(entry, normalizeParents) {
      const wrappers = ownedWrappers(entry);
      const parents = new Map();
      for (const wrapper of wrappers) {
        const parent = wrapper.parentNode;
        if (!parent) continue;
        const children = Array.from(wrapper.childNodes || []);
        const cleanOwnership = children.length === 1 && children[0].nodeType === 3 &&
          children[0].nodeValue === wrapper.getAttribute('data-halo-original');
        parents.set(parent, (parents.get(parent) ?? true) && cleanOwnership);
        track(wrapper);
        track(parent);
        for (const child of children) track(child);
        if (typeof wrapper.replaceWith === 'function') wrapper.replaceWith(...children);
        else {
          for (const child of children) parent.insertBefore(child, wrapper);
          parent.removeChild(wrapper);
        }
      }
      if (normalizeParents) {
        for (const [parent, safeToNormalize] of parents) {
          if (!safeToNormalize || typeof parent.normalize !== 'function') continue;
          for (const child of Array.from(parent.childNodes || [])) track(child);
          parent.normalize();
          for (const child of Array.from(parent.childNodes || [])) track(child);
        }
      }
      return wrappers.length;
    }

    function preparedOperations(request) {
      return planNodeOperations(request.fragments).map((fragment) => {
        const wrapper = track(document.createElement('span'));
        applyProjection(wrapper, request, fragment);
        wrapper.textContent = fragment.text;
        for (const child of Array.from(wrapper.childNodes || [])) track(child);
        return { fragment, wrapper };
      });
    }

    function applyPrepared(prepared) {
      for (const operation of prepared) {
        const fragment = operation.fragment;
        const node = fragment.node;
        if (!node.parentNode || node.nodeValue.slice(fragment.start, fragment.end) !== fragment.text) {
          throw new Error(`render fragment became stale: ${fragment.nodeId}`);
        }
        track(node);
        const suffix = track(node.splitText(fragment.end));
        const marked = track(node.splitText(fragment.start));
        track(marked.parentNode);
        marked.parentNode.replaceChild(operation.wrapper, marked);
        track(suffix);
      }
    }

    function record(request) {
      return renderState.record({
        rootId: request.rootId,
        rootRevision: request.rootRevision,
        analysisKey: request.analysisKey,
        runId: request.runId,
        wrappers: request.fragments.length,
        boundarySignature: request.boundarySignature,
        root: request.root
      });
    }

    function applyValidated(request) {
      const prepared = preparedOperations(request);
      suppressMutations(() => applyPrepared(prepared));
      record(request);
      lastAction = 'applied';
      return frozenResult({ action: 'applied', rootId: request.rootId, wrappers: request.fragments.length });
    }

    function wrappersMatchBoundaries(entry, request) {
      if (entry.boundarySignature !== request.boundarySignature) return false;
      const wrappers = ownedWrappers(entry);
      if (wrappers.length !== request.fragments.length) return false;
      const byIndex = new Map(wrappers.map((wrapper) => [wrapper.getAttribute('data-halo-index'), wrapper]));
      return request.fragments.every((fragment) => {
        const wrapper = byIndex.get(String(fragment.boundaryIndex));
        return Boolean(wrapper &&
          wrapper.getAttribute('data-halo-boundary') === fragment.boundaryKey &&
          wrapper.getAttribute('data-halo-original') === fragment.text &&
          wrapper.childNodes.length === 1 && wrapper.childNodes[0].nodeType === 3 &&
          wrapper.textContent === fragment.text);
      });
    }

    function updateInPlace(entry, request) {
      const wrappers = ownedWrappers(entry);
      const byIndex = new Map(wrappers.map((wrapper) => [wrapper.getAttribute('data-halo-index'), wrapper]));
      suppressMutations(() => {
        for (const fragment of request.fragments) {
          const wrapper = byIndex.get(String(fragment.boundaryIndex));
          track(wrapper);
          applyProjection(wrapper, request, fragment);
        }
      });
      record(request);
      lastAction = 'updated';
      return frozenResult({ action: 'updated', rootId: request.rootId, wrappers: request.fragments.length });
    }

    function reconcileValidated(request) {
      const entry = renderState.lookup(request.rootId);
      if (!entry) return applyValidated(request);
      if (entry.rootRef && entry.rootRef.deref() !== request.root) {
        throw new Error('renderRequest.rootId is already bound to a different live root');
      }
      if (wrappersMatchBoundaries(entry, request)) return updateInPlace(entry, request);
      const prepared = preparedOperations(request);
      suppressMutations(() => {
        unwrapEntry(entry, false);
        applyPrepared(prepared);
      });
      record(request);
      lastAction = 'rebuilt';
      return frozenResult({ action: 'rebuilt', rootId: request.rootId, wrappers: request.fragments.length });
    }

    function apply(rawRequest) {
      const envelope = validateRenderEnvelope(rawRequest, document);
      const classification = renderState.classify(envelope);
      if (classification === 'duplicate') {
        const entry = renderState.lookup(envelope.rootId);
        if (entry && entry.rootRef && entry.rootRef.deref() !== envelope.root) {
          throw new Error('renderRequest.rootId is already bound to a different live root');
        }
        lastAction = 'duplicate';
        return frozenResult({ action: 'duplicate', rootId: envelope.rootId, wrappers: entry ? entry.wrappers : 0 });
      }
      const request = validateRenderRequest(rawRequest, document);
      if (classification === 'reconcile') return reconcileValidated(request);
      return applyValidated(request);
    }

    function reconcile(rawRequest) {
      const envelope = validateRenderEnvelope(rawRequest, document);
      const classification = renderState.classify(envelope);
      if (classification === 'duplicate') {
        const entry = renderState.lookup(envelope.rootId);
        if (entry && entry.rootRef && entry.rootRef.deref() !== envelope.root) {
          throw new Error('renderRequest.rootId is already bound to a different live root');
        }
        lastAction = 'duplicate';
        return frozenResult({ action: 'duplicate', rootId: envelope.rootId, wrappers: entry ? entry.wrappers : 0 });
      }
      const request = validateRenderRequest(rawRequest, document);
      return reconcileValidated(request);
    }

    function removeRoot(rootId) {
      const key = nonemptyString(rootId, 'rootId', 256);
      const entry = renderState.lookup(key);
      if (!entry) return frozenResult({ action: 'noop', rootId: key, wrappers: 0 });
      let removed = 0;
      suppressMutations(() => {
        removed = unwrapEntry(entry, true);
      });
      renderState.remove(key);
      lastAction = 'removed';
      return frozenResult({ action: 'removed', rootId: key, wrappers: removed });
    }

    function closePanel(reason) {
      const closeReason = reason === undefined ? 'closed' : nonemptyString(reason, 'reason', 128);
      if (!panelOpen || !panelParts) return frozenResult({ action: 'noop', reason: panelCloseReason });
      track(panelParts.host);
      panelParts.host.remove();
      panelParts = null;
      panelOpen = false;
      panelCloseReason = closeReason;
      lastAction = 'panel-closed';
      return frozenResult({ action: 'closed', reason: closeReason });
    }

    function removeAll() {
      let wrappers = 0;
      for (const entry of [...renderState.values()]) {
        const result = removeRoot(entry.rootId);
        wrappers += result.wrappers;
      }
      if (panelOpen) closePanel('remove-all');
      lastAction = 'removed-all';
      return frozenResult({ action: 'removed-all', wrappers });
    }

    function openPanel(model) {
      if (!model || typeof model !== 'object' || Array.isArray(model)) throw new TypeError('panel model: must be an object');
      const titleText = nonemptyString(model.title, 'panel model.title', 256);
      const bodyText = optionalString(model.body, 'panel model.body', 4000) || '';
      const statusText = optionalString(model.status, 'panel model.status', 256) || '';
      const anchor = model.anchor && typeof model.anchor === 'object' ? model.anchor : {};
      if (panelOpen) closePanel('replaced');
      panelParts = createCorePanel(document);
      panelParts.title.textContent = titleText;
      panelParts.body.textContent = bodyText;
      panelParts.status.textContent = statusText;
      track(panelParts.host);
      const container = document.body || document.documentElement;
      container.appendChild(panelParts.host);
      const view = document.defaultView || root;
      const viewport = { width: Number(view.innerWidth) || 0, height: Number(view.innerHeight) || 0 };
      const rect = panelParts.panel.getBoundingClientRect();
      const position = clampPanelPosition({ x: anchor.x, y: anchor.y }, viewport, rect, 8);
      panelParts.panel.style.left = `${position.left}px`;
      panelParts.panel.style.top = `${position.top}px`;
      panelOpen = true;
      panelCloseReason = null;
      lastAction = 'panel-opened';
      return frozenResult({ action: 'opened', position });
    }

    function status() {
      const roots = renderState.status();
      return frozenResult({
        schemaVersion: RENDER_REQUEST_SCHEMA_VERSION,
        rootCount: roots.length,
        wrapperCount: roots.reduce((sum, entry) => sum + entry.wrappers, 0),
        roots,
        panel: frozenResult({ open: panelOpen, closeReason: panelCloseReason }),
        lastAction
      });
    }

    return Object.freeze({ apply, reconcile, removeRoot, removeAll, openPanel, closePanel, status });
  }

  return Object.freeze({
    RENDER_REQUEST_SCHEMA_VERSION,
    planNodeOperations,
    createRenderState,
    validateRenderRequest,
    clampPanelPosition,
    createCorePanel,
    createReversibleRenderer
  });
});
