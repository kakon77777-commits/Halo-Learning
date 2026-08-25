const test = require('node:test');
const assert = require('node:assert/strict');

const Contracts = require('../packages/contracts/semantic-contracts');
const Grammar = require('../apps/extension/src/shared/grammar-annotations');

const GENERATED_AT = '2026-08-25T10:00:00.000Z';

function annotation(surface, start, end, type, value, confidence) {
  return {
    schemaVersion: 1,
    annotationId: `fixture:${start}:${end}:${type}`,
    type,
    value,
    confidence,
    source: 'grammar-fixture',
    provider: { id: 'grammar-fixture-provider', version: '1' },
    algorithm: { id: 'grammar-fixture', version: '1' },
    generatedAt: GENERATED_AT,
    provenance: [`fixture:${surface}`]
  };
}

function token(surface, start, simplifiedPos, options) {
  const settings = options || {};
  const end = start + surface.length;
  const value = {
    schemaVersion: 1,
    tokenId: `token:en:${start}:${end}`,
    surface,
    normalizedSurface: surface.toLowerCase(),
    language: settings.language || 'en',
    start,
    end,
    lemma: settings.lemma || surface.toLowerCase(),
    simplifiedPos,
    glossRefs: settings.lexical === false ? [] : [`fixture:${surface}:gloss`],
    lexicalRefs: settings.lexical === false ? [] : [`fixture:${surface}:lexical`],
    confidence: settings.confidence === undefined ? 0.95 : settings.confidence,
    provenance: [`fixture:${surface}`],
    priority: ['n', 'v', 'adj', 'adv'].includes(simplifiedPos) ? 0.85 : 0.7,
    annotations: [
      annotation(surface, start, end, 'lemma', settings.lemma || surface.toLowerCase(), 0.95),
      annotation(surface, start, end, 'simplified-pos', simplifiedPos, 0.95)
    ]
  };
  if (settings.morphology) {
    value.morphology = settings.morphology;
    value.annotations.push(annotation(surface, start, end, 'morphology', settings.morphology, 0.9));
  }
  return value;
}

function setFor(text, tokens, languageMode) {
  return Contracts.normalizeAnnotationSet({
    schemaVersion: 1,
    setId: `fixture:${text}`,
    languageMode: languageMode || 'en',
    textLength: text.length,
    algorithm: { id: 'halo-semantic-engine', version: '0.3.0' },
    generatedAt: GENERATED_AT,
    providerRefs: [{ id: 'grammar-fixture-provider', version: '1', status: 'verified' }],
    tokens,
    diagnostics: {
      fallbackActivated: false,
      unavailableCapabilities: ['chunk', 'grammar-role', 'learning-state', 'tense-aspect'],
      warnings: []
    }
  });
}

test('bounded grammar layer adds fixture-backed subject, predicate, object, tense, and chunks', () => {
  const text = 'The child reads books.';
  const input = setFor(text, [
    token('The', 0, 'det'),
    token('child', 4, 'n'),
    token('reads', 10, 'v', {
      lemma: 'read',
      morphology: { form: 'third-person-singular', number: 'singular', person: 3, tense: 'present' }
    }),
    token('books', 16, 'n', { lemma: 'book', morphology: { form: 'plural', number: 'plural' } })
  ]);
  const output = Grammar.annotateGrammar(input);

  assert.doesNotThrow(() => Contracts.normalizeAnnotationSet(output));
  assert.equal(output.tokens[1].grammarRole, 'subject');
  assert.equal(output.tokens[2].grammarRole, 'predicate');
  assert.equal(output.tokens[2].tenseAspect, 'simple-present');
  assert.equal(output.tokens[3].grammarRole, 'object');
  assert.ok(output.tokens[0].annotations.some((value) => value.type === 'chunk' && value.value.type === 'noun-phrase'));
  assert.ok(output.tokens[2].annotations.some((value) => value.type === 'chunk' && value.value.type === 'verb-phrase'));
  assert.ok(output.tokens[2].annotations.some((value) =>
    value.type === 'tense-aspect' && value.algorithm.id === 'halo-bounded-grammar'));
  assert.deepEqual(output.diagnostics.unavailableCapabilities, ['learning-state']);
});

