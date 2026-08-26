'use strict';

const BUDGETS = Object.freeze({
  primedHighlightP95Ms: 100,
  localSentenceAnalysisP95Ms: 300,
  corePanelFirstVisibleP95Ms: 500,
  mainThreadLongTaskMaxMs: 50
});

const MV3_REQUIRED_GATES = Object.freeze([
  'coldStart',
  'workerRestart',
  'cacheLossReload',
  'inFlightCancellation',
  'tabClose',
  'extensionReload',
  'browserContextRestart',
  'versionMismatchRejected'
]);

function assertFiniteSamples(values, label, minimum = 1) {
  if (!Array.isArray(values) || values.length < minimum) {
    throw new TypeError(`${label} requires at least ${minimum === 20 ? 'twenty raw samples' : minimum + ' raw sample(s)'}`);
  }
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} contains invalid raw measurement`);
  }
  return values.slice();
}

function percentile(values, fraction) {
  const samples = assertFiniteSamples(values, 'percentile');
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) throw new RangeError('percentile fraction must be in (0, 1]');
  samples.sort((a, b) => a - b);
  return samples[Math.max(0, Math.ceil(fraction * samples.length) - 1)];
}

function normalizeBrowserPerformance(report) {
  if (!report || report.schemaVersion !== 1 || report.reportFormat !== 'BrowserPerformanceReport/v1') {
    throw new TypeError('invalid BrowserPerformanceReport/v1');
  }
  const conditions = report.conditions || {};
  const cold = conditions.cold || {};
  const warm = conditions.warm || {};
  const lexical = conditions.lexical || {};
  assertFiniteSamples(cold.firstUsableAnnotationMs, 'cold.firstUsableAnnotationMs', 20);
  assertFiniteSamples(warm.warmAnnotationMs, 'warm.warmAnnotationMs', 20);
  assertFiniteSamples(warm.primedHighlightMs, 'warm.primedHighlightMs', 20);
  assertFiniteSamples(warm.localSentenceAnalysisMs, 'warm.localSentenceAnalysisMs', 20);
  assertFiniteSamples(warm.corePanelFirstVisibleMs, 'warm.corePanelFirstVisibleMs', 20);
  assertFiniteSamples(warm.mainThreadLongTaskMs, 'warm.mainThreadLongTaskMs');
  assertFiniteSamples(lexical.coldRequiredShardsMs, 'lexical.coldRequiredShardsMs', 20);
  assertFiniteSamples(lexical.warmLookupMs, 'lexical.warmLookupMs', 20);
  const heapPeakBytes = report.memory && report.memory.heapPeakBytes;
  if (heapPeakBytes !== 'unknown' && (!Number.isFinite(heapPeakBytes) || heapPeakBytes < 0)) {
    throw new TypeError('memory.heapPeakBytes must be a nonnegative measurement or unknown');
  }
  return JSON.parse(JSON.stringify(report));
}

function evaluateBrowserPerformance(report) {
  const normalized = normalizeBrowserPerformance(report);
  const warm = normalized.conditions.warm;
  const measurements = Object.freeze({
    primedHighlightP95Ms: percentile(warm.primedHighlightMs, 0.95),
    localSentenceAnalysisP95Ms: percentile(warm.localSentenceAnalysisMs, 0.95),
    corePanelFirstVisibleP95Ms: percentile(warm.corePanelFirstVisibleMs, 0.95),
    mainThreadLongTaskMaxMs: Math.max(...warm.mainThreadLongTaskMs)
  });
  const gates = Object.freeze({
    primedHighlight: measurements.primedHighlightP95Ms <= BUDGETS.primedHighlightP95Ms,
    localSentenceAnalysis: measurements.localSentenceAnalysisP95Ms <= BUDGETS.localSentenceAnalysisP95Ms,
    corePanelFirstVisible: measurements.corePanelFirstVisibleP95Ms <= BUDGETS.corePanelFirstVisibleP95Ms,
    mainThreadLongTask: measurements.mainThreadLongTaskMaxMs <= BUDGETS.mainThreadLongTaskMaxMs
  });
  return Object.freeze({ normalized, measurements, gates, allBlockingPassed: Object.values(gates).every(Boolean) });
}

function evaluateMv3Lifecycle(report) {
  if (!report || report.schemaVersion !== 1 || report.reportFormat !== 'MV3LifecycleReport/v1') {
    throw new TypeError('invalid MV3LifecycleReport/v1');
  }
  const input = report.gates || {};
  const gates = Object.fromEntries(MV3_REQUIRED_GATES.map((name) => [name, input[name] === true]));
  return Object.freeze({ gates: Object.freeze(gates), allBlockingPassed: Object.values(gates).every(Boolean) });
}

module.exports = {
  BUDGETS,
  MV3_REQUIRED_GATES,
  percentile,
  normalizeBrowserPerformance,
  evaluateBrowserPerformance,
  evaluateMv3Lifecycle
};
