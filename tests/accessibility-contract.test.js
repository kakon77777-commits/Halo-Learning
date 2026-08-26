const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const rendererPath = path.join(root, 'apps', 'extension', 'src', 'shared', 'reversible-renderer.js');
const contentCssPath = path.join(root, 'apps', 'extension', 'src', 'content.css');
const popupCssPath = path.join(root, 'apps', 'extension', 'src', 'popup.css');

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

test('popup presentation is resilient to keyboard focus, reduced motion, forced colors, and narrow zoomed viewports', () => {
  const css = source(popupCssPath);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media\s*\(forced-colors:\s*active\)/);
  assert.match(css, /max-width:\s*100vw/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
});
