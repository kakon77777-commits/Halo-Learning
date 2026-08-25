const test = require('node:test');
const assert = require('node:assert/strict');

const Contracts = require('../packages/contracts/semantic-contracts');
const Semantic = require('../apps/extension/src/shared/semantic-annotations');

const GENERATED_AT = '2026-08-25T09:00:00.000Z';

function lexicalEntry(surface, lemma, simplifiedPos, options) {
  const settings = options || {};
  const recordRef = settings.recordRef || `data.${simplifiedPos}:${lemma}`;
  return Object.freeze({
    surface,
    normalizedSurface: surface.toLowerCase(),
    language: 'en',
    lemma,
    simplifiedPos,
    posConfidence: settings.confidence === undefined ? 1 : settings.confidence,
    lexicalRef: recordRef,
    glossRef: `${recordRef}#gloss`,
    gloss: settings.gloss || `${lemma} fixture gloss`,
    datasetRef: {
      datasetId: 'princeton-wordnet-3.0-fixture',
      datasetVersion: '3.0-fixture.1',
      recordRef
    },
    provenance: [`dataset:princeton-wordnet-3.0-fixture@3.0-fixture.1`]
  });
}

function bootstrapEntry(surface, simplifiedPos, confidence, lemma) {
  return Object.freeze({
    surface,
    lang: 'en',
    lemma: lemma || surface.toLowerCase(),
    pos: simplifiedPos,
    confidence,
    source: 'closed-class-bootstrap'
  });
}

function fixtureProvider() {
  const entries = new Map();
  const add = (entry) => {
    const key = entry.surface.toLowerCase();
    if (!entries.has(key)) entries.set(key, []);
    entries.get(key).push(entry);
  };
  add(bootstrapEntry('The', 'det', 0.99));
  add(bootstrapEntry('A', 'det', 0.99));
  add(bootstrapEntry('An', 'det', 0.99));
  add(bootstrapEntry('She', 'pron', 0.99));
  add(bootstrapEntry('We', 'pron', 0.99));
  add(bootstrapEntry('is', 'aux', 0.99, 'be'));
  add(lexicalEntry('A', 'A', 'n', { gloss: 'the letter A' }));
  add(lexicalEntry('child', 'child', 'n', { gloss: 'a young person' }));
  add(lexicalEntry('read', 'read', 'v', { gloss: 'to interpret written language' }));
  add(lexicalEntry('book', 'book', 'n', { gloss: 'a written work' }));
  add(lexicalEntry('book', 'book', 'v', { gloss: 'to reserve' }));
  add(lexicalEntry('reading', 'reading', 'n', { gloss: 'the act of reading' }));
  add(lexicalEntry('important', 'important', 'adj'));
  add(lexicalEntry('word', 'word', 'n'));
  add(lexicalEntry('word', 'word', 'v'));
  add(lexicalEntry('show', 'show', 'n'));
  add(lexicalEntry('show', 'show', 'v'));
  add(lexicalEntry('meaning', 'meaning', 'n'));
  add(lexicalEntry('write', 'write', 'v'));
  add(lexicalEntry('clear', 'clear', 'v'));
  add(lexicalEntry('clear', 'clear', 'adj'));
  add(lexicalEntry('sentence', 'sentence', 'n'));
  add(lexicalEntry('lead', 'lead', 'v', { confidence: 0.42, gloss: 'to guide' }));
  return Object.freeze({
    id: 'halo-fixture-provider',
    version: '0.3.0-test',
    lookup(surface, language) {
      const values = this.lookupAll(surface, language);
      return values[0] || null;
    },
    lookupAll(surface, language) {
      if (language !== 'en') return Object.freeze([]);
      return Object.freeze(entries.get(String(surface).toLowerCase()) || []);
    },
    lookupMorphology(surface, language) {
      if (language === 'en' && String(surface).toLowerCase() === 'children') {
        return Object.freeze([Object.freeze({
          inflected: 'children',
          lemma: 'child',
          simplifiedPos: 'n',
          datasetRef: {
            datasetId: 'princeton-wordnet-3.0-fixture',
            datasetVersion: '3.0-fixture.1',
            recordRef: 'noun.exc:1'
          }
        })]);
      }
      return Object.freeze([]);
    },
    status() {
      return Object.freeze({ mode: 'ready', fallbackActivated: false, failures: [] });
    }
  });
}

function annotate(text) {
  return Semantic.createSemanticEngine({ provider: fixtureProvider() }).annotateText(text, {
    languageMode: 'en',
    generatedAt: GENERATED_AT
  });
}

