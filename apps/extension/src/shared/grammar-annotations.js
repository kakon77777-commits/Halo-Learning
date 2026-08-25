(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloGrammarAnnotations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ALGORITHM = Object.freeze({ id: 'halo-bounded-grammar', version: '0.3.0' });

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }

  function cloneToken(token) {
    const result = { ...token, annotations: [...token.annotations] };
    delete result.grammarRole;
    delete result.tenseAspect;
    result.annotations = result.annotations.filter((annotation) =>
      !annotation.algorithm || annotation.algorithm.id !== ALGORITHM.id);
    return result;
  }

  function annotationFactory(set, tokens) {
    const provider = set.providerRefs[0]
      ? { id: set.providerRefs[0].id, version: set.providerRefs[0].version }
      : { id: 'semantic-provider', version: 'unspecified' };
    let sequence = 0;
    return function annotation(tokenIndex, type, value, confidence, rule) {
      const token = tokens[tokenIndex];
      const result = {
        schemaVersion: 1,
        annotationId: `ann:${token.language}:${token.start}:${token.end}:${type}:grammar:${sequence}`,
        type,
        value,
        confidence,
        source: 'deterministic-grammar-rule',
        provider,
        algorithm: ALGORITHM,
        generatedAt: set.generatedAt,
        provenance: [`rule:${rule}`]
      };
      sequence += 1;
      return deepFreeze(result);
    };
  }

  function setRole(tokens, tokenIndex, role, confidence, rule, annotation) {
    tokens[tokenIndex].grammarRole = role;
    tokens[tokenIndex].annotations.push(annotation(tokenIndex, 'grammar-role', role, confidence, rule));
  }

  function setTenseAspect(tokens, tokenIndex, value, confidence, rule, annotation) {
    tokens[tokenIndex].tenseAspect = value;
    tokens[tokenIndex].annotations.push(annotation(tokenIndex, 'tense-aspect', value, confidence, rule));
  }

  function addChunk(tokens, memberIndexes, type, confidence, rule, annotation) {
    if (!memberIndexes.length) return;
    const first = memberIndexes[0];
    const last = memberIndexes[memberIndexes.length - 1];
    const value = deepFreeze({
      type,
      startToken: first,
      endToken: last + 1,
      start: tokens[first].start,
      end: tokens[last].end
    });
    for (const tokenIndex of memberIndexes) {
      tokens[tokenIndex].annotations.push(annotation(tokenIndex, 'chunk', value, confidence, rule));
    }
  }

  function progressiveTense(auxiliary, predicate) {
    if (!predicate.morphology || predicate.morphology.form !== 'present-participle') return null;
    if (auxiliary.lemma !== 'be' && !['am', 'is', 'are', 'was', 'were'].includes(auxiliary.normalizedSurface)) return null;
    return ['was', 'were'].includes(auxiliary.normalizedSurface) ? 'past-progressive' : 'present-progressive';
  }

  function perfectTense(auxiliary, predicate) {
    if (!predicate.morphology || !['past-or-participle', 'irregular'].includes(predicate.morphology.form)) return null;
    if (auxiliary.lemma !== 'have' && !['have', 'has', 'had'].includes(auxiliary.normalizedSurface)) return null;
    return auxiliary.normalizedSurface === 'had' ? 'past-perfect' : 'present-perfect';
  }

  function englishClauses(tokens, sourceText) {
    const clauses = [];
    let current = [];
    function flush() {
      if (current.length) clauses.push(current);
      current = [];
    }
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.language !== 'en') {
        flush();
        continue;
      }
      if (current.length && typeof sourceText === 'string') {
        const previous = tokens[current[current.length - 1]];
        if (/[.!?。！？]/.test(sourceText.slice(previous.end, token.start))) flush();
      }
      current.push(index);
    }
    flush();
    return clauses;
  }

  function annotateClause(tokens, clauseIndexes, annotation) {
    const predicatePosition = clauseIndexes.findIndex((index) => tokens[index].simplifiedPos === 'v');
    if (predicatePosition < 0) return;
    const predicateIndex = clauseIndexes[predicatePosition];
    const subjectCandidates = clauseIndexes.slice(0, predicatePosition).filter((index) =>
      ['n', 'pron'].includes(tokens[index].simplifiedPos));
    const subjectIndex = subjectCandidates.length ? subjectCandidates[subjectCandidates.length - 1] : null;
    const auxiliaryIndexes = clauseIndexes.slice(0, predicatePosition).filter((index) =>
      ['aux', 'modal'].includes(tokens[index].simplifiedPos) &&
      (subjectIndex === null || index > subjectIndex));
    const objectIndex = clauseIndexes.slice(predicatePosition + 1).find((index) =>
      ['n', 'pron'].includes(tokens[index].simplifiedPos));

    if (subjectIndex !== null) setRole(tokens, subjectIndex, 'subject', 0.84, 'en-svo-subject-v1', annotation);
    for (const auxiliaryIndex of auxiliaryIndexes) {
      setRole(tokens, auxiliaryIndex, 'predicate-auxiliary', 0.9, 'en-auxiliary-chain-v1', annotation);
    }
    setRole(tokens, predicateIndex, 'predicate', 0.9, 'en-predicate-v1', annotation);
    if (objectIndex !== undefined) setRole(tokens, objectIndex, 'object', 0.8, 'en-svo-object-v1', annotation);

    const predicate = tokens[predicateIndex];
    const lastAuxiliary = auxiliaryIndexes.length ? tokens[auxiliaryIndexes[auxiliaryIndexes.length - 1]] : null;
    const progressive = lastAuxiliary ? progressiveTense(lastAuxiliary, predicate) : null;
    const perfect = lastAuxiliary ? perfectTense(lastAuxiliary, predicate) : null;
    if (progressive) {
      setTenseAspect(tokens, predicateIndex, progressive, 0.9, 'en-progressive-v1', annotation);
    } else if (perfect) {
      setTenseAspect(tokens, predicateIndex, perfect, 0.86, 'en-perfect-v1', annotation);
    } else if (predicate.morphology && predicate.morphology.form === 'third-person-singular') {
      setTenseAspect(tokens, predicateIndex, 'simple-present', 0.86, 'en-third-person-present-v1', annotation);
    }

    if (subjectIndex !== null) {
      const subjectPosition = clauseIndexes.indexOf(subjectIndex);
      let nounPhraseStartPosition = subjectPosition;
      while (nounPhraseStartPosition > 0 &&
          ['det', 'adj'].includes(tokens[clauseIndexes[nounPhraseStartPosition - 1]].simplifiedPos)) {
        nounPhraseStartPosition -= 1;
      }
      addChunk(
        tokens,
        clauseIndexes.slice(nounPhraseStartPosition, subjectPosition + 1),
        'noun-phrase',
        0.84,
        'en-subject-noun-phrase-v1',
        annotation
      );
    }
    const verbPhraseStart = auxiliaryIndexes.length ? auxiliaryIndexes[0] : predicateIndex;
    const verbPhraseEnd = objectIndex === undefined ? predicateIndex : objectIndex;
    const verbPhraseStartPosition = clauseIndexes.indexOf(verbPhraseStart);
    const verbPhraseEndPosition = clauseIndexes.indexOf(verbPhraseEnd);
    addChunk(
      tokens,
      clauseIndexes.slice(verbPhraseStartPosition, verbPhraseEndPosition + 1),
      'verb-phrase',
      0.82,
      'en-verb-phrase-v1',
      annotation
    );
  }

  function annotateEnglish(set, tokenValues, sourceText) {
    const tokens = tokenValues.map(cloneToken);
    const annotation = annotationFactory(set, tokens);
    for (const clauseIndexes of englishClauses(tokens, sourceText)) {
      annotateClause(tokens, clauseIndexes, annotation);
    }
    return tokens.map(deepFreeze);
  }

  function annotateGrammar(annotationSet, sourceText) {
    if (!annotationSet || typeof annotationSet !== 'object' || !Array.isArray(annotationSet.tokens)) {
      throw new TypeError('annotationSet.tokens: must be an array');
    }
    const hasEnglish = annotationSet.tokens.some((token) => token.language === 'en');
    const tokens = hasEnglish ? annotateEnglish(annotationSet, annotationSet.tokens, sourceText) : annotationSet.tokens;
    const unavailable = new Set(annotationSet.diagnostics.unavailableCapabilities || []);
    if (hasEnglish) {
      unavailable.delete('chunk');
      unavailable.delete('grammar-role');
      unavailable.delete('tense-aspect');
    }
    return deepFreeze({
      ...annotationSet,
      setId: `${annotationSet.setId}:grammar-v1`,
      tokens,
      diagnostics: {
        ...annotationSet.diagnostics,
        unavailableCapabilities: [...unavailable].sort()
      }
    });
  }

  return Object.freeze({ ALGORITHM, annotateGrammar });
});
