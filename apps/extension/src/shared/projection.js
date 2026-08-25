(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloProjection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function stableHash(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function isLanguageAllowed(token, mode) {
    if (mode === 'en') return token.lang === 'en';
    if (mode === 'zh') return token.lang === 'zh';
    return token.lang === 'en' || token.lang === 'zh';
  }

  function createMarkingPlan(tokens, profile) {
    const source = Array.isArray(tokens) ? tokens : [];
    const p = profile || {};
    const hasVisibleChannel = Boolean(p.posLabels || p.posColors);
    const eligible = [];

    source.forEach((token, index) => {
      const confidence = Number(token.confidence || 0);
      const knownPos = token.pos && token.pos !== 'x';
      if (hasVisibleChannel && knownPos && confidence >= Number(p.minConfidence || 0) && isLanguageAllowed(token, p.languageMode || 'both')) {
        eligible.push({
          index,
          priority: Number.isFinite(Number(token.priority)) ? Number(token.priority) : 0.5,
          hash: stableHash(`${token.lang}|${token.text}|${token.start}|${token.end}`)
        });
      }
    });

    eligible.sort((a, b) => b.priority - a.priority || a.hash - b.hash || a.index - b.index);
    const density = Math.min(1, Math.max(0, Number.isFinite(Number(p.density)) ? Number(p.density) : 1));
    const targetCount = density <= 0 ? 0 : Math.min(eligible.length, Math.ceil(eligible.length * density));
    const selected = new Set(eligible.slice(0, targetCount).map((item) => item.index));

    return source.map((token, index) => {
      const marked = selected.has(index);
      return Object.freeze({
        ...token,
        marked,
        label: marked && p.posLabels ? token.pos : null,
        colorClass: marked && p.posColors ? `halo-pos-${String(token.pos).replace(/[^a-z-]/g, '')}` : null,
        labelPosition: p.labelPosition || 'top-right'
      });
    });
  }

  return Object.freeze({ createMarkingPlan, stableHash });
});
