const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Contracts = require('../packages/contracts/semantic-contracts');
const Semantic = require('../apps/extension/src/shared/semantic-annotations');
const Grammar = require('../apps/extension/src/shared/grammar-annotations');
const ServiceWorker = require('../apps/extension/src/service-worker');

const extensionRoot = path.join(__dirname, '..', 'apps', 'extension');

function entry(surface, lemma, pos) {
  return Object.freeze({
    surface,
    normalizedSurface: surface.toLowerCase(),
    language: 'en',
    lemma,
    simplifiedPos: pos,
    posConfidence: 1,
    lexicalRef: `fixture:${lemma}`,
    glossRef: `fixture:${lemma}#gloss`,
    gloss: `${lemma} gloss`,
    datasetRef: {
      datasetId: 'service-fixture',
      datasetVersion: '1',
      recordRef: `fixture:${lemma}`
    },
    provenance: ['dataset:service-fixture@1']
  });
}

function provider() {
  const values = new Map([
    ['the', [{ surface: 'The', lang: 'en', lemma: 'the', pos: 'det', confidence: 0.99, source: 'bootstrap' }]],
    ['child', [entry('child', 'child', 'n')]],
    ['read', [entry('read', 'read', 'v')]],
    ['book', [entry('book', 'book', 'n')]]
  ]);
  return Object.freeze({
    id: 'service-fixture-provider',
    version: '1',
    lookup(surface, language) {
      const entries = this.lookupAll(surface, language);
      return entries[0] || null;
    },
    lookupAll(surface, language) {
      return language === 'en' ? Object.freeze(values.get(String(surface).toLowerCase()) || []) : Object.freeze([]);
    },
    lookupMorphology() {
      return Object.freeze([]);
    },
    status() {
      return Object.freeze({ mode: 'ready', fallbackActivated: false, failures: [] });
    }
  });
}

test('semantic service initializes its provider once and returns contract-valid local annotation batches', async () => {
  let loads = 0;
  const service = ServiceWorker.createSemanticService({
    loadProvider: async () => { loads += 1; return provider(); },
    semanticModule: Semantic,
    grammarModule: Grammar
  });
  const options = { languageMode: 'en', generatedAt: '2026-08-25T11:00:00.000Z' };
  const first = await service.annotateBatch(['The child reads books.', 'Unknown.'], options);
  const second = await service.annotateBatch(['The child reads books.'], options);

  assert.equal(loads, 1);
  assert.equal(first.annotationSets.length, 2);
  assert.equal(second.annotationSets.length, 1);
  assert.doesNotThrow(() => Contracts.normalizeAnnotationSet(first.annotationSets[0]));
  assert.equal(first.annotationSets[0].tokens[1].grammarRole, 'subject');
  assert.equal(first.annotationSets[0].tokens[2].grammarRole, 'predicate');
  assert.equal(first.annotationSets[0].tokens[3].grammarRole, 'object');
  assert.equal(first.annotationSets[1].tokens[0].simplifiedPos, 'x');
  assert.equal(first.status.mode, 'ready');
});
test('semantic service rejects oversized or malformed local messages without reading arbitrary fields', async () => {
  const service = ServiceWorker.createSemanticService({
    loadProvider: async () => provider(),
    semanticModule: Semantic,
    grammarModule: Grammar,
    maxBatchItems: 2,
    maxTextLength: 20
  });

  await assert.rejects(() => service.annotateBatch('not-an-array', {}), /texts.*array/i);
  await assert.rejects(() => service.annotateBatch(['one', 'two', 'three'], {}), /batch/i);
  await assert.rejects(() => service.annotateBatch(['x'.repeat(21)], {}), /text length/i);
});

test('MV3 runtime integration loads only the packaged index and keeps semantic work out of renderer code', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  const serviceSource = fs.readFileSync(path.join(extensionRoot, 'src/service-worker.js'), 'utf8');
  const contentSource = fs.readFileSync(path.join(extensionRoot, 'src/content.js'), 'utf8');

  assert.equal(manifest.version, '0.3.0');
  assert.equal(manifest.background.service_worker, 'src/service-worker.js');
  assert.equal(Object.hasOwn(manifest, 'host_permissions'), false);
  assert.equal(Object.hasOwn(manifest, 'web_accessible_resources'), false);
  assert.match(serviceSource, /chrome\.runtime\.getURL\(['"]data\/lexical-runtime-index\.json['"]\)/);
  assert.match(serviceSource, /fetch\(resourceUrl/);
  assert.doesNotMatch(serviceSource, /https?:\/\//i);
  assert.match(contentSource, /HALO_ANNOTATE_BATCH/);
  assert.match(contentSource, /annotationSets/);
  assert.doesNotMatch(contentSource, /WordNet|CC-CEDICT|cedict|data\.noun/);
});

test('service worker message handler exposes only annotation batch and sanitized dictionary status operations', async () => {
  const service = ServiceWorker.createSemanticService({
    loadProvider: async () => provider(),
    semanticModule: Semantic,
    grammarModule: Grammar
  });
  const options = { languageMode: 'en', generatedAt: '2026-08-25T11:00:00.000Z' };

  const annotated = await service.handleMessage({ type: 'HALO_ANNOTATE_BATCH', texts: ['Unknown.'], options });
  const status = await service.handleMessage({ type: 'HALO_DICTIONARY_STATUS' });
  const ignored = await service.handleMessage({ type: 'READ_COOKIES', cookie: 'secret' });

  assert.equal(annotated.annotationSets[0].tokens[0].simplifiedPos, 'x');
  assert.deepEqual(status, { mode: 'ready', fallbackActivated: false, failures: [] });
  assert.equal(ignored, null);
  assert.doesNotMatch(JSON.stringify(status), /cookie|secret|history|password/i);
});
