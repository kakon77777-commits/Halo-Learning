(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloSemanticAnnotations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ENGINE = Object.freeze({ id: 'halo-semantic-engine', version: '0.3.0' });
  const ENGLISH_ALGORITHM = Object.freeze({ id: 'halo-english-semantic', version: '0.3.0' });
  const CHINESE_ALGORITHM = Object.freeze({ id: 'halo-zh-hant-semantic', version: '0.3.0' });
  const EMPTY = Object.freeze([]);
  const POS_PRIORITY = Object.freeze({
    det: 0.74,
    pron: 0.76,
    prep: 0.7,
    conj: 0.68,
    aux: 0.78,
    modal: 0.78,
    n: 0.85,
    v: 0.88,
    adj: 0.82,
    adv: 0.8,
    x: 0.1
  });
  const POS_ORDER = Object.freeze(['v', 'n', 'adj', 'adv', 'aux', 'modal', 'pron', 'det', 'prep', 'conj', 'x']);
  const CLOSED_CLASS_POS = Object.freeze(new Set(['det', 'pron', 'prep', 'conj', 'aux', 'modal']));

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }

  function stableHash(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function uniqueStrings(values) {
    return Object.freeze([...new Set((values || []).filter((value) => typeof value === 'string' && value))]);
  }

  function providerIdentity(provider) {
    return Object.freeze({
      id: typeof provider.id === 'string' && provider.id ? provider.id : 'dictionary-provider',
      version: typeof provider.version === 'string' && provider.version ? provider.version : 'unspecified'
    });
  }

  function providerEntries(provider, surface, language) {
    if (typeof provider.lookupAll === 'function') {
      const values = provider.lookupAll(surface, language);
      return Array.isArray(values) ? values : EMPTY;
    }
    const value = provider.lookup(surface, language);
    return value ? [value] : EMPTY;
  }

  function normalizedEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const simplifiedPos = raw.simplifiedPos || raw.pos || 'x';
    const confidenceValue = raw.posConfidence === undefined ? raw.confidence : raw.posConfidence;
    const confidence = Number.isFinite(Number(confidenceValue))
      ? Math.min(1, Math.max(0, Number(confidenceValue)))
      : 0;
    const surface = String(raw.surface || '');
    const lemma = String(raw.lemma || surface).trim();
    if (!surface || !lemma) return null;
    return Object.freeze({
      surface,
      lemma,
      simplifiedPos,
      confidence,
      lexicalRef: typeof raw.lexicalRef === 'string' && raw.lexicalRef ? raw.lexicalRef : null,
      glossRef: typeof raw.glossRef === 'string' && raw.glossRef ? raw.glossRef : null,
      gloss: typeof raw.gloss === 'string' && raw.gloss ? raw.gloss : null,
      traditional: typeof raw.traditional === 'string' && raw.traditional ? raw.traditional : surface,
      simplified: typeof raw.simplified === 'string' && raw.simplified ? raw.simplified : surface,
      pinyin: typeof raw.pinyin === 'string' && raw.pinyin ? raw.pinyin : null,
      datasetRef: raw.datasetRef && typeof raw.datasetRef === 'object'
        ? Object.freeze({ ...raw.datasetRef })
        : null,
      provenance: uniqueStrings([
        ...(Array.isArray(raw.provenance) ? raw.provenance : []),
        typeof raw.source === 'string' ? `source:${raw.source}` : null
      ])
    });
  }

  function compareAnalyses(left, right) {
    return right.confidence - left.confidence ||
      POS_ORDER.indexOf(left.entry.simplifiedPos) - POS_ORDER.indexOf(right.entry.simplifiedPos) ||
      String(left.entry.lexicalRef || '').localeCompare(String(right.entry.lexicalRef || ''), 'en');
  }

  function hasSentenceBoundary(text, previousEnd, nextStart) {
    return previousEnd !== null && /[.!?]/.test(text.slice(previousEnd, nextStart));
  }

  function contextualScore(analysis, state, nextAnalyses) {
    const entry = analysis.entry;
    const pos = entry.simplifiedPos;
    let score = analysis.confidence * 10;
    if (!entry.datasetRef && CLOSED_CLASS_POS.has(pos)) score += 100;
    if (state.previous) {
      const previousPos = state.previous.entry.simplifiedPos;
      if (previousPos === 'det') {
        if (pos === 'n') score += 12;
        else if (pos === 'adj') score += 10;
        else score -= 4;
      }
      if (previousPos === 'adj' && pos === 'n') score += 12;
      if (previousPos === 'aux' || previousPos === 'modal') {
        if (pos === 'v') score += 24;
        if (analysis.morphology && analysis.morphology.form === 'present-participle') score += 6;
      }
      if (!state.predicateSeen && ['n', 'pron'].includes(previousPos) && pos === 'v') score += 12;
    }
    if (state.predicateSeen) {
      if (pos === 'n' && analysis.morphology && analysis.morphology.form === 'plural') score += 20;
      if (pos === 'v' && analysis.morphology && analysis.morphology.form === 'third-person-singular') score -= 20;
    }
    if (state.previous && state.previous.entry.simplifiedPos === 'det' && pos === 'adj' &&
        nextAnalyses.some((candidate) => candidate.entry.simplifiedPos === 'n')) score += 8;
    if (state.predicateSeen && pos === 'adj' &&
        nextAnalyses.some((candidate) => candidate.entry.simplifiedPos === 'n')) score += 12;
    return score;
  }

  function selectEnglishAnalysis(analyses, state, nextAnalyses) {
    return [...analyses].sort((left, right) =>
      contextualScore(right, state, nextAnalyses) - contextualScore(left, state, nextAnalyses) ||
      compareAnalyses(left, right))[0];
  }

  function directAnalyses(provider, surface) {
    return providerEntries(provider, surface, 'en')
      .map(normalizedEntry)
      .filter(Boolean)
      .map((entry) => Object.freeze({
        entry,
        confidence: entry.confidence,
        source: entry.datasetRef ? 'verified-lexical-index' : 'bootstrap-lexicon',
        provenance: entry.provenance,
        morphology: null,
        morphologyDatasetRef: null
      }));
  }

  function regularCandidates(surface) {
    const lower = surface.toLocaleLowerCase('en-US');
    const candidates = [];
    function add(lemma, kind) {
      if (lemma && lemma !== lower && /^[a-z]+(?:['’][a-z]+)*$/.test(lemma)) candidates.push({ lemma, kind });
    }
    if (lower.length > 3 && lower.endsWith('ies')) add(`${lower.slice(0, -3)}y`, 's');
    if (lower.length > 3 && /(ches|shes|sses|xes|zes|oes)$/.test(lower)) add(lower.slice(0, -2), 's');
    if (lower.length > 2 && lower.endsWith('s') && !lower.endsWith('ss')) add(lower.slice(0, -1), 's');
    if (lower.length > 4 && lower.endsWith('ing')) {
      const stem = lower.slice(0, -3);
      add(stem, 'ing');
      add(`${stem}e`, 'ing');
      if (/([b-df-hj-np-tv-z])\1$/.test(stem)) add(stem.slice(0, -1), 'ing');
    }
    if (lower.length > 3 && lower.endsWith('ed')) {
      const stem = lower.slice(0, -2);
      add(stem, 'ed');
      add(`${stem}e`, 'ed');
      if (/([b-df-hj-np-tv-z])\1$/.test(stem)) add(stem.slice(0, -1), 'ed');
      if (lower.endsWith('ied')) add(`${lower.slice(0, -3)}y`, 'ed');
    }
    if (lower.length > 4 && lower.endsWith('est')) add(lower.slice(0, -3), 'est');
    if (lower.length > 3 && lower.endsWith('er')) add(lower.slice(0, -2), 'er');
    const seen = new Set();
    return candidates.filter((candidate) => {
      const key = `${candidate.lemma}\u0000${candidate.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function morphologyFor(kind, simplifiedPos) {
    if (kind === 's' && simplifiedPos === 'n') return Object.freeze({ form: 'plural', number: 'plural' });
    if (kind === 's' && simplifiedPos === 'v') {
      return Object.freeze({ form: 'third-person-singular', number: 'singular', person: 3, tense: 'present' });
    }
    if (kind === 'ing' && simplifiedPos === 'v') return Object.freeze({ form: 'present-participle' });
    if (kind === 'ed' && simplifiedPos === 'v') return Object.freeze({ form: 'past-or-participle' });
    if (kind === 'er' && simplifiedPos === 'adj') return Object.freeze({ degree: 'comparative', form: 'comparative' });
    if (kind === 'est' && simplifiedPos === 'adj') return Object.freeze({ degree: 'superlative', form: 'superlative' });
    return null;
  }

  function morphologyAnalyses(provider, surface) {
    const analyses = [];
    if (typeof provider.lookupMorphology === 'function') {
      const records = provider.lookupMorphology(surface, 'en');
      for (const record of Array.isArray(records) ? records : EMPTY) {
        for (const raw of providerEntries(provider, record.lemma, 'en')) {
          const entry = normalizedEntry(raw);
          if (!entry || entry.simplifiedPos !== record.simplifiedPos) continue;
          const morphology = entry.simplifiedPos === 'n'
            ? Object.freeze({ form: 'irregular', number: 'plural' })
            : Object.freeze({ form: 'irregular' });
          analyses.push(Object.freeze({
            entry,
            confidence: Math.min(entry.confidence, 0.96),
            source: 'wordnet-exception-morphology',
            provenance: uniqueStrings([...entry.provenance, `morphology-exception:${record.datasetRef.recordRef}`]),
            morphology,
            morphologyDatasetRef: record.datasetRef
          }));
        }
      }
    }
    for (const candidate of regularCandidates(surface)) {
      for (const raw of providerEntries(provider, candidate.lemma, 'en')) {
        const entry = normalizedEntry(raw);
        if (!entry) continue;
        const morphology = morphologyFor(candidate.kind, entry.simplifiedPos);
        if (!morphology) continue;
        analyses.push(Object.freeze({
          entry,
          confidence: Math.min(entry.confidence, 0.9),
          source: 'verified-regular-morphology',
          provenance: uniqueStrings([...entry.provenance, `regular-morphology:${candidate.kind}`]),
          morphology,
          morphologyDatasetRef: entry.datasetRef
        }));
      }
    }
    return analyses;
  }

  function annotationFor(context, type, value, confidence, source, datasetRef, provenance, index) {
    const annotation = {
      schemaVersion: 1,
      annotationId: `ann:${context.language}:${context.start}:${context.end}:${type}:${index}`,
      type,
      value,
      confidence,
      source,
      provider: context.provider,
      algorithm: context.algorithm || ENGLISH_ALGORITHM,
      generatedAt: context.generatedAt,
      provenance: uniqueStrings(provenance)
    };
    if (datasetRef) annotation.datasetRef = datasetRef;
    return deepFreeze(annotation);
  }

  function knownEnglishToken(surface, start, end, analysis, context) {
    const entry = analysis.entry;
    const tokenContext = {
      language: 'en',
      start,
      end,
      provider: context.providerIdentity,
      generatedAt: context.generatedAt,
      algorithm: ENGLISH_ALGORITHM
    };
    const annotations = [];
    annotations.push(annotationFor(
      tokenContext,
      'lemma',
      entry.lemma,
      analysis.confidence,
      analysis.source,
      entry.datasetRef,
      analysis.provenance,
      annotations.length
    ));
    annotations.push(annotationFor(
      tokenContext,
      'simplified-pos',
      entry.simplifiedPos,
      analysis.confidence,
      analysis.source,
      entry.datasetRef,
      analysis.provenance,
      annotations.length
    ));
    if (entry.lexicalRef) annotations.push(annotationFor(
      tokenContext,
      'lexical-reference',
      entry.lexicalRef,
      analysis.confidence,
      analysis.source,
      entry.datasetRef,
      analysis.provenance,
      annotations.length
    ));
    if (entry.glossRef) annotations.push(annotationFor(
      tokenContext,
      'gloss-reference',
      entry.glossRef,
      analysis.confidence,
      analysis.source,
      entry.datasetRef,
      analysis.provenance,
      annotations.length
    ));
    if (entry.gloss) annotations.push(annotationFor(
      tokenContext,
      'gloss',
      entry.gloss,
      analysis.confidence,
      analysis.source,
      entry.datasetRef,
      analysis.provenance,
      annotations.length
    ));
    if (analysis.morphology) annotations.push(annotationFor(
      tokenContext,
      'morphology',
      analysis.morphology,
      analysis.confidence,
      analysis.source,
      analysis.morphologyDatasetRef,
      analysis.provenance,
      annotations.length
    ));
    const token = {
      schemaVersion: 1,
      tokenId: `token:en:${start}:${end}`,
      surface,
      normalizedSurface: surface.normalize('NFC').toLocaleLowerCase('en-US'),
      language: 'en',
      start,
      end,
      lemma: entry.lemma,
      simplifiedPos: entry.simplifiedPos,
      glossRefs: entry.glossRef ? [entry.glossRef] : [],
      lexicalRefs: entry.lexicalRef ? [entry.lexicalRef] : [],
      confidence: analysis.confidence,
      provenance: analysis.provenance.length
        ? analysis.provenance
        : uniqueStrings([`provider:${context.providerIdentity.id}@${context.providerIdentity.version}`]),
      priority: POS_PRIORITY[entry.simplifiedPos] === undefined ? 0.1 : POS_PRIORITY[entry.simplifiedPos],
      annotations
    };
    if (analysis.morphology) token.morphology = analysis.morphology;
    return deepFreeze(token);
  }

  function unknownEnglishToken(surface, start, end, context) {
    const provenance = Object.freeze([`provider:${context.providerIdentity.id}@${context.providerIdentity.version}`, 'analysis:unknown']);
    return deepFreeze({
      schemaVersion: 1,
      tokenId: `token:en:${start}:${end}`,
      surface,
      normalizedSurface: surface.normalize('NFC').toLocaleLowerCase('en-US'),
      language: 'en',
      start,
      end,
      simplifiedPos: 'x',
      glossRefs: [],
      lexicalRefs: [],
      confidence: 0.15,
      provenance,
      priority: POS_PRIORITY.x,
      annotations: [annotationFor({
        language: 'en',
        start,
        end,
        provider: context.providerIdentity,
        generatedAt: context.generatedAt,
        algorithm: ENGLISH_ALGORITHM
      }, 'simplified-pos', 'x', 0.15, 'unknown-handler', null, provenance, 0), annotationFor({
        language: 'en',
        start,
        end,
        provider: context.providerIdentity,
        generatedAt: context.generatedAt,
        algorithm: ENGLISH_ALGORITHM
      }, 'unknown', true, 0.15, 'unknown-handler', null, provenance, 1)]
    });
  }

  function analyzeEnglish(text, context) {
    const candidates = [];
    const expression = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
    let match;
    while ((match = expression.exec(text))) {
      const surface = match[0];
      const start = match.index;
      const end = start + surface.length;
      const analyses = directAnalyses(context.provider, surface);
      analyses.push(...morphologyAnalyses(context.provider, surface));
      candidates.push({ surface, start, end, analyses });
    }
    const tokens = [];
    const state = { previous: null, predicateSeen: false, previousEnd: null };
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (hasSentenceBoundary(text, state.previousEnd, candidate.start)) {
        state.previous = null;
        state.predicateSeen = false;
      }
      if (!candidate.analyses.length) {
        tokens.push(unknownEnglishToken(candidate.surface, candidate.start, candidate.end, context));
        state.previous = null;
        state.previousEnd = candidate.end;
        continue;
      }
      const nextAnalyses = candidates[index + 1] ? candidates[index + 1].analyses : EMPTY;
      const analysis = selectEnglishAnalysis(candidate.analyses, state, nextAnalyses);
      tokens.push(knownEnglishToken(candidate.surface, candidate.start, candidate.end, analysis, context));
      state.previous = analysis;
      if (analysis.entry.simplifiedPos === 'v') state.predicateSeen = true;
      state.previousEnd = candidate.end;
    }
    return tokens;
  }

  function compareChineseEntries(left, right) {
    return right.confidence - left.confidence ||
      POS_ORDER.indexOf(left.simplifiedPos) - POS_ORDER.indexOf(right.simplifiedPos) ||
      String(left.lexicalRef || '').localeCompare(String(right.lexicalRef || ''));
  }

  function sourceForEntry(entry) {
    return entry.datasetRef ? 'verified-lexical-index' : 'bootstrap-lexicon';
  }

  function chineseAnnotation(context, annotations, type, value, confidence, source, datasetRef, provenance) {
    annotations.push(annotationFor({
      language: 'zh-Hant',
      start: context.start,
      end: context.end,
      provider: context.providerIdentity,
      generatedAt: context.generatedAt,
      algorithm: CHINESE_ALGORITHM
    }, type, value, confidence, source, datasetRef, provenance, annotations.length));
  }

  function knownChineseToken(surface, start, end, rawEntries, context) {
    const entries = rawEntries.map(normalizedEntry).filter(Boolean).sort(compareChineseEntries);
    if (!entries.length) return null;
    const lexicalEntries = entries.filter((candidate) => candidate.datasetRef);
    const entry = lexicalEntries.length
      ? [...lexicalEntries].sort((left, right) =>
        String(left.lexicalRef || '').localeCompare(String(right.lexicalRef || ''), 'en'))[0]
      : entries[0];
    const posEntry = [...entries].sort((left, right) =>
      Number(right.simplifiedPos !== 'x') - Number(left.simplifiedPos !== 'x') ||
      right.confidence - left.confidence ||
      POS_ORDER.indexOf(left.simplifiedPos) - POS_ORDER.indexOf(right.simplifiedPos) ||
      String(left.lexicalRef || '').localeCompare(String(right.lexicalRef || ''), 'en'))[0];
    const lexicalConfidence = entry.datasetRef ? 0.98 : entry.confidence;
    const source = sourceForEntry(entry);
    const posSource = sourceForEntry(posEntry);
    const provenance = uniqueStrings([...entry.provenance, ...posEntry.provenance]);
    const lexicalProvenance = entry.provenance.length
      ? entry.provenance
      : uniqueStrings([`provider:${context.providerIdentity.id}@${context.providerIdentity.version}`]);
    const annotationContext = {
      start,
      end,
      providerIdentity: context.providerIdentity,
      generatedAt: context.generatedAt
    };
    const annotations = [];
    chineseAnnotation(annotationContext, annotations, 'traditional-form', entry.traditional, lexicalConfidence, source, entry.datasetRef, lexicalProvenance);
    chineseAnnotation(annotationContext, annotations, 'simplified-form', entry.simplified, lexicalConfidence, source, entry.datasetRef, lexicalProvenance);
    chineseAnnotation(annotationContext, annotations, 'lemma', entry.lemma, lexicalConfidence, source, entry.datasetRef, lexicalProvenance);
    chineseAnnotation(annotationContext, annotations, 'simplified-pos', posEntry.simplifiedPos, posEntry.confidence, posSource, posEntry.datasetRef, posEntry.provenance);
    if (entry.datasetRef && (entry.simplifiedPos !== posEntry.simplifiedPos || entry.confidence !== posEntry.confidence)) {
      chineseAnnotation(annotationContext, annotations, 'lexical-pos-candidate', entry.simplifiedPos, entry.confidence, source, entry.datasetRef, lexicalProvenance);
    }
    const referencedEntries = lexicalEntries.length ? lexicalEntries : [entry];
    for (const referenceEntry of referencedEntries) {
      if (referenceEntry.lexicalRef) {
        chineseAnnotation(annotationContext, annotations, 'lexical-reference', referenceEntry.lexicalRef, lexicalConfidence, sourceForEntry(referenceEntry), referenceEntry.datasetRef, referenceEntry.provenance);
      }
      if (referenceEntry.glossRef) {
        chineseAnnotation(annotationContext, annotations, 'gloss-reference', referenceEntry.glossRef, lexicalConfidence, sourceForEntry(referenceEntry), referenceEntry.datasetRef, referenceEntry.provenance);
      }
    }
    if (entry.gloss) {
      chineseAnnotation(annotationContext, annotations, 'gloss', entry.gloss, lexicalConfidence, source, entry.datasetRef, provenance);
    }
    if (entry.pinyin) {
      chineseAnnotation(annotationContext, annotations, 'pinyin', entry.pinyin, lexicalConfidence, source, entry.datasetRef, provenance);
    }
    return deepFreeze({
      schemaVersion: 1,
      tokenId: `token:zh-Hant:${start}:${end}`,
      surface,
      normalizedSurface: surface.normalize('NFC'),
      language: 'zh-Hant',
      start,
      end,
      lemma: entry.lemma,
      simplifiedPos: posEntry.simplifiedPos,
      glossRefs: uniqueStrings(referencedEntries.map((candidate) => candidate.glossRef)),
      lexicalRefs: uniqueStrings(referencedEntries.map((candidate) => candidate.lexicalRef)),
      confidence: lexicalConfidence,
      provenance,
      priority: POS_PRIORITY[posEntry.simplifiedPos] === undefined ? 0.1 : POS_PRIORITY[posEntry.simplifiedPos],
      annotations
    });
  }

  function unknownChineseToken(surface, start, end, context) {
    const provenance = Object.freeze([
      `provider:${context.providerIdentity.id}@${context.providerIdentity.version}`,
      'analysis:unknown'
    ]);
    return deepFreeze({
      schemaVersion: 1,
      tokenId: `token:zh-Hant:${start}:${end}`,
      surface,
      normalizedSurface: surface.normalize('NFC'),
      language: 'zh-Hant',
      start,
      end,
      simplifiedPos: 'x',
      glossRefs: [],
      lexicalRefs: [],
      confidence: 0.15,
      provenance,
      priority: POS_PRIORITY.x,
      annotations: [annotationFor({
        language: 'zh-Hant',
        start,
        end,
        provider: context.providerIdentity,
        generatedAt: context.generatedAt,
        algorithm: CHINESE_ALGORITHM
      }, 'simplified-pos', 'x', 0.15, 'unknown-handler', null, provenance, 0), annotationFor({
        language: 'zh-Hant',
        start,
        end,
        provider: context.providerIdentity,
        generatedAt: context.generatedAt,
        algorithm: CHINESE_ALGORITHM
      }, 'unknown', true, 0.15, 'unknown-handler', null, provenance, 1)]
    });
  }

  function analyzeChinese(text, context) {
    const tokens = [];
    let index = 0;
    while (index < text.length) {
      const codePoint = text.codePointAt(index);
      const character = String.fromCodePoint(codePoint);
      if (!/\p{Script=Han}/u.test(character)) {
        index += character.length;
        continue;
      }
      const match = typeof context.provider.longestMatch === 'function'
        ? context.provider.longestMatch(text, index, 'zh-Hant')
        : null;
      if (match && match.start === index && Number.isInteger(match.end) && match.end > index &&
          Array.isArray(match.entries) && match.entries.length) {
        const token = knownChineseToken(match.surface, index, match.end, match.entries, context);
        if (token) {
          tokens.push(token);
          index = match.end;
          continue;
        }
      }
      const direct = providerEntries(context.provider, character, 'zh-Hant');
      const token = direct.length
        ? knownChineseToken(character, index, index + character.length, direct, context)
        : unknownChineseToken(character, index, index + character.length, context);
      tokens.push(token);
      index += character.length;
    }
    return tokens;
  }

  function detectLanguage(text) {
    const hasEnglish = /[A-Za-z]/.test(text);
    const hasChinese = /\p{Script=Han}/u.test(text);
    if (hasEnglish && hasChinese) return 'both';
    if (hasChinese) return 'zh-Hant';
    if (hasEnglish) return 'en';
    return 'both';
  }

  function spansOverlap(left, right) {
    return left.start < right.end && right.start < left.end;
  }

  function createSemanticEngine(options) {
    const settings = options || {};
    const provider = settings.provider;
    const grammarAnnotator = settings.grammarAnnotator;
    if (!provider || typeof provider.lookup !== 'function') throw new TypeError('provider.lookup: must be a function');
    const identity = providerIdentity(provider);
    return Object.freeze({
      annotateText(textValue, runOptions) {
        const text = String(textValue || '');
        const run = runOptions || {};
        const languageMode = run.languageMode === 'auto' ? detectLanguage(text) : (run.languageMode || 'both');
        if (!['both', 'en', 'zh-Hant'].includes(languageMode)) {
          throw new TypeError('languageMode: must be auto, both, en, or zh-Hant');
        }
        if (typeof run.generatedAt !== 'string' || Number.isNaN(Date.parse(run.generatedAt))) {
          throw new TypeError('generatedAt: must be an ISO 8601 timestamp');
        }
        const context = { provider, providerIdentity: identity, generatedAt: run.generatedAt };
        let tokens = [];
        if (languageMode === 'en') tokens = analyzeEnglish(text, context);
        if (languageMode === 'zh-Hant') tokens = analyzeChinese(text, context);
        if (languageMode === 'both') {
          const chineseTokens = analyzeChinese(text, context);
          const englishTokens = analyzeEnglish(text, context)
            .filter((englishToken) => !chineseTokens.some((chineseToken) => spansOverlap(englishToken, chineseToken)));
          tokens = chineseTokens.concat(englishTokens);
        }
        tokens.sort((left, right) => left.start - right.start || left.end - right.end || left.language.localeCompare(right.language));
        const status = typeof provider.status === 'function'
          ? provider.status()
          : Object.freeze({ mode: 'ready', fallbackActivated: false, failures: [] });
        const providerStatus = status.mode === 'ready' ? 'verified' : 'bootstrap';
        const warnings = Array.isArray(status.failures)
          ? status.failures.map((failure) => `dictionary:${failure.code}`).filter((value) => !value.endsWith(':undefined'))
          : [];
        const annotationSet = deepFreeze({
          schemaVersion: 1,
          setId: `annotation-set:${stableHash(`${languageMode}\u0000${text}\u0000${identity.id}\u0000${identity.version}`)}`,
          languageMode,
          textLength: text.length,
          algorithm: ENGINE,
          generatedAt: run.generatedAt,
          providerRefs: [{ id: identity.id, version: identity.version, status: providerStatus }],
          tokens,
          diagnostics: {
            fallbackActivated: Boolean(status.fallbackActivated),
            unavailableCapabilities: ['chunk', 'grammar-role', 'learning-state', 'tense-aspect'],
            warnings
          }
        });
        return typeof grammarAnnotator === 'function' ? grammarAnnotator(annotationSet, text) : annotationSet;
      }
    });
  }

  return Object.freeze({ ENGINE, ENGLISH_ALGORITHM, CHINESE_ALGORITHM, createSemanticEngine, stableHash });
});
