(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloContent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'CODE', 'PRE', 'KBD', 'SAMP', 'BUTTON', 'SVG', 'MATH'
  ]);

  function buildSegments(text, renderPlan) {
    const source = String(text || '');
    const marked = (Array.isArray(renderPlan) ? renderPlan : [])
      .filter((item) => item && item.marked && Number.isInteger(item.start) && Number.isInteger(item.end))
      .filter((item) => item.start >= 0 && item.end <= source.length && item.end > item.start)
      .sort((a, b) => a.start - b.start || a.end - b.end);

    const out = [];
    let cursor = 0;
    for (const item of marked) {
      if (item.start < cursor) continue;
      if (item.start > cursor) out.push({ text: source.slice(cursor, item.start), marked: false });
      out.push({
        text: source.slice(item.start, item.end),
        marked: true,
        pos: item.pos,
        label: item.label,
        colorClass: item.colorClass,
        labelPosition: item.labelPosition,
        confidence: item.confidence,
        source: item.source
      });
      cursor = item.end;
    }
    if (cursor < source.length) out.push({ text: source.slice(cursor), marked: false });
    if (!out.length && source) out.push({ text: source, marked: false });
    return out;
  }

  function shouldSkipElement(element) {
    if (!element || element.nodeType !== 1) return false;
    if (SKIP_TAGS.has(element.tagName)) return true;
    if (element.closest('[data-halo-token="1"]')) return true;
    if (element.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"]')) return true;
    if (element.closest('nav, [aria-hidden="true"]')) return true;
    return false;
  }

  function initBrowser() {
    if (!root.document || !root.chrome || !root.chrome.runtime) return;
    if (root.__HALO_CONTENT_INITIALIZED__) return;
    root.__HALO_CONTENT_INITIALIZED__ = true;

    let lastStatus = Object.freeze({ active: false, textNodesVisited: 0, markedTokens: 0, lastError: null });

    function isVisible(element) {
      if (!element || !root.getComputedStyle) return true;
      const style = root.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function eligibleTextNode(node) {
      if (!node || !node.parentElement) return false;
      if (shouldSkipElement(node.parentElement)) return false;
      const text = node.nodeValue || '';
      if (!/[A-Za-z\p{Script=Han}]/u.test(text)) return false;
      if (!text.trim()) return false;
      return isVisible(node.parentElement);
    }

    function collectTextNodes(maxTextNodes) {
      const nodes = [];
      const walker = root.document.createTreeWalker(
        root.document.body || root.document.documentElement,
        root.NodeFilter.SHOW_TEXT,
        { acceptNode: (node) => eligibleTextNode(node) ? root.NodeFilter.FILTER_ACCEPT : root.NodeFilter.FILTER_REJECT }
      );
      let node;
      while ((node = walker.nextNode()) && nodes.length < maxTextNodes) nodes.push(node);
      return nodes;
    }

    function removeMarking() {
      const parents = new Set();
      const markedNodes = Array.from(root.document.querySelectorAll('[data-halo-token="1"]'));
      for (const span of markedNodes) {
        const parent = span.parentNode;
        if (!parent) continue;
        parents.add(parent);
        parent.replaceChild(root.document.createTextNode(span.dataset.haloOriginal || span.textContent || ''), span);
      }
      for (const parent of parents) if (typeof parent.normalize === 'function') parent.normalize();
      lastStatus = Object.freeze({ active: false, textNodesVisited: 0, markedTokens: 0, lastError: null });
      return lastStatus;
    }

    function spanFor(segment) {
      const span = root.document.createElement('span');
      span.dataset.haloToken = '1';
      span.dataset.haloOriginal = segment.text;
      if (segment.pos) span.dataset.haloSemanticPos = segment.pos;
      if (segment.label) span.dataset.haloPos = segment.label;
      if (Number.isFinite(segment.confidence)) span.dataset.haloConfidence = String(segment.confidence);
      span.className = 'halo-token';
      if (segment.label) span.classList.add(`halo-label-${segment.labelPosition || 'top-right'}`);
      if (segment.colorClass) span.classList.add(segment.colorClass);
      span.textContent = segment.text;
      return span;
    }

    function replaceTextNode(node, segments) {
      if (!segments.some((segment) => segment.marked)) return 0;
      const fragment = root.document.createDocumentFragment();
      let count = 0;
      for (const segment of segments) {
        if (segment.marked) {
          fragment.appendChild(spanFor(segment));
          count += 1;
        } else if (segment.text) {
          fragment.appendChild(root.document.createTextNode(segment.text));
        }
      }
      node.parentNode.replaceChild(fragment, node);
      return count;
    }

    function applyMarking(rawSettings) {
      try {
        const Settings = root.HaloSettings;
        const Linguistics = root.HaloLinguistics;
        const Projection = root.HaloProjection;
        if (!Settings || !Linguistics || !Projection) throw new Error('Halo shared modules are not loaded');
        const settings = Settings.normalizeSettings(rawSettings);
        removeMarking();
        if (!settings.enabled) return lastStatus;

        const textNodes = collectTextNodes(settings.maxTextNodes);
        let markedTokens = 0;
        for (const node of textNodes) {
          if (markedTokens >= settings.maxMarkedTokens) break;
          const text = node.nodeValue || '';
          const semanticTokens = Linguistics.tokenize(text, settings.languageMode);
          if (!semanticTokens.length) continue;
          let plan = Projection.createMarkingPlan(semanticTokens, settings);
          const remaining = settings.maxMarkedTokens - markedTokens;
          if (plan.filter((item) => item.marked).length > remaining) {
            let used = 0;
            plan = plan.map((item) => {
              if (!item.marked) return item;
              if (used < remaining) { used += 1; return item; }
              return { ...item, marked: false, label: null, colorClass: null };
            });
          }
          markedTokens += replaceTextNode(node, buildSegments(text, plan));
        }
        lastStatus = Object.freeze({
          active: markedTokens > 0,
          textNodesVisited: textNodes.length,
          markedTokens,
          lastError: null
        });
        return lastStatus;
      } catch (error) {
        lastStatus = Object.freeze({ active: false, textNodesVisited: 0, markedTokens: 0, lastError: String(error && error.message ? error.message : error) });
        return lastStatus;
      }
    }

    root.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || !message.type) return false;
      if (message.type === 'HALO_APPLY_MARKING') {
        sendResponse(applyMarking(message.settings || {}));
        return false;
      }
      if (message.type === 'HALO_REMOVE_MARKING') {
        sendResponse(removeMarking());
        return false;
      }
      if (message.type === 'HALO_STATUS') {
        sendResponse(lastStatus);
        return false;
      }
      return false;
    });
  }

  initBrowser();
  return Object.freeze({ buildSegments, shouldSkipElement });
});
