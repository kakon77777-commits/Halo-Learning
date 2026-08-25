'use strict';

function annotationFixture(overrides) {
  return {
    schemaVersion: 1,
    annotationId: 'ann:en:0:5:pos',
    type: 'simplified-pos',
    value: 'v',
    confidence: 0.97,
    source: 'lexical-provider',
    provider: { id: 'halo-runtime-dictionary', version: '0.3.0' },
    algorithm: { id: 'halo-english-semantic', version: '0.3.0' },
    datasetRef: {
      datasetId: 'princeton-wordnet-3.0',
      datasetVersion: '3.0',
      recordRef: 'data.verb:01926311'
    },
    generatedAt: '2026-08-25T08:00:00.000Z',
    provenance: ['runtime-index:sha256:abc', 'wordnet:data.verb:01926311'],
    ...(overrides || {})
  };
}

function tokenFixture(overrides) {
  const token = {
    schemaVersion: 1,
    tokenId: 'token:en:0:5',
    surface: 'Reads',
    normalizedSurface: 'reads',
    language: 'en',
    start: 0,
    end: 5,
    lemma: 'read',
    simplifiedPos: 'v',
    morphology: { person: 3, number: 'singular', form: 'present' },
    grammarRole: 'predicate',
    tenseAspect: 'simple-present',
    glossRefs: ['wn30:00627520-v'],
    lexicalRefs: ['wn30:00627520-v:read'],
    confidence: 0.93,
    provenance: ['provider:halo-runtime-dictionary@0.3.0'],
    priority: 0.85,
    ...(overrides || {})
  };
  if (!overrides || !Object.hasOwn(overrides, 'annotations')) {
    const fields = [
      ['lemma', 'lemma'],
      ['simplifiedPos', 'simplified-pos'],
      ['morphology', 'morphology'],
      ['grammarRole', 'grammar-role'],
      ['tenseAspect', 'tense-aspect']
    ];
    token.annotations = fields
      .filter(([field]) => token[field] !== undefined)
      .map(([field, type], index) => annotationFixture({
        annotationId: `ann:${token.language}:${token.start}:${token.end}:${type}:${index}`,
        type,
        value: token[field],
        confidence: token.confidence
      }));
  }
  return token;
}

function annotationSetFixture(overrides) {
  return {
    schemaVersion: 1,
    setId: 'annotation-set:fixture:1',
    languageMode: 'en',
    textLength: 11,
    algorithm: { id: 'halo-semantic-engine', version: '0.3.0' },
    generatedAt: '2026-08-25T08:00:00.000Z',
    providerRefs: [{ id: 'halo-runtime-dictionary', version: '0.3.0', status: 'verified' }],
    tokens: [
      tokenFixture(),
      tokenFixture({
        tokenId: 'token:en:6:11',
        surface: 'books',
        normalizedSurface: 'books',
        start: 6,
        end: 11,
        lemma: 'book',
        simplifiedPos: 'n',
        morphology: { number: 'plural' },
        grammarRole: 'object',
        tenseAspect: undefined,
        glossRefs: ['wn30:06410904-n'],
        lexicalRefs: ['wn30:06410904-n:book'],
        confidence: 0.96
      })
    ],
    diagnostics: {
      fallbackActivated: false,
      unavailableCapabilities: ['learning-state'],
      warnings: []
    },
    ...(overrides || {})
  };
}

function markingProfileFixture(overrides) {
  return {
    schemaVersion: 2,
    profileId: 'default-v0.3.0',
    enabled: true,
    languageMode: 'both',
    channels: {
      posLabel: true,
      posColor: true,
      lemma: false,
      morphology: false,
      glossHint: false,
      grammarRole: false,
      tenseAspect: false,
      chunk: false,
      learningState: false
    },
    density: 0.65,
    minConfidence: 0.6,
    labelPosition: 'top-right',
    maxTextNodes: 600,
    maxMarkedTokens: 3000,
    ...(overrides || {})
  };
}

module.exports = Object.freeze({
  annotationFixture,
  tokenFixture,
  annotationSetFixture,
  markingProfileFixture
});
