#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const {
  buildLexicalIndex,
  loadLexicalIndex,
  serializeLexicalIndex
} = require('../packages/lexical-index/lexical-index');

const ENTRY_COUNT = 20_000;
const LOOKUP_SAMPLES = 5_000;
const BUDGETS = Object.freeze({
  p95LookupMs: 5,
  serializedBytesPerEntry: 1024,
  heapBytesPerEntry: 8192
});

function parseOutputPath(args) {
  const index = args.indexOf('--json-out');
  if (index < 0) return null;
  if (!args[index + 1]) throw new TypeError('--json-out requires a path');
  return args[index + 1];
}

function benchmarkEntry(index) {
  const surface = `term${String(index).padStart(5, '0')}`;
  return {
    schemaVersion: 1,
    entryId: `synthetic-benchmark:${surface}`,
    locale: 'en',
    surface,
    normalizedSurface: surface,
    lemma: surface,
    pos: index % 2 === 0 ? 'n' : 'v',
    posConfidence: 1,
    glosses: [{ text: `synthetic gloss ${index}`, locale: 'en', ref: `synthetic:${index}#gloss` }],
    glossRefs: [`synthetic:${index}#gloss`],
    aliases: [],
    source: {
      datasetId: 'halo-synthetic-index-benchmark',
      version: '1',
      recordRef: `synthetic:${index}`,
      lineNumber: index + 1,
      recordData: {}
    },
    provenance: {
      fieldOrigins: {
        surface: `synthetic:${index}:surface`,
        lemma: `synthetic:${index}:lemma`,
        pos: `synthetic:${index}:pos`,
        glosses: `synthetic:${index}:glosses`
      },
      transformations: []
    }
  };
}

function percentile(sortedValues, percentileValue) {
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * percentileValue) - 1);
  return sortedValues[index];
}

function main(args) {
  if (typeof global.gc !== 'function') {
    throw new Error('Run with node --expose-gc to measure the heap budget');
  }
  const outputPath = parseOutputPath(args);
  const entries = Array.from({ length: ENTRY_COUNT }, (_value, index) => benchmarkEntry(index));
  global.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const index = buildLexicalIndex(entries, { indexId: 'synthetic-20k-benchmark-v1' });
  global.gc();
  const heapAfter = process.memoryUsage().heapUsed;
  const serialized = serializeLexicalIndex(index);
  const loaded = loadLexicalIndex(serialized);

  for (let sample = 0; sample < 1_000; sample += 1) {
    loaded.lookup(`TERM${String(sample % ENTRY_COUNT).padStart(5, '0')}`, 'en');
  }
  const lookupTimes = [];
  for (let sample = 0; sample < LOOKUP_SAMPLES; sample += 1) {
    const surface = `TERM${String((sample * 7919) % ENTRY_COUNT).padStart(5, '0')}`;
    const started = performance.now();
    const values = loaded.lookup(surface, 'en');
    lookupTimes.push(performance.now() - started);
    if (values.length !== 1) throw new Error(`lookup failed for ${surface}`);
  }
  lookupTimes.sort((left, right) => left - right);

  const measurements = {
    p95LookupMs: percentile(lookupTimes, 0.95),
    serializedBytesPerEntry: Buffer.byteLength(serialized) / ENTRY_COUNT,
    heapBytesPerEntry: Math.max(0, heapAfter - heapBefore) / ENTRY_COUNT
  };
  const gates = {
    p95LookupMs: measurements.p95LookupMs < BUDGETS.p95LookupMs,
    serializedBytesPerEntry: measurements.serializedBytesPerEntry <= BUDGETS.serializedBytesPerEntry,
    heapBytesPerEntry: measurements.heapBytesPerEntry <= BUDGETS.heapBytesPerEntry
  };
  const report = {
    schemaVersion: 1,
    benchmarkId: 'halo-lexical-index-synthetic-20k-v1',
    runtime: process.version,
    entryCount: ENTRY_COUNT,
    lookupSamples: LOOKUP_SAMPLES,
    indexHash: index.hash.value,
    measurements,
    budgets: BUDGETS,
    gates,
    allPassed: Object.values(gates).every(Boolean),
    limitation: 'Synthetic 20k-entry engineering budget only; not a full-corpus production performance or NLP-accuracy claim.'
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) fs.writeFileSync(outputPath, output);
  process.stdout.write(output);
  if (!report.allPassed) process.exitCode = 1;
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exitCode = 1;
}
