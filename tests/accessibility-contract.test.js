const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const rendererPath = path.join(root, 'apps', 'extension', 'src', 'shared', 'reversible-renderer.js');
const contentCssPath = path.join(root, 'apps', 'extension', 'src', 'content.css');
const popupCssPath = path.join(root, 'apps', 'extension', 'src', 'popup.css');
const popupHtmlPath = path.join(root, 'apps', 'extension', 'src', 'popup.html');
const optionsCssPath = path.join(root, 'apps', 'extension', 'src', 'options.css');
const optionsHtmlPath = path.join(root, 'apps', 'extension', 'src', 'options.html');

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

test('visual token labels never create one tab stop or accessible name per token', () => {
  const renderer = source(rendererPath);
  assert.doesNotMatch(renderer, /setAttribute\(['"]tabindex['"][^\n]*wrapper/);
  assert.doesNotMatch(renderer, /setAttribute\(['"]aria-label['"][^\n]*wrapper/);
});

test('core panel contract includes labelled dialog semantics, concise live status, and focus entry/return', () => {
  const renderer = source(rendererPath);
  assert.match(renderer, /setAttribute\(['"]role['"], ['"]dialog['"]\)/);
  assert.match(renderer, /setAttribute\(['"]aria-labelledby['"], ['"]halo-panel-title['"]\)/);
  assert.match(renderer, /setAttribute\(['"]aria-live['"], ['"]polite['"]\)/);
  assert.match(renderer, /setAttribute\(['"]tabindex['"], ['"]-1['"]\)/);
  assert.match(renderer, /\.focus\(/);
  assert.match(renderer, /returnFocus/);
});

test('content presentation has non-speech pseudo labels, reduced motion, forced colors, and visible focus contracts', () => {
  const css = source(contentCssPath);
  assert.match(css, /\.halo-token::before[\s\S]*\.halo-token::after[\s\S]*speak:\s*none/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media\s*\(forced-colors:\s*active\)/);
  assert.match(css, /:focus-visible/);
});

test('popup presentation is resilient and keeps dogfood entry compact', () => {
  const css = source(popupCssPath);
  const html = source(popupHtmlPath);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media\s*\(forced-colors:\s*active\)/);
  assert.match(css, /max-width:\s*100vw/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(html, /id="dogfoodCaptureStatus"/);
  assert.match(html, /id="openDashboardButton"/);
  assert.doesNotMatch(html, /dogfoodEventTable|dogfoodAnalytics|mastery/i);
});

test('options dashboard has one h1, landmark navigation, labelled controls, live status, focus, reduced motion, and forced colors', () => {
  const html = source(optionsHtmlPath);
  const css = source(optionsCssPath);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /<nav[^>]*aria-label="Dashboard sections"/);
  assert.match(html, /aria-label="Event type"/);
  assert.match(html, /aria-label="New dogfood note"|for="newNoteText"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media\s*\(forced-colors:\s*active\)/);
  assert.doesNotMatch(source(optionsHtmlPath), /mastery|confidence|learner level/i);
});
