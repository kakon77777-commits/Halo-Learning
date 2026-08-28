(function (root, factory) {
  const sourceModule = typeof module === 'object' && module.exports
    ? require('./dogfood-source')
    : root.HaloDogfoodSource;
  const captureModule = typeof module === 'object' && module.exports
    ? require('./dogfood-capture')
    : root.HaloDogfoodCapture;
  const api = factory(root, sourceModule, captureModule);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDogfoodContent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Source, Capture) {
  'use strict';

  const MESSAGE_TYPE = 'HALO_DOGFOOD_CAPTURE';

  function createDogfoodContentClient(options) {
    const settings = options || {};
    const sendMessage = typeof settings.sendMessage === 'function'
      ? settings.sendMessage
      : root.chrome && root.chrome.runtime && typeof root.chrome.runtime.sendMessage === 'function'
        ? root.chrome.runtime.sendMessage.bind(root.chrome.runtime)
        : null;
    const cryptoApi = settings.cryptoApi || root.crypto;
    const onError = typeof settings.onError === 'function' ? settings.onError : () => {};
    if (!Source || typeof Source.createSourceRef !== 'function') throw new Error('dogfood source helpers unavailable');
    if (!Capture || typeof Capture.createCaptureRuntime !== 'function' || typeof Capture.diffProfileEvents !== 'function') {
      throw new Error('dogfood capture helpers unavailable');
    }
    if (typeof sendMessage !== 'function') throw new TypeError('sendMessage: required');

    const captureRuntime = Capture.createCaptureRuntime({
      cryptoApi,
      randomUUID: settings.randomUUID,
      now: settings.now
    });
    let page = null;

    function reportUnavailable() {
      try { onError('DOGFOOD_CAPTURE_UNAVAILABLE'); } catch (_ignored) {}
      return null;
    }

    async function sourceFor(input, retainFullUrl) {
      const value = input || {};
      const sourceUrl = value.sourceUrl || (page && page.url);
      if (!sourceUrl) throw new Error('dogfood page session has not started');
      return Source.createSourceRef({
        url: sourceUrl,
        language: value.language || (page && page.language) || 'und',
        retainFullUrl: retainFullUrl === true,
        cryptoApi
      });
    }

    async function startPageSession(input) {
      const value = input || {};
      if (!value.policyDecision || value.policyDecision.allow !== true) {
        page = null;
        return null;
      }
      const source = await Source.createSourceRef({
        url: value.url,
        language: value.language || 'und',
        retainFullUrl: false,
        cryptoApi
      });
      const session = captureRuntime.startSession({ sourceRef: source.sourceId });
      page = Object.freeze({
        url: value.url,
        language: value.language || 'und',
        sourceId: source.sourceId,
        sessionId: session.sessionId
      });
      return Object.freeze({ source, session });
    }

    async function emit(eventType, input, options) {
      const value = input || {};
      if (!value.policyDecision || value.policyDecision.allow !== true || !page) return null;
      try {
        const source = await sourceFor(value, options && options.retainFullUrl);
        if (source.sourceId !== page.sourceId) throw new Error('dogfood capture source changed without a new page session');
        const prepared = await captureRuntime.prepare({
          policyDecision: value.policyDecision,
          sourceRef: source.sourceId,
          eventType,
          sentenceText: value.sentenceText === undefined ? null : value.sentenceText,
          language: value.language || page.language || 'und',
          profile: value.profile === undefined ? null : value.profile,
          algorithmVersion: value.algorithmVersion === undefined ? null : value.algorithmVersion,
          noteText: value.noteText,
          refersToEventId: value.refersToEventId
        });
        if (!prepared) return null;
        const message = Object.freeze({
          type: MESSAGE_TYPE,
          envelope: Object.freeze({
            source,
            event: prepared.event,
            sentenceRecord: prepared.sentenceRecord
          })
        });
        const response = await sendMessage(message);
        if (!response || response.accepted !== true) return reportUnavailable();
        return response.result === undefined ? response : response.result;
      } catch (_error) {
        return reportUnavailable();
      }
    }

    const recordApply = (input) => emit('halo_applied', input);
    const recordRemove = (input) => emit('halo_removed', input);
    const recordExposure = (input) => emit('sentence_exposed', input);
    const recordExplicitOpen = (input) => emit(input && input.hasGloss === true ? 'gloss_opened' : 'explanation_opened', input);
    const saveSentence = (input) => emit('sentence_saved', input, { retainFullUrl: true });
    const createNote = (input) => emit('dogfood_note_created', input, { retainFullUrl: true });

    async function recordProfileDiff(input) {
      const value = input || {};
      if (!value.policyDecision || value.policyDecision.allow !== true || !page) return Object.freeze([]);
      let eventTypes;
      try {
        eventTypes = Capture.diffProfileEvents(value.previous, value.next);
      } catch (_error) {
        reportUnavailable();
        return Object.freeze([]);
      }
      const results = [];
      for (const eventType of eventTypes) {
        results.push(await emit(eventType, { ...value, profile: value.next }));
      }
      return Object.freeze(results);
    }

    function routeChanged(input) {
      const value = input || {};
      return startPageSession({
        url: value.url,
        language: value.language || (page && page.language) || 'und',
        policyDecision: value.policyDecision
      });
    }

    return Object.freeze({
      startPageSession,
      recordApply,
      recordRemove,
      recordExposure,
      recordExplicitOpen,
      saveSentence,
      createNote,
      recordProfileDiff,
      routeChanged,
      currentPage: () => page,
      currentSession: () => captureRuntime.currentSession()
    });
  }

  return Object.freeze({ MESSAGE_TYPE, createDogfoodContentClient });
});
