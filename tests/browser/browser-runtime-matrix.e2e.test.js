const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { resolveChromiumExecutable } = require('./helpers/extension-harness');
const { withFixtureServer } = require('./helpers/fixture-server');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const fixtureRoot = path.join(repositoryRoot, 'fixtures', 'browser');
const matrixPath = path.join(fixtureRoot, 'matrix.json');
const extensionRoot = path.join(repositoryRoot, 'apps', 'extension');
const source = (relative) => path.join(extensionRoot, 'src', relative);
const runtimeScripts = [
  'shared/progressive-runtime.js',
  'shared/semantic-contracts.js',
  'shared/dictionary-provider.js',
  'shared/semantic-annotations.js',
  'shared/grammar-annotations.js',
  'shared/projection.js',
  'shared/site-policy.js',
  'shared/settings.js',
  'shared/sentence-pipeline.js',
  'shared/runtime-scheduler.js',
  'shared/dynamic-dom-controller.js',
  'shared/reversible-renderer.js',
  'content.js'
].map(source);

function readMatrix() {
  return JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
}

function buildRoutes(matrix) {
  return Object.fromEntries(matrix.fixtures.map((fixture) => [
    `/${fixture.file}`,
    { contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(fixtureRoot, fixture.file), 'utf8') }
  ]));
}

async function installLocalSemanticRuntime(page) {
  await page.evaluate(() => {
    const listeners = [];
    const semanticRequests = [];
    const cancelRequests = [];

    function responseFor(message) {
      const provider = HaloDictionary.createBootstrapDictionaryProvider();
      const engine = HaloSemanticAnnotations.createSemanticEngine({
        provider,
        grammarAnnotator: HaloGrammarAnnotations.annotateGrammar
      });
      const generatedAt = new Date().toISOString();
      return {
        schemaVersion: HaloSemanticContracts.SEMANTIC_SCHEMA_VERSION,
        requestId: message.requestId,
        pageEpoch: message.pageEpoch,
        results: message.items.map((item) => ({
          schemaVersion: HaloSemanticContracts.SEMANTIC_SCHEMA_VERSION,
          requestId: message.requestId,
          pageEpoch: message.pageEpoch,
          rootId: item.rootId,
          rootRevision: item.rootRevision,
          analysisKey: item.analysisKey,
          phase: 'bootstrap',
          lexicalVersion: item.lexicalVersion,
          generatedAt,
          annotationSet: engine.annotateText(item.text, {
            languageMode: item.languageMode,
            generatedAt
          })
        })),
        status: {
          mode: 'bootstrap-only',
          networkActivity: {
            schemaVersion: 1,
            scope: 'worker-lifetime',
            lifetimeId: 'worker-b-fixture-matrix',
            fetchAttempts: 0
          }
        }
      };
    }

    const runtime = {
      onMessage: { addListener: (listener) => listeners.push(listener) },
      sendMessage: async (message) => {
        if (message.type === 'HALO_CANCEL_REQUEST') {
          cancelRequests.push(message.requestId);
          return { status: 'cancelled' };
        }
        if (message.type !== 'HALO_ENRICH_BATCH') return null;
        semanticRequests.push(message);
        return responseFor(message);
      }
    };
    if (!globalThis.chrome) globalThis.chrome = {};
    globalThis.chrome.runtime = runtime;
    globalThis.__haloFixtureRuntime = { listeners, semanticRequests, cancelRequests };
  });

  for (const script of runtimeScripts) await page.addScriptTag({ path: script });
}

async function sendContentCommand(page, type) {
  return page.evaluate((messageType) => new Promise((resolve, reject) => {
    const listener = __haloFixtureRuntime.listeners[0];
    if (typeof listener !== 'function') {
      reject(new Error('Halo content listener was not registered'));
      return;
    }
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      let message = { type: messageType };
      if (messageType === 'HALO_APPLY_MARKING') {
        const settings = JSON.parse(JSON.stringify(HaloSettings.DEFAULT_SETTINGS));
        settings.density = 1;
        settings.minConfidence = 0;
        message = { type: messageType, settings };
      }
      const asyncResponse = listener(message, {}, finish);
      if (asyncResponse !== true && !settled) queueMicrotask(() => finish(null));
    } catch (error) {
      reject(error);
    }
  }), type);
}

async function rootText(page) {
  return page.locator('[data-fixture-content]').evaluate((node) => node.textContent);
}

async function assertNoDuplicateWrappers(page, fixture) {
  const duplicateCount = await page.locator('[data-halo-owned="token"] [data-halo-owned="token"]').count();
  assert.equal(duplicateCount, 0, `${fixture.id}: nested Halo token wrappers`);
}

async function waitForDocumentMark(page, fixture) {
  await page.waitForFunction(() => document.querySelectorAll('[data-halo-owned="token"]').length > 0, null, { timeout: 7000 });
  const count = await page.locator('[data-halo-owned="token"]').count();
  assert.ok(count > 0, `${fixture.id}: expected at least one real rendered token`);
}

async function specialSnapshot(page, fixture) {
  if (fixture.shadowHost) {
    return page.evaluate((selector) => {
      const host = document.querySelector(selector);
      return host && host.shadowRoot ? host.shadowRoot.textContent : null;
    }, fixture.shadowHost);
  }
  if (fixture.iframe) {
    await page.waitForFunction((selector) => {
      const frame = document.querySelector(selector);
      return frame && frame.contentDocument && frame.contentDocument.body;
    }, fixture.iframe);
    return page.evaluate((selector) => document.querySelector(selector).contentDocument.body.textContent, fixture.iframe);
  }
  return null;
}

