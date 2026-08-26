from pathlib import Path


def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return source.replace(old, new, 1)


path = Path('scripts/profile-browser-runtime.js')
source = path.read_text(encoding='utf-8')

if 'function summarizeShardColdDecomposition(samples)' not in source:
    old = """function evaluateShardCandidate(candidate) {
  const coldValues = candidate.conditions.cold.samples.map((sample) => sample.durationMs);
  const warmValues = candidate.conditions.warm.samples.flatMap((sample) => sample.samplesMs);
  const longTaskValues = candidate.conditions.longTasks.samples.flatMap((sample) => sample.durationsMs);
  const measurements = Object.freeze({
    coldRequiredShardsP95Ms: percentile(coldValues, 0.95),
    warmLookupP95Ms: percentile(warmValues, 0.95),
    longTaskMaxMs: longTaskValues.length ? Math.max(...longTaskValues) : 0
  });
"""
    new = """function summarizeMetricValues(values) {
  return Object.freeze({
    p50: percentile(values, 0.50),
    p95: percentile(values, 0.95),
    max: Math.max(...values)
  });
}

function summarizeShardColdDecomposition(samples) {
  if (!Array.isArray(samples) || samples.length === 0 || samples.some((sample) =>
      !sample || !sample.decomposition || !sample.decomposition.stageMs ||
      typeof sample.decomposition.stageMs !== 'object')) {
    throw new TypeError('cold decomposition requires non-empty stage samples');
  }
  const names = [...new Set(samples.flatMap((sample) => Object.keys(sample.decomposition.stageMs)))].sort();
  const stages = names.map((name) => {
    const values = samples.map((sample) => sample.decomposition.stageMs[name]);
    if (values.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new TypeError(`cold decomposition stage ${name} is incomplete`);
    }
    const summary = summarizeMetricValues(values);
    return Object.freeze({ name, p50Ms: summary.p50, p95Ms: summary.p95, maxMs: summary.max });
  });
  const byteSummary = summarizeMetricValues(samples.map((sample) => sample.decomposition.bytesLoaded));
  const shardSummary = summarizeMetricValues(samples.map((sample) => sample.decomposition.shardCount));
  const heapValues = samples.map((sample) => sample.decomposition.usedJsHeapBytes)
    .filter((value) => Number.isFinite(value) && value >= 0);
  return Object.freeze({
    sampleCount: samples.length,
    stages: Object.freeze(stages),
    bytesLoaded: Object.freeze({ p50: byteSummary.p50, p95: byteSummary.p95, max: byteSummary.max }),
    shardCount: Object.freeze({ p50: shardSummary.p50, p95: shardSummary.p95, max: shardSummary.max }),
    usedJsHeapBytes: Object.freeze({
      measurableSamples: heapValues.length,
      max: heapValues.length ? Math.max(...heapValues) : 'unknown'
    })
  });
}

function evaluateShardCandidate(candidate) {
  const coldValues = candidate.conditions.cold.samples.map((sample) => sample.durationMs);
  const warmValues = candidate.conditions.warm.samples.flatMap((sample) => sample.samplesMs);
  const longTaskValues = candidate.conditions.longTasks.samples.flatMap((sample) => sample.durationsMs);
  const measurements = Object.freeze({
    coldRequiredShardsP50Ms: percentile(coldValues, 0.50),
    coldRequiredShardsP95Ms: percentile(coldValues, 0.95),
    coldRequiredShardsMaxMs: Math.max(...coldValues),
    warmLookupP50Ms: percentile(warmValues, 0.50),
    warmLookupP95Ms: percentile(warmValues, 0.95),
    warmLookupMaxMs: Math.max(...warmValues),
    longTaskP50Ms: longTaskValues.length ? percentile(longTaskValues, 0.50) : 0,
    longTaskP95Ms: longTaskValues.length ? percentile(longTaskValues, 0.95) : 0,
    longTaskMaxMs: longTaskValues.length ? Math.max(...longTaskValues) : 0
  });
"""
    source = replace_once(source, old, new, 'decomposition summarizer')

