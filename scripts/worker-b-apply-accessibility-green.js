'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function write(relative, value) {
  fs.writeFileSync(path.join(root, relative), value, 'utf8');
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`worker-b accessibility patch anchor missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`worker-b accessibility patch anchor is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

let renderer = read('apps/extension/src/shared/reversible-renderer.js');

renderer = replaceOnce(
  renderer,
  "  const SAFE_PROJECTION_CLASS = /^halo-(?:pos|structure)-[a-z0-9-]+$/;\n",
  "  const SAFE_PROJECTION_CLASS = /^halo-(?:pos|structure)-[a-z0-9-]+$/;\n" +
  "  const LIVE_STATUS_MESSAGES = new Set(['Ready', 'Analyzing', 'Enriched', 'Blocked', 'Closed']);\n",
  'renderer live status set'
);

renderer = replaceOnce(
  renderer,
  "    .halo-core-panel h2 { margin: 0 0 0.5rem; font: 700 1.05rem/1.3 ui-sans-serif, system-ui, sans-serif; }\n" +
  "    .halo-core-panel p { margin: 0.35rem 0; }\n" +
  "    .halo-core-status { font-size: 0.875rem; font-weight: 650; }\n",
  "    .halo-core-panel h2 { margin: 0 0 0.5rem; font: 700 1.05rem/1.3 ui-sans-serif, system-ui, sans-serif; }\n" +
  "    .halo-core-panel h2:focus { outline: 2px solid Highlight; outline-offset: 2px; }\n" +
  "    .halo-core-panel p { margin: 0.35rem 0; }\n" +
  "    .halo-core-status { font-size: 0.875rem; font-weight: 650; }\n" +
  "    @media (prefers-reduced-motion: reduce) {\n" +
  "      .halo-core-panel, .halo-core-panel * { animation: none !important; transition: none !important; scroll-behavior: auto !important; }\n" +
  "    }\n" +
  "    @media (forced-colors: active) {\n" +
  "      .halo-core-panel { color: CanvasText; background: Canvas; border-color: CanvasText; box-shadow: none; }\n" +
  "    }\n",
  'renderer panel resilient CSS'
);

renderer = replaceOnce(
  renderer,
  "    const title = document.createElement('h2');\n" +
  "    title.setAttribute('id', 'halo-panel-title');\n" +
  "    const body = document.createElement('p');\n",
  "    const title = document.createElement('h2');\n" +
  "    title.setAttribute('id', 'halo-panel-title');\n" +
  "    title.setAttribute('tabindex', '-1');\n" +
  "    const body = document.createElement('p');\n",
  'renderer panel focus target'
);

renderer = replaceOnce(
  renderer,
  "    let panelParts = null;\n" +
  "    let panelOpen = false;\n" +
  "    let panelCloseReason = null;\n" +
  "    let lastAction = 'idle';\n",
  "    let panelParts = null;\n" +
  "    let panelOpen = false;\n" +
  "    let panelCloseReason = null;\n" +
  "    let returnFocus = null;\n" +
  "    let lastAction = 'idle';\n",
  'renderer focus state'
);

