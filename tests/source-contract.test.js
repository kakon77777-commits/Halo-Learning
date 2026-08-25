const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionRoot = path.join(__dirname, '..', 'apps', 'extension');
const contentPath = path.join(extensionRoot, 'src', 'content.js');
const cssPath = path.join(extensionRoot, 'src', 'content.css');
const rendererPath = path.join(extensionRoot, 'src', 'shared', 'reversible-renderer.js');

function loadContent() {
  return require(contentPath);
}

test('segment builder preserves original text while marking only selected ranges', () => {
  const Content = loadContent();
  const text = 'The model learns 中文。';
  const plan = [
    { text: 'The', start: 0, end: 3, pos: 'det', marked: false },
    { text: 'model', start: 4, end: 9, pos: 'n', marked: true, label: 'n', colorClass: 'halo-pos-n', labelPosition: 'top-right', metaLabel: 'lemma: model', glossHint: 'a representation', chunkClass: 'halo-structure-chunk' },
    { text: 'learns', start: 10, end: 16, pos: 'v', marked: true, label: 'v', colorClass: 'halo-pos-v', labelPosition: 'top-right' },
    { text: '中文', start: 17, end: 19, pos: 'n', marked: true, label: 'n', colorClass: 'halo-pos-n', labelPosition: 'top-right' }
  ];
  const segments = Content.buildSegments(text, plan);
  assert.equal(segments.map((s) => s.text).join(''), text);
  assert.deepEqual(segments.filter((s) => s.marked).map((s) => s.text), ['model', 'learns', '中文']);
  const model = segments.find((segment) => segment.text === 'model');
  assert.equal(model.metaLabel, 'lemma: model');
  assert.equal(model.glossHint, 'a representation');
  assert.equal(model.chunkClass, 'halo-structure-chunk');
});

test('segment builder creates no semantic decoration when every RenderPlan item is unmarked', () => {
  const Content = loadContent();
  const text = 'The model learns.';
  const segments = Content.buildSegments(text, [
    { text: 'The', start: 0, end: 3, marked: false },
    { text: 'model', start: 4, end: 9, marked: false },
    { text: 'learns', start: 10, end: 16, marked: false }
  ]);

  assert.deepEqual(segments, [{ text, marked: false }]);
});

test('content-service failure fallback uses the conservative semantic engine instead of suffix guessing', () => {
  const Content = loadContent();
  const Dictionary = require('../apps/extension/src/shared/dictionary-provider');
  const Semantic = require('../apps/extension/src/shared/semantic-annotations');

  const sets = Content.bootstrapAnnotationSets(
    ['Qzxvizing'],
    { languageMode: 'en' },
    Dictionary,
    Semantic,
    '2026-08-25T10:00:00.000Z'
  );
  const token = sets[0].tokens[0];

  assert.equal(token.simplifiedPos, 'x');
  assert.equal(Object.hasOwn(token, 'lemma'), false);
  assert.deepEqual(token.lexicalRefs, []);
  assert.ok(token.confidence < 0.5);
  assert.equal(sets[0].providerRefs[0].status, 'bootstrap');
  assert.equal(sets[0].diagnostics.fallbackActivated, true);
});

