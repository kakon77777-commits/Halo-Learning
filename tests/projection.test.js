const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const projectionPath = path.join(__dirname, '..', 'apps', 'extension', 'src', 'shared', 'projection.js');
const settingsPath = path.join(__dirname, '..', 'apps', 'extension', 'src', 'shared', 'settings.js');

function loadModules() {
  return { Projection: require(projectionPath), Settings: require(settingsPath) };
}

function sampleTokens() {
  return [
    { text: 'The', start: 0, end: 3, lang: 'en', pos: 'det', confidence: 0.99, priority: 0.65 },
    { text: 'model', start: 4, end: 9, lang: 'en', pos: 'n', confidence: 0.92, priority: 0.85 },
    { text: 'learns', start: 10, end: 16, lang: 'en', pos: 'v', confidence: 0.92, priority: 0.85 },
    { text: '快速', start: 17, end: 19, lang: 'zh', pos: 'adj', confidence: 0.94, priority: 0.85 },
    { text: 'xqz', start: 20, end: 23, lang: 'en', pos: 'x', confidence: 0.2, priority: 0.2 }
  ];
}

test('default profile renders compact POS labels at top-right', () => {
  const { Projection, Settings } = loadModules();
  const plan = Projection.createMarkingPlan(sampleTokens(), Settings.DEFAULT_SETTINGS);
  const noun = plan.find((x) => x.text === 'model');
  assert.equal(noun.marked, true);
  assert.equal(noun.label, 'n');
  assert.equal(noun.labelPosition, 'top-right');
});

test('POS color is disabled when it would be the only POS semantic carrier', () => {
  const { Projection, Settings } = loadModules();
  const profile = Settings.migrateSettings({ posLabels: false, posColors: true, density: 1 });
  const plan = Projection.createMarkingPlan(sampleTokens(), profile);
  const verb = plan.find((x) => x.text === 'learns');
  assert.equal(verb.marked, false);
  assert.equal(verb.label, null);
  assert.equal(verb.colorClass, null);

  const labelsOnly = Settings.migrateSettings({ posLabels: true, posColors: false, density: 1 });
  const plan2 = Projection.createMarkingPlan(sampleTokens(), labelsOnly);
  const verb2 = plan2.find((x) => x.text === 'learns');
  assert.equal(verb2.label, 'v');
  assert.equal(verb2.colorClass, null);
});

function semanticToken() {
  return Object.freeze({
    schemaVersion: 1,
    tokenId: 'token:en:0:5',
    surface: 'books',
    normalizedSurface: 'books',
    language: 'en',
    start: 0,
    end: 5,
    lemma: 'book',
    simplifiedPos: 'n',
    morphology: Object.freeze({ form: 'plural', number: 'plural' }),
    grammarRole: 'object',
    tenseAspect: 'simple-present',
    glossRefs: Object.freeze(['wn:book#gloss']),
    lexicalRefs: Object.freeze(['wn:book']),
    confidence: 0.96,
    provenance: Object.freeze(['fixture']),
    priority: 0.85,
    annotations: Object.freeze([
      Object.freeze({ type: 'lemma', value: 'book', confidence: 0.96 }),
      Object.freeze({ type: 'simplified-pos', value: 'n', confidence: 0.96 }),
      Object.freeze({ type: 'morphology', value: Object.freeze({ form: 'plural', number: 'plural' }), confidence: 0.94 }),
      Object.freeze({ type: 'grammar-role', value: 'object', confidence: 0.8 }),
      Object.freeze({ type: 'tense-aspect', value: 'simple-present', confidence: 0.86 }),
      Object.freeze({ type: 'gloss', value: 'a written work', confidence: 0.96 }),
      Object.freeze({ type: 'chunk', value: Object.freeze({ type: 'noun-phrase', start: 0, end: 5 }), confidence: 0.84 })
    ])
  });
}

function channelsWith(name) {
  return {
    posLabel: false,
    posColor: false,
    lemma: false,
    morphology: false,
    glossHint: false,
    grammarRole: false,
    tenseAspect: false,
    chunk: false,
    learningState: false,
    [name]: true
  };
}

test('available semantic channels select only their corresponding projection decoration', () => {
  const { Projection, Settings } = loadModules();
  const expected = {
    posLabel: 'n',
    lemma: 'book',
    morphology: { form: 'plural', number: 'plural' },
    glossHint: 'a written work',
    grammarRole: 'object',
    tenseAspect: 'simple-present',
    chunk: { type: 'noun-phrase', start: 0, end: 5 }
  };

  for (const [channel, value] of Object.entries(expected)) {
    const profile = Settings.migrateSettings({ channels: channelsWith(channel), density: 1 });
    const item = Projection.createMarkingPlan([semanticToken()], profile)[0];
    assert.equal(item.marked, true, channel);
    assert.deepEqual(item.decorations[channel], value, channel);
    for (const other of Object.keys(item.decorations)) {
      if (other !== channel) assert.equal(item.decorations[other], null, `${channel} leaked ${other}`);
    }
  }
});

test('all visual channels off yields zero decoration while semantic tokens remain byte-identical', () => {
  const { Projection, Settings } = loadModules();
  const token = semanticToken();
  const snapshot = JSON.stringify(token);
  const channels = channelsWith('learningState');
  channels.learningState = false;
  const profile = Settings.migrateSettings({ channels, density: 1 });
  const plan = Projection.createMarkingPlan([token], profile);

  assert.equal(plan.filter((item) => item.marked).length, 0);
  assert.ok(Object.values(plan[0].decorations).every((value) => value === null));
  assert.equal(JSON.stringify(token), snapshot);
});

