(function (root, factory) {
  const base = typeof module === 'object' && module.exports
    ? require('./reversible-renderer')
    : root.HaloReversibleRenderer;
  const api = factory(root, base);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloReversibleRenderer = api;
  root.HaloDogfoodRenderer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Base) {
  'use strict';

  const ACTION_IDS = new Set(['save-sentence', 'dogfood-note']);
  const OBSERVATION_MAX = 512;
  const NOTE_MAX = 2000;

  function observationRuntime() {
    const value = root && root.__HALO_DOGFOOD_OBSERVATION_RUNTIME__;
    return value && typeof value === 'object' ? value : null;
  }

  function observationKey(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > OBSERVATION_MAX) {
      throw new TypeError(`observationKey: must be a string of at most ${OBSERVATION_MAX} characters`);
    }
    return value;
  }

  function normalizeActions(value) {
    if (value === undefined || value === null) return Object.freeze([]);
    if (!Array.isArray(value) || value.length > 2) throw new TypeError('panel actions: must be an array of at most two actions');
    const seen = new Set();
    return Object.freeze(value.map((action, index) => {
      if (!action || typeof action !== 'object' || Array.isArray(action)) {
        throw new TypeError(`panel actions[${index}]: must be an object`);
      }
      const id = String(action.id || '');
      if (!ACTION_IDS.has(id) || seen.has(id)) throw new TypeError(`panel actions[${index}].id: is invalid`);
      const label = String(action.label || '');
      if (!label || label.length > 96) throw new TypeError(`panel actions[${index}].label: is invalid`);
      seen.add(id);
      return Object.freeze({ id, label });
    }));
  }

  function createReversibleRenderer(options) {
    if (!Base || typeof Base.createReversibleRenderer !== 'function') {
      throw new Error('Halo reversible renderer is unavailable');
    }
    const settings = options || {};
    const document = settings.document || root.document;
    const onPanelAction = typeof settings.onPanelAction === 'function' ? settings.onPanelAction : null;
    const base = Base.createReversibleRenderer(settings);
    const observations = new WeakMap();
    let publicApi = null;

    function rememberObservations(rawRequest) {
      if (!rawRequest || !rawRequest.root || !Array.isArray(rawRequest.fragments) ||
          typeof rawRequest.root.querySelectorAll !== 'function') return;
      const expected = new Map();
      rawRequest.fragments.forEach((fragment, index) => {
        const key = observationKey(fragment && fragment.observationKey);
        expected.set(`${String(fragment && fragment.boundaryKey || `${fragment && fragment.nodeId}:${fragment && fragment.start}:${fragment && fragment.end}`)}\u0000${index}`, key);
      });
      for (const token of rawRequest.root.querySelectorAll('[data-halo-owned="token"]')) {
        if (!base.ownsToken(token, rawRequest.rootId)) continue;
        const identity = `${token.getAttribute('data-halo-boundary') || ''}\u0000${token.getAttribute('data-halo-index') || ''}`;
        if (!expected.has(identity)) continue;
        const key = expected.get(identity);
        if (key === null) observations.delete(token);
        else observations.set(token, key);
      }
    }

    function instrument(rawRequest) {
      const runtime = observationRuntime();
      if (!runtime || typeof runtime.instrumentRenderRequest !== 'function') return rawRequest;
      try { return runtime.instrumentRenderRequest(rawRequest) || rawRequest; } catch (_error) { return rawRequest; }
    }

    function apply(rawRequest) {
      const observedRequest = instrument(rawRequest);
      const result = base.apply(rawRequest);
      rememberObservations(observedRequest);
      return result;
    }

    function reconcile(rawRequest) {
      const observedRequest = instrument(rawRequest);
      const result = base.reconcile(rawRequest);
      rememberObservations(observedRequest);
      return result;
    }

    function observationKeyForToken(token) {
      if (!token || !base.ownsToken(token)) return null;
      return observations.get(token) || null;
    }

    function activePanelHost() {
      if (!document || typeof document.querySelectorAll !== 'function') return null;
      for (const host of document.querySelectorAll('[data-halo-owned="panel"]')) {
        if (base.ownsPanel(host)) return host;
      }
      return null;
    }

    function invokeAction(callback, action) {
      if (typeof callback !== 'function') return;
      try {
        const result = callback(Object.freeze(action));
        if (result && typeof result.then === 'function') result.catch(() => {});
      } catch (_error) {
        // Dogfood observation must never break the v0.4 interaction surface.
      }
    }

    function emitPanelAction(action) {
      invokeAction(onPanelAction, action);
      const runtime = observationRuntime();
      if (runtime && typeof runtime.handlePanelAction === 'function') invokeAction(runtime.handlePanelAction.bind(runtime), action);
    }

    function decoratePanel(model, actions) {
      if (!actions.length) return;
      const host = activePanelHost();
      const shadow = host && host.shadowRoot;
      const panel = shadow && shadow.querySelector('.halo-core-panel');
      if (!panel) return;
      const key = observationKey(model.observationKey);

      const style = document.createElement('style');
      style.textContent = `
        .halo-dogfood-actions { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .75rem; }
        .halo-dogfood-action, .halo-dogfood-note-editor button { font: inherit; padding: .35rem .55rem; border: 1px solid #64748b; border-radius: .45rem; background: #fff; color: inherit; cursor: pointer; }
        .halo-dogfood-note-editor { margin-top: .55rem; }
        .halo-dogfood-note-input { box-sizing: border-box; width: 100%; min-height: 5rem; padding: .45rem; font: inherit; color: inherit; background: #fff; border: 1px solid #94a3b8; border-radius: .45rem; resize: vertical; }
        .halo-dogfood-note-controls { display: flex; gap: .4rem; margin-top: .35rem; }
        @media (forced-colors: active) { .halo-dogfood-action, .halo-dogfood-note-editor button, .halo-dogfood-note-input { border-color: CanvasText; } }
      `;
      shadow.appendChild(style);

      const actionsRow = document.createElement('div');
      actionsRow.className = 'halo-dogfood-actions';
      const editor = document.createElement('div');
      editor.className = 'halo-dogfood-note-editor';
      editor.hidden = true;
      const textarea = document.createElement('textarea');
      textarea.className = 'halo-dogfood-note-input';
      textarea.maxLength = NOTE_MAX;
      textarea.setAttribute('aria-label', 'Dogfood note');
      textarea.setAttribute('placeholder', 'What felt helpful, noisy, confusing, or missing?');
      const controls = document.createElement('div');
      controls.className = 'halo-dogfood-note-controls';
      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = 'Save note';
      save.setAttribute('data-halo-note-save', '');
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.setAttribute('data-halo-note-cancel', '');
      controls.append(save, cancel);
      editor.append(textarea, controls);

      for (const action of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'halo-dogfood-action';
        button.textContent = action.label;
        button.setAttribute('data-halo-action', action.id);
        button.addEventListener('click', () => {
          if (action.id === 'dogfood-note') {
            editor.hidden = false;
            try { textarea.focus({ preventScroll: true }); } catch (_error) { try { textarea.focus(); } catch (_ignored) {} }
            return;
          }
          emitPanelAction({ id: action.id, value: null, observationKey: key });
        });
        actionsRow.appendChild(button);
      }

      save.addEventListener('click', () => {
        const value = String(textarea.value || '').trim();
        if (!value || value.length > NOTE_MAX) return;
        emitPanelAction({ id: 'dogfood-note', value, observationKey: key });
        textarea.value = '';
        editor.hidden = true;
      });
      cancel.addEventListener('click', () => {
        textarea.value = '';
        editor.hidden = true;
      });
      panel.append(actionsRow, editor);
    }

    function openPanel(rawModel) {
      if (!rawModel || typeof rawModel !== 'object' || Array.isArray(rawModel)) return base.openPanel(rawModel);
      let model = rawModel;
      const runtime = observationRuntime();
      if (runtime && typeof runtime.preparePanelModel === 'function') {
        try { model = runtime.preparePanelModel(rawModel) || rawModel; } catch (_error) { model = rawModel; }
      }
      const actions = normalizeActions(model.actions);
      const result = base.openPanel(model);
      decoratePanel(model, actions);
      return result;
    }

    function removeAll(reason) {
      const result = base.removeAll(reason);
      const runtime = observationRuntime();
      if (runtime && typeof runtime.clearAll === 'function') {
        try { runtime.clearAll(); } catch (_error) {}
      }
      return result;
    }

    publicApi = Object.freeze({
      apply,
      reconcile,
      removeRoot: base.removeRoot,
      removeAll,
      openPanel,
      closePanel: base.closePanel,
      status: base.status,
      ownsToken: base.ownsToken,
      ownsPanel: base.ownsPanel,
      observationKeyForToken
    });
    const runtime = observationRuntime();
    if (runtime && typeof runtime.setActiveRenderer === 'function') {
      try { runtime.setActiveRenderer(publicApi); } catch (_error) {}
    }
    return publicApi;
  }

  return Object.freeze({ ...Base, createReversibleRenderer });
});
