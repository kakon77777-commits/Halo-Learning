const test = require('node:test');
const assert = require('node:assert/strict');

const Contracts = require('../packages/contracts/semantic-contracts');
const Settings = require('../apps/extension/src/shared/settings');

test('legacy v0.1/v0.2 settings migrate to MarkingProfile/v2 without losing existing choices', () => {
  const profile = Settings.migrateSettings({
    enabled: true,
    languageMode: 'zh',
    posLabels: false,
    posColors: true,
    density: 0.4,
    minConfidence: 0.7,
    labelPosition: 'bottom-right',
    maxTextNodes: 321,
    maxMarkedTokens: 654
  });

  assert.equal(profile.schemaVersion, 2);
  assert.equal(profile.languageMode, 'zh-Hant');
  assert.equal(profile.channels.posLabel, false);
  assert.equal(profile.channels.posColor, true);
  assert.equal(profile.channels.lemma, false);
  assert.equal(profile.channels.learningState, false);
  assert.equal(profile.density, 0.4);
  assert.equal(profile.labelPosition, 'bottom-right');
  assert.doesNotThrow(() => Contracts.normalizeMarkingProfile(profile));
});

test('MarkingProfile/v2 normalization is idempotent and all channels remain explicit', () => {
  const first = Settings.normalizeSettings({
    schemaVersion: 2,
    profileId: 'fixture-v2',
    channels: {
      posLabel: true,
      posColor: false,
      lemma: true,
      morphology: true,
      glossHint: true,
      grammarRole: true,
      tenseAspect: true,
      chunk: true,
      learningState: false
    }
  });
  const second = Settings.normalizeSettings(first);

  assert.deepEqual(second, first);
  assert.deepEqual(Object.keys(first.channels).sort(), [
    'chunk', 'glossHint', 'grammarRole', 'learningState', 'lemma',
    'morphology', 'posColor', 'posLabel', 'tenseAspect'
  ]);
});

test('learning-state remains explicitly unavailable and cannot be enabled in v0.3.0 settings', () => {
  const profile = Settings.normalizeSettings({ channels: { learningState: true } });
  assert.equal(profile.channels.learningState, false);
  assert.ok(Settings.UNAVAILABLE_CHANNELS.includes('learningState'));
});

test('popup UI edits preserve hidden profile controls and the existing profile identity', () => {
  const ProfileControls = require('../apps/extension/src/shared/profile-controls');
  const current = Settings.normalizeSettings({
    schemaVersion: 2,
    profileId: 'custom-study-profile',
    enabled: false,
    channels: { lemma: true, glossHint: true },
    density: 0.4,
    minConfidence: 0.82,
    languageMode: 'en',
    labelPosition: 'top-left',
    maxTextNodes: 777,
    maxMarkedTokens: 4321
  });

  const next = ProfileControls.mergeUiSettings(current, {
    channels: { ...current.channels, lemma: false, morphology: true },
    density: 0.75,
    languageMode: 'zh-Hant',
    labelPosition: 'bottom-right'
  }, Settings.normalizeSettings);

  assert.equal(next.profileId, 'custom-study-profile');
  assert.equal(next.enabled, false);
  assert.equal(next.minConfidence, 0.82);
  assert.equal(next.maxTextNodes, 777);
  assert.equal(next.maxMarkedTokens, 4321);
  assert.equal(next.channels.lemma, false);
  assert.equal(next.channels.morphology, true);
  assert.equal(next.density, 0.75);
  assert.equal(next.languageMode, 'zh-Hant');
  assert.equal(next.labelPosition, 'bottom-right');
});

test('runtime budgets migrate from legacy caps and normalize every bounded dimension', () => {
  const migrated = Settings.migrateSettings({
    maxTextNodes: 321,
    maxMarkedTokens: 654
  });
  assert.deepEqual(migrated.runtimeBudgets, {
    maxTextNodes: 24,
    maxCharacters: 12000,
    maxSentences: 24,
    maxSemanticTokens: 600,
    maxShardIds: 24,
    timeSliceMs: 8,
    maxQueuedRoots: 200,
    viewportBufferPx: 1200
  });

  const normalized = Settings.normalizeSettings({
    runtimeBudgets: {
      maxTextNodes: 7,
      maxCharacters: 4500,
      maxSentences: 8,
      maxSemanticTokens: 120,
      maxShardIds: 5,
      timeSliceMs: 4,
      maxQueuedRoots: 30,
      viewportBufferPx: 800
    }
  });
  assert.deepEqual(normalized.runtimeBudgets, {
    maxTextNodes: 7,
    maxCharacters: 4500,
    maxSentences: 8,
    maxSemanticTokens: 120,
    maxShardIds: 5,
    timeSliceMs: 4,
    maxQueuedRoots: 30,
    viewportBufferPx: 800
  });
  assert.equal(Object.isFrozen(normalized.runtimeBudgets), true);
  assert.deepEqual(Settings.normalizeSettings(normalized), normalized);
});
