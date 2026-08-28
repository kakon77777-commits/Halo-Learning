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
  assert.equal(profile.triggerMode, 'hybrid');
  assert.doesNotThrow(() => Contracts.normalizeMarkingProfile(profile));
});

test('strict settings normalization accepts only canonical profiles', () => {
  assert.throws(() => Settings.normalizeSettings(undefined), /canonical|required/);
  assert.throws(() => Settings.normalizeSettings({ posLabels: false }), /canonical|required/);
  const canonical = Settings.migrateSettings({ posLabels: false });
  assert.deepEqual(Settings.normalizeSettings(canonical), canonical);
  assert.equal(Object.hasOwn(canonical, 'posLabels'), false);
});

test('trigger mode normalization accepts exactly the three canonical serialized values', () => {
  for (const triggerMode of ['adaptive-hover', 'explicit-only', 'hybrid']) {
    const profile = Settings.migrateSettings({ triggerMode });
    assert.equal(profile.triggerMode, triggerMode);
    assert.deepEqual(Settings.migrateSettings(JSON.parse(JSON.stringify(profile))), profile);
  }
  for (const triggerMode of ['', 'hover', 'explicit', 'HYBRID', null, 1]) {
    assert.equal(Settings.migrateSettings({ triggerMode }).triggerMode, 'hybrid');
  }
});

test('site policy migration defaults explicitly and canonical denylist is closed and frozen', () => {
  const defaults = Settings.migrateSettings({});
  assert.deepEqual(defaults.sitePolicy, { schemaVersion: 1, userDenylist: [] });
  assert.equal(Object.isFrozen(defaults.sitePolicy), true);
  assert.equal(Object.isFrozen(defaults.sitePolicy.userDenylist), true);

  const migrated = Settings.migrateSettings({
    sitePolicy: { schemaVersion: 1, userDenylist: ['Private.Example.', 'private.example', 'A.example'] }
  });
  assert.deepEqual(migrated.sitePolicy, {
    schemaVersion: 1,
    userDenylist: ['a.example', 'private.example']
  });
  assert.deepEqual(Settings.normalizeSettings(migrated), migrated);
});

test('invalid present site policy never migrates to a silently narrower default', () => {
  for (const sitePolicy of [
    null,
    {},
    { schemaVersion: 2, userDenylist: [] },
    { schemaVersion: 1, userDenylist: ['*.example'] },
    { schemaVersion: 1, userDenylist: [], extra: true }
  ]) assert.throws(() => Settings.migrateSettings({ sitePolicy }), /sitePolicy|denylist/i);
});

