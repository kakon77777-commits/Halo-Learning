const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionRoot = path.join(__dirname, '..', 'apps', 'extension');
const contentPath = path.join(extensionRoot, 'src', 'content.js');
const cssPath = path.join(extensionRoot, 'src', 'content.css');

function loadContent() {
  return require(contentPath);
}

test('segment builder preserves original text while marking only selected ranges', () => {
  const Content = loadContent();
  const text = 'The model learns 中文。';
  const plan = [
    { text: 'The', start: 0, end: 3, pos: 'det', marked: false },
    { text: 'model', start: 4, end: 9, pos: 'n', marked: true, label: 'n', colorClass: 'halo-pos-n', labelPosition: 'top-right' },
    { text: 'learns', start: 10, end: 16, pos: 'v', marked: true, label: 'v', colorClass: 'halo-pos-v', labelPosition: 'top-right' },
    { text: '中文', start: 17, end: 19, pos: 'n', marked: true, label: 'n', colorClass: 'halo-pos-n', labelPosition: 'top-right' }
  ];
  const segments = Content.buildSegments(text, plan);
  assert.equal(segments.map((s) => s.text).join(''), text);
  assert.deepEqual(segments.filter((s) => s.marked).map((s) => s.text), ['model', 'learns', '中文']);
});

test('content renderer source defines reversible handlers, safety skips, and budgets', () => {
  const source = fs.readFileSync(contentPath, 'utf8');
  assert.match(source, /HALO_APPLY_MARKING/);
  assert.match(source, /HALO_REMOVE_MARKING/);
  assert.match(source, /HALO_STATUS/);
  assert.match(source, /data-halo-token/);
  assert.match(source, /haloOriginal/);
  for (const tag of ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE']) {
    assert.match(source, new RegExp(tag));
  }
  assert.match(source, /maxTextNodes/);
  assert.match(source, /maxMarkedTokens/);
});

test('CSS uses POS pseudo labels and does not replace the visible word', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(css, /content:\s*attr\(data-halo-pos\)/);
  assert.match(css, /halo-label-top-right/);
  assert.match(css, /position:\s*absolute/);
  assert.match(css, /halo-pos-n/);
  assert.match(css, /halo-pos-v/);
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
  for (const id of ['posLabels', 'posColors', 'density', 'languageMode', 'labelPosition', 'applyButton', 'removeButton']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /詞性/);
  assert.match(html, /POS/);
  assert.match(js, /chrome\.storage\.local/);
  assert.match(js, /chrome\.scripting\.executeScript/);
  assert.match(js, /chrome\.scripting\.insertCSS/);
  assert.doesNotMatch(js, /fetch\s*\(/);
  assert.doesNotMatch(js, /XMLHttpRequest/);
});

test('executable extension source contains no remote script or API dependency', () => {
  const sourceFiles = [
    'src/popup.js', 'src/content.js', 'src/shared/linguistics.js',
    'src/shared/projection.js', 'src/shared/settings.js', 'src/shared/dictionary-provider.js'
  ];
  const combined = sourceFiles.map((rel) => fs.readFileSync(path.join(extensionRoot, rel), 'utf8')).join('\n');
  assert.doesNotMatch(combined, /https?:\/\//i);
  assert.doesNotMatch(combined, /eval\s*\(/);
  assert.doesNotMatch(combined, /new\s+Function\s*\(/);
});
