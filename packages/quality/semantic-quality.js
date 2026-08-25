'use strict';

function finiteRatio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function f1Score(precision, recall) {
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function posMacroF1(observations) {
  if (!Array.isArray(observations)) throw new TypeError('observations: must be an array');
  const labels = [...new Set(observations
    .map((observation) => observation && observation.expected)
    .filter((label) => typeof label === 'string' && label && !label.startsWith('__')))].sort();
  const details = {};
  let total = 0;
  for (const label of labels) {
    const truePositive = observations.filter((item) => item.expected === label && item.predicted === label).length;
    const falsePositive = observations.filter((item) => item.expected !== label && item.predicted === label).length;
    const falseNegative = observations.filter((item) => item.expected === label && item.predicted !== label).length;
    const support = observations.filter((item) => item.expected === label).length;
    const precision = finiteRatio(truePositive, truePositive + falsePositive);
    const recall = finiteRatio(truePositive, truePositive + falseNegative);
    const f1 = f1Score(precision, recall);
    details[label] = { support, truePositive, falsePositive, falseNegative, precision, recall, f1 };
    total += f1;
  }
  return Object.freeze({
    macroF1: finiteRatio(total, labels.length),
    labels: Object.freeze(details)
  });
}

function spanKey(token) {
  return `${token.start}:${token.end}`;
}

function tokenSpanMetric(expectedTokens, predictedTokens) {
  if (!Array.isArray(expectedTokens) || !Array.isArray(predictedTokens)) {
    throw new TypeError('expectedTokens and predictedTokens must be arrays');
  }
  const expectedSpans = new Set(expectedTokens.map(spanKey));
  const predictedSpans = new Set(predictedTokens.map(spanKey));
  let truePositive = 0;
  for (const span of predictedSpans) if (expectedSpans.has(span)) truePositive += 1;
  const precision = finiteRatio(truePositive, predictedSpans.size);
  const recall = finiteRatio(truePositive, expectedSpans.size);
  return Object.freeze({
    expected: expectedSpans.size,
    predicted: predictedSpans.size,
    truePositive,
    precision,
    recall,
    f1: f1Score(precision, recall)
  });
}

function evaluateFixtureCase(fixture, annotationSet) {
  if (!fixture || typeof fixture !== 'object' || !Array.isArray(fixture.tokens)) {
    throw new TypeError('fixture.tokens: must be an array');
  }
  if (!annotationSet || typeof annotationSet !== 'object' || !Array.isArray(annotationSet.tokens)) {
    throw new TypeError('annotationSet.tokens: must be an array');
  }
  const predictedBySpan = new Map(annotationSet.tokens.map((token) => [spanKey(token), token]));
  const expectedSpans = new Set(fixture.tokens.map(spanKey));
  const posObservations = fixture.tokens.map((expected) => {
    const predicted = predictedBySpan.get(spanKey(expected));
    return Object.freeze({
      expected: expected.simplifiedPos,
      predicted: predicted ? predicted.simplifiedPos : '__missing__'
    });
  });
  for (const predicted of annotationSet.tokens) {
    if (!expectedSpans.has(spanKey(predicted))) {
      posObservations.push(Object.freeze({ expected: '__extra__', predicted: predicted.simplifiedPos }));
    }
  }
  const exactTokenization = fixture.tokens.length === annotationSet.tokens.length &&
    fixture.tokens.every((expected, index) => {
      const predicted = annotationSet.tokens[index];
      return predicted && expected.surface === predicted.surface && expected.start === predicted.start && expected.end === predicted.end;
    });
  return Object.freeze({
    id: fixture.id,
    exactTokenization,
    posObservations: Object.freeze(posObservations),
    segmentation: tokenSpanMetric(fixture.tokens, annotationSet.tokens)
  });
}

module.exports = Object.freeze({ posMacroF1, tokenSpanMetric, evaluateFixtureCase });