test('content delegates reversible DOM ownership to the versioned renderer boundary', () => {
  const source = fs.readFileSync(contentPath, 'utf8');
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  assert.match(source, /HALO_APPLY_MARKING/);
  assert.match(source, /HALO_REMOVE_MARKING/);
  assert.match(source, /HALO_STATUS/);
  assert.match(source, /HaloReversibleRenderer/);
  assert.match(source, /createReversibleRenderer/);
  assert.doesNotMatch(source, /function spanFor|function replaceTextNode|function removeRenderedDom/);
  assert.match(renderer, /data-halo-owned/);
  assert.match(renderer, /data-halo-original/);
  assert.match(renderer, /createReversibleRenderer/);
  assert.match(renderer, /createCorePanel/);
  assert.doesNotMatch(renderer, /innerHTML\s*=/);
  for (const tag of ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE']) {
    assert.match(source, new RegExp(tag));
  }
  assert.match(source, /runtimeBudgets/);
  assert.match(source, /HaloRuntimeScheduler/);
  assert.match(source, /HALO_ENRICH_BATCH/);
  assert.match(source, /annotationSet/);
  assert.doesNotMatch(source, /settings\.maxTextNodes|settings\.maxMarkedTokens/);
  assert.doesNotMatch(source, /lastAnnotationSets/);
  assert.match(source, /async function applyMarking/);
  assert.match(source, /return true/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('CSS uses POS pseudo labels and does not replace the visible word', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(css, /content:\s*attr\(data-halo-pos\)/);
  assert.match(css, /halo-label-top-right/);
  assert.match(css, /position:\s*absolute/);
  assert.match(css, /halo-pos-n/);
  assert.match(css, /halo-pos-v/);
  assert.match(css, /content:\s*attr\(data-halo-meta\)/);
  assert.match(css, /halo-structure-chunk/);
  assert.match(css, /halo-noncolor-marker/);
  assert.match(css, /text-decoration-style:\s*dotted/);
});

test('Manifest V3 uses minimal click-scoped permissions and no host permissions', () => {
  const manifestPath = path.join(extensionRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, 'src/popup.html');
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'scripting', 'storage'].sort());
  assert.equal(Object.hasOwn(manifest, 'host_permissions'), false);
  assert.equal(Object.hasOwn(manifest, 'content_scripts'), false);
});

test('popup exposes bilingual basic controls and injects only packaged local files', () => {
  const html = fs.readFileSync(path.join(extensionRoot, 'src', 'popup.html'), 'utf8');
  const js = fs.readFileSync(path.join(extensionRoot, 'src', 'popup.js'), 'utf8');
  for (const id of [
    'posLabels', 'posColors', 'lemma', 'morphology', 'glossHint', 'grammarRole',
    'tenseAspect', 'chunk', 'learningState', 'density', 'languageMode',
    'labelPosition', 'applyButton', 'removeButton'
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /詞性/);
  assert.match(html, /POS/);
  assert.match(js, /chrome\.storage\.local/);
  assert.match(js, /chrome\.scripting\.executeScript/);
  assert.match(js, /chrome\.scripting\.insertCSS/);
  assert.match(js, /settings\.channels/);
  assert.match(html, /id=["']learningState["'][^>]*disabled/);
  assert.match(html, /value=["']zh-Hant["']/);
  assert.doesNotMatch(js, /fetch\s*\(/);
  assert.doesNotMatch(js, /XMLHttpRequest/);
  const injection = js.match(/const INJECT_FILES = \[([\s\S]*?)\];/)[1];
  assert.ok(injection.includes("'src/shared/reversible-renderer.js'"));
  assert.ok(
    injection.indexOf("'src/shared/reversible-renderer.js'") < injection.indexOf("'src/content.js'"),
    'renderer must load before the content orchestrator'
  );
});

test('executable extension source contains no remote script or API dependency', () => {
  const sourceFiles = [
    'src/popup.js', 'src/content.js', 'src/shared/linguistics.js',
    'src/shared/projection.js', 'src/shared/settings.js', 'src/shared/dictionary-provider.js',
    'src/shared/runtime-scheduler.js', 'src/shared/semantic-contracts.js',
    'src/shared/reversible-renderer.js'
  ];
  const combined = sourceFiles.map((rel) => fs.readFileSync(path.join(extensionRoot, rel), 'utf8')).join('\n');
  assert.doesNotMatch(combined, /https?:\/\//i);
  assert.doesNotMatch(combined, /eval\s*\(/);
  assert.doesNotMatch(combined, /new\s+Function\s*\(/);
});

test('content privacy gate fails closed on sensitive form attributes without reading field values', () => {
  const source = fs.readFileSync(contentPath, 'utf8');
  assert.match(source, /SENSITIVE_PAGE_BLOCKED/);
  assert.match(source, /input\[type=["']password["']\]/);
  assert.doesNotMatch(source, /\.value\b/);
  assert.doesNotMatch(source, /document\.cookie|chrome\.history|chrome\.cookies/);
});