renderer = replaceOnce(
  renderer,
  "    function removePanelHost(parts) {\n" +
  "      if (!parts || !parts.host || !parts.host.parentNode) return;\n" +
  "      track(parts.host);\n" +
  "      expectChildList(parts.host.parentNode, [], [parts.host]);\n" +
  "      parts.host.parentNode.removeChild(parts.host);\n" +
  "    }\n\n" +
  "    function closePanel(reason) {\n",
  "    function removePanelHost(parts) {\n" +
  "      if (!parts || !parts.host || !parts.host.parentNode) return;\n" +
  "      track(parts.host);\n" +
  "      expectChildList(parts.host.parentNode, [], [parts.host]);\n" +
  "      parts.host.parentNode.removeChild(parts.host);\n" +
  "    }\n\n" +
  "    function isReturnFocusTarget(candidate, excludedHost) {\n" +
  "      return Boolean(candidate && typeof candidate.focus === 'function' &&\n" +
  "        candidate.isConnected !== false && candidate !== document.body &&\n" +
  "        candidate !== document.documentElement && candidate !== excludedHost);\n" +
  "    }\n\n" +
  "    function focusSafely(candidate) {\n" +
  "      if (!candidate || typeof candidate.focus !== 'function') return false;\n" +
  "      try {\n" +
  "        candidate.focus({ preventScroll: true });\n" +
  "        return true;\n" +
  "      } catch (_error) {\n" +
  "        try { candidate.focus(); return true; } catch (_ignored) { return false; }\n" +
  "      }\n" +
  "    }\n\n" +
  "    function nextReturnFocus(model, priorParts) {\n" +
  "      const explicit = model && model.trigger;\n" +
  "      if (isReturnFocusTarget(explicit, priorParts && priorParts.host)) return explicit;\n" +
  "      if (isReturnFocusTarget(returnFocus, priorParts && priorParts.host)) return returnFocus;\n" +
  "      const active = document.activeElement;\n" +
  "      return isReturnFocusTarget(active, priorParts && priorParts.host) ? active : null;\n" +
  "    }\n\n" +
  "    function configureLiveStatus(parts, statusText) {\n" +
  "      parts.status.textContent = statusText;\n" +
  "      if (LIVE_STATUS_MESSAGES.has(statusText)) {\n" +
  "        parts.status.setAttribute('role', 'status');\n" +
  "        parts.status.setAttribute('aria-live', 'polite');\n" +
  "        parts.status.setAttribute('aria-atomic', 'true');\n" +
  "      } else {\n" +
  "        parts.status.removeAttribute('role');\n" +
  "        parts.status.setAttribute('aria-live', 'off');\n" +
  "        parts.status.removeAttribute('aria-atomic');\n" +
  "      }\n" +
  "    }\n\n" +
  "    function closePanel(reason) {\n",
  'renderer focus/live helpers'
);

renderer = replaceOnce(
  renderer,
  "      const closingParts = panelParts;\n" +
  "      const location = nodeLocation(closingParts.host);\n",
  "      const closingParts = panelParts;\n" +
  "      const focusAfterClose = returnFocus;\n" +
  "      const location = nodeLocation(closingParts.host);\n",
  'renderer close focus capture'
);

renderer = replaceOnce(
  renderer,
  "      panelCapabilities.delete(closingParts.host);\n" +
  "      panelCloseReason = closeReason;\n" +
  "      lastAction = 'panel-closed';\n" +
  "      return frozenResult({ action: 'closed', reason: closeReason });\n",
  "      panelCapabilities.delete(closingParts.host);\n" +
  "      panelCloseReason = closeReason;\n" +
  "      returnFocus = null;\n" +
  "      focusSafely(focusAfterClose);\n" +
  "      lastAction = 'panel-closed';\n" +
  "      return frozenResult({ action: 'closed', reason: closeReason });\n",
  'renderer close focus restore'
);

renderer = replaceOnce(
  renderer,
  "      const closingParts = panelOpen ? panelParts : null;\n" +
  "      const panelLocation = closingParts ? nodeLocation(closingParts.host) : null;\n",
  "      const closingParts = panelOpen ? panelParts : null;\n" +
  "      const focusAfterRemoveAll = closingParts ? returnFocus : null;\n" +
  "      const panelLocation = closingParts ? nodeLocation(closingParts.host) : null;\n",
  'renderer remove-all focus capture'
);

renderer = replaceOnce(
  renderer,
  "        panelOpen = false;\n" +
  "        panelCloseReason = 'remove-all';\n" +
  "      }\n" +
  "      lastAction = 'removed-all';\n",
  "        panelOpen = false;\n" +
  "        panelCloseReason = 'remove-all';\n" +
  "        returnFocus = null;\n" +
  "        focusSafely(focusAfterRemoveAll);\n" +
  "      }\n" +
  "      lastAction = 'removed-all';\n",
  'renderer remove-all focus restore'
);