if "const profile = { stageMs: {} };" not in source:
    old = """      const coldStarted = performance.now();
      const manifestResponse = await fetch(chrome.runtime.getURL('data/manifest.json'), { cache: 'no-store' });
      if (!manifestResponse.ok) throw new Error('candidate manifest fetch failed');
      const manifest = await globalThis.HaloRuntimeShardBrowser.loadBrowserLexicalManifest(await manifestResponse.text());
      const runtime = globalThis.HaloRuntimeShardBrowser.createBrowserLexicalRuntime({
        manifest,
        readText: async (resourcePath, loadOptions) => {
          const response = await fetch(chrome.runtime.getURL(`data/${resourcePath}`), {
            cache: 'no-store',
            signal: loadOptions && loadOptions.signal
          });
          if (!response.ok) throw new Error('candidate shard fetch failed');
          return response.text();
        }
      });
      const ids = runtime.requiredShardIds([fixtureText], 'both');
      await runtime.ensureShards(ids);
      const coldDurationMs = performance.now() - coldStarted;
      function lookupFixture(shards) {
        let evidenceCount = 0;
        for (const shard of shards) {
          evidenceCount += shard.lookup('models', 'en').length;
          evidenceCount += shard.lookupMorphology('learning', 'en').length;
          const match = shard.longestMatch('學生學習', 0, 'zh-Hant');
          if (match) evidenceCount += match.entries.length;
        }
        return evidenceCount;
      }
      const warmSamplesMs = [];
      let evidenceCount = 0;
      for (let index = 0; index < warmAnnotations; index += 1) {
        const started = performance.now();
        evidenceCount += runtime.withPinnedShards(ids, lookupFixture);
        warmSamplesMs.push(performance.now() - started);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (observer) observer.disconnect();
      return {
        coldDurationMs,
        warmSamplesMs,
        longTaskDurationsMs: longTasks,
        requiredShardCount: ids.length,
        evidenceCount,
        residentShardCount: runtime.status().residentCount
      };
"""
    new = """      const coldStarted = performance.now();
      const profile = { stageMs: {} };
      const encoder = new TextEncoder();
      let bytesLoaded = 0;
      let started = performance.now();
      const manifestResponse = await fetch(chrome.runtime.getURL('data/manifest.json'), { cache: 'no-store' });
      profile.stageMs.manifestFetchMs = performance.now() - started;
      if (!manifestResponse.ok) throw new Error('candidate manifest fetch failed');
      started = performance.now();
      const manifestText = await manifestResponse.text();
      profile.stageMs.manifestTextDecodeMs = performance.now() - started;
      bytesLoaded += encoder.encode(manifestText).length;
      const manifest = await globalThis.HaloRuntimeShardBrowser.loadBrowserLexicalManifest(manifestText, { profile });
      const runtime = globalThis.HaloRuntimeShardBrowser.createBrowserLexicalRuntime({
        manifest,
        profile,
        readText: async (resourcePath, loadOptions) => {
          let readStarted = performance.now();
          const response = await fetch(chrome.runtime.getURL(`data/${resourcePath}`), {
            cache: 'no-store',
            signal: loadOptions && loadOptions.signal
          });
          profile.stageMs.shardFetchMs = (profile.stageMs.shardFetchMs || 0) + (performance.now() - readStarted);
          if (!response.ok) throw new Error('candidate shard fetch failed');
          readStarted = performance.now();
          const text = await response.text();
          profile.stageMs.shardTextDecodeMs = (profile.stageMs.shardTextDecodeMs || 0) +
            (performance.now() - readStarted);
          bytesLoaded += encoder.encode(text).length;
          return text;
        }
      });
      started = performance.now();
      const ids = runtime.requiredShardIds([fixtureText], 'both');
      profile.stageMs.shardSelectionMs = performance.now() - started;
      started = performance.now();
      await runtime.ensureShards(ids);
      const coldDurationMs = performance.now() - coldStarted;
      profile.stageMs.lookupReadinessMs = performance.now() - started;
      function lookupFixture(shards) {
        let evidenceCount = 0;
        for (const shard of shards) {
          evidenceCount += shard.lookup('models', 'en').length;
          evidenceCount += shard.lookupMorphology('learning', 'en').length;
          const match = shard.longestMatch('學生學習', 0, 'zh-Hant');
          if (match) evidenceCount += match.entries.length;
        }
        return evidenceCount;
      }
      started = performance.now();
      let evidenceCount = runtime.withPinnedShards(ids, lookupFixture);
      profile.stageMs.firstSemanticConsumerMs = performance.now() - started;
      const warmSamplesMs = [];
      for (let index = 0; index < warmAnnotations; index += 1) {
        const warmStarted = performance.now();
        evidenceCount += runtime.withPinnedShards(ids, lookupFixture);
        warmSamplesMs.push(performance.now() - warmStarted);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (observer) observer.disconnect();
      const usedJsHeapBytes = performance.memory && Number.isFinite(performance.memory.usedJSHeapSize)
        ? Math.round(performance.memory.usedJSHeapSize)
        : 'unknown';
      return {
        coldDurationMs,
        warmSamplesMs,
        longTaskDurationsMs: longTasks,
        requiredShardCount: ids.length,
        evidenceCount,
        residentShardCount: runtime.status().residentCount,
        decomposition: {
          stageMs: profile.stageMs,
          bytesLoaded,
          shardCount: ids.length,
          usedJsHeapBytes
        }
      };
"""
    source = replace_once(source, old, new, 'cold context instrumentation')