test('English semantic layer emits contract-valid tokens, lemmas, POS, refs, confidence, and provenance', () => {
  const set = annotate('The child reads books.');
  assert.doesNotThrow(() => Contracts.normalizeAnnotationSet(set));
  assert.deepEqual(set.tokens.map((token) => token.surface), ['The', 'child', 'reads', 'books']);
  assert.deepEqual(set.tokens.map((token) => token.lemma), ['the', 'child', 'read', 'book']);
  assert.deepEqual(set.tokens.map((token) => token.simplifiedPos), ['det', 'n', 'v', 'n']);
  assert.deepEqual(set.tokens.map(({ start, end }) => [start, end]), [[0, 3], [4, 9], [10, 15], [16, 21]]);

  for (const token of set.tokens) {
    assert.equal('The child reads books.'.slice(token.start, token.end), token.surface);
    assert.ok(token.annotations.length >= 2);
    assert.ok(token.annotations.every((annotation) => annotation.generatedAt === GENERATED_AT));
    assert.ok(token.annotations.every((annotation) => annotation.algorithm.version === '0.3.0'));
    assert.ok(token.provenance.length >= 1);
  }

  const reads = set.tokens[2];
  assert.deepEqual(reads.morphology, {
    form: 'third-person-singular',
    number: 'singular',
    person: 3,
    tense: 'present'
  });
  assert.deepEqual(reads.lexicalRefs, ['data.v:read']);
  assert.deepEqual(reads.glossRefs, ['data.v:read#gloss']);
  assert.equal(reads.annotations.find((annotation) => annotation.type === 'gloss').value, 'to interpret written language');
  assert.equal(reads.confidence, 0.9);

  const books = set.tokens[3];
  assert.deepEqual(books.morphology, { form: 'plural', number: 'plural' });
});

test('WordNet exception morphology resolves irregular surface without losing exception provenance', () => {
  const set = annotate('The children read.');
  const children = set.tokens[1];

  assert.equal(children.lemma, 'child');
  assert.equal(children.simplifiedPos, 'n');
  assert.deepEqual(children.morphology, { form: 'irregular', number: 'plural' });
  assert.ok(children.provenance.includes('morphology-exception:noun.exc:1'));
  assert.ok(children.annotations.some((annotation) =>
    annotation.type === 'morphology' && annotation.datasetRef.recordRef === 'noun.exc:1'));
});

test('unknown suffix-shaped words remain unknown instead of receiving fabricated lemma or POS', () => {
  const token = annotate('Zorbled.').tokens[0];

  assert.equal(token.simplifiedPos, 'x');
  assert.equal(Object.hasOwn(token, 'lemma'), false);
  assert.equal(Object.hasOwn(token, 'morphology'), false);
  assert.deepEqual(token.lexicalRefs, []);
  assert.deepEqual(token.glossRefs, []);
  assert.ok(token.confidence < 0.5);
  assert.deepEqual(token.annotations.map((annotation) => annotation.type), ['simplified-pos', 'unknown']);
  assert.equal(token.annotations[0].value, 'x');
});

test('low lexical confidence remains visible in canonical semantics', () => {
  const token = annotate('Lead.').tokens[0];

  assert.equal(token.simplifiedPos, 'v');
  assert.equal(token.confidence, 0.42);
  assert.equal(token.annotations.find((annotation) => annotation.type === 'simplified-pos').confidence, 0.42);
});

test('English annotation is deterministic for fixed text, provider, and generatedAt', () => {
  const first = annotate('The child reads books.');
  const second = annotate('The child reads books.');

  assert.deepEqual(second, first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.tokens), true);
});

test('English contextual selection resolves closed class, inflected object, and auxiliary-participle ambiguity', () => {
  const set = annotate('A child reads books. She is reading.');

  assert.deepEqual(set.tokens.map((token) => token.simplifiedPos), [
    'det', 'n', 'v', 'n', 'pron', 'aux', 'v'
  ]);
  assert.deepEqual(set.tokens.map((token) => token.lemma), [
    'a', 'child', 'read', 'book', 'she', 'be', 'read'
  ]);
  assert.deepEqual(set.tokens[3].morphology, { form: 'plural', number: 'plural' });
  assert.deepEqual(set.tokens[6].morphology, { form: 'present-participle' });
});

test('English contextual selection treats an adjective-following nominal as the subject before an inflected predicate', () => {
  const set = annotate('An important word shows meaning.');

  assert.deepEqual(set.tokens.map((token) => token.simplifiedPos), ['det', 'adj', 'n', 'v', 'n']);
  assert.deepEqual(set.tokens.map((token) => token.lemma), ['an', 'important', 'word', 'show', 'meaning']);
});

test('English contextual selection permits an adjective modifier before an object noun after the predicate', () => {
  const set = annotate('We write clear sentences.');

  assert.deepEqual(set.tokens.map((token) => token.simplifiedPos), ['pron', 'v', 'adj', 'n']);
  assert.deepEqual(set.tokens.map((token) => token.lemma), ['we', 'write', 'clear', 'sentence']);
});
