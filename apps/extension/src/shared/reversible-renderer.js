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
    const WeakRefClass = Object.prototype.hasOwnProperty.call(settings, 'WeakRef')
      ? settings.WeakRef
      : root.WeakRef;
    const entries = new Map();

    function reference(value) {
      if (!value) return null;
      if (typeof WeakRefClass === 'function') return new WeakRefClass(value);
      return { deref: () => value };
    }

    function prune() {
      for (const [rootId, entry] of entries) {
        if (!entry.rootRef) continue;
        const node = entry.rootRef.deref();
        if (!node) entries.delete(rootId);
      }
    }

    function prepare(value) {
      if (!value || typeof value !== 'object') throw new TypeError('render state record: must be an object');
      const rootId = nonemptyString(value.rootId, 'rootId', 256);
      if (!Number.isSafeInteger(value.rootRevision) || value.rootRevision < 0) {
        throw new TypeError('rootRevision: must be a non-negative safe integer');
      }
      const analysisKey = nonemptyString(value.analysisKey, 'analysisKey', 512);
      const runId = value.runId === undefined ? '' : String(value.runId);
      const wrappers = Number.isSafeInteger(value.wrappers) && value.wrappers >= 0 ? value.wrappers : 0;
      const wrapperNodes = Array.isArray(value.wrapperNodes) ? value.wrapperNodes : [];
      return {
        rootId,
        rootRevision: value.rootRevision,
        analysisKey,
        runId,
        wrappers,
        boundarySignature: typeof value.boundarySignature === 'string' ? value.boundarySignature : '',
        rootRef: reference(value.root),
        wrapperRefs: wrapperNodes.map(reference)
      };
    }

    function commit(entry) {
      if (!entry || typeof entry !== 'object') throw new TypeError('render state entry: must be an object');
      entries.set(entry.rootId, entry);
      return entry;
    }

    function record(value) {
      const entry = prepare(value);
      return commit(entry);
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

    return Object.freeze({ prepare, commit, record, classify, lookup, remove, values, status });
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

  function setOrRemove(element, name, value, mutations) {
    if (value === null || value === undefined || value === '') mutations.removeAttribute(element, name);
    else mutations.setAttribute(element, name, String(value));
  }

  function applyProjection(wrapper, request, fragment, mutationMethods) {
    const mutations = mutationMethods || {
      setAttribute: (element, name, value) => element.setAttribute(name, value),
      removeAttribute: (element, name) => element.removeAttribute(name),
      setClassName: (element, value) => { element.className = value; }
    };
    const projection = fragment.projection;
    mutations.setAttribute(wrapper, 'data-halo-owned', OWNED_TOKEN);
    mutations.setAttribute(wrapper, 'data-halo-run', request.runId);
    mutations.setAttribute(wrapper, 'data-halo-root', request.rootId);
    mutations.setAttribute(wrapper, 'data-halo-original', fragment.text);
    mutations.setAttribute(wrapper, 'data-halo-node', fragment.nodeId);
    mutations.setAttribute(wrapper, 'data-halo-start', String(fragment.start));
    mutations.setAttribute(wrapper, 'data-halo-end', String(fragment.end));
    mutations.setAttribute(wrapper, 'data-halo-index', String(fragment.boundaryIndex));
    mutations.setAttribute(wrapper, 'data-halo-boundary', fragment.boundaryKey);
    mutations.setAttribute(wrapper, 'data-halo-revision', String(request.rootRevision));
    mutations.setAttribute(wrapper, 'data-halo-carrier', projection.carrier);
    setOrRemove(wrapper, 'data-halo-pos', projection.label || projection.pos, mutations);
    setOrRemove(wrapper, 'data-halo-meta', projection.metaLabel, mutations);
    setOrRemove(wrapper, 'data-halo-gloss', projection.glossHint, mutations);
    setOrRemove(wrapper, 'data-halo-confidence', projection.confidence, mutations);
    setOrRemove(wrapper, 'title', projection.glossHint, mutations);
    const classes = ['halo-token', 'halo-noncolor-marker'];
    if (projection.label || projection.pos) classes.push(`halo-label-${projection.labelPosition}`);
    if (projection.metaLabel) classes.push('halo-has-meta');
    classes.push(...projection.classes);
    mutations.setClassName(wrapper, classes.join(' '));
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
    const trackMutation = typeof settings.trackMutation === 'function' ? settings.trackMutation : () => {};
    if (Object.prototype.hasOwnProperty.call(settings, 'prepareCapabilities') &&
        typeof settings.prepareCapabilities !== 'function') {
      throw new TypeError('prepareCapabilities: must be a function');
    }
    const prepareCapabilities = typeof settings.prepareCapabilities === 'function'
      ? settings.prepareCapabilities
      : () => {};
    const renderState = createRenderState(Object.prototype.hasOwnProperty.call(settings, 'WeakRef')
      ? { WeakRef: settings.WeakRef }
      : {});
    const wrapperCapabilities = new WeakSet();
    const wrapperMetadata = new WeakMap();
    let panelParts = null;
    let panelOpen = false;
    let panelCloseReason = null;
    let lastAction = 'idle';

    function track(node) {
      if (node) trackOwnedNode(node);
      return node;
    }

    function expectMutation(operation) {
      trackMutation(Object.freeze(operation));
    }

    function trackedSetAttribute(element, name, value) {
      expectMutation({
        type: 'attributes',
        target: element,
        attributeName: String(name).toLowerCase(),
        oldValue: element.getAttribute(name)
      });
      element.setAttribute(name, value);
    }

    function trackedRemoveAttribute(element, name) {
      if (!element.hasAttribute(name)) return;
      expectMutation({
        type: 'attributes',
        target: element,
        attributeName: String(name).toLowerCase(),
        oldValue: element.getAttribute(name)
      });
      element.removeAttribute(name);
    }

    const trackedProjectionMutations = Object.freeze({
      setAttribute: trackedSetAttribute,
      removeAttribute: trackedRemoveAttribute,
      setClassName(element, value) {
        trackedSetAttribute(element, 'class', value);
      }
    });

    function expectChildList(target, addedNodes, removedNodes) {
      expectMutation({
        type: 'childList',
        target,
        addedNodes: Object.freeze(Array.from(addedNodes || [])),
        removedNodes: Object.freeze(Array.from(removedNodes || []))
      });
    }

    function trackedNodeValue(node, value) {
      if (node.nodeValue === value) return;
      expectMutation({ type: 'characterData', target: node, oldValue: node.nodeValue });
      node.nodeValue = value;
    }

    function rootFor(entry) {
      return entry && entry.rootRef ? entry.rootRef.deref() : null;
    }

    function attributeEntries(element) {
      if (!element || element.nodeType !== 1) return [];
      if (typeof element.getAttributeNames === 'function') {
        return element.getAttributeNames().map((name) => [name, element.getAttribute(name)]);
      }
      return Array.from(element.attributes || []).map((attribute) =>
        Array.isArray(attribute) ? [attribute[0], attribute[1]] : [attribute.name, attribute.value]
      );
    }

    function captureSubtree(renderRoot) {
      const parents = [];
      const textValues = [];
      const attributes = [];
      const visit = (node) => {
        if (!node) return;
        if (node.nodeType === 3) textValues.push({ node, value: node.nodeValue });
        if (node.nodeType === 1 && wrapperCapabilities.has(node)) {
          attributes.push({ node, entries: attributeEntries(node) });
        }
        if (!node.childNodes) return;
        parents.push({ node, children: Array.from(node.childNodes) });
        for (const child of Array.from(node.childNodes)) visit(child);
      };
      visit(renderRoot);
      return { parents, textValues, attributes };
    }

    function restoreAttributes(record) {
      const names = typeof record.node.getAttributeNames === 'function'
        ? record.node.getAttributeNames()
        : attributeEntries(record.node).map((entry) => entry[0]);
      for (const name of names) trackedRemoveAttribute(record.node, name);
      for (const [name, value] of record.entries) trackedSetAttribute(record.node, name, value);
    }

    function restoreSubtree(snapshot) {
      for (const record of snapshot.parents) {
        const wanted = record.children;
        for (const child of Array.from(record.node.childNodes || [])) {
          if (wanted.includes(child)) continue;
          expectChildList(record.node, [], [child]);
          record.node.removeChild(child);
        }
        for (let index = 0; index < wanted.length; index += 1) {
          const child = wanted[index];
          if (record.node.childNodes[index] === child) continue;
          if (child.parentNode && child.parentNode !== record.node) {
            expectChildList(child.parentNode, [], [child]);
          }
          expectChildList(record.node, [child], child.parentNode === record.node ? [child] : []);
          record.node.insertBefore(child, record.node.childNodes[index] || null);
        }
      }
      for (const record of snapshot.textValues) {
        trackedNodeValue(record.node, record.value);
      }
      for (const record of snapshot.attributes) {
        restoreAttributes(record);
      }
    }

    function runSuppressedTransaction(mutate, rollback) {
      let entered = false;
      try {
        return suppressMutations(() => {
          entered = true;
          return mutate();
        });
      } catch (error) {
        if (entered) {
          let restored = false;
          const rollbackErrors = [];
          const restore = () => {
            rollback();
            restored = true;
          };
          try {
            suppressMutations(restore);
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
            if (!restored) {
              try {
                restore();
              } catch (directRollbackError) {
                if (directRollbackError !== rollbackError) rollbackErrors.push(directRollbackError);
              }
            }
          }
          if (rollbackErrors.length) {
            throw new AggregateError(
              [error, ...rollbackErrors],
              `${error && error.message ? error.message : 'renderer mutation failed'}; rollback failed`,
              { cause: error }
            );
          }
        }
        throw error;
      }
    }

    function snapshotRoots(renderRoot, entries) {
      const candidates = [];
      if (renderRoot) candidates.push(renderRoot);
      for (const entry of Array.from(entries || [])) {
        for (const wrapper of ownedWrappers(entry)) candidates.push(wrapper.parentNode || wrapper);
      }
      const roots = [];
      for (const candidate of candidates) {
        if (!candidate || roots.some((current) => current === candidate ||
            (typeof current.contains === 'function' && current.contains(candidate)))) continue;
        for (let index = roots.length - 1; index >= 0; index -= 1) {
          if (typeof candidate.contains === 'function' && candidate.contains(roots[index])) roots.splice(index, 1);
        }
        roots.push(candidate);
      }
      return roots.map(captureSubtree);
    }

    function mutateRootAtomically(renderRoot, mutate, entries) {
      const snapshots = snapshotRoots(renderRoot, entries);
      return runSuppressedTransaction(mutate, () => {
        for (const snapshot of snapshots) restoreSubtree(snapshot);
      });
    }

    function ownedWrappers(entry) {
      return Array.from(entry && entry.wrapperRefs || [], (reference) => reference && reference.deref())
        .filter((wrapper) => wrapper && wrapperCapabilities.has(wrapper))
        .filter((wrapper) => {
          const metadata = wrapperMetadata.get(wrapper);
          return metadata && metadata.rootId === entry.rootId;
        });
    }

    function unwrapEntry(entry, normalizeParents) {
      const wrappers = ownedWrappers(entry);
      const parents = new Map();
      for (const wrapper of wrappers) {
        const parent = wrapper.parentNode;
        if (!parent) continue;
        const children = Array.from(wrapper.childNodes || []);
        const metadata = wrapperMetadata.get(wrapper);
        const cleanOwnership = children.length === 1 && children[0].nodeType === 3 &&
          metadata && children[0].nodeValue === metadata.original;
        parents.set(parent, (parents.get(parent) ?? true) && cleanOwnership);
        track(wrapper);
        expectChildList(parent, children, [wrapper]);
        if (typeof wrapper.replaceWith === 'function') wrapper.replaceWith(...children);
        else {
          for (const child of children) parent.insertBefore(child, wrapper);
          parent.removeChild(wrapper);
        }
      }
      if (normalizeParents) {
        for (const [parent, safeToNormalize] of parents) {
          if (!safeToNormalize || typeof parent.normalize !== 'function') continue;
          expectNormalization(parent);
          parent.normalize();
        }
      }
      return wrappers.length;
    }

    function expectNormalization(parent) {
      const visit = (container) => {
        let group = [];
        const flush = () => {
          if (!group.length) return;
          const nonempty = group.filter((node) => node.nodeValue !== '');
          const survivor = nonempty[0] || null;
          const removed = group.filter((node) => node !== survivor);
          if (removed.length) expectChildList(container, [], removed);
          if (survivor) {
            let accumulated = survivor.nodeValue;
            let seenSurvivor = false;
            for (const node of group) {
              if (node === survivor) {
                seenSurvivor = true;
                continue;
              }
              if (!seenSurvivor || node.nodeValue === '') continue;
              expectMutation({ type: 'characterData', target: survivor, oldValue: accumulated });
              accumulated += node.nodeValue;
            }
          }
          group = [];
        };
        for (const child of Array.from(container.childNodes || [])) {
          if (child.nodeType === 3) {
            group.push(child);
            continue;
          }
          flush();
          if (child.nodeType === 1) visit(child);
        }
        flush();
      };
      visit(parent);
    }

    function scrubWrapper(wrapper) {
      for (const name of attributeEntries(wrapper).map((entry) => entry[0])) {
        if (name === 'title' || name.startsWith('data-halo-')) trackedRemoveAttribute(wrapper, name);
      }
      const retainedClasses = String(wrapper.className || '').split(/\s+/)
        .filter(Boolean)
        .filter((name) => !name.startsWith('halo-'));
      if (retainedClasses.length) trackedSetAttribute(wrapper, 'class', retainedClasses.join(' '));
      else trackedRemoveAttribute(wrapper, 'class');
    }

    function revokeWrappers(wrappers) {
      for (const wrapper of wrappers) {
        wrapperCapabilities.delete(wrapper);
        wrapperMetadata.delete(wrapper);
      }
    }

    function grantPreparedOperations(prepared) {
      const granted = [];
      try {
        for (const operation of prepared) {
          granted.push(operation.wrapper);
          wrapperCapabilities.add(operation.wrapper);
          wrapperMetadata.set(operation.wrapper, operation.metadata);
        }
      } catch (error) {
        revokeWrappers(granted);
        throw error;
      }
    }

    function cleanupEntry(entry, normalizeParents) {
      const wrappers = ownedWrappers(entry);
      unwrapEntry(entry, normalizeParents);
      for (const wrapper of wrappers) scrubWrapper(wrapper);
      return wrappers;
    }

    function preparedOperations(request) {
      return planNodeOperations(request.fragments).map((fragment) => {
        const wrapper = track(document.createElement('span'));
        const metadata = Object.freeze({
          rootId: request.rootId,
          runId: request.runId,
          original: fragment.text,
          boundaryKey: fragment.boundaryKey,
          boundaryIndex: fragment.boundaryIndex
        });
        applyProjection(wrapper, request, fragment);
        wrapper.textContent = fragment.text;
        for (const child of Array.from(wrapper.childNodes || [])) track(child);
        return { fragment, wrapper, metadata };
      });
    }

    function applyPrepared(prepared) {
      for (const operation of prepared) {
        const fragment = operation.fragment;
        const node = fragment.node;
        if (!node.parentNode || node.nodeValue.slice(fragment.start, fragment.end) !== fragment.text) {
          throw new Error(`render fragment became stale: ${fragment.nodeId}`);
        }
        const suffix = splitTextTracked(node, fragment.end);
        const marked = splitTextTracked(node, fragment.start);
        expectChildList(marked.parentNode, [operation.wrapper], [marked]);
        marked.parentNode.replaceChild(operation.wrapper, marked);
      }
    }

    function splitTextTracked(node, offset) {
      const parent = node.parentNode;
      const childrenBefore = parent ? new Set(Array.from(parent.childNodes || [])) : null;
      expectMutation({ type: 'characterData', target: node, oldValue: node.nodeValue });
      let split;
      try {
        split = node.splitText(offset);
        return split;
      } finally {
        if (parent && childrenBefore) {
          for (const child of Array.from(parent.childNodes || [])) {
            if (childrenBefore.has(child)) continue;
            track(child);
            expectChildList(parent, [child], []);
          }
        }
      }
    }

    function validatePrivateOwnership(request) {
      for (const fragment of request.fragments) {
        for (let current = fragment.node.parentNode; current; current = current.parentNode) {
          if (!wrapperCapabilities.has(current)) continue;
          const metadata = wrapperMetadata.get(current);
          if (!metadata || metadata.rootId !== request.rootId) {
            throw new Error('render fragment is already owned by another renderer root');
          }
          break;
        }
      }
      return request;
    }

    function prepareRecord(request, wrappers) {
      return renderState.prepare({
        rootId: request.rootId,
        rootRevision: request.rootRevision,
        analysisKey: request.analysisKey,
        runId: request.runId,
        wrappers: request.fragments.length,
        boundarySignature: request.boundarySignature,
        root: request.root,
        wrapperNodes: wrappers
      });
    }

    function applyValidated(request) {
      const prepared = preparedOperations(request);
      const wrappers = prepared
        .slice()
        .sort((left, right) => left.fragment.boundaryIndex - right.fragment.boundaryIndex)
        .map((operation) => operation.wrapper);
      const nextEntry = prepareRecord(request, wrappers);
      prepareCapabilities(Object.freeze({ rootId: request.rootId, wrapperCount: wrappers.length }));
      grantPreparedOperations(prepared);
      try {
        mutateRootAtomically(request.root, () => applyPrepared(prepared));
      } catch (error) {
        revokeWrappers(wrappers);
        throw error;
      }
      renderState.commit(nextEntry);
      lastAction = 'applied';
      return frozenResult({ action: 'applied', rootId: request.rootId, wrappers: request.fragments.length });
    }

    function wrappersMatchBoundaries(entry, request) {
      if (entry.boundarySignature !== request.boundarySignature) return false;
      const wrappers = ownedWrappers(entry);
      if (wrappers.length !== request.fragments.length) return false;
      const byIndex = new Map(wrappers.map((wrapper) => {
        const metadata = wrapperMetadata.get(wrapper);
        return [String(metadata.boundaryIndex), wrapper];
      }));
      return request.fragments.every((fragment) => {
        const wrapper = byIndex.get(String(fragment.boundaryIndex));
        const metadata = wrapper && wrapperMetadata.get(wrapper);
        return Boolean(wrapper &&
          metadata && metadata.boundaryKey === fragment.boundaryKey &&
          metadata.original === fragment.text &&
          wrapper.childNodes.length === 1 && wrapper.childNodes[0].nodeType === 3 &&
          wrapper.textContent === fragment.text);
      });
    }

    function updateInPlace(entry, request) {
      const wrappers = ownedWrappers(entry);
      const byIndex = new Map(wrappers.map((wrapper) => [
        String(wrapperMetadata.get(wrapper).boundaryIndex), wrapper
      ]));
      const nextEntry = prepareRecord(request, wrappers);
      mutateRootAtomically(request.root, () => {
        for (const fragment of request.fragments) {
          const wrapper = byIndex.get(String(fragment.boundaryIndex));
          applyProjection(wrapper, request, fragment, trackedProjectionMutations);
        }
      }, [entry]);
      for (const fragment of request.fragments) {
        const wrapper = byIndex.get(String(fragment.boundaryIndex));
        wrapperMetadata.set(wrapper, Object.freeze({
          rootId: request.rootId,
          runId: request.runId,
          original: fragment.text,
          boundaryKey: fragment.boundaryKey,
          boundaryIndex: fragment.boundaryIndex
        }));
      }
      renderState.commit(nextEntry);
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
      const wrappers = prepared
        .slice()
        .sort((left, right) => left.fragment.boundaryIndex - right.fragment.boundaryIndex)
        .map((operation) => operation.wrapper);
      const nextEntry = prepareRecord(request, wrappers);
      const oldWrappers = ownedWrappers(entry);
      prepareCapabilities(Object.freeze({ rootId: request.rootId, wrapperCount: wrappers.length }));
      grantPreparedOperations(prepared);
      try {
        mutateRootAtomically(request.root, () => {
          cleanupEntry(entry, false);
          applyPrepared(prepared);
        }, [entry]);
      } catch (error) {
        revokeWrappers(wrappers);
        throw error;
      }
      revokeWrappers(oldWrappers);
      renderState.commit(nextEntry);
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
      const request = validatePrivateOwnership(validateRenderRequest(rawRequest, document));
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
      const request = validatePrivateOwnership(validateRenderRequest(rawRequest, document));
      return reconcileValidated(request);
    }

    function removeRoot(rootId) {
      const key = nonemptyString(rootId, 'rootId', 256);
      const entry = renderState.lookup(key);
      if (!entry) return frozenResult({ action: 'noop', rootId: key, wrappers: 0 });
      let removed = 0;
      const renderRoot = rootFor(entry);
      let wrappers = [];
      mutateRootAtomically(renderRoot, () => {
        wrappers = cleanupEntry(entry, true);
        removed = wrappers.length;
      }, [entry]);
      revokeWrappers(wrappers);
      renderState.remove(key);
      lastAction = 'removed';
      return frozenResult({ action: 'removed', rootId: key, wrappers: removed });
    }

    function nodeLocation(node) {
      const parent = node && node.parentNode;
      return {
        node,
        parent,
        index: parent ? Array.from(parent.childNodes || []).indexOf(node) : -1
      };
    }

    function restoreNodeLocation(location) {
      const node = location && location.node;
      if (!node) return;
      if (!location.parent) {
        if (node.parentNode) {
          track(node);
          expectChildList(node.parentNode, [], [node]);
          node.parentNode.removeChild(node);
        }
        return;
      }
      const reference = location.parent.childNodes[location.index] || null;
      if (node.parentNode === location.parent && reference === node) return;
      track(node);
      if (node.parentNode && node.parentNode !== location.parent) expectChildList(node.parentNode, [], [node]);
      expectChildList(location.parent, [node], node.parentNode === location.parent ? [node] : []);
      location.parent.insertBefore(node, reference);
    }

    function removePanelHost(parts) {
      if (!parts || !parts.host || !parts.host.parentNode) return;
      track(parts.host);
      expectChildList(parts.host.parentNode, [], [parts.host]);
      parts.host.parentNode.removeChild(parts.host);
    }

    function closePanel(reason) {
      const closeReason = reason === undefined ? 'closed' : nonemptyString(reason, 'reason', 128);
      if (!panelOpen || !panelParts) return frozenResult({ action: 'noop', reason: panelCloseReason });
      const closingParts = panelParts;
      const location = nodeLocation(closingParts.host);
      runSuppressedTransaction(
        () => removePanelHost(closingParts),
        () => restoreNodeLocation(location)
      );
      panelParts = null;
      panelOpen = false;
      panelCloseReason = closeReason;
      lastAction = 'panel-closed';
      return frozenResult({ action: 'closed', reason: closeReason });
    }

    function removeAll() {
      const entries = [...renderState.values()];
      const renderRoots = entries.map(rootFor).filter(Boolean);
      const snapshots = snapshotRoots(null, entries);
      for (const renderRoot of renderRoots) {
        if (snapshots.some((snapshot) => snapshot.parents.some((record) => record.node === renderRoot))) continue;
        snapshots.push(captureSubtree(renderRoot));
      }
      const closingParts = panelOpen ? panelParts : null;
      const panelLocation = closingParts ? nodeLocation(closingParts.host) : null;
      let wrappers = 0;
      const releasedWrappers = [];
      if (entries.length || closingParts) {
        runSuppressedTransaction(() => {
          for (const entry of entries) {
            const cleaned = cleanupEntry(entry, true);
            wrappers += cleaned.length;
            releasedWrappers.push(...cleaned);
          }
          if (closingParts) removePanelHost(closingParts);
        }, () => {
          for (const snapshot of snapshots) restoreSubtree(snapshot);
          if (panelLocation) restoreNodeLocation(panelLocation);
        });
      }
      revokeWrappers(releasedWrappers);
      for (const entry of entries) renderState.remove(entry.rootId);
      if (closingParts) {
        panelParts = null;
        panelOpen = false;
        panelCloseReason = 'remove-all';
      }
      lastAction = 'removed-all';
      return frozenResult({ action: 'removed-all', wrappers });
    }

    function openPanel(model) {
      if (!model || typeof model !== 'object' || Array.isArray(model)) throw new TypeError('panel model: must be an object');
      const titleText = nonemptyString(model.title, 'panel model.title', 256);
      const bodyText = optionalString(model.body, 'panel model.body', 4000) || '';
      const statusText = optionalString(model.status, 'panel model.status', 256) || '';
      const anchor = model.anchor && typeof model.anchor === 'object' ? model.anchor : {};
      const requestedPosition = { x: Number(anchor.x) || 8, y: Number(anchor.y) || 8 };
      const view = document.defaultView || root;
      const viewport = { width: Number(view.innerWidth) || 0, height: Number(view.innerHeight) || 0 };
      const container = document.body || document.documentElement;
      if (!container || typeof container.appendChild !== 'function') throw new TypeError('panel container: is unavailable');
      const nextParts = createCorePanel(document);
      nextParts.title.textContent = titleText;
      nextParts.body.textContent = bodyText;
      nextParts.status.textContent = statusText;
      const priorParts = panelOpen ? panelParts : null;
      const nextLocation = nodeLocation(nextParts.host);
      const priorLocation = priorParts ? nodeLocation(priorParts.host) : null;
      let position;
      runSuppressedTransaction(() => {
        track(nextParts.host);
        expectChildList(container, [nextParts.host], []);
        container.appendChild(nextParts.host);
        const rect = nextParts.panel.getBoundingClientRect();
        position = clampPanelPosition(requestedPosition, viewport, rect, 8);
        nextParts.panel.style.left = `${position.left}px`;
        nextParts.panel.style.top = `${position.top}px`;
        if (priorParts) removePanelHost(priorParts);
      }, () => {
        restoreNodeLocation(nextLocation);
        if (priorLocation) restoreNodeLocation(priorLocation);
      });
      panelParts = nextParts;
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

    function ownsToken(element, expectedRootId) {
      if (!element || !wrapperCapabilities.has(element)) return false;
      const metadata = wrapperMetadata.get(element);
      if (!metadata) return false;
      return expectedRootId === undefined || metadata.rootId === expectedRootId;
    }

    return Object.freeze({ apply, reconcile, removeRoot, removeAll, openPanel, closePanel, status, ownsToken });
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