test('profile position, density, color, and channel changes never mutate canonical SemanticToken', () => {
  const { Projection, Settings } = loadModules();
  const token = semanticToken();
  const snapshot = JSON.stringify(token);
  const profiles = [
    Settings.migrateSettings({ density: 1, labelPosition: 'top-left' }),
    Settings.migrateSettings({ density: 0, labelPosition: 'inline' }),
    Settings.migrateSettings({ channels: { ...channelsWith('posLabel'), posColor: true }, density: 1 }),
    Settings.migrateSettings({ channels: channelsWith('glossHint'), density: 1 })
  ];

  const plans = profiles.map((profile) => Projection.createMarkingPlan([token], profile));
  assert.equal(JSON.stringify(token), snapshot);
  assert.notDeepEqual(plans[0], plans[1]);
  assert.notDeepEqual(plans[2], plans[3]);
});

test('density selection is deterministic and priority-aware', () => {
  const { Projection, Settings } = loadModules();
  const profile = Settings.migrateSettings({ density: 0.5, minConfidence: 0.5, languageMode: 'both' });
  const a = Projection.createMarkingPlan(sampleTokens(), profile);
  const b = Projection.createMarkingPlan(sampleTokens(), profile);
  assert.deepEqual(a.map((x) => x.marked), b.map((x) => x.marked));
  assert.equal(a.filter((x) => x.marked).length, 2);
  assert.ok(a.filter((x) => x.marked).every((x) => x.priority >= 0.85));
});

test('low-confidence and filtered-language tokens are not marked', () => {
  const { Projection, Settings } = loadModules();
  const profile = Settings.migrateSettings({ density: 1, minConfidence: 0.6, languageMode: 'en' });
  const plan = Projection.createMarkingPlan(sampleTokens(), profile);
  assert.equal(plan.find((x) => x.text === '快速').marked, false);
  assert.equal(plan.find((x) => x.text === 'xqz').marked, false);
});

test('projection thresholds each annotation channel instead of promoting low-confidence POS with lexical confidence', () => {
  const { Projection, Settings } = loadModules();
  const token = {
    ...semanticToken(),
    confidence: 0.98,
    simplifiedPos: 'v',
    annotations: [
      { type: 'simplified-pos', value: 'v', confidence: 0.55 },
      { type: 'gloss', value: 'to print', confidence: 0.98 }
    ]
  };
  const posOnly = Settings.migrateSettings({ channels: channelsWith('posLabel'), density: 1, minConfidence: 0.6 });
  const glossOnly = Settings.migrateSettings({ channels: channelsWith('glossHint'), density: 1, minConfidence: 0.6 });
  const combined = Settings.migrateSettings({
    channels: { ...channelsWith('glossHint'), posLabel: true, posColor: true },
    density: 1,
    minConfidence: 0.6
  });

  assert.equal(Projection.createMarkingPlan([token], posOnly)[0].marked, false);
  const visibleLowConfidencePos = Projection.createMarkingPlan([token], Settings.migrateSettings({
    channels: channelsWith('posLabel'),
    density: 1,
    minConfidence: 0.5
  }))[0];
  assert.equal(visibleLowConfidencePos.marked, true);
  assert.equal(visibleLowConfidencePos.confidence, 0.55);
  const glossItem = Projection.createMarkingPlan([token], glossOnly)[0];
  assert.equal(glossItem.marked, true);
  assert.equal(glossItem.glossHint, 'to print');
  assert.equal(glossItem.confidence, 0.98);
  const combinedItem = Projection.createMarkingPlan([token], combined)[0];
  assert.equal(combinedItem.marked, true);
  assert.equal(combinedItem.label, null);
  assert.equal(combinedItem.colorClass, null);
  assert.equal(combinedItem.glossHint, 'to print');
  const visibleCombined = Projection.createMarkingPlan([token], Settings.migrateSettings({
    channels: { ...channelsWith('glossHint'), posLabel: true },
    density: 1,
    minConfidence: 0.5
  }))[0];
  assert.equal(visibleCombined.label, 'v');
  assert.equal(visibleCombined.glossHint, 'to print');
  assert.equal(visibleCombined.confidence, 0.55);
});

test('canonical tokens never project a derived field without matching annotation evidence', () => {
  const { Projection, Settings } = loadModules();
  const token = { ...semanticToken(), annotations: [] };
  const profile = Settings.migrateSettings({ channels: channelsWith('posLabel'), density: 1, minConfidence: 0 });

  const item = Projection.createMarkingPlan([token], profile)[0];

  assert.equal(item.marked, false);
  assert.equal(item.label, null);
  assert.equal(item.confidence, 0);
});

test('canonical projection rejects same-type evidence whose value contradicts the derived field', () => {
  const { Projection, Settings } = loadModules();
  const token = {
    ...semanticToken(),
    simplifiedPos: 'v',
    annotations: [{ type: 'simplified-pos', value: 'n', confidence: 0.99 }]
  };
  const profile = Settings.migrateSettings({ channels: channelsWith('posLabel'), density: 1, minConfidence: 0.6 });

  const item = Projection.createMarkingPlan([token], profile)[0];

  assert.equal(item.marked, false);
  assert.equal(item.label, null);
  assert.equal(item.confidence, 0);
});

test('settings normalization clamps invalid values and accepts label positions', () => {
  const { Settings } = loadModules();
  const settings = Settings.migrateSettings({
    density: 9,
    minConfidence: -2,
    languageMode: 'nonsense',
    labelPosition: 'bottom-right'
  });
  assert.equal(settings.density, 1);
  assert.equal(settings.minConfidence, 0);
  assert.equal(settings.languageMode, 'both');
  assert.equal(settings.labelPosition, 'bottom-right');
  assert.equal(Settings.migrateSettings({ labelPosition: 'bad' }).labelPosition, 'top-right');
});
