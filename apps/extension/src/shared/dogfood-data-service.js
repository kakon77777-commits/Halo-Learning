(function (root, factory) {
  const contractsModule = typeof module === 'object' && module.exports ? require('./dogfood-contracts') : root.HaloDogfoodContracts;
  const sourceModule = typeof module === 'object' && module.exports ? require('./dogfood-source') : root.HaloDogfoodSource;
  const projectorModule = typeof module === 'object' && module.exports ? require('./dogfood-projector') : root.HaloDogfoodProjector;
  const api = factory(root, contractsModule, sourceModule, projectorModule);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDogfoodDataService = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, DefaultContracts, DefaultSource, DefaultProjector) {
  'use strict';

  const DEFAULT_RETENTION = Object.freeze({ passiveDays: 30, ordinaryDays: 90, explicitDays: null, dogfoodNoteDays: null });
  const LOCAL_SESSION_ID = 'session:local-control';
  const SESSION_POLICY_VERSION = 'top-level-page-v1';
  const CAPTURE_POLICY_VERSION = 'dogfood-capture-v1';

  function errorCode(error) {
    if (error && error.name === 'QuotaExceededError') return 'QUOTA_EXCEEDED';
    if (error && (error.name === 'VersionError' || /migration/i.test(String(error.message || '')))) return 'MIGRATION_FAILED';
    return 'INDEXEDDB_UNAVAILABLE';
  }

  function createDogfoodDataService(options) {
    const settings = options || {};
    const repository = settings.repository;
    const Contracts = settings.contracts || DefaultContracts;
    const Source = settings.sourceModule || DefaultSource;
    const Projector = settings.projector || DefaultProjector;
    const now = typeof settings.now === 'function' ? settings.now : () => Date.now();
    const randomUUID = typeof settings.randomUUID === 'function'
      ? settings.randomUUID
      : (settings.cryptoApi || root.crypto) && typeof (settings.cryptoApi || root.crypto).randomUUID === 'function'
        ? (settings.cryptoApi || root.crypto).randomUUID.bind(settings.cryptoApi || root.crypto)
        : null;
    const cryptoApi = settings.cryptoApi || root.crypto;
    const getCurrentProfile = typeof settings.getCurrentProfile === 'function' ? settings.getCurrentProfile : async () => null;
    if (!repository || typeof repository.appendEvent !== 'function' || typeof repository.getSetting !== 'function') throw new TypeError('repository: canonical dogfood repository required');
    if (!Contracts || typeof Contracts.normalizeLearningEvent !== 'function') throw new TypeError('contracts: canonical dogfood contracts required');
    if (!Source || typeof Source.createLocalControlSourceRef !== 'function') throw new TypeError('sourceModule: required');
    if (!Projector || typeof Projector.project !== 'function') throw new TypeError('projector: required');
    if (typeof randomUUID !== 'function') throw new TypeError('randomUUID: required');

    let mode = 'ready';
    let lastErrorCode = null;
    let captureEnabled = true;

    function status() {
      return Object.freeze({ schemaVersion: 1, mode, captureEnabled, lastErrorCode });
    }
    function markReady() { mode = 'ready'; lastErrorCode = null; }
    function markFailure(error) { mode = 'storage-degraded'; lastErrorCode = errorCode(error); }
    function timestamp() {
      const date = new Date(Number(now()));
      if (!Number.isFinite(date.getTime())) throw new TypeError('now: valid milliseconds required');
      return date.toISOString();
    }
    function newEventId() {
      const value = String(randomUUID());
      if (!value || value.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(value)) throw new TypeError('randomUUID: stable value required');
      return `event:${value}`;
    }
    async function preferences() {
      const value = await repository.getSetting('dogfood.preferences');
      if (value && typeof value.captureEnabled === 'boolean') captureEnabled = value.captureEnabled;
      return value || { key: 'dogfood.preferences', schemaVersion: 1, captureEnabled, retention: { ...DEFAULT_RETENTION } };
    }
    function profileSnapshot(profile) {
      if (!profile || typeof profile !== 'object') return null;
      return Object.freeze({
        profileKey: `${profile.profileId}@${profile.profileRevision}`,
        profileId: profile.profileId,
        profileRevision: profile.profileRevision,
        channels: profile.channels,
        density: profile.density,
        triggerMode: profile.triggerMode
      });
    }

    async function persistCapture(envelope) {
      try {
        await preferences();
        if (!captureEnabled) return Object.freeze({ status: 'capture-disabled' });
        const raw = envelope || {};
        const event = Contracts.normalizeLearningEvent(raw.event);
        const source = Contracts.normalizeSourceRef(raw.source);
        if (event.sourceRef !== source.sourceId) throw new TypeError('capture envelope source identity mismatch');
        let sentenceRecord = null;
        if (raw.sentenceRecord !== null && raw.sentenceRecord !== undefined) {
          sentenceRecord = Contracts.normalizeSentenceRecord(raw.sentenceRecord);
          if (sentenceRecord.sourceRef !== source.sourceId || event.sentenceRef !== sentenceRecord.sentenceId || event.sentenceHash !== sentenceRecord.textHash) {
            throw new TypeError('capture envelope sentence identity mismatch');
          }
        } else if (event.sentenceRef !== null) {
          throw new TypeError('capture envelope is missing its retained sentence');
        }
        await repository.putSource(source);
        if (sentenceRecord) await repository.putSentence(sentenceRecord);
        if (event.profileId && event.profileRevision !== null && typeof repository.putProfileSnapshot === 'function') {
          const current = await getCurrentProfile();
          if (current && current.profileId === event.profileId && current.profileRevision === event.profileRevision) {
            await repository.putProfileSnapshot(profileSnapshot(current));
          }
        }
        const result = await repository.appendEvent(event);
        markReady();
        return result;
      } catch (error) {
        markFailure(error);
        throw error;
      }
    }

    async function localControlEvent(eventType, noteText, refersToEventId) {
      const source = await Source.createLocalControlSourceRef({ cryptoApi });
      const event = Contracts.normalizeLearningEvent({
        schema: 'LearningEvent/v1', eventId: newEventId(), timestamp: timestamp(), eventType,
        sessionId: LOCAL_SESSION_ID, sessionPolicyVersion: SESSION_POLICY_VERSION,
        sourceRef: source.sourceId, language: 'und', sentenceRef: null, sentenceHash: null,
        interactionClass: eventType.startsWith('dogfood_note_') ? 'dogfood-note' : 'ordinary',
        capturePolicyVersion: CAPTURE_POLICY_VERSION, profileId: null, profileRevision: null,
        uiContext: null, algorithmVersion: null, refersToEventId: refersToEventId || null,
        detail: { noteText: noteText === undefined ? null : noteText }
      });
      return { source, event };
    }

    async function setCaptureEnabled(value) {
      if (typeof value !== 'boolean') throw new TypeError('capture enabled: boolean required');
      const current = await preferences();
      if (captureEnabled === value) return status();
      try {
        if (value === false) {
          const control = await localControlEvent('capture_paused', null, null);
          await repository.putSource(control.source);
          await repository.appendEvent(control.event);
          await repository.putSetting({ ...current, captureEnabled: false });
          captureEnabled = false;
        } else {
          await repository.putSetting({ ...current, captureEnabled: true });
          captureEnabled = true;
          const control = await localControlEvent('capture_resumed', null, null);
          await repository.putSource(control.source);
          await repository.appendEvent(control.event);
        }
        markReady();
        return status();
      } catch (error) {
        markFailure(error);
        throw error;
      }
    }

    async function createStandaloneNote(text) {
      const control = await localControlEvent('dogfood_note_created', String(text || '').trim(), null);
      await repository.putSource(control.source);
      await repository.appendEvent(control.event);
      return control.event;
    }
    async function reviseNote(eventId, text) {
      const prior = await repository.getEvent(eventId);
      if (!prior || !prior.eventType.startsWith('dogfood_note_')) throw new Error('dogfood note not found');
      const event = Contracts.normalizeLearningEvent({
        ...prior, eventId: newEventId(), timestamp: timestamp(), eventType: 'dogfood_note_revised',
        refersToEventId: prior.eventId, detail: { noteText: String(text || '').trim() }
      });
      await repository.appendEvent(event); return event;
    }
    async function removeNote(eventId) {
      const prior = await repository.getEvent(eventId);
      if (!prior || !prior.eventType.startsWith('dogfood_note_')) throw new Error('dogfood note not found');
      const event = Contracts.normalizeLearningEvent({
        ...prior, eventId: newEventId(), timestamp: timestamp(), eventType: 'dogfood_note_removed',
        refersToEventId: prior.eventId, detail: { noteText: null }
      });
      await repository.appendEvent(event); return event;
    }
    async function unsaveSentence(sentenceId) {
      const sentence = await repository.getSentence(sentenceId);
      if (!sentence) throw new Error('saved sentence not found');
      const event = Contracts.normalizeLearningEvent({
        schema: 'LearningEvent/v1', eventId: newEventId(), timestamp: timestamp(), eventType: 'sentence_unsaved',
        sessionId: LOCAL_SESSION_ID, sessionPolicyVersion: SESSION_POLICY_VERSION, sourceRef: sentence.sourceRef,
        language: sentence.language, sentenceRef: sentence.sentenceId, sentenceHash: sentence.textHash,
        interactionClass: 'ordinary', capturePolicyVersion: CAPTURE_POLICY_VERSION,
        profileId: sentence.profileId, profileRevision: sentence.profileRevision, uiContext: null,
        algorithmVersion: sentence.algorithmVersion, refersToEventId: null, detail: { noteText: null }
      });
      await repository.appendEvent(event); return event;
    }

    async function replay() {
      const dataset = await repository.readReplayDataset();
      const projection = Projector.project(dataset.events, dataset);
      const report = await Projector.createReplayReport({ events: dataset.events, projection, skipped: [], cryptoApi });
      return Object.freeze({ projection, report });
    }
    async function query(view, options) {
      if (view === 'events') return repository.queryEvents(options);
      if (view === 'sources') return repository.querySources(options);
      if (view === 'sentences') return repository.querySentences(options);
      const result = await replay();
      if (Object.prototype.hasOwnProperty.call(result.projection, view)) return result.projection[view];
      if (view === 'overview') return result.projection.overview;
      throw new TypeError('dogfood query view: unsupported');
    }

    return Object.freeze({
      status,
      persistCapture,
      query,
      createStandaloneNote,
      reviseNote,
      removeNote,
      unsaveSentence,
      setCaptureEnabled,
      exportBundle: () => repository.exportBundle(),
      exportEventsJsonl: () => repository.exportEventsJsonl(),
      deleteByScope: (scope) => repository.deleteByScope(scope),
      clearAnalysisCache: () => repository.clearAnalysisCache(),
      replay
    });
  }

  return Object.freeze({ createDogfoodDataService });
});