if 'bottleneckDecomposition: summarizeShardColdDecomposition(coldSamples)' not in source:
    old = """    if (!Array.isArray(sample.warmSamplesMs) || sample.warmSamplesMs.length < warmAnnotations ||
        !Array.isArray(sample.longTaskDurationsMs) || !Number.isFinite(sample.coldDurationMs)) {
      throw new Error('browser shard comparison sample is incomplete');
    }
    coldSamples.push(Object.freeze({
      condition: 'cold',
      contextIndex,
      durationMs: sample.coldDurationMs,
      requiredShardCount: sample.requiredShardCount,
      residentShardCount: sample.residentShardCount
    }));
"""
    new = """    if (!Array.isArray(sample.warmSamplesMs) || sample.warmSamplesMs.length < warmAnnotations ||
        !Array.isArray(sample.longTaskDurationsMs) || !Number.isFinite(sample.coldDurationMs) ||
        !sample.decomposition || !sample.decomposition.stageMs) {
      throw new Error('browser shard comparison sample is incomplete');
    }
    coldSamples.push(Object.freeze({
      condition: 'cold',
      contextIndex,
      durationMs: sample.coldDurationMs,
      requiredShardCount: sample.requiredShardCount,
      residentShardCount: sample.residentShardCount,
      decomposition: Object.freeze({
        stageMs: Object.freeze({ ...sample.decomposition.stageMs }),
        bytesLoaded: sample.decomposition.bytesLoaded,
        shardCount: sample.decomposition.shardCount,
        usedJsHeapBytes: sample.decomposition.usedJsHeapBytes
      })
    }));
"""
    source = replace_once(source, old, new, 'cold sample decomposition')

    old = """    sizes: candidateSizes(options.artifacts),
    browserVersion,
    conditions: Object.freeze({
"""
    new = """    sizes: candidateSizes(options.artifacts),
    browserVersion,
    bottleneckDecomposition: summarizeShardColdDecomposition(coldSamples),
    conditions: Object.freeze({
"""
    source = replace_once(source, old, new, 'candidate decomposition summary')

if 'summarizeShardColdDecomposition,' not in source:
    old = """  selectShardCandidate,
  verifyBrowserRuntimeProfile,
"""
    new = """  selectShardCandidate,
  summarizeShardColdDecomposition,
  verifyBrowserRuntimeProfile,
"""
    source = replace_once(source, old, new, 'decomposition export')

path.write_text(source, encoding='utf-8', newline='\n')
