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

test('label and color channels can be switched independently', () => {
  const { Projection, Settings } = loadModules();
  const profile = Settings.normalizeSettings({ posLabels: false, posColors: true, density: 1 });
  const plan = Projection.createMarkingPlan(sampleTokens(), profile);
  const verb = plan.find((x) => x.text === 'learns');
  assert.equal(verb.marked, true);
  assert.equal(verb.label, null);
  assert.equal(verb.colorClass, 'halo-pos-v');

  const labelsOnly = Settings.normalizeSettings({ posLabels: true, posColors: false, density: 1 });
  const plan2 = Projection.createMarkingPlan(sampleTokens(), labelsOnly);
  const verb2 = plan2.find((x) => x.text === 'learns');
  assert.equal(verb2.label, 'v');
  assert.equal(verb2.colorClass, null);
});

test('density selection is deterministic and priority-aware', () => {
  const { Projection, Settings } = loadModules();
  const profile = Settings.normalizeSettings({ density: 0.5, minConfidence: 0.5, languageMode: 'both' });
  const a = Projection.createMarkingPlan(sampleTokens(), profile);
  const b = Projection.createMarkingPlan(sampleTokens(), profile);
  assert.deepEqual(a.map((x) => x.marked), b.map((x) => x.marked));
  assert.equal(a.filter((x) => x.marked).length, 2);
  assert.ok(a.filter((x) => x.marked).every((x) => x.priority >= 0.85));
});

test('low-confidence and filtered-language tokens are not marked', () => {
  const { Projection, Settings } = loadModules();
  const profile = Settings.normalizeSettings({ density: 1, minConfidence: 0.6, languageMode: 'en' });
  const plan = Projection.createMarkingPlan(sampleTokens(), profile);
  assert.equal(plan.find((x) => x.text === '快速').marked, false);
  assert.equal(plan.find((x) => x.text === 'xqz').marked, false);
});

test('settings normalization clamps invalid values and accepts label positions', () => {
  const { Settings } = loadModules();
  const settings = Settings.normalizeSettings({
    density: 9,
    minConfidence: -2,
    languageMode: 'nonsense',
    labelPosition: 'bottom-right'
  });
  assert.equal(settings.density, 1);
  assert.equal(settings.minConfidence, 0);
  assert.equal(settings.languageMode, 'both');
  assert.equal(settings.labelPosition, 'bottom-right');
  assert.equal(Settings.normalizeSettings({ labelPosition: 'bad' }).labelPosition, 'top-right');
});
