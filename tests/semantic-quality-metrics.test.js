const test = require('node:test');
const assert = require('node:assert/strict');

const Quality = require('../packages/quality/semantic-quality');

test('macro-F1 reports per-label precision, recall, and an unrounded aggregate', () => {
  const result = Quality.posMacroF1([
    { expected: 'n', predicted: 'n' },
    { expected: 'v', predicted: 'n' },
    { expected: 'n', predicted: 'n' }
  ]);

  assert.equal(result.macroF1, 0.4);
  assert.deepEqual(result.labels, {
    n: { support: 2, truePositive: 2, falsePositive: 1, falseNegative: 0, precision: 2 / 3, recall: 1, f1: 0.8 },
    v: { support: 1, truePositive: 0, falsePositive: 0, falseNegative: 1, precision: 0, recall: 0, f1: 0 }
  });
});

test('token-span segmentation metric counts exact spans without hiding over-segmentation', () => {
  const result = Quality.tokenSpanMetric(
    [{ start: 0, end: 1 }, { start: 1, end: 3 }],
    [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }]
  );

  assert.deepEqual(result, {
    expected: 2,
    predicted: 3,
    truePositive: 1,
    precision: 1 / 3,
    recall: 0.5,
    f1: 0.4
  });
});

test('fixture evaluation aligns exact spans and makes missing and extra tokens visible to POS scoring', () => {
  const fixture = {
    id: 'sample',
    text: 'Alpha beta',
    tokens: [
      { surface: 'Alpha', start: 0, end: 5, simplifiedPos: 'n' },
      { surface: 'beta', start: 6, end: 10, simplifiedPos: 'v' }
    ]
  };
  const annotationSet = {
    tokens: [
      { surface: 'Alpha', start: 0, end: 5, simplifiedPos: 'n' },
      { surface: 'be', start: 6, end: 8, simplifiedPos: 'v' },
      { surface: 'ta', start: 8, end: 10, simplifiedPos: 'n' }
    ]
  };

  const result = Quality.evaluateFixtureCase(fixture, annotationSet);
  assert.equal(result.exactTokenization, false);
  assert.deepEqual(result.posObservations, [
    { expected: 'n', predicted: 'n' },
    { expected: 'v', predicted: '__missing__' },
    { expected: '__extra__', predicted: 'v' },
    { expected: '__extra__', predicted: 'n' }
  ]);
  assert.equal(result.segmentation.f1, 0.4);
});
