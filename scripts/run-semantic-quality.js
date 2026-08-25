#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Quality = require('../packages/quality/semantic-quality');

const GENERATED_AT = '2026-08-25T00:00:00.000Z';
const REPORT_PATH = 'docs/validation/v0.3.0-semantic-quality.json';
const FIXTURE_PATHS = Object.freeze({
  en: 'tests/fixtures/quality/en-annotations.json',
  'zh-Hant': 'tests/fixtures/quality/zh-hant-annotations.json'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function materializeFixtureDocument(document) {
  if (!document || document.schemaVersion !== 1) throw new TypeError('quality fixture schemaVersion must be 1');
  if (!['en', 'zh-Hant'].includes(document.locale)) throw new TypeError('quality fixture locale must be en or zh-Hant');
  if (!Array.isArray(document.cases) || !document.cases.length) throw new TypeError('quality fixture cases must not be empty');
  const cases = document.cases.map((fixtureCase) => {
    if (!fixtureCase || typeof fixtureCase.id !== 'string' || typeof fixtureCase.text !== 'string' ||
        !Array.isArray(fixtureCase.tokens)) {
      throw new TypeError('quality fixture case requires id, text, and tokens');
    }
    let cursor = 0;
    const tokens = fixtureCase.tokens.map((token) => {
      if (!token || typeof token.surface !== 'string' || !token.surface || typeof token.simplifiedPos !== 'string') {
        throw new TypeError(`${fixtureCase.id}: every expected token requires surface and simplifiedPos`);
      }
      const start = fixtureCase.text.indexOf(token.surface, cursor);
      if (start < cursor) throw new TypeError(`${fixtureCase.id}: token ${token.surface} does not occur in source order`);
      const end = start + token.surface.length;
      cursor = end;
      return Object.freeze({ ...token, start, end });
    });
    return Object.freeze({ ...fixtureCase, tokens: Object.freeze(tokens) });
  });
  return deepFreeze({ ...document, cases });
}

function aggregateSegmentation(caseResults) {
  const expected = caseResults.reduce((total, item) => total + item.segmentation.expected, 0);
  const predicted = caseResults.reduce((total, item) => total + item.segmentation.predicted, 0);
  const truePositive = caseResults.reduce((total, item) => total + item.segmentation.truePositive, 0);
  const precision = predicted ? truePositive / predicted : 0;
  const recall = expected ? truePositive / expected : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return Object.freeze({ expected, predicted, truePositive, precision, recall, f1 });
}

function expectationCounter() {
  return { expected: 0, passed: 0 };
}

function evaluateCorpus(fixture, engine, generatedAt) {
  const caseResults = [];
  const observations = [];
  const lemma = expectationCounter();
  const morphology = expectationCounter();
  const simplifiedForm = expectationCounter();
  const unknown = expectationCounter();
  let tokenCount = 0;
  let tokensWithLexicalRefs = 0;
  let validConfidenceTokens = 0;
  for (const fixtureCase of fixture.cases) {
    const annotationSet = engine.annotateText(fixtureCase.text, {
      languageMode: fixture.locale,
      generatedAt
    });
    const result = Quality.evaluateFixtureCase(fixtureCase, annotationSet);
    const predictedBySpan = new Map(annotationSet.tokens.map((token) => [`${token.start}:${token.end}`, token]));
    for (const expected of fixtureCase.tokens) {
      const predicted = predictedBySpan.get(`${expected.start}:${expected.end}`);
      if (Object.hasOwn(expected, 'lemma')) {
        lemma.expected += 1;
        if (predicted && predicted.lemma === expected.lemma) lemma.passed += 1;
      }
      if (Object.hasOwn(expected, 'morphologyForm')) {
        morphology.expected += 1;
        if (predicted && predicted.morphology && predicted.morphology.form === expected.morphologyForm) morphology.passed += 1;
      }
      if (Object.hasOwn(expected, 'simplified')) {
        simplifiedForm.expected += 1;
        const annotation = predicted && predicted.annotations.find((item) => item.type === 'simplified-form');
        if (annotation && annotation.value === expected.simplified) simplifiedForm.passed += 1;
      }
      if (expected.unknown) {
        unknown.expected += 1;
        if (predicted && predicted.simplifiedPos === 'x' && !Object.hasOwn(predicted, 'lemma') &&
            Array.isArray(predicted.lexicalRefs) && predicted.lexicalRefs.length === 0 && predicted.confidence < 0.5) {
          unknown.passed += 1;
        }
      }
    }
    tokenCount += annotationSet.tokens.length;
    tokensWithLexicalRefs += annotationSet.tokens.filter((token) => Array.isArray(token.lexicalRefs) && token.lexicalRefs.length).length;
    validConfidenceTokens += annotationSet.tokens.filter((token) => Number.isFinite(token.confidence) && token.confidence >= 0 && token.confidence <= 1).length;
    observations.push(...result.posObservations);
    caseResults.push(Object.freeze({
      id: result.id,
      exactTokenization: result.exactTokenization,
      posErrors: result.posObservations.filter((item) => item.expected !== item.predicted).length,
      segmentation: result.segmentation
    }));
  }
  return deepFreeze({
    fixtureId: fixture.fixtureId,
    fixtureVersion: fixture.fixtureVersion,
    caseCount: fixture.cases.length,
    tokenCount,
    exactTokenizationCases: caseResults.filter((item) => item.exactTokenization).length,
    pos: Quality.posMacroF1(observations),
    segmentation: aggregateSegmentation(caseResults),
    lemma,
    morphology,
    simplifiedForm,
    unknown,
    lexicalEvidence: { tokensWithLexicalRefs, tokenCount },
    confidence: { valid: validConfidenceTokens, tokenCount },
    cases: caseResults
  });
}

function readFixture(projectRoot, locale) {
  const filePath = path.join(projectRoot, FIXTURE_PATHS[locale]);
  return materializeFixtureDocument(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function checksPass(corpus) {
  return corpus.exactTokenizationCases === corpus.caseCount &&
    corpus.lemma.passed === corpus.lemma.expected &&
    corpus.morphology.passed === corpus.morphology.expected &&
    corpus.simplifiedForm.passed === corpus.simplifiedForm.expected &&
    corpus.unknown.passed === corpus.unknown.expected &&
    corpus.confidence.valid === corpus.confidence.tokenCount;
}

function buildQualityReport(projectRoot) {
  const { loadRuntimeLexicalIndex } = require('../packages/lexical-index/runtime-lexical-index');
  const Dictionary = require('../apps/extension/src/shared/dictionary-provider');
  const RuntimeDictionary = require('../apps/extension/src/shared/runtime-dictionary-provider');
  const Semantic = require('../apps/extension/src/shared/semantic-annotations');
  const serialized = fs.readFileSync(path.join(projectRoot, 'apps/extension/data/lexical-runtime-index.json'), 'utf8');
  const runtimeIndex = loadRuntimeLexicalIndex(serialized);
  const provider = RuntimeDictionary.createProviderChain({
    runtimeIndex,
    bootstrapProvider: Dictionary.createBootstrapDictionaryProvider()
  });
  const engine = Semantic.createSemanticEngine({ provider });
  const english = evaluateCorpus(readFixture(projectRoot, 'en'), engine, GENERATED_AT);
  const traditionalChinese = evaluateCorpus(readFixture(projectRoot, 'zh-Hant'), engine, GENERATED_AT);
  const threshold = 0.9;
  const gateChecks = {
    englishPosMacroF1: english.pos.macroF1 >= threshold,
    chinesePosMacroF1: traditionalChinese.pos.macroF1 >= threshold,
    chineseTokenSpanF1: traditionalChinese.segmentation.f1 >= threshold,
    englishSemanticExpectations: checksPass(english),
    chineseSemanticExpectations: checksPass(traditionalChinese),
    runtimeProviderReady: provider.status().mode === 'ready' && !provider.status().fallbackActivated
  };
  return deepFreeze({
    schemaVersion: 1,
    release: 'v0.3.0',
    generatedAt: GENERATED_AT,
    runtimeIndex: {
      indexId: runtimeIndex.indexId,
      hash: runtimeIndex.hash,
      providerStatus: provider.status()
    },
    fixtureScale: {
      caseCount: english.caseCount + traditionalChinese.caseCount,
      tokenCount: english.tokenCount + traditionalChinese.tokenCount,
      english: { cases: english.caseCount, tokens: english.tokenCount },
      traditionalChinese: { cases: traditionalChinese.caseCount, tokens: traditionalChinese.tokenCount }
    },
    quality: {
      englishPosMacroF1: english.pos.macroF1,
      chinesePosMacroF1: traditionalChinese.pos.macroF1,
      chineseSegmentationTokenSpan: traditionalChinese.segmentation
    },
    corpora: { english, traditionalChinese },
    gate: {
      threshold,
      checks: gateChecks,
      pass: Object.values(gateChecks).every(Boolean)
    },
    limitations: [
      'The quality corpus is a small, authored 22-case/97-token regression fixture and is not a statistically representative NLP benchmark.',
      'CC-CEDICT supplies lexical forms and glosses but is not a comprehensive POS corpus; the Chinese POS layer remains a conservative curated/rule projection with explicit evidence.',
      'English contextual disambiguation is intentionally bounded and deterministic; broad-domain production-grade accuracy is not claimed.'
    ]
  });
}

function parseMode(args) {
  if (args.length !== 1 || !['--write', '--verify'].includes(args[0])) {
    throw new TypeError('usage: node scripts/run-semantic-quality.js --write|--verify');
  }
  return args[0].slice(2);
}

function publishReport(report, projectRoot, mode) {
  const filePath = path.join(projectRoot, REPORT_PATH);
  const content = `${JSON.stringify(report, null, 2)}\n`;
  if (mode === 'verify') {
    if (fs.readFileSync(filePath, 'utf8') !== content) throw new Error(`${REPORT_PATH} does not match fresh semantic quality results`);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { flag: 'wx' });
  fs.renameSync(temporary, filePath);
}

function main(args) {
  const mode = parseMode(args);
  const projectRoot = process.cwd();
  const report = buildQualityReport(projectRoot);
  publishReport(report, projectRoot, mode);
  process.stdout.write(`${JSON.stringify({
    mode,
    pass: report.gate.pass,
    englishPosMacroF1: report.quality.englishPosMacroF1,
    chinesePosMacroF1: report.quality.chinesePosMacroF1,
    chineseSegmentationF1: report.quality.chineseSegmentationTokenSpan.f1,
    fixtureCases: report.fixtureScale.caseCount,
    fixtureTokens: report.fixtureScale.tokenCount
  })}\n`);
  if (!report.gate.pass) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  GENERATED_AT,
  REPORT_PATH,
  FIXTURE_PATHS,
  materializeFixtureDocument,
  evaluateCorpus,
  buildQualityReport,
  parseMode,
  publishReport
});
