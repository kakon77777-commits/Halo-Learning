const test = require('node:test');
const assert = require('node:assert/strict');

const Runner = require('../scripts/run-semantic-quality');

test('quality fixture materialization derives exact UTF-16 offsets without normalizing source text', () => {
  const fixture = Runner.materializeFixtureDocument({
    schemaVersion: 1,
    fixtureId: 'fixture',
    fixtureVersion: '1',
    locale: 'zh-Hant',
    cases: [{
      id: 'case',
      text: '𠀀 學習。',
      tokens: [
        { surface: '𠀀', simplifiedPos: 'x', unknown: true },
        { surface: '學習', simplifiedPos: 'v' }
      ]
    }]
  });

  assert.deepEqual(fixture.cases[0].tokens.map(({ start, end }) => [start, end]), [[0, 2], [3, 5]]);
  assert.equal(fixture.cases[0].text.slice(0, 2), '𠀀');
});

test('quality corpus evaluation exposes semantic expectation failures and aggregate observations', () => {
  const fixture = Runner.materializeFixtureDocument({
    schemaVersion: 1,
    fixtureId: 'fixture',
    fixtureVersion: '1',
    locale: 'en',
    cases: [{
      id: 'case',
      text: 'Books qzxv.',
      tokens: [
        { surface: 'Books', simplifiedPos: 'n', lemma: 'book', morphologyForm: 'plural' },
        { surface: 'qzxv', simplifiedPos: 'x', unknown: true }
      ]
    }]
  });
  const engine = {
    annotateText() {
      return {
        tokens: [
          { surface: 'Books', start: 0, end: 5, simplifiedPos: 'n', lemma: 'book', morphology: { form: 'plural' }, confidence: 0.9, lexicalRefs: ['wn:book'], annotations: [] },
          { surface: 'qzxv', start: 6, end: 10, simplifiedPos: 'x', confidence: 0.15, lexicalRefs: [], annotations: [] }
        ]
      };
    }
  };

  const result = Runner.evaluateCorpus(fixture, engine, '2026-08-25T00:00:00.000Z');
  assert.equal(result.caseCount, 1);
  assert.equal(result.tokenCount, 2);
  assert.equal(result.exactTokenizationCases, 1);
  assert.deepEqual(result.lemma, { expected: 1, passed: 1 });
  assert.deepEqual(result.morphology, { expected: 1, passed: 1 });
  assert.deepEqual(result.unknown, { expected: 1, passed: 1 });
  assert.equal(result.pos.macroF1, 1);
  assert.equal(result.segmentation.f1, 1);
});

test('quality command accepts only explicit write or verify modes', () => {
  assert.equal(Runner.parseMode(['--write']), 'write');
  assert.equal(Runner.parseMode(['--verify']), 'verify');
  assert.throws(() => Runner.parseMode([]), /--write\|--verify/);
});