async function exerciseFixture(page, fixture) {
  const before = await rootText(page);
  const specialBefore = await specialSnapshot(page, fixture);

  const firstStatus = await sendContentCommand(page, 'HALO_APPLY_MARKING');
  assert.equal(firstStatus && firstStatus.active, true, `${fixture.id}: APPLY did not activate runtime`);
  await waitForDocumentMark(page, fixture);
  assert.equal(await rootText(page), before, `${fixture.id}: source text changed during apply`);
  await assertNoDuplicateWrappers(page, fixture);

  if (fixture.excludeSelector) {
    const selectors = fixture.excludeSelector.split(',').map((value) => value.trim()).filter(Boolean);
    const excludedMarked = await page.evaluate((values) => values.some((selector) => {
      for (const element of document.querySelectorAll(selector)) {
        if (element.matches('[data-halo-owned="token"]') || element.querySelector('[data-halo-owned="token"]')) return true;
      }
      return false;
    }), selectors);
    assert.equal(excludedMarked, false, `${fixture.id}: excluded code/pre content was marked`);
  }

  if (fixture.dynamicAction) {
    await page.evaluate((name) => {
      const action = globalThis[name];
      if (typeof action !== 'function') throw new Error(`fixture action ${name} is unavailable`);
      action();
    }, fixture.dynamicAction);
    await page.waitForSelector('[data-fixture-dynamic]');
    await page.waitForFunction(() => {
      const dynamic = document.querySelector('[data-fixture-dynamic]');
      return dynamic && dynamic.querySelector('[data-halo-owned="token"]');
    }, null, { timeout: 7000 });
    await assertNoDuplicateWrappers(page, fixture);
  }

  const expectedAfterAction = await rootText(page);
  const specialAfterApply = await specialSnapshot(page, fixture);
  if (specialBefore !== null) assert.equal(specialAfterApply, specialBefore, `${fixture.id}: shadow/frame source changed during apply`);

  await sendContentCommand(page, 'HALO_REMOVE_MARKING');
  await page.waitForFunction(() => document.querySelectorAll('[data-halo-owned]').length === 0, null, { timeout: 7000 });
  assert.equal(await rootText(page), expectedAfterAction, `${fixture.id}: REMOVE did not restore source text`);
  assert.equal(await page.locator('[data-halo-owned]').count(), 0, `${fixture.id}: owned artifacts remain after remove`);
  const specialAfterRemove = await specialSnapshot(page, fixture);
  if (specialBefore !== null) assert.equal(specialAfterRemove, specialBefore, `${fixture.id}: shadow/frame source changed after remove`);

  const secondStatus = await sendContentCommand(page, 'HALO_APPLY_MARKING');
  assert.equal(secondStatus && secondStatus.active, true, `${fixture.id}: second APPLY did not activate runtime`);
  await waitForDocumentMark(page, fixture);
  assert.equal(await rootText(page), expectedAfterAction, `${fixture.id}: second apply changed source text`);
  await assertNoDuplicateWrappers(page, fixture);
  await sendContentCommand(page, 'HALO_REMOVE_MARKING');
  await page.waitForFunction(() => document.querySelectorAll('[data-halo-owned]').length === 0, null, { timeout: 7000 });
  assert.equal(await rootText(page), expectedAfterAction, `${fixture.id}: second REMOVE did not restore source text`);

  if (fixture.layoutCheck) {
    const layout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `${fixture.id}: horizontal layout overflow`);
  }
}

test('matrix declares exactly twenty distinct required fixture classes', () => {
  const matrix = readMatrix();
  assert.equal(matrix.schemaVersion, 1);
  assert.equal(matrix.fixtures.length, 20);
  assert.equal(new Set(matrix.fixtures.map((value) => value.id)).size, 20);
  assert.equal(new Set(matrix.fixtures.map((value) => value.class)).size, 20);
  for (const fixture of matrix.fixtures) {
    assert.ok(fixture.file);
    assert.ok(fs.existsSync(path.join(fixtureRoot, fixture.file)), `${fixture.file} must exist`);
    assert.ok(fixture.assertions.includes('source-text-preserved'));
    assert.ok(fixture.assertions.includes('no-duplicate-wrapper'));
    assert.ok(fixture.assertions.includes('remove-correct'));
  }
});

test('real Chromium exercises the twenty-class browser fixture matrix twice through apply/remove', async (t) => {
  const matrix = readMatrix();
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const browser = await chromium.launch({ executablePath: executable.path, headless: true, args: ['--no-sandbox'] });
  try {
    await withFixtureServer(buildRoutes(matrix), async ({ origin }) => {
      for (const fixture of matrix.fixtures) {
        await t.test(fixture.id, async () => {
          const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
          page.setDefaultTimeout(7000);
          try {
            await page.goto(`${origin}/${fixture.file}`, { waitUntil: 'load' });
            await installLocalSemanticRuntime(page);
            await exerciseFixture(page, fixture);
          } finally {
            await page.close();
          }
        });
      }
    });
  } finally {
    await browser.close();
  }
});