test('MarkingProfile/v2 normalization is idempotent and all channels remain explicit', () => {
  const first = Settings.migrateSettings({
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
  const second = Settings.migrateSettings(first);

  assert.deepEqual(second, first);
  assert.deepEqual(Object.keys(first.channels).sort(), [
    'chunk', 'glossHint', 'grammarRole', 'learningState', 'lemma',
    'morphology', 'posColor', 'posLabel', 'tenseAspect'
  ]);
});

test('learning-state remains explicitly unavailable and cannot be enabled in v0.3.0 settings', () => {
  const profile = Settings.migrateSettings({ channels: { learningState: true } });
  assert.equal(profile.channels.learningState, false);
  assert.ok(Settings.UNAVAILABLE_CHANNELS.includes('learningState'));
});

test('popup UI edits preserve hidden profile controls and the existing profile identity', () => {
  const ProfileControls = require('../apps/extension/src/shared/profile-controls');
  const current = Settings.migrateSettings({
    schemaVersion: 2,
    profileId: 'custom-study-profile',
    enabled: false,
    channels: { lemma: true, glossHint: true },
    density: 0.4,
    minConfidence: 0.82,
    languageMode: 'en',
    labelPosition: 'top-left',
    maxTextNodes: 777,
    maxMarkedTokens: 4321,
    triggerMode: 'adaptive-hover'
  });

  const next = ProfileControls.mergeUiSettings(current, {
    channels: { ...current.channels, lemma: false, morphology: true },
    density: 0.75,
    languageMode: 'zh-Hant',
    labelPosition: 'bottom-right',
    triggerMode: 'explicit-only'
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
  assert.equal(next.triggerMode, 'explicit-only');
});

test('trigger mode edits preserve compatibility fields and increment the locked profile revision once', () => {
  const ProfileControls = require('../apps/extension/src/shared/profile-controls');
  const current = Settings.migrateSettings({
    profileId: 'trigger-profile',
    profileRevision: 8,
    triggerMode: 'hybrid',
    maxTextNodes: 913,
    maxMarkedTokens: 7123,
    runtimeBudgets: { maxTextNodes: 9, maxCharacters: 3000 }
  });
  const next = ProfileControls.mergeUiSettings(current, {
    triggerMode: 'explicit-only'
  }, Settings.normalizeSettings);

  assert.equal(next.profileRevision, 9);
  assert.equal(next.triggerMode, 'explicit-only');
  assert.equal(next.maxTextNodes, 913);
  assert.equal(next.maxMarkedTokens, 7123);
  assert.deepEqual(next.runtimeBudgets, current.runtimeBudgets);
});

test('site denylist edits preserve the profile and increment the locked revision exactly once', () => {
  const ProfileControls = require('../apps/extension/src/shared/profile-controls');
  const current = Settings.migrateSettings({ profileId: 'private-profile', profileRevision: 4 });
  const next = ProfileControls.mergeUiSettings(current, {
    sitePolicy: { schemaVersion: 1, userDenylist: ['private.example'] }
  }, Settings.normalizeSettings);

  assert.equal(next.profileId, 'private-profile');
  assert.equal(next.profileRevision, 5);
  assert.deepEqual(next.sitePolicy, { schemaVersion: 1, userDenylist: ['private.example'] });
  assert.deepEqual(next.channels, current.channels);
  assert.deepEqual(next.runtimeBudgets, current.runtimeBudgets);
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

  const normalized = Settings.migrateSettings({
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
  assert.deepEqual(Settings.migrateSettings(normalized), normalized);
});

test('profile revision is monotonic across edits, stable across reload, and changes analysis keys', () => {
  const ProfileControls = require('../apps/extension/src/shared/profile-controls');
  const Progressive = require('../apps/extension/src/shared/progressive-runtime');
  const initial = Settings.migrateSettings({
    profileId: 'study-profile',
    profileRevision: 4,
    channels: { lemma: false },
    density: 0.5
  });
  const unchanged = ProfileControls.mergeUiSettings(initial, {
    channels: initial.channels,
    density: 0.5,
    languageMode: initial.languageMode,
    labelPosition: initial.labelPosition
  }, Settings.normalizeSettings);
  const edited = ProfileControls.mergeUiSettings(initial, {
    channels: { ...initial.channels, lemma: true },
    density: 0.75
  }, Settings.normalizeSettings);
  const reloaded = Settings.migrateSettings(JSON.parse(JSON.stringify(edited)));

  assert.equal(initial.profileId, 'study-profile');
  assert.equal(unchanged.profileRevision, 4);
  assert.equal(edited.profileId, 'study-profile');
  assert.equal(edited.profileRevision, 5);
  assert.equal(Contracts.normalizeMarkingProfile(edited).profileRevision, 5);
  assert.equal(reloaded.profileRevision, 5);
  assert.deepEqual(Settings.migrateSettings(reloaded), reloaded);

  const versions = {
    text: 'The model learns.',
    languageMode: 'both',
    semanticVersion: '0.3.0',
    grammarVersion: '0.3.0',
    lexicalVersion: 'halo-bootstrap-dictionary@0.3.0'
  };
  assert.notEqual(
    Progressive.createAnalysisKey({ ...versions, profileRevision: initial.profileRevision }),
    Progressive.createAnalysisKey({ ...versions, profileRevision: edited.profileRevision })
  );
});

test('overlapping popup saves serialize distinct edits into distinct revisions and keys', async () => {
  const Persistence = require('../apps/extension/src/shared/profile-persistence');
  const ProfileControls = require('../apps/extension/src/shared/profile-controls');
  const Progressive = require('../apps/extension/src/shared/progressive-runtime');
  const storageKey = 'haloSettings';
  let stored = Settings.migrateSettings({
    profileId: 'shared-profile',
    profileRevision: 4,
    channels: { lemma: false },
    density: 0.5
  });
  const writes = [];
  const storage = {
    async get(key) {
      await Promise.resolve();
      return { [key]: JSON.parse(JSON.stringify(stored)) };
    },
    async set(update) {
      await Promise.resolve();
      stored = update[storageKey];
      writes.push(stored);
    }
  };
  let tail = Promise.resolve();
  const lockManager = {
    request(name, options, callback) {
      assert.equal(name, 'halo-settings-write');
      assert.deepEqual(options, { mode: 'exclusive' });
      const run = tail.then(callback);
      tail = run.catch(() => {});
      return run;
    }
  };
  const options = {
    storage,
    storageKey,
    lockManager,
    normalizeSettings: Settings.normalizeSettings,
    mergeUiSettings: ProfileControls.mergeUiSettings
  };
  const popupA = Persistence.createProfilePersistence(options);
  const popupB = Persistence.createProfilePersistence(options);

  const [lemmaEdit, densityEdit] = await Promise.all([
    popupA.saveEdit({ channels: { lemma: true } }),
    popupB.saveEdit({ density: 0.75 })
  ]);

  assert.equal(lemmaEdit.profileRevision, 5);
  assert.equal(densityEdit.profileRevision, 6);
  assert.equal(stored.profileId, 'shared-profile');
  assert.equal(stored.profileRevision, 6);
  assert.equal(stored.channels.lemma, true);
  assert.equal(stored.density, 0.75);
  assert.deepEqual(writes.map((value) => value.profileRevision), [5, 6]);

  const keyFor = (profile) => Progressive.createAnalysisKey({
    text: 'The model learns.',
    languageMode: profile.languageMode,
    semanticVersion: '0.3.0',
    grammarVersion: '0.3.0',
    profileRevision: profile.profileRevision,
    lexicalVersion: 'halo-bootstrap-dictionary@0.3.0'
  });
  assert.notEqual(keyFor(lemmaEdit), keyFor(densityEdit));

  const [sameA, sameB] = await Promise.all([
    popupA.saveEdit({ labelPosition: 'bottom-right' }),
    popupB.saveEdit({ labelPosition: 'bottom-right' })
  ]);
  assert.equal(sameA.profileRevision, 7);
  assert.equal(sameB.profileRevision, 7);
  assert.equal(stored.profileRevision, 7);
});

test('overlapping trigger-mode and visual saves remain serialized without losing either edit', async () => {
  const Persistence = require('../apps/extension/src/shared/profile-persistence');
  const ProfileControls = require('../apps/extension/src/shared/profile-controls');
  const storageKey = 'haloSettings';
  let stored = Settings.migrateSettings({ profileRevision: 2, triggerMode: 'hybrid', density: 0.5 });
  let tail = Promise.resolve();
  const persistence = Persistence.createProfilePersistence({
    storage: {
      async get(key) { return { [key]: JSON.parse(JSON.stringify(stored)) }; },
      async set(update) { stored = update[storageKey]; }
    },
    storageKey,
    lockManager: {
      request(_name, _options, callback) {
        const run = tail.then(callback);
        tail = run.catch(() => {});
        return run;
      }
    },
    normalizeSettings: Settings.normalizeSettings,
    mergeUiSettings: ProfileControls.mergeUiSettings
  });

  const [triggerEdit, densityEdit] = await Promise.all([
    persistence.saveEdit({ triggerMode: 'explicit-only' }),
    persistence.saveEdit({ density: 0.75 })
  ]);
  assert.equal(triggerEdit.profileRevision, 3);
  assert.equal(densityEdit.profileRevision, 4);
  assert.equal(stored.triggerMode, 'explicit-only');
  assert.equal(stored.density, 0.75);
});

test('locked site-host operations reread latest settings and preserve concurrent add, remove, and duplicate edits', async () => {
  const Persistence = require('../apps/extension/src/shared/profile-persistence');
  const ProfileControls = require('../apps/extension/src/shared/profile-controls');
  const Policy = require('../apps/extension/src/shared/site-policy');
  const storageKey = 'haloSettings';
  let stored = Settings.migrateSettings({
    profileRevision: 10,
    sitePolicy: { schemaVersion: 1, userDenylist: ['old.example'] }
  });
  const writes = [];
  let tail = Promise.resolve();
  const persistence = Persistence.createProfilePersistence({
    storage: {
      async get(key) { return { [key]: JSON.parse(JSON.stringify(stored)) }; },
      async set(update) { stored = update[storageKey]; writes.push(stored.profileRevision); }
    },
    storageKey,
    lockManager: {
      request(_name, _options, callback) {
        const run = tail.then(callback);
        tail = run.catch(() => {});
        return run;
      }
    },
    normalizeSettings: Settings.normalizeSettings,
    mergeUiSettings: ProfileControls.mergeUiSettings
  });
  const editHost = (hostname, blocked) => persistence.saveTransform((latest) => {
    const hosts = new Set(latest.sitePolicy.userDenylist);
    if (blocked) hosts.add(hostname);
    else hosts.delete(hostname);
    return {
      sitePolicy: { schemaVersion: 1, userDenylist: Policy.normalizeDenylist([...hosts]) }
    };
  });

  const [addedA, addedB] = await Promise.all([
    editHost('a.example', true),
    editHost('b.example', true)
  ]);
  assert.deepEqual(addedA.sitePolicy.userDenylist, ['a.example', 'old.example']);
  assert.deepEqual(addedB.sitePolicy.userDenylist, ['a.example', 'b.example', 'old.example']);
  assert.equal(addedA.profileRevision, 11);
  assert.equal(addedB.profileRevision, 12);

  const [duplicateA, duplicateB] = await Promise.all([
    editHost('same.example', true),
    editHost('same.example', true)
  ]);
  assert.equal(duplicateA.profileRevision, 13);
  assert.equal(duplicateB.profileRevision, 13);

  const [removedOld, readdedOld] = await Promise.all([
    editHost('old.example', false),
    editHost('old.example', true)
  ]);
  assert.equal(removedOld.profileRevision, 14);
  assert.equal(readdedOld.profileRevision, 15);
  assert.deepEqual(stored.sitePolicy.userDenylist, ['a.example', 'b.example', 'old.example', 'same.example']);
  assert.deepEqual(writes, [11, 12, 13, 14, 15]);
});

test('popup profile persistence fails closed without a cross-context lock manager', async () => {
  const Persistence = require('../apps/extension/src/shared/profile-persistence');
  const ProfileControls = require('../apps/extension/src/shared/profile-controls');
  const persistence = Persistence.createProfilePersistence({
    storage: { get: async () => ({}), set: async () => {} },
    storageKey: 'haloSettings',
    lockManager: null,
    normalizeSettings: Settings.normalizeSettings,
    mergeUiSettings: ProfileControls.mergeUiSettings
  });

  await assert.rejects(() => persistence.saveEdit({ density: 0.8 }), /LockManager/);
});