renderer = replaceOnce(
  renderer,
  "      const nextParts = createCorePanel(document);\n" +
  "      nextParts.title.textContent = titleText;\n" +
  "      nextParts.body.textContent = bodyText;\n" +
  "      nextParts.status.textContent = statusText;\n" +
  "      const priorParts = panelOpen ? panelParts : null;\n",
  "      const priorParts = panelOpen ? panelParts : null;\n" +
  "      const focusAfterPanel = nextReturnFocus(model, priorParts);\n" +
  "      const nextParts = createCorePanel(document);\n" +
  "      nextParts.title.textContent = titleText;\n" +
  "      nextParts.body.textContent = bodyText;\n" +
  "      configureLiveStatus(nextParts, statusText);\n",
  'renderer panel status and return focus selection'
);

renderer = replaceOnce(
  renderer,
  "      if (priorParts) panelCapabilities.delete(priorParts.host);\n" +
  "      panelCloseReason = null;\n" +
  "      lastAction = 'panel-opened';\n",
  "      if (priorParts) panelCapabilities.delete(priorParts.host);\n" +
  "      panelCloseReason = null;\n" +
  "      returnFocus = focusAfterPanel;\n" +
  "      focusSafely(nextParts.title);\n" +
  "      lastAction = 'panel-opened';\n",
  'renderer panel focus entry'
);

write('apps/extension/src/shared/reversible-renderer.js', renderer);

let contentCss = read('apps/extension/src/content.css');
if (!contentCss.includes('@media (prefers-reduced-motion: reduce)')) {
  contentCss += `\n\n/* v0.4 accessibility: visual projection never becomes the only carrier. */\n.halo-token::before,\n.halo-token::after {\n  speak: none;\n}\n\n[data-halo-owned]:focus-visible {\n  outline: 2px solid Highlight;\n  outline-offset: 2px;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  [data-halo-owned] {\n    animation: none !important;\n    transition: none !important;\n    scroll-behavior: auto !important;\n  }\n}\n\n@media (forced-colors: active) {\n  .halo-token {\n    color: CanvasText !important;\n    outline: 1px dotted CanvasText;\n    text-decoration-color: CanvasText !important;\n    forced-color-adjust: auto;\n  }\n}\n`;
}
write('apps/extension/src/content.css', contentCss);

let popupCss = read('apps/extension/src/popup.css');
popupCss = replaceOnce(
  popupCss,
  'body { margin: 0; min-width: 330px; }\n.panel { padding: 16px; }\n',
  'body { margin: 0; min-width: min(330px, 100vw); max-width: 100vw; overflow-x: hidden; overflow-wrap: anywhere; }\n' +
  '.panel { padding: 16px; max-width: 100%; overflow-wrap: anywhere; }\n',
  'popup viewport resilience'
);
if (!popupCss.includes('@media (prefers-reduced-motion: reduce)')) {
  popupCss += `\n\n:focus-visible {\n  outline: 2px solid Highlight;\n  outline-offset: 2px;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after {\n    animation: none !important;\n    transition: none !important;\n    scroll-behavior: auto !important;\n  }\n}\n\n@media (forced-colors: active) {\n  button, select, input, summary {\n    forced-color-adjust: auto;\n  }\n  button.primary, button.secondary, select {\n    border: 1px solid ButtonText;\n  }\n}\n\n@media (max-width: 360px) {\n  .panel { padding: 12px; }\n  .row, .label-line { align-items: flex-start; gap: 8px; }\n  .actions { grid-template-columns: 1fr; }\n  .actions .analyze { grid-column: auto; }\n}\n`;
}
write('apps/extension/src/popup.css', popupCss);

console.log(JSON.stringify({
  ok: true,
  changed: [
    'apps/extension/src/shared/reversible-renderer.js',
    'apps/extension/src/content.css',
    'apps/extension/src/popup.css'
  ]
}));