test('auxiliary plus present participle yields progressive evidence without overwriting lexical morphology', () => {
  const text = 'She is reading books.';
  const input = setFor(text, [
    token('She', 0, 'pron', { lemma: 'she' }),
    token('is', 4, 'aux', { lemma: 'be' }),
    token('reading', 7, 'v', { lemma: 'read', morphology: { form: 'present-participle' } }),
    token('books', 15, 'n', { lemma: 'book', morphology: { form: 'plural', number: 'plural' } })
  ]);
  const morphologyBefore = JSON.stringify(input.tokens[2].morphology);
  const output = Grammar.annotateGrammar(input);

  assert.equal(output.tokens[0].grammarRole, 'subject');
  assert.equal(output.tokens[1].grammarRole, 'predicate-auxiliary');
  assert.equal(output.tokens[2].grammarRole, 'predicate');
  assert.equal(output.tokens[2].tenseAspect, 'present-progressive');
  assert.equal(JSON.stringify(output.tokens[2].morphology), morphologyBefore);
});

test('insufficient or uncertain token patterns omit grammar claims', () => {
  const text = 'Blue perhaps.';
  const input = setFor(text, [token('Blue', 0, 'adj'), token('perhaps', 5, 'adv')]);
  const output = Grammar.annotateGrammar(input);

  assert.ok(output.tokens.every((value) => !Object.hasOwn(value, 'grammarRole')));
  assert.ok(output.tokens.every((value) => !Object.hasOwn(value, 'tenseAspect')));
  assert.ok(output.tokens.every((value) => !value.annotations.some((item) => item.type === 'chunk')));
});

test('v0.3 bounded grammar does not invent Chinese role or tense/aspect analysis', () => {
  const text = '我學習';
  const input = setFor(text, [
    token('我', 0, 'pron', { language: 'zh-Hant' }),
    token('學習', 1, 'v', { language: 'zh-Hant' })
  ], 'zh-Hant');
  const output = Grammar.annotateGrammar(input);

  assert.deepEqual(output.tokens, input.tokens);
  assert.ok(output.diagnostics.unavailableCapabilities.includes('grammar-role'));
  assert.ok(output.diagnostics.unavailableCapabilities.includes('tense-aspect'));
});

test('grammar annotation returns a new immutable set and never mutates lexical semantic truth', () => {
  const text = 'The child reads books.';
  const input = setFor(text, [
    token('The', 0, 'det'),
    token('child', 4, 'n'),
    token('reads', 10, 'v', { lemma: 'read', morphology: { form: 'third-person-singular' } }),
    token('books', 16, 'n', { lemma: 'book' })
  ]);
  const snapshot = JSON.stringify(input);
  const output = Grammar.annotateGrammar(input);

  assert.equal(JSON.stringify(input), snapshot);
  assert.notEqual(output, input);
  assert.equal(Object.isFrozen(output), true);
  assert.deepEqual(output.tokens.map((value) => value.lexicalRefs), input.tokens.map((value) => value.lexicalRefs));
  assert.deepEqual(output.tokens.map((value) => value.glossRefs), input.tokens.map((value) => value.glossRefs));
});

test('bounded grammar isolates sentence clauses instead of linking a later subject as an object', () => {
  const text = 'I run. Dogs bark.';
  const input = setFor(text, [
    token('I', 0, 'pron', { lemma: 'i' }),
    token('run', 2, 'v'),
    token('Dogs', 7, 'n', { lemma: 'dog', morphology: { form: 'plural', number: 'plural' } }),
    token('bark', 12, 'v')
  ]);

  const output = Grammar.annotateGrammar(input, text);

  assert.equal(output.tokens[0].grammarRole, 'subject');
  assert.equal(output.tokens[1].grammarRole, 'predicate');
  assert.equal(output.tokens[2].grammarRole, 'subject');
  assert.equal(output.tokens[3].grammarRole, 'predicate');
  assert.ok(output.tokens.every((value) => value.grammarRole !== 'object'));
});

test('bounded grammar never crosses a non-English token or includes it in an English chunk', () => {
  const text = 'I run 看 books.';
  const input = setFor(text, [
    token('I', 0, 'pron', { lemma: 'i' }),
    token('run', 2, 'v'),
    token('看', 6, 'v', { language: 'zh-Hant' }),
    token('books', 8, 'n', { lemma: 'book', morphology: { form: 'plural', number: 'plural' } })
  ], 'both');

  const output = Grammar.annotateGrammar(input, text);

  assert.equal(output.tokens[0].grammarRole, 'subject');
  assert.equal(output.tokens[1].grammarRole, 'predicate');
  assert.equal(Object.hasOwn(output.tokens[3], 'grammarRole'), false);
  assert.equal(output.tokens[2].annotations.some((value) => value.type === 'chunk'), false);
  assert.ok(output.tokens[1].annotations
    .filter((value) => value.type === 'chunk')
    .every((value) => value.value.end <= input.tokens[1].end));
});
