'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { resolveChromiumExecutable } = require('./helpers/extension-harness');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const rendererPath = path.join(repositoryRoot, 'apps', 'extension', 'src', 'shared', 'reversible-renderer.js');

test('renderer keeps observation identity private and emits bounded Save/Note panel actions', async () => {
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const browser = await chromium.launch({ headless: true, executablePath: executable.path, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body><p id="lesson">The model learns.</p></body></html>');
    await page.addScriptTag({ path: rendererPath });

    const state = await page.evaluate(() => {
      const actions = [];
      const renderer = HaloReversibleRenderer.createReversibleRenderer({
        document,
        onPanelAction(action) {
          actions.push(action);
        }
      });
      const root = document.getElementById('lesson');
      const node = root.firstChild;
      renderer.apply({
        schemaVersion: 1,
        runId: 'run-1',
        rootId: 'root-1',
        rootRevision: 1,
        analysisKey: 'analysis-1',
        root,
        fragments: [{
          node,
          nodeId: 'node-1',
          start: 4,
          end: 9,
          text: 'model',
          boundaryKey: '4:9:0',
          observationKey: 'obs:sentence-1',
          renderPlan: {
            marked: true,
            pos: 'n',
            label: 'N',
            labelPosition: 'top-right',
            confidence: 0.9,
            glossHint: 'model gloss'
          }
        }]
      });
      const token = root.querySelector('[data-halo-owned="token"]');
      const observationKey = renderer.observationKeyForToken(token);
      const leakedAttributes = token.getAttributeNames().filter((name) => /observation|sentence|url/i.test(name));
      renderer.openPanel({
        title: 'model',
        body: 'N · model gloss',
        status: 'Confidence 0.9',
        observationKey,
        anchor: { x: 10, y: 20 },
        actions: [
          { id: 'save-sentence', label: 'Save sentence · 儲存句子' },
          { id: 'dogfood-note', label: 'Dogfood note · 體驗註記' }
        ]
      });
      return { observationKey, leakedAttributes, actionCount: actions.length };
    });

    assert.equal(state.observationKey, 'obs:sentence-1');
    assert.deepEqual(state.leakedAttributes, []);
    assert.equal(state.actionCount, 0);

    await page.evaluate(() => {
      const shadow = document.querySelector('[data-halo-owned="panel"]').shadowRoot;
      shadow.querySelector('[data-halo-action="save-sentence"]').click();
      shadow.querySelector('[data-halo-action="dogfood-note"]').click();
      const note = shadow.querySelector('.halo-dogfood-note-input');
      note.value = 'The tense marker is too noisy here.';
      shadow.querySelector('[data-halo-note-save]').click();
    });

    const result = await page.evaluate(() => {
      const rendererHost = document.querySelector('[data-halo-owned="panel"]');
      return {
        noteHidden: rendererHost.shadowRoot.querySelector('.halo-dogfood-note-editor').hidden,
        // The test callback is intentionally not serialized through DOM attributes.
        bodyText: rendererHost.shadowRoot.querySelector('.halo-core-body').textContent
      };
    });
    assert.equal(result.noteHidden, true);
    assert.equal(result.bodyText, 'N · model gloss');

    const actions = await page.evaluate(() => {
      // Reach the renderer only through a test-local callback mirror, never through page attributes.
      const host = document.querySelector('[data-halo-owned="panel"]');
      return host.shadowRoot.__haloTestActions || null;
    });
    // The production callback is verified below via an explicit event mirror installed by the renderer test hook.
    // A null mirror is fine here; the actual callback assertions are returned from a second isolated render.
    assert.equal(actions, null);

    const callbackActions = await page.evaluate(() => new Promise((resolve) => {
      const root = document.getElementById('lesson');
      const token = root.querySelector('[data-halo-owned="token"]');
      const renderer = HaloReversibleRenderer.createReversibleRenderer({
        document,
        onPanelAction(action) {
          collected.push(action);
          if (collected.length === 2) resolve(collected);
        }
      });
      const collected = [];
      renderer.openPanel({
        title: 'model',
        observationKey: 'obs:sentence-1',
        anchor: { x: 10, y: 20 },
        actions: [
          { id: 'save-sentence', label: 'Save sentence · 儲存句子' },
          { id: 'dogfood-note', label: 'Dogfood note · 體驗註記' }
        ]
      });
      const shadow = document.querySelector('[data-halo-owned="panel"]').shadowRoot;
      shadow.querySelector('[data-halo-action="save-sentence"]').click();
      shadow.querySelector('[data-halo-action="dogfood-note"]').click();
      shadow.querySelector('.halo-dogfood-note-input').value = 'The tense marker is too noisy here.';
      shadow.querySelector('[data-halo-note-save]').click();
    }));

    assert.deepEqual(callbackActions, [
      { id: 'save-sentence', value: null, observationKey: 'obs:sentence-1' },
      { id: 'dogfood-note', value: 'The tense marker is too noisy here.', observationKey: 'obs:sentence-1' }
    ]);
  } finally {
    await browser.close();
  }
});
