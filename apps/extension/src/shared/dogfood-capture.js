(function (root, factory) {
  const contractsModule = typeof module === 'object' && module.exports
    ? require('./dogfood-contracts')
    : root.HaloDogfoodContracts;
  const sourceModule = typeof module === 'object' && module.exports
    ? require('./dogfood-source')
    : root.HaloDogfoodSource;
  const api = factory(contractsModule, sourceModule);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDogfoodCapture = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Contracts, Source) {
  'use strict';

  const CAPTURE_POLICY_VERSION = 'dogfood-capture-v1';
  const SESSION_POLICY_VERSION = 'top-level-page-v1';
  const EXPOSURE_POLICY_VERSION = 'exposure-v1';
  const EXPLICIT_TYPES = new Set(['gloss_opened', 'explanation_opened', 'sentence_saved']);
  const NOTE_TYPES = new Set(['dogfood_note_created', 'dogfood_note_revised', 'dogfood_note_removed']);

  function classifyEventType(eventType) {
    if (!Contracts || !Array.isArray(Contracts.EVENT_TYPES) || !Contracts.EVENT_TYPES.includes(eventType)) {
      throw new TypeError('eventType: canonical dogfood event required');
    }
    if (eventType === 'sentence_exposed') return 'passive';
    if (EXPLICIT_TYPES.has(eventType)) return 'explicit-learning';
    if (NOTE_TYPES.has(eventType)) return 'dogfood-note';
    return 'ordinary';
  }

  function channelsOf(profile) {
    const channels = profile && profile.channels;
    if (!channels || typeof channels !== 'object' || Array.isArray(channels)) return Object.freeze([]);
    return Object.freeze(Object.keys(channels).filter((name) => channels[name] === true));
  }

  function comparableChannels(profile) {
    return JSON.stringify(channelsOf(profile));
  }

  function diffProfileEvents(previous, next) {
    if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') {
      throw new TypeError('profiles: previous and next profile objects required');
    }
    const changes = [];
    if (Number(next.density) !== Number(previous.density)) changes.push('density_changed');
    if (comparableChannels(next) !== comparableChannels(previous)) changes.push('channels_changed');
    if (String(next.triggerMode) !== String(previous.triggerMode)) changes.push('trigger_mode_changed');
    if (!changes.length && next.profileRevision !== previous.profileRevision) changes.push('profile_changed');
    return Object.freeze(changes);
  }

  function timestampFrom(value) {
    const raw = value();
    const date = raw instanceof Date ? raw : new Date(raw);
    if (!Number.isFinite(date.getTime())) throw new TypeError('now: valid date/time required');
    return date.toISOString();
  }

  function requiredStableString(value, name) {
    if (typeof value !== 'string' || !value || value.length > 256 || !/^[A-Za-z0-9._:@-]+$/u.test(value)) {
      throw new TypeError(`${name}: stable local reference required`);
    }
    return value;
  }

  function normalizeProfile(profile) {
    if (profile === null || profile === undefined) return null;
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new TypeError('profile: object required');
    if (typeof profile.profileId !== 'string' || !profile.profileId || profile.profileId.length > 256) {
      throw new TypeError('profile.profileId: required');
    }
    if (!Number.isSafeInteger(profile.profileRevision) || profile.profileRevision < 0) {
      throw new TypeError('profile.profileRevision: non-negative safe integer required');
    }
    if (!Number.isFinite(profile.density) || profile.density < 0 || profile.density > 1) {
      throw new TypeError('profile.density: number between 0 and 1 required');
    }
    if (!['adaptive-hover', 'explicit-only', 'hybrid'].includes(profile.triggerMode)) {
      throw new TypeError('profile.triggerMode: canonical trigger mode required');
    }
    return profile;
  }

  function uiContextFor(profile) {
    if (!profile) return null;
    return Object.freeze({
      activeChannels: channelsOf(profile),
      density: profile.density,
      triggerMode: profile.triggerMode
    });
  }

  function createCaptureRuntime(options) {
    const settings = options || {};
    const cryptoApi = settings.cryptoApi;
    const now = typeof settings.now === 'function' ? settings.now : () => Date.now();
    const randomUUID = typeof settings.randomUUID === 'function'
      ? settings.randomUUID
      : (cryptoApi && typeof cryptoApi.randomUUID === 'function' ? cryptoApi.randomUUID.bind(cryptoApi) : null);
    if (!Source || typeof Source.createSentenceHash !== 'function' || typeof Source.sha256Text !== 'function') {
      throw new Error('Canonical dogfood source helpers are unavailable');
    }
    if (!Contracts || typeof Contracts.normalizeLearningEvent !== 'function' ||
        typeof Contracts.normalizeSentenceRecord !== 'function') {
      throw new Error('Canonical dogfood contracts are unavailable');
    }
    if (typeof randomUUID !== 'function') throw new TypeError('randomUUID: required');

    let current = null;

    function startSession(input) {
      const raw = input || {};
      const sourceRef = requiredStableString(raw.sourceRef, 'sourceRef');
      const sessionId = `session:${requiredStableString(String(randomUUID()), 'randomUUID')}`;
      current = Object.freeze({
        sessionId,
        sourceRef,
        sessionPolicyVersion: SESSION_POLICY_VERSION,
        startedAt: timestampFrom(now)
      });
      return current;
    }

    function currentSession() {
      return current;
    }

    async function deterministicExposureId(session, sourceRef, sentenceHash) {
      const digest = await Source.sha256Text(
        `${session.sessionId}\n${sourceRef}\n${sentenceHash}\n${EXPOSURE_POLICY_VERSION}`,
        cryptoApi
      );
      return `event:${digest.replace(/^sha256:/u, '')}`;
    }

    async function sentenceIdentity(sourceRef, sentenceHash) {
      const digest = await Source.sha256Text(`${sourceRef}\n${sentenceHash}`, cryptoApi);
      return `sentence:${digest.replace(/^sha256:/u, '')}`;
    }

    async function prepare(input) {
      const raw = input || {};
      if (!raw.policyDecision || raw.policyDecision.allow !== true) return null;
      if (!current) throw new Error('capture session has not started');
      const sourceRef = requiredStableString(raw.sourceRef, 'sourceRef');
      if (sourceRef !== current.sourceRef) throw new Error('capture source does not match current session');
      const eventType = raw.eventType;
      const interactionClass = classifyEventType(eventType);
      const profile = normalizeProfile(raw.profile);
      const timestamp = timestampFrom(now);
      const language = raw.language === undefined ? 'und' : raw.language;
      const sentenceText = raw.sentenceText === undefined || raw.sentenceText === null ? null : raw.sentenceText;
      if (sentenceText !== null && (typeof sentenceText !== 'string' || !sentenceText || sentenceText.length > 12000)) {
        throw new TypeError('sentenceText: non-empty string of at most 12000 characters required');
      }
      const sentenceHash = sentenceText === null ? null : await Source.createSentenceHash(sentenceText, cryptoApi);
      const retainSentence = sentenceText !== null && (
        interactionClass === 'explicit-learning' ||
        (interactionClass === 'dogfood-note' && eventType !== 'dogfood_note_removed')
      );
      const sentenceId = retainSentence ? await sentenceIdentity(sourceRef, sentenceHash) : null;
      const eventId = eventType === 'sentence_exposed'
        ? await deterministicExposureId(current, sourceRef, sentenceHash || 'sha256:none')
        : `event:${requiredStableString(String(randomUUID()), 'randomUUID')}`;
      const noteText = NOTE_TYPES.has(eventType)
        ? (eventType === 'dogfood_note_removed' ? null : raw.noteText)
        : null;

      const sentenceRecord = retainSentence ? Contracts.normalizeSentenceRecord({
        schema: 'SentenceRecord/v1',
        sentenceId,
        text: sentenceText,
        language,
        textHash: sentenceHash,
        sourceRef,
        captureReason: eventType,
        capturedAt: timestamp,
        algorithmVersion: raw.algorithmVersion === undefined ? null : raw.algorithmVersion,
        profileId: profile ? profile.profileId : null,
        profileRevision: profile ? profile.profileRevision : null
      }) : null;

      const event = Contracts.normalizeLearningEvent({
        schema: 'LearningEvent/v1',
        eventId,
        timestamp,
        eventType,
        sessionId: current.sessionId,
        sessionPolicyVersion: SESSION_POLICY_VERSION,
        sourceRef,
        language,
        sentenceRef: sentenceRecord ? sentenceRecord.sentenceId : null,
        sentenceHash,
        interactionClass,
        capturePolicyVersion: CAPTURE_POLICY_VERSION,
        profileId: profile ? profile.profileId : null,
        profileRevision: profile ? profile.profileRevision : null,
        uiContext: uiContextFor(profile),
        algorithmVersion: raw.algorithmVersion === undefined ? null : raw.algorithmVersion,
        refersToEventId: raw.refersToEventId === undefined ? null : raw.refersToEventId,
        detail: { noteText: noteText === undefined ? null : noteText }
      });

      return Object.freeze({ event, sentenceRecord });
    }

    return Object.freeze({ startSession, currentSession, prepare });
  }

  return Object.freeze({
    CAPTURE_POLICY_VERSION,
    SESSION_POLICY_VERSION,
    EXPOSURE_POLICY_VERSION,
    createCaptureRuntime,
    classifyEventType,
    diffProfileEvents
  });
});
