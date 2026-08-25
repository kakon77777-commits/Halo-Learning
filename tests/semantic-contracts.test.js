const test = require('node:test');
const assert = require('node:assert/strict');

const {
  annotationFixture,
  tokenFixture,
  annotationSetFixture,
  markingProfileFixture
} = require('./fixtures/semantic-contracts');
const Contracts = require('../packages/contracts/semantic-contracts');

test('semantic annotation preserves provider, algorithm, dataset, confidence, and provenance', () => {
  const annotation = Contracts.normalizeSemanticAnnotation(annotationFixture());

  assert.equal(annotation.type, 'simplified-pos');
  assert.equal(annotation.value, 'v');
  assert.equal(annotation.confidence, 0.97);
  assert.deepEqual(annotation.provider, { id: 'halo-runtime-dictionary', version: '0.3.0' });
  assert.equal(annotation.datasetRef.datasetVersion, '3.0');
  assert.equal(annotation.generatedAt, '2026-08-25T08:00:00.000Z');
  assert.equal(Object.isFrozen(annotation), true);
  assert.equal(Object.isFrozen(annotation.datasetRef), true);
});

test('semantic annotation rejects unsafe values and incomplete evidence', () => {
  assert.throws(
    () => Contracts.normalizeSemanticAnnotation(annotationFixture({ confidence: 1.01 })),
    /confidence/
  );
  assert.throws(
    () => Contracts.normalizeSemanticAnnotation(annotationFixture({ value: () => 'not JSON' })),
    /value/
  );
  assert.throws(
    () => Contracts.normalizeSemanticAnnotation(annotationFixture({ provider: { id: 'missing-version' } })),
    /provider\.version/
  );
  assert.throws(
    () => Contracts.normalizeSemanticAnnotation(annotationFixture({ generatedAt: 'today' })),
    /generatedAt/
  );
});

test('semantic token validates offsets, established optional fields, and unknown analyses', () => {
  const known = Contracts.normalizeSemanticToken(tokenFixture());
  const unknown = Contracts.normalizeSemanticToken(tokenFixture({
    tokenId: 'token:en:0:7',
    surface: 'Zorbled',
    normalizedSurface: 'zorbled',
    start: 0,
    end: 7,
    lemma: undefined,
    simplifiedPos: 'x',
    morphology: undefined,
    grammarRole: undefined,
    tenseAspect: undefined,
    glossRefs: [],
    lexicalRefs: [],
    confidence: 0.12,
    provenance: ['analysis:unknown'],
    priority: 0.1,
    annotations: [
      annotationFixture({
        annotationId: 'ann:en:0:7:simplified-pos',
        type: 'simplified-pos',
        value: 'x',
        confidence: 0.12,
        datasetRef: undefined,
        source: 'unknown-handler'
      }),
      annotationFixture({
        annotationId: 'ann:en:0:7:unknown',
        type: 'unknown',
        value: true,
        confidence: 0.12,
        datasetRef: undefined,
        source: 'unknown-handler'
      })
    ]
  }));

  assert.equal(known.end - known.start, known.surface.length);
  assert.equal(unknown.simplifiedPos, 'x');
  assert.equal(Object.hasOwn(unknown, 'lemma'), false);
  assert.deepEqual(unknown.lexicalRefs, []);
  assert.equal(Object.isFrozen(known.annotations), true);

  assert.throws(
    () => Contracts.normalizeSemanticToken(tokenFixture({ end: 4 })),
    /end/
  );
  assert.throws(
    () => Contracts.normalizeSemanticToken(tokenFixture({ language: 'zh' })),
    /language/
  );
});

test('canonical derived token fields require matching annotation evidence', () => {
  const missingLemmaEvidence = tokenFixture();
  missingLemmaEvidence.annotations = missingLemmaEvidence.annotations.filter((item) => item.type !== 'lemma');
  assert.throws(
    () => Contracts.normalizeSemanticToken(missingLemmaEvidence),
    /lemma.*annotation evidence/i
  );

  const mismatchedPosEvidence = tokenFixture();
  mismatchedPosEvidence.annotations = mismatchedPosEvidence.annotations.map((item) =>
    item.type === 'simplified-pos' ? { ...item, value: 'n' } : item);
  assert.throws(
    () => Contracts.normalizeSemanticToken(mismatchedPosEvidence),
    /simplifiedPos.*annotation evidence/i
  );
});

test('annotation set enforces deterministic token order, non-overlap, and text bounds', () => {
  const set = Contracts.normalizeAnnotationSet(annotationSetFixture());

  assert.equal(set.tokens.length, 2);
  assert.equal(set.tokens[1].start, 6);
  assert.equal(set.diagnostics.fallbackActivated, false);
  assert.equal(Object.isFrozen(set.tokens), true);

  const overlapping = annotationSetFixture();
  overlapping.tokens[1] = tokenFixture({ start: 4, end: 9, surface: 'sbook' });
  assert.throws(() => Contracts.normalizeAnnotationSet(overlapping), /overlap|order/);

  assert.throws(
    () => Contracts.normalizeAnnotationSet(annotationSetFixture({ textLength: 10 })),
    /textLength/
  );
});

test('MarkingProfile/v2 exposes every semantic channel as an independent switch', () => {
  const profile = Contracts.normalizeMarkingProfile(markingProfileFixture());
  assert.equal(profile.triggerMode, 'hybrid');
  assert.deepEqual(Object.keys(profile.channels).sort(), [
    'chunk', 'glossHint', 'grammarRole', 'learningState', 'lemma',
    'morphology', 'posColor', 'posLabel', 'tenseAspect'
  ]);
  assert.equal(Object.isFrozen(profile.channels), true);

  const missingChannel = markingProfileFixture();
  delete missingChannel.channels.glossHint;
  assert.throws(() => Contracts.normalizeMarkingProfile(missingChannel), /channels\.glossHint/);
  for (const triggerMode of ['adaptive-hover', 'explicit-only', 'hybrid']) {
    assert.equal(Contracts.normalizeMarkingProfile(markingProfileFixture({ triggerMode })).triggerMode, triggerMode);
  }
  assert.throws(
    () => Contracts.normalizeMarkingProfile(markingProfileFixture({ triggerMode: 'hover' })),
    /triggerMode/
  );
});

test('legacy v0.1 token migration is explicit and does not invent lexical evidence', () => {
  const migrated = Contracts.migrateLegacySemanticToken({
    text: 'Reads',
    start: 0,
    end: 5,
    lang: 'en',
    pos: 'v',
    confidence: 0.76,
    source: 'suffix-heuristic',
    priority: 0.85
  }, {
    generatedAt: '2026-08-25T08:00:00.000Z',
    tokenId: 'legacy:en:0:5'
  });

  assert.equal(migrated.surface, 'Reads');
  assert.equal(migrated.language, 'en');
  assert.equal(migrated.simplifiedPos, 'v');
  assert.deepEqual(migrated.lexicalRefs, []);
  assert.deepEqual(migrated.glossRefs, []);
  assert.equal(Object.hasOwn(migrated, 'lemma'), false);
  assert.equal(migrated.annotations[0].algorithm.id, 'halo-legacy-token-adapter');
});
