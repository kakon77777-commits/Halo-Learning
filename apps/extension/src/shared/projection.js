(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloProjection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DECORATION_NAMES = Object.freeze([
    'posLabel',
    'posColor',
    'lemma',
    'morphology',
    'glossHint',
    'grammarRole',
    'tenseAspect',
    'chunk',
    'learningState'
  ]);

  function stableHash(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function tokenSurface(token) {
    return String(token.surface === undefined ? (token.text || '') : token.surface);
  }

  function tokenLanguage(token) {
    const language = token.language || token.lang;
    return language === 'zh' ? 'zh-Hant' : language;
  }

  function tokenPos(token) {
    return token.simplifiedPos || token.pos || 'x';
  }

  function channelsFor(profile) {
    if (profile && profile.channels) return profile.channels;
    return Object.freeze({
      posLabel: Boolean(profile && profile.posLabels),
      posColor: Boolean(profile && profile.posColors),
      lemma: false,
      morphology: false,
      glossHint: false,
      grammarRole: false,
      tenseAspect: false,
      chunk: false,
      learningState: false
    });
  }

  function isLanguageAllowed(token, mode) {
    const language = tokenLanguage(token);
    if (mode === 'en') return language === 'en';
    if (mode === 'zh-Hant' || mode === 'zh') return language === 'zh-Hant';
    return language === 'en' || language === 'zh-Hant';
  }

  function annotationForType(token, type) {
    if (!Array.isArray(token.annotations)) return null;
    return token.annotations.find((value) => value && value.type === type) || null;
  }

  function equivalentValue(left, right) {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) || Array.isArray(right)) {
      return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
        left.every((value, index) => equivalentValue(value, right[index]));
    }
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && equivalentValue(left[key], right[key]));
  }

  function annotationValue(token, type) {
    const annotation = annotationForType(token, type);
    return annotation ? annotation.value : null;
  }

  function evidenceConfidence(token, type, expectedValue) {
    const sameType = annotationForType(token, type);
    const annotation = Array.isArray(token.annotations)
      ? token.annotations.find((value) => value && value.type === type && equivalentValue(value.value, expectedValue))
      : null;
    const annotationConfidence = annotation ? Number(annotation.confidence) : NaN;
    if (Number.isFinite(annotationConfidence)) return Math.min(1, Math.max(0, annotationConfidence));
    if (sameType || (token && token.schemaVersion === 1)) return -1;
    const tokenConfidence = Number(token.confidence);
    return Number.isFinite(tokenConfidence) ? Math.min(1, Math.max(0, tokenConfidence)) : 0;
  }

  function blankDecorations() {
    return {
      posLabel: null,
      posColor: null,
      lemma: null,
      morphology: null,
      glossHint: null,
      grammarRole: null,
      tenseAspect: null,
      chunk: null,
      learningState: null
    };
  }

  function decorationCandidates(token, channels, minimumConfidence) {
    const result = blankDecorations();
    const confidences = [];
    function add(channel, value, annotationType) {
      const confidence = evidenceConfidence(token, annotationType, value);
      if (confidence < minimumConfidence) return;
      result[channel] = value;
      confidences.push(confidence);
    }
    const pos = tokenPos(token);
    const knownPos = pos && pos !== 'x';
    if (channels.posLabel && knownPos) add('posLabel', pos, 'simplified-pos');
    if (channels.posColor && result.posLabel) {
      result.posColor = `halo-pos-${String(pos).replace(/[^a-z-]/g, '')}`;
      confidences.push(evidenceConfidence(token, 'simplified-pos', pos));
    }
    if (channels.lemma && typeof token.lemma === 'string' && token.lemma) add('lemma', token.lemma, 'lemma');
    if (channels.morphology && token.morphology && typeof token.morphology === 'object') {
      add('morphology', token.morphology, 'morphology');
    }
    const gloss = annotationValue(token, 'gloss');
    if (channels.glossHint && typeof gloss === 'string' && gloss) add('glossHint', gloss, 'gloss');
    if (channels.grammarRole && typeof token.grammarRole === 'string' && token.grammarRole) {
      add('grammarRole', token.grammarRole, 'grammar-role');
    }
    if (channels.tenseAspect && typeof token.tenseAspect === 'string' && token.tenseAspect) {
      add('tenseAspect', token.tenseAspect, 'tense-aspect');
    }
    const chunk = annotationValue(token, 'chunk');
    if (channels.chunk && chunk && typeof chunk === 'object') add('chunk', chunk, 'chunk');
    const learningState = annotationValue(token, 'learning-state');
    if (channels.learningState && learningState !== null) add('learningState', learningState, 'learning-state');
    return Object.freeze({
      decorations: Object.freeze(result),
      confidence: confidences.length ? Math.min(...confidences) : 0
    });
  }

  function hasDecoration(decorations) {
    return DECORATION_NAMES.some((name) => decorations[name] !== null);
  }

  function formatMorphology(value) {
    if (!value || typeof value !== 'object') return null;
    return value.form || value.tense || value.degree || Object.values(value).join(' ');
  }

  function metaLabel(decorations) {
    const parts = [];
    if (decorations.lemma) parts.push(`lemma: ${decorations.lemma}`);
    if (decorations.morphology) parts.push(`morph: ${formatMorphology(decorations.morphology)}`);
    if (decorations.grammarRole) parts.push(`role: ${decorations.grammarRole}`);
    if (decorations.tenseAspect) parts.push(`tense: ${decorations.tenseAspect}`);
    if (decorations.chunk) parts.push(`chunk: ${decorations.chunk.type || 'structure'}`);
    if (decorations.learningState) parts.push(`learning: ${String(decorations.learningState)}`);
    return parts.length ? parts.join(' · ') : null;
  }

  function planItem(token, marked, candidateSet, profile) {
    const decorations = Object.freeze(marked ? { ...candidateSet.decorations } : blankDecorations());
    const surface = tokenSurface(token);
    const pos = tokenPos(token);
    return Object.freeze({
      semanticTokenId: token.tokenId || null,
      text: surface,
      surface,
      start: token.start,
      end: token.end,
      language: tokenLanguage(token),
      lang: tokenLanguage(token) === 'zh-Hant' ? 'zh' : tokenLanguage(token),
      simplifiedPos: pos,
      pos,
      confidence: candidateSet.confidence,
      priority: Number.isFinite(Number(token.priority)) ? Number(token.priority) : 0.5,
      marked,
      decorations,
      label: decorations.posLabel,
      colorClass: decorations.posColor,
      labelPosition: profile.labelPosition || 'top-right',
      metaLabel: marked ? metaLabel(decorations) : null,
      glossHint: marked ? decorations.glossHint : null,
      chunkClass: marked && decorations.chunk ? 'halo-structure-chunk' : null
    });
  }

  function createMarkingPlan(tokens, profile) {
    const source = Array.isArray(tokens) ? tokens : [];
    const normalizedProfile = profile || {};
    const channels = channelsFor(normalizedProfile);
    const rawMinimumConfidence = Number(normalizedProfile.minConfidence);
    const minimumConfidence = Number.isFinite(rawMinimumConfidence)
      ? Math.min(1, Math.max(0, rawMinimumConfidence))
      : 0;
    const eligible = [];
    const candidates = source.map((token, index) => {
      const candidateSet = decorationCandidates(token, channels, minimumConfidence);
      if (hasDecoration(candidateSet.decorations) &&
          isLanguageAllowed(token, normalizedProfile.languageMode || 'both')) {
        eligible.push({
          index,
          priority: Number.isFinite(Number(token.priority)) ? Number(token.priority) : 0.5,
          hash: stableHash(`${tokenLanguage(token)}|${tokenSurface(token)}|${token.start}|${token.end}`)
        });
      }
      return candidateSet;
    });

    eligible.sort((left, right) => right.priority - left.priority || left.hash - right.hash || left.index - right.index);
    const densityValue = Number(normalizedProfile.density);
    const density = Math.min(1, Math.max(0, Number.isFinite(densityValue) ? densityValue : 1));
    const targetCount = density <= 0 ? 0 : Math.min(eligible.length, Math.ceil(eligible.length * density));
    const selected = new Set(eligible.slice(0, targetCount).map((item) => item.index));
    return Object.freeze(source.map((token, index) => planItem(
      token,
      selected.has(index),
      candidates[index],
      normalizedProfile
    )));
  }

  return Object.freeze({ DECORATION_NAMES, createMarkingPlan, stableHash });
});
