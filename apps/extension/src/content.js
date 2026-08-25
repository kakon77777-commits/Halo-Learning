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
      .sort((left, right) => left.start - right.start || left.end - right.end);

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
        metaLabel: item.metaLabel,
        glossHint: item.glossHint,
        chunkClass: item.chunkClass
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

  function bootstrapAnnotationSets(texts, settings, Dictionary, Semantic, generatedAt) {
    if (!Dictionary || typeof Dictionary.createBootstrapDictionaryProvider !== 'function') {
      throw new TypeError('Dictionary bootstrap provider is unavailable');
    }
    if (!Semantic || typeof Semantic.createSemanticEngine !== 'function') {
      throw new TypeError('Semantic engine is unavailable');
    }
    const provider = Dictionary.createBootstrapDictionaryProvider();
    const engine = Semantic.createSemanticEngine({ provider });
    return Object.freeze((Array.isArray(texts) ? texts : []).map((text) => engine.annotateText(text, {
      languageMode: settings && settings.languageMode ? settings.languageMode : 'both',
      generatedAt
    })));
  }

  function initBrowser() {
    if (!root.document || !root.chrome || !root.chrome.runtime) return;
    if (root.__HALO_CONTENT_INITIALIZED__) return;
    root.__HALO_CONTENT_INITIALIZED__ = true;

    const emptyStatus = () => Object.freeze({
      active: false,
      textNodesVisited: 0,
      semanticTokens: 0,
      markedTokens: 0,
      providerMode: null,
      lastError: null
    });
    let lastStatus = emptyStatus();
    let lastAnnotationSets = Object.freeze([]);

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

    function isSensitivePage() {
      const location = root.location;
      if (!location || !['http:', 'https:'].includes(location.protocol)) return true;
      if (/(?:^|\/)(?:login|signin|sign-in|auth|checkout|payment|banking)(?:\/|$)/i.test(location.pathname || '')) {
        return true;
      }
      return Boolean(root.document.querySelector(
        'input[type="password"], input[autocomplete="current-password"], input[autocomplete="new-password"], input[autocomplete="one-time-code"]'
      ));
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
      lastAnnotationSets = Object.freeze([]);
      lastStatus = emptyStatus();
      return lastStatus;
    }

    function spanFor(segment) {
      const span = root.document.createElement('span');
      span.dataset.haloToken = '1';
      span.dataset.haloOriginal = segment.text;
      if (segment.label) span.dataset.haloPos = segment.label;
      if (segment.metaLabel) span.dataset.haloMeta = segment.metaLabel;
      if (segment.glossHint) {
        span.dataset.haloGloss = segment.glossHint;
        span.title = segment.glossHint;
      }
      if (Number.isFinite(segment.confidence)) span.dataset.haloConfidence = String(segment.confidence);
      span.className = 'halo-token';
      if (segment.label) span.classList.add(`halo-label-${segment.labelPosition || 'top-right'}`);
      if (segment.metaLabel) span.classList.add('halo-has-meta');
      if (segment.colorClass) span.classList.add(segment.colorClass);
      if (segment.chunkClass) span.classList.add(segment.chunkClass);
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

    function unmarkPlanItem(item) {
      const decorations = {};
      for (const name of Object.keys(item.decorations || {})) decorations[name] = null;
      return Object.freeze({
        ...item,
        marked: false,
        decorations: Object.freeze(decorations),
        label: null,
        colorClass: null,
        metaLabel: null,
        glossHint: null,
        chunkClass: null
      });
    }

    function capPlan(plan, remaining) {
      let used = 0;
      return plan.map((item) => {
        if (!item.marked) return item;
        if (used < remaining) {
          used += 1;
          return item;
        }
        return unmarkPlanItem(item);
      });
    }

    async function requestAnnotations(texts, settings, Dictionary, Semantic) {
      const generatedAt = new Date().toISOString();
      try {
        const response = await root.chrome.runtime.sendMessage({
          type: 'HALO_ANNOTATE_BATCH',
          texts,
          options: {
            languageMode: settings.languageMode,
            generatedAt
          }
        });
        if (!response || response.error || !Array.isArray(response.annotationSets) || response.annotationSets.length !== texts.length) {
          throw new Error('Local semantic service returned an invalid response');
        }
        return Object.freeze({
          annotationSets: Object.freeze(response.annotationSets),
          providerMode: response.status && response.status.mode ? response.status.mode : 'ready'
        });
      } catch (_error) {
        return Object.freeze({
          annotationSets: bootstrapAnnotationSets(texts, settings, Dictionary, Semantic, generatedAt),
          providerMode: 'content-bootstrap'
        });
      }
    }

    async function applyMarking(rawSettings) {
      try {
        const Settings = root.HaloSettings;
        const Dictionary = root.HaloDictionary;
        const Semantic = root.HaloSemanticAnnotations;
        const Projection = root.HaloProjection;
        if (!Settings || !Dictionary || !Semantic || !Projection) throw new Error('Halo shared modules are not loaded');
        const settings = Settings.normalizeSettings(rawSettings);
        removeMarking();
        if (!settings.enabled) return lastStatus;
        if (isSensitivePage()) {
          lastStatus = Object.freeze({ ...emptyStatus(), lastError: 'SENSITIVE_PAGE_BLOCKED' });
          return lastStatus;
        }

        const textNodes = collectTextNodes(settings.maxTextNodes);
        const texts = textNodes.map((node) => node.nodeValue || '');
        const result = await requestAnnotations(texts, settings, Dictionary, Semantic);
        lastAnnotationSets = result.annotationSets;
        let markedTokens = 0;
        let semanticTokens = 0;
        for (let index = 0; index < textNodes.length; index += 1) {
          if (markedTokens >= settings.maxMarkedTokens) break;
          const node = textNodes[index];
          const text = texts[index];
          const semanticSet = result.annotationSets[index];
          const semanticValues = semanticSet && Array.isArray(semanticSet.tokens) ? semanticSet.tokens : [];
          semanticTokens += semanticValues.length;
          if (!semanticValues.length) continue;
          let plan = Projection.createMarkingPlan(semanticValues, settings);
          const remaining = settings.maxMarkedTokens - markedTokens;
          if (plan.filter((item) => item.marked).length > remaining) plan = capPlan(plan, remaining);
          markedTokens += replaceTextNode(node, buildSegments(text, plan));
        }
        lastStatus = Object.freeze({
          active: markedTokens > 0,
          textNodesVisited: textNodes.length,
          semanticTokens,
          markedTokens,
          providerMode: result.providerMode,
          lastError: null
        });
        return lastStatus;
      } catch (_error) {
        lastStatus = Object.freeze({ ...emptyStatus(), lastError: 'LOCAL_MARKING_ERROR' });
        return lastStatus;
      }
    }

    root.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || !message.type) return false;
      if (message.type === 'HALO_APPLY_MARKING') {
        applyMarking(message.settings || {}).then((status) => sendResponse(status));
        return true;
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
  return Object.freeze({ bootstrapAnnotationSets, buildSegments, shouldSkipElement });
});
