(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloSentencePipeline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const FILTERED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'TEMPLATE', 'PRE', 'CODE', 'KBD', 'SAMP', 'BUTTON', 'SVG', 'MATH'
  ]);
  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIALOG',
    'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN',
    'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH',
    'THEAD', 'TR', 'UL'
  ]);
  const SENTENCE_TERMINATORS = new Set(['.', '!', '?', '\u3002', '\uff01', '\uff1f']);
  const SENTENCE_CLOSERS = new Set([
    '"', "'", '\u2019', '\u201d', ')', ']', '}', '\u3009', '\u300b', '\u300d',
    '\u300f', '\u3011', '\u3015', '\u3017', '\u3019', '\u301b'
  ]);
  const SENSITIVE_AUTOCOMPLETE = new Set([
    'current-password', 'new-password', 'one-time-code', 'cc-number', 'cc-csc',
    'cc-exp', 'cc-exp-month', 'cc-exp-year'
  ]);
  const SENSITIVE_ATTRIBUTE_PATTERN = /(?:password|passcode|one[-_ ]?time|\botp\b|credit[-_ ]?card|card[-_ ]?number|\bcvv\b|\bcvc\b|security[-_ ]?code|client[-_ ]?secret|api[-_ ]?key)/i;

  function freezeArray(values) {
    return Object.freeze(values);
  }

  function attribute(element, name) {
    if (!element || typeof element.getAttribute !== 'function') return null;
    return element.getAttribute(name);
  }

  function hasAttribute(element, name) {
    return Boolean(element && typeof element.hasAttribute === 'function' && element.hasAttribute(name));
  }

  function normalizedAttribute(element, name) {
    const value = attribute(element, name);
    return value === null ? null : String(value).trim().toLowerCase();
  }

  function hasTokenMarker(element) {
    return normalizedAttribute(element, 'data-halo-owned') === 'token' ||
      normalizedAttribute(element, 'data-halo-token') === '1';
  }

  function privatelyOwnsToken(element, options) {
    return Boolean(hasTokenMarker(element) && typeof options.ownsToken === 'function' && options.ownsToken(element));
  }

  function isHaloOwned(element, options) {
    if (hasTokenMarker(element)) return privatelyOwnsToken(element, options);
    return hasAttribute(element, 'data-halo-token') ||
      hasAttribute(element, 'data-halo-owned') ||
      hasAttribute(element, 'data-halo-ui') ||
      normalizedAttribute(element, 'data-halo-owner') === 'halo-learning';
  }

  function isRemappableHaloToken(element, options) {
    return privatelyOwnsToken(element, options);
  }

  function isEditable(element) {
    const editable = normalizedAttribute(element, 'contenteditable');
    return editable !== null && editable !== 'false';
  }

  function styleHidesElement(element, options) {
    if (typeof options.isVisible === 'function' && !options.isVisible(element)) return true;
    const view = element && element.ownerDocument && element.ownerDocument.defaultView;
    if (!view || typeof view.getComputedStyle !== 'function') return false;
    const style = view.getComputedStyle(element);
    if (!style) return false;
    const opacity = Number.parseFloat(style.opacity);
    const contentVisibility = String(
      style.contentVisibility ||
      (typeof style.getPropertyValue === 'function' ? style.getPropertyValue('content-visibility') : '')
    ).trim().toLowerCase();
    return style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      contentVisibility === 'hidden' ||
      (Number.isFinite(opacity) && opacity === 0);
  }

  function isStructurallyHidden(element, options) {
    return hasAttribute(element, 'hidden') ||
      normalizedAttribute(element, 'aria-hidden') === 'true' ||
      styleHidesElement(element, options);
  }

  function elementHasSensitiveMarker(element) {
    if (!element || element.nodeType !== 1) return false;
    const tagName = String(element.tagName || '').toUpperCase();
    if (tagName === 'INPUT' && normalizedAttribute(element, 'type') === 'password') return true;
    const autocomplete = normalizedAttribute(element, 'autocomplete');
    if (autocomplete) {
      for (const token of autocomplete.split(/\s+/)) {
        if (SENSITIVE_AUTOCOMPLETE.has(token)) return true;
      }
    }
    if (normalizedAttribute(element, 'data-sensitive') === 'true' ||
        normalizedAttribute(element, 'data-private') === 'true') return true;
    const role = normalizedAttribute(element, 'role');
    const formAssociated = ['FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON'].includes(tagName) ||
      role === 'form' || role === 'textbox';
    if (!formAssociated) return false;
    for (const name of ['name', 'id', 'aria-label', 'action']) {
      const value = attribute(element, name);
      if (value !== null && SENSITIVE_ATTRIBUTE_PATTERN.test(String(value))) return true;
    }
    return false;
  }

  function subtreeHasSensitiveMarker(element, cache) {
    if (!element || element.nodeType !== 1) return false;
    if (cache.has(element)) return cache.get(element);
    let sensitive = elementHasSensitiveMarker(element);
    if (!sensitive) {
      for (const child of element.childNodes || []) {
        if (child && child.nodeType === 1 && subtreeHasSensitiveMarker(child, cache)) {
          sensitive = true;
          break;
        }
      }
    }
    cache.set(element, sensitive);
    return sensitive;
  }

  function unsuitableElement(element, options, sensitiveCache, structurallyHidden) {
    const tagName = String(element.tagName || '').toUpperCase();
    const namespace = String(element.namespaceURI || '').toLowerCase();
    if (FILTERED_TAGS.has(tagName) || namespace.includes('svg') || namespace.includes('mathml')) return true;
    if (tagName === 'NAV' || normalizedAttribute(element, 'role') === 'navigation') return true;
    if (normalizedAttribute(element, 'role') === 'textbox') return true;
    if (structurallyHidden || hasAttribute(element, 'inert')) return true;
    if (isEditable(element) || (isHaloOwned(element, options) && !isRemappableHaloToken(element, options))) return true;
    if (elementHasSensitiveMarker(element)) return true;
    if ((tagName === 'FORM' || normalizedAttribute(element, 'role') === 'form') &&
        subtreeHasSensitiveMarker(element, sensitiveCache)) return true;
    return styleHidesElement(element, options);
  }

  function createTextRuns(rootNode, options) {
    const settings = options || {};
    if (!rootNode || ![1, 9, 11].includes(rootNode.nodeType)) {
      throw new TypeError('TextRun root must be an Element, Document, or DocumentFragment');
    }
    const rootRevision = Number.isInteger(settings.rootRevision) ? settings.rootRevision : 0;
    const getNodeId = typeof settings.getNodeId === 'function'
      ? settings.getNodeId
      : (_node, index) => `run-${index}`;
    const sensitiveCache = new WeakMap();
    const runs = [];
    let cursor = 0;
    let pendingBoundary = '';

    function requestBoundary(preserveMultiple) {
      if (runs.length === 0) return;
      if (preserveMultiple) pendingBoundary += '\n';
      else if (!pendingBoundary) pendingBoundary = '\n';
    }

    function appendTextNode(node) {
      const source = node.nodeValue;
      if (typeof source !== 'string' || source.length === 0) return;
      const boundaryBefore = pendingBoundary;
      pendingBoundary = '';
      cursor += boundaryBefore.length;
      const nodeIdValue = getNodeId(node, runs.length);
      const nodeId = nodeIdValue === undefined || nodeIdValue === null
        ? `run-${runs.length}`
        : String(nodeIdValue);
      const start = cursor;
      cursor += source.length;
      runs.push(Object.freeze({
        node,
        nodeId,
        text: source,
        start,
        end: cursor,
        boundaryBefore,
        rootRevision
      }));
    }

    function visit(node, isRoot) {
      if (!node) return;
      if (node.nodeType === 3) {
        appendTextNode(node);
        return;
      }
      if (![1, 9, 11].includes(node.nodeType)) return;
      const isElement = node.nodeType === 1;
      const tagName = isElement ? String(node.tagName || '').toUpperCase() : '';
      const isBlock = isElement && BLOCK_TAGS.has(tagName);
      const structurallyHidden = isElement && isStructurallyHidden(node, settings);
      if (isElement && unsuitableElement(node, settings, sensitiveCache, structurallyHidden)) {
        if (isBlock && !isRoot && !structurallyHidden) requestBoundary(true);
        return;
      }
      if (tagName === 'BR') {
        requestBoundary(true);
        return;
      }

      const runCountBefore = runs.length;
      const boundaryBefore = pendingBoundary;
      if (isBlock && !isRoot) requestBoundary();
      for (const child of node.childNodes || []) visit(child, false);
      if (isBlock && !isRoot) {
        if (runs.length === runCountBefore && pendingBoundary.length === boundaryBefore.length) {
          requestBoundary(true);
        } else if (runs.length !== runCountBefore) {
          requestBoundary();
        }
      }
    }

    visit(rootNode, true);
    return freezeArray(runs);
  }

  function normalizedSentence(source, start, end) {
    let left = start;
    let right = end;
    while (left < right && /\s/u.test(source[left])) left += 1;
    while (right > left && /\s/u.test(source[right - 1])) right -= 1;
    if (right <= left) return null;
    return Object.freeze({ text: source.slice(left, right), start: left, end: right });
  }

  function fallbackSentenceSegments(source) {
    const out = [];
    let sentenceStart = 0;

    function append(end) {
      const sentence = normalizedSentence(source, sentenceStart, end);
      if (sentence) out.push(sentence);
      sentenceStart = end;
    }

    let index = 0;
    while (index < source.length) {
      const character = source[index];
      if (character === '\r' || character === '\n') {
        append(index);
        if (character === '\r' && source[index + 1] === '\n') index += 1;
        index += 1;
        sentenceStart = index;
        continue;
      }
      if (!SENTENCE_TERMINATORS.has(character)) {
        index += 1;
        continue;
      }
      let end = index + 1;
      while (end < source.length && SENTENCE_TERMINATORS.has(source[end])) end += 1;
      while (end < source.length && SENTENCE_CLOSERS.has(source[end])) end += 1;
      append(end);
      index = end;
    }
    append(source.length);
    return freezeArray(out);
  }

  function intlSentenceSegments(source, options) {
    const locale = typeof options.locale === 'string' && options.locale ? options.locale : 'zh-Hant';
    const Segmenter = options.Segmenter || (root.Intl && root.Intl.Segmenter);
    if (typeof Segmenter !== 'function') return null;
    const segmenter = new Segmenter(locale, { granularity: 'sentence' });
    const out = [];
    for (const part of segmenter.segment(source)) {
      const rawStart = part.index;
      const rawEnd = rawStart + part.segment.length;
      let chunkStart = rawStart;
      for (let index = rawStart; index < rawEnd; index += 1) {
        if (source[index] !== '\r' && source[index] !== '\n') continue;
        const sentence = normalizedSentence(source, chunkStart, index);
        if (sentence) out.push(sentence);
        if (source[index] === '\r' && source[index + 1] === '\n') index += 1;
        chunkStart = index + 1;
      }
      const sentence = normalizedSentence(source, chunkStart, rawEnd);
      if (sentence) out.push(sentence);
    }
    return freezeArray(out);
  }

  function segmentSentences(text, options) {
    const source = String(text || '');
    if (!source) return freezeArray([]);
    const settings = options || {};
    if (!settings.forceFallback) {
      try {
        const segmented = intlSentenceSegments(source, settings);
        if (segmented) return segmented;
      } catch {
        // Unsupported locale or Segmenter implementation: use the tested local fallback.
      }
    }
    return fallbackSentenceSegments(source);
  }

  function detectLanguage(text) {
    const source = String(text || '');
    const hasEnglish = /[A-Za-z]/.test(source);
    const hasChinese = /\p{Script=Han}/u.test(source);
    if (hasEnglish && hasChinese) return 'both';
    if (hasChinese) return 'zh-Hant';
    if (hasEnglish) return 'en';
    return 'unknown';
  }

  function validateRuns(runs) {
    if (!Array.isArray(runs)) throw new TypeError('TextRuns must be an array');
    let previousEnd = 0;
    for (const run of runs) {
      if (!run || typeof run.text !== 'string' ||
          !Number.isInteger(run.start) || !Number.isInteger(run.end) ||
          run.start < previousEnd || run.end < run.start ||
          run.end - run.start !== run.text.length) {
        throw new TypeError('TextRuns contain invalid UTF-16 offsets');
      }
      previousEnd = run.end;
    }
    return previousEnd;
  }

  function mapAggregateSpanToFragments(runs, start, end) {
    const aggregateEnd = validateRuns(runs);
    if (!Number.isInteger(start) || !Number.isInteger(end) ||
        start < 0 || end < start || end > aggregateEnd) {
      throw new RangeError('Aggregate span is outside the TextRun UTF-16 range');
    }
    const fragments = [];
    for (const run of runs) {
      const left = Math.max(start, run.start);
      const right = Math.min(end, run.end);
      if (right <= left) continue;
      const fragment = {
        nodeId: run.nodeId,
        start: left - run.start,
        end: right - run.start
      };
      if (run.node !== undefined && run.node !== null) fragment.node = run.node;
      fragments.push(Object.freeze(fragment));
    }
    return freezeArray(fragments);
  }

  function aggregateText(runs) {
    let source = '';
    for (const run of runs) {
      const boundary = typeof run.boundaryBefore === 'string' ? run.boundaryBefore : '';
      if (source.length + boundary.length !== run.start) {
        throw new TypeError('TextRun boundary does not match aggregate UTF-16 offset');
      }
      source += boundary + run.text;
    }
    return source;
  }

  function buildSentenceRecords(rootNode, options) {
    const settings = options || {};
    const runs = createTextRuns(rootNode, settings);
    const source = aggregateText(runs);
    const rootRevision = Number.isInteger(settings.rootRevision) ? settings.rootRevision : 0;
    const records = segmentSentences(source, settings).map((sentence) => {
      const fragments = mapAggregateSpanToFragments(runs, sentence.start, sentence.end)
        .map((fragment) => Object.freeze({
          nodeId: fragment.nodeId,
          start: fragment.start,
          end: fragment.end
        }));
      return Object.freeze({
        id: `${rootRevision}:${sentence.start}:${sentence.end}`,
        text: sentence.text,
        start: sentence.start,
        end: sentence.end,
        language: detectLanguage(sentence.text),
        rootRevision,
        fragments: freezeArray(fragments)
      });
    });
    return freezeArray(records);
  }

  return Object.freeze({
    createTextRuns,
    isRemappableHaloToken,
    segmentSentences,
    detectLanguage,
    mapAggregateSpanToFragments,
    buildSentenceRecords
  });
});
