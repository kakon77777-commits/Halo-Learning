(function (root, factory) {
  const contractsModule = typeof module === 'object' && module.exports
    ? require('./dogfood-contracts')
    : root.HaloDogfoodContracts;
  const sourceModule = typeof module === 'object' && module.exports
    ? require('./dogfood-source')
    : root.HaloDogfoodSource;
  const api = factory(contractsModule, sourceModule);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDogfoodProjector = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Contracts, Source) {
  'use strict';

  const PROJECTOR_VERSION = 'dogfood-projector-v1';

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }

  function sortedEvents(events) {
    if (!Array.isArray(events)) throw new TypeError('events: array required');
    return events.map((value) => Contracts.normalizeLearningEvent(value)).sort((left, right) =>
      left.timestamp.localeCompare(right.timestamp) || left.eventId.localeCompare(right.eventId)
    );
  }

  function attachmentMaps(attachments) {
    const raw = attachments && typeof attachments === 'object' ? attachments : {};
    const sources = Array.isArray(raw.sources) ? raw.sources.map((value) => Contracts.normalizeSourceRef(value)) : [];
    const sentences = Array.isArray(raw.sentences) ? raw.sentences.map((value) => Contracts.normalizeSentenceRecord(value)) : [];
    return {
      sources,
      sentences,
      sourceById: new Map(sources.map((value) => [value.sourceId, value])),
      sentenceById: new Map(sentences.map((value) => [value.sentenceId, value]))
    };
  }

  function foldSaved(events, sentenceById) {
    const saved = new Map();
    for (const event of events) {
      if (!event.sentenceRef) continue;
      if (event.eventType === 'sentence_saved') saved.set(event.sentenceRef, event);
      if (event.eventType === 'sentence_unsaved') saved.delete(event.sentenceRef);
    }
    return Object.freeze([...saved.keys()].sort().map((sentenceId) => {
      const sentence = sentenceById.get(sentenceId) || null;
      const savedEvent = saved.get(sentenceId);
      return deepFreeze({
        sentenceId,
        text: sentence ? sentence.text : null,
        language: sentence ? sentence.language : savedEvent.language,
        sourceRef: sentence ? sentence.sourceRef : savedEvent.sourceRef,
        savedAt: savedEvent.timestamp
      });
    }));
  }

  function foldNotes(events) {
    const roots = new Map();
    const eventToRoot = new Map();
    for (const event of events) {
      if (event.eventType === 'dogfood_note_created') {
        const rootEventId = event.eventId;
        roots.set(rootEventId, {
          rootEventId,
          latestEventId: event.eventId,
          text: event.detail.noteText,
          sourceRef: event.sourceRef,
          sentenceRef: event.sentenceRef,
          createdAt: event.timestamp,
          updatedAt: event.timestamp,
          removed: false
        });
        eventToRoot.set(event.eventId, rootEventId);
        continue;
      }
      if (event.eventType !== 'dogfood_note_revised' && event.eventType !== 'dogfood_note_removed') continue;
      const referred = event.refersToEventId;
      const rootEventId = eventToRoot.get(referred) || referred;
      const note = roots.get(rootEventId);
      if (!note) continue;
      eventToRoot.set(event.eventId, rootEventId);
      note.latestEventId = event.eventId;
      note.updatedAt = event.timestamp;
      if (event.eventType === 'dogfood_note_revised') note.text = event.detail.noteText;
      else note.removed = true;
    }
    return Object.freeze([...roots.values()]
      .filter((value) => !value.removed)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.rootEventId.localeCompare(right.rootEventId))
      .map((value) => deepFreeze({
        rootEventId: value.rootEventId,
        latestEventId: value.latestEventId,
        text: value.text,
        sourceRef: value.sourceRef,
        sentenceRef: value.sentenceRef,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt
      })));
  }

  function project(eventsValue, attachmentsValue) {
    const events = sortedEvents(eventsValue);
    const attachments = attachmentMaps(attachmentsValue);
    const sourceById = attachments.sourceById;
    const savedSentences = foldSaved(events, attachments.sentenceById);
    const notes = foldNotes(events);

    const siteMap = new Map();
    const sessionMap = new Map();
    const languageCounts = {};
    const activeDays = new Set();
    for (const event of events) {
      const source = sourceById.get(event.sourceRef);
      const domain = source ? source.domain : 'unknown';
      if (!siteMap.has(domain)) siteMap.set(domain, { domain, eventCount: 0, explicitLearningSignals: 0, languages: new Set() });
      const site = siteMap.get(domain);
      site.eventCount += 1;
      if (event.interactionClass === 'explicit-learning') site.explicitLearningSignals += 1;
      site.languages.add(event.language);
      if (!sessionMap.has(event.sessionId)) sessionMap.set(event.sessionId, { sessionId: event.sessionId, eventCount: 0, firstAt: event.timestamp, lastAt: event.timestamp, sourceRefs: new Set() });
      const session = sessionMap.get(event.sessionId);
      session.eventCount += 1;
      if (event.timestamp < session.firstAt) session.firstAt = event.timestamp;
      if (event.timestamp > session.lastAt) session.lastAt = event.timestamp;
      session.sourceRefs.add(event.sourceRef);
      languageCounts[event.language] = (languageCounts[event.language] || 0) + 1;
      activeDays.add(event.timestamp.slice(0, 10));
    }

    const sites = Object.freeze([...siteMap.values()].sort((a, b) => a.domain.localeCompare(b.domain)).map((value) => deepFreeze({
      domain: value.domain,
      eventCount: value.eventCount,
      explicitLearningSignals: value.explicitLearningSignals,
      languages: [...value.languages].sort()
    })));
    const sessions = Object.freeze([...sessionMap.values()].sort((a, b) => a.firstAt.localeCompare(b.firstAt) || a.sessionId.localeCompare(b.sessionId)).map((value) => deepFreeze({
      sessionId: value.sessionId,
      eventCount: value.eventCount,
      firstAt: value.firstAt,
      lastAt: value.lastAt,
      sourceRefs: [...value.sourceRefs].sort()
    })));
    const activity = Object.freeze(events.slice().reverse().map((event) => {
      const source = sourceById.get(event.sourceRef);
      return deepFreeze({
        eventId: event.eventId,
        timestamp: event.timestamp,
        eventType: event.eventType,
        interactionClass: event.interactionClass,
        sourceRef: event.sourceRef,
        domain: source ? source.domain : null,
        sessionId: event.sessionId,
        language: event.language,
        sentenceRef: event.sentenceRef,
        noteText: event.detail.noteText
      });
    }));
    const overview = deepFreeze({
      activeDays: activeDays.size,
      siteCount: sites.length,
      eventCount: events.length,
      explicitLearningSignals: events.filter((value) => value.interactionClass === 'explicit-learning').length,
      savedSentenceCount: savedSentences.length,
      noteCount: notes.length,
      languageCounts,
      oldestEventAt: events.length ? events[0].timestamp : null,
      newestEventAt: events.length ? events[events.length - 1].timestamp : null
    });

    return deepFreeze({ overview, activity, sites, sessions, savedSentences, notes });
  }

  async function createReplayReport(options) {
    const settings = options || {};
    const events = sortedEvents(settings.events || []);
    const projection = settings.projection;
    if (!projection || typeof projection !== 'object') throw new TypeError('projection: required');
    if (!Source || typeof Source.sha256Text !== 'function') throw new Error('dogfood hash helper unavailable');
    const skipped = Array.isArray(settings.skipped) ? settings.skipped : [];
    const report = {
      schema: 'ReplayReport/v1',
      sourceEventCount: events.length,
      eventRange: {
        from: events.length ? events[0].timestamp : null,
        to: events.length ? events[events.length - 1].timestamp : null
      },
      projectorVersion: PROJECTOR_VERSION,
      projectionHash: await Source.sha256Text(JSON.stringify(projection), settings.cryptoApi),
      skippedEventIds: [...skipped],
      success: skipped.length === 0
    };
    return Contracts.normalizeReplayReport(report);
  }

  return Object.freeze({ PROJECTOR_VERSION, project, createReplayReport });
});
