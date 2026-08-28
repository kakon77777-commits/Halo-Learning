(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDogfoodRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const PANEL_ACTIONS = Object.freeze([
    Object.freeze({ id: 'save-sentence', label: 'Save sentence · 儲存句子' }),
    Object.freeze({ id: 'dogfood-note', label: 'Dogfood note · 體驗註記' })
  ]);

  function enabledChannelNames(channels) {
    if (!channels || typeof channels !== 'object') return Object.freeze([]);
    return Object.freeze(Object.keys(channels).filter((name) => channels[name] === true).sort());
  }

  function recordEnd(record) {
    const explicit = Number(record && record.end);
    if (Number.isFinite(explicit)) return explicit;
    const start = Number(record && record.start);
    return Number.isFinite(start) ? start + String(record && record.text || '').length : NaN;
  }

  function fragmentBounds(fragment) {
    const boundary = fragment && typeof fragment.boundaryKey === 'string'
      ? fragment.boundaryKey.match(/^(\d+):(\d+):/)
      : null;
    if (boundary) return [Number(boundary[1]), Number(boundary[2])];
    const start = Number(fragment && fragment.start);
    const end = Number(fragment && fragment.end);
    return [start, end];
  }

  function snapshotProfile(profile) {
    if (!profile || typeof profile !== 'object') return null;
    return Object.freeze({
      profileId: profile.profileId,
      profileRevision: profile.profileRevision,
      density: profile.density,
      triggerMode: profile.triggerMode,
      channels: Object.freeze({ ...(profile.channels || {}) })
    });
  }

  function createDogfoodObservationRuntime(options) {
    const settings = options || {};
    const client = settings.client;
    const windowLike = settings.windowLike || root;
    const Policy = settings.sitePolicyModule;
    const maxContexts = Number.isSafeInteger(settings.maxContexts) && settings.maxContexts > 0
      ? Math.min(settings.maxContexts, 4096)
      : 512;
    if (!client || typeof client !== 'object') throw new TypeError('client: required');
    if (!Policy || typeof Policy.classifySite !== 'function') throw new TypeError('sitePolicyModule.classifySite: required');

    const recordsByRoot = new WeakMap();
    const planMetaByItem = new WeakMap();
    const observationByRoot = new WeakMap();
    const contexts = new Map();
    const exposed = new Set();
    const pending = new Set();
    let currentProfile = null;
    let currentPolicy = null;
    let activeRenderer = null;
    let explicitToken = null;
    let sequence = 0;

    function fire(value) {
      let promise;
      try { promise = Promise.resolve(value); } catch (_error) { return; }
      pending.add(promise);
      promise.catch(() => null).finally(() => pending.delete(promise));
    }

    async function flush() {
      while (pending.size) await Promise.allSettled([...pending]);
    }

    function policyFor(profile) {
      if (!profile || !windowLike || !windowLike.location) return null;
      try {
        const decision = Policy.classifySite({
          url: String(windowLike.location.href || ''),
          userDenylist: profile.sitePolicy && profile.sitePolicy.userDenylist,
          document: windowLike.document
        });
        return decision && decision.allow === true ? decision : null;
      } catch (_error) {
        return null;
      }
    }

    function captureInput(context, additions) {
      return {
        sentenceText: context && context.sentenceText,
        language: context && context.language,
        sourceUrl: context && context.sourceUrl,
        policyDecision: currentPolicy,
        profile: context && context.profile,
        algorithmVersion: context && context.algorithmVersion,
        ...(additions || {})
      };
    }

    async function applyAllowedProfile(profile) {
      const decision = policyFor(profile);
      currentProfile = profile || null;
      currentPolicy = decision;
      if (!decision) return null;
      try {
        await client.startPageSession({
          url: String(windowLike.location.href || ''),
          language: profile.languageMode || 'und',
          policyDecision: decision
        });
        await client.recordApply({
          language: profile.languageMode || 'und',
          sourceUrl: String(windowLike.location.href || ''),
          policyDecision: decision,
          profile,
          algorithmVersion: null
        });
        return decision;
      } catch (_error) {
        return decision;
      }
    }

    function rememberSentenceRecords(contentRoot, records) {
      if (!contentRoot || (typeof contentRoot !== 'object' && typeof contentRoot !== 'function')) return;
      recordsByRoot.set(contentRoot, Array.isArray(records) ? records.slice() : []);
    }

    function rememberPlan(plan, profile, algorithmVersion) {
      if (!Array.isArray(plan)) return;
      const value = Object.freeze({ profile, algorithmVersion: algorithmVersion || null });
      for (const item of plan) {
        if (item && (typeof item === 'object' || typeof item === 'function')) planMetaByItem.set(item, value);
      }
    }

    function recordForFragment(contentRoot, fragment) {
      const records = recordsByRoot.get(contentRoot) || [];
      const [start, end] = fragmentBounds(fragment);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      return records.find((record) => {
        const recordStart = Number(record && record.start);
        const endValue = recordEnd(record);
        return Number.isFinite(recordStart) && Number.isFinite(endValue) && start >= recordStart && end <= endValue;
      }) || null;
    }

    function observationKeyFor(contentRoot, request, record) {
      let bySignature = observationByRoot.get(contentRoot);
      if (!bySignature) {
        bySignature = new Map();
        observationByRoot.set(contentRoot, bySignature);
      }
      const signature = `${String(request.rootId || '')}|${String(request.rootRevision || '')}|${String(record.start)}|${String(recordEnd(record))}|${String(record.text || '')}`;
      if (!bySignature.has(signature)) bySignature.set(signature, `obs:${++sequence}`);
      return bySignature.get(signature);
    }

    function trimContexts() {
      while (contexts.size > maxContexts) {
        const oldest = contexts.keys().next().value;
        contexts.delete(oldest);
        exposed.delete(oldest);
      }
    }

    function contextFor(contentRoot, request, record, planMeta) {
      const profile = planMeta && planMeta.profile || currentProfile || {};
      return Object.freeze({
        root: contentRoot,
        sentenceText: String(record.text || ''),
        language: record.language || record.lang || 'und',
        sourceUrl: String(windowLike.location && windowLike.location.href || ''),
        profileId: profile.profileId || null,
        profileRevision: Number.isSafeInteger(profile.profileRevision) ? profile.profileRevision : null,
        activeChannels: enabledChannelNames(profile.channels),
        density: Number.isFinite(Number(profile.density)) ? Number(profile.density) : null,
        triggerMode: profile.triggerMode || null,
        algorithmVersion: planMeta && planMeta.algorithmVersion || null,
        profile: snapshotProfile(profile),
        rootId: request.rootId || null,
        rootRevision: request.rootRevision === undefined ? null : request.rootRevision
      });
    }

    function instrumentRenderRequest(request) {
      if (!request || typeof request !== 'object' || !Array.isArray(request.fragments) || !currentPolicy) return request;
      const rootNode = request.root;
      let changed = false;
      const seenObservations = new Set();
      const fragments = request.fragments.map((fragment) => {
        const record = recordForFragment(rootNode, fragment);
        const planMeta = fragment && fragment.renderPlan ? planMetaByItem.get(fragment.renderPlan) : null;
        if (!record || !planMeta) return fragment;
        const key = observationKeyFor(rootNode, request, record);
        const context = contexts.get(key) || contextFor(rootNode, request, record, planMeta);
        if (!contexts.has(key)) {
          contexts.set(key, context);
          trimContexts();
        }
        if (!exposed.has(key) && !seenObservations.has(key)) {
          exposed.add(key);
          seenObservations.add(key);
          fire(client.recordExposure(captureInput(context)));
        }
        changed = true;
        return Object.freeze({ ...fragment, observationKey: key });
      });
      return changed ? Object.freeze({ ...request, fragments: Object.freeze(fragments) }) : request;
    }

    function contextForObservation(key) {
      return typeof key === 'string' ? contexts.get(key) || null : null;
    }

    function setActiveRenderer(renderer) {
      activeRenderer = renderer || null;
    }

    function noteExplicitToken(token) {
      explicitToken = token || null;
    }

    function preparePanelModel(model) {
      const token = explicitToken;
      explicitToken = null;
      if (!token || !activeRenderer || typeof activeRenderer.observationKeyForToken !== 'function') return model;
      let key = null;
      try { key = activeRenderer.observationKeyForToken(token); } catch (_error) { key = null; }
      const context = contextForObservation(key);
      if (!context || !currentPolicy) return model;
      let tokenGloss = null;
      try { tokenGloss = typeof token.getAttribute === 'function' ? token.getAttribute('data-halo-gloss') : null; } catch (_error) {}
      const hasGloss = Boolean(tokenGloss && String(tokenGloss).trim()) || /\bgloss\b/i.test(String(model && model.body || ''));
      fire(client.recordExplicitOpen(captureInput(context, { hasGloss })));
      return Object.freeze({ ...(model || {}), observationKey: key, actions: PANEL_ACTIONS });
    }

    function handlePanelAction(action) {
      if (!action || typeof action !== 'object' || !currentPolicy) return null;
      const context = contextForObservation(action.observationKey);
      if (!context) return null;
      if (action.id === 'save-sentence') {
        fire(client.saveSentence(captureInput(context)));
        return true;
      }
      if (action.id === 'dogfood-note' && typeof action.value === 'string' && action.value.trim()) {
        fire(client.createNote(captureInput(context, { noteText: action.value.trim() })));
        return true;
      }
      return null;
    }

    function clearRoots(roots) {
      const set = new Set(Array.isArray(roots) ? roots : []);
      for (const value of set) {
        if (value && (typeof value === 'object' || typeof value === 'function')) {
          recordsByRoot.delete(value);
          observationByRoot.delete(value);
        }
      }
      for (const [key, context] of contexts) {
        if (set.has(context.root)) {
          contexts.delete(key);
          exposed.delete(key);
        }
      }
      if (explicitToken && set.size) explicitToken = null;
    }

    function clearAll() {
      contexts.clear();
      exposed.clear();
      explicitToken = null;
    }

    async function routeCleanup() {
      clearAll();
      return null;
    }

    async function routeChanged() {
      clearAll();
      if (!currentProfile) {
        currentPolicy = null;
        return null;
      }
      currentPolicy = policyFor(currentProfile);
      if (!currentPolicy) return null;
      try {
        return await client.routeChanged({
          url: String(windowLike.location && windowLike.location.href || ''),
          language: currentProfile.languageMode || 'und',
          policyDecision: currentPolicy
        });
      } catch (_error) {
        return null;
      }
    }

    function recordUserRemove() {
      if (currentPolicy && currentProfile) {
        fire(client.recordRemove({
          language: currentProfile.languageMode || 'und',
          sourceUrl: String(windowLike.location && windowLike.location.href || ''),
          policyDecision: currentPolicy,
          profile: currentProfile,
          algorithmVersion: null
        }));
      }
      clearAll();
    }

    function recordProfileDiff(previous, next) {
      if (!currentPolicy) return null;
      currentProfile = next || currentProfile;
      fire(client.recordProfileDiff({
        previous,
        next,
        policyDecision: currentPolicy,
        language: currentProfile && currentProfile.languageMode || 'und',
        sourceUrl: String(windowLike.location && windowLike.location.href || '')
      }));
      return true;
    }

    return Object.freeze({
      applyAllowedProfile,
      rememberSentenceRecords,
      rememberPlan,
      instrumentRenderRequest,
      contextForObservation,
      setActiveRenderer,
      noteExplicitToken,
      preparePanelModel,
      handlePanelAction,
      clearRoots,
      clearAll,
      routeCleanup,
      routeChanged,
      recordUserRemove,
      recordProfileDiff,
      flush,
      currentPolicy: () => currentPolicy,
      currentProfile: () => currentProfile
    });
  }

  return Object.freeze({ PANEL_ACTIONS, enabledChannelNames, createDogfoodObservationRuntime });
});
