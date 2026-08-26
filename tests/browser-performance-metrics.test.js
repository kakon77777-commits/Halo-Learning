'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BUDGETS,
  MV3_REQUIRED_GATES,
  percentile,
  normalizeBrowserPerformance,
  evaluateBrowserPerformance,
  evaluateMv3Lifecycle
} = require('../packages/quality/browser-performance');

function samples(value, count = 20) {
  return Array.from({ length: count }, (_, index) => value + index / 1000);
}

function goodReport() {
  return {
    schemaVersion: 1,
    reportFormat: 'BrowserPerformanceReport/v1',
    browser: { name: 'Chromium', version: 'Chromium 151.0.0.0' },
    conditions: {
      cold: { firstUsableAnnotationMs: samples(40) },
      warm: {
        warmAnnotationMs: samples(20),
        primedHighlightMs: samples(15),
        localSentenceAnalysisMs: samples(30),
        corePanelFirstVisibleMs: samples(35),
        mainThreadLongTaskMs: [0]
      },
      bootstrap: { providerMode: 'bootstrap-only' },
      lexical: { coldRequiredShardsMs: samples(25), warmLookupMs: samples(5) }
    },
    memory: { heapPeakBytes: 'unknown' }
  };
}

test('browser performance budgets remain frozen at the v0.4 acceptance values', () => {
  assert.deepEqual(BUDGETS, {
    primedHighlightP95Ms: 100,
    localSentenceAnalysisP95Ms: 300,
    corePanelFirstVisibleP95Ms: 500,
    mainThreadLongTaskMaxMs: 50
  });
});

test('percentile is nearest-rank over raw measurements without pre-rounding', () => {
  const values = Array.from({ length: 20 }, (_, index) => 0.001 + index * 0.0011);
  assert.equal(percentile(values, 0.95), values.slice().sort((a, b) => a - b)[18]);
});

test('normalization requires at least twenty raw samples for each p95 metric and preserves unknown memory', () => {
  const report = goodReport();
  assert.equal(normalizeBrowserPerformance(report).memory.heapPeakBytes, 'unknown');
  report.conditions.warm.primedHighlightMs = samples(10, 19);
  assert.throws(() => normalizeBrowserPerformance(report), /twenty raw samples/i);
});

test('blocking performance evaluation compares raw p95 and long tasks to frozen budgets', () => {
  const evaluated = evaluateBrowserPerformance(goodReport());
  assert.equal(evaluated.allBlockingPassed, true);
  assert.ok(evaluated.measurements.primedHighlightP95Ms < BUDGETS.primedHighlightP95Ms);
  assert.ok(evaluated.measurements.localSentenceAnalysisP95Ms < BUDGETS.localSentenceAnalysisP95Ms);
  assert.ok(evaluated.measurements.corePanelFirstVisibleP95Ms < BUDGETS.corePanelFirstVisibleP95Ms);
  assert.ok(evaluated.measurements.mainThreadLongTaskMaxMs < BUDGETS.mainThreadLongTaskMaxMs);

  const bad = goodReport();
  bad.conditions.warm.primedHighlightMs = samples(100);
  assert.equal(evaluateBrowserPerformance(bad).gates.primedHighlight, false);
});

test('MV3 lifecycle acceptance requires every frozen v0.4 gate and rejects unknown as PASS', () => {
  assert.deepEqual(MV3_REQUIRED_GATES, [
    'coldStart',
    'workerRestart',
    'cacheLossReload',
    'inFlightCancellation',
    'tabClose',
    'extensionReload',
    'browserContextRestart',
    'versionMismatchRejected'
  ]);
  const pass = Object.fromEntries(MV3_REQUIRED_GATES.map((name) => [name, true]));
  assert.equal(evaluateMv3Lifecycle({ schemaVersion: 1, reportFormat: 'MV3LifecycleReport/v1', gates: pass }).allBlockingPassed, true);
  assert.equal(evaluateMv3Lifecycle({
    schemaVersion: 1,
    reportFormat: 'MV3LifecycleReport/v1',
    gates: { ...pass, workerRestart: 'unknown' }
  }).allBlockingPassed, false);
});
