'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchExtension, resolveChromiumExecutable } = require('./helpers/extension-harness');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const extensionRoot = path.join(repositoryRoot, 'apps', 'extension');

async function extensionWorker(context) {
  return context.serviceWorkers()[0] || context.waitForEvent('serviceworker');
}

async function seedDashboard(page) {
  return page.evaluate(async () => {
    const dashboard = globalThis.HaloDogfoodDashboard;
    if (!dashboard || !dashboard.repository || !dashboard.service) throw new Error('dashboard runtime unavailable');
    const repository = dashboard.repository;
    const source = HaloDogfoodContracts.normalizeSourceRef({
      schema: 'SourceRef/v1',
      sourceId: 'source:dashboard',
      domain: 'example.com',
      normalizedPathHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      pathNormalizationVersion: 'path-v1',
      fullUrl: 'https://example.com/read/lesson?return=1#sentence',
      language: 'en'
    });
    const sentence = HaloDogfoodContracts.normalizeSentenceRecord({
      schema: 'SentenceRecord/v1',
      sentenceId: 'sentence:dashboard',
      text: 'The model learns quickly.',
      language: 'en',
      textHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      sourceRef: source.sourceId,
      captureReason: 'sentence_saved',
      capturedAt: '2026-08-28T12:00:00.000Z',
      algorithmVersion: '0.3.0',
      profileId: 'halo-default-v0.3.0',
      profileRevision: 2
    });
    const event = HaloDogfoodContracts.normalizeLearningEvent({
      schema: 'LearningEvent/v1',
      eventId: 'event:dashboard-saved',
      timestamp: '2026-08-28T12:00:00.000Z',
      eventType: 'sentence_saved',
      sessionId: 'session:dashboard',
      sessionPolicyVersion: 'top-level-page-v1',
      sourceRef: source.sourceId,
      language: 'en',
      sentenceRef: sentence.sentenceId,
      sentenceHash: sentence.textHash,
      interactionClass: 'explicit-learning',
      capturePolicyVersion: 'dogfood-capture-v1',
      profileId: 'halo-default-v0.3.0',
      profileRevision: 2,
      uiContext: { activeChannels: ['posLabel'], density: 0.65, triggerMode: 'hybrid' },
      algorithmVersion: '0.3.0',
      refersToEventId: null,
      detail: { noteText: null }
    });
    await repository.putSource(source);
    await repository.putSentence(sentence);
    await repository.appendEvent(event);
    await dashboard.service.createStandaloneNote('Dashboard standalone note.');
    await dashboard.refresh();
    return true;
  });
}

test('v0.5 options dashboard exposes eight local-only views and durable data controls', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '0.5.0');
  assert.equal(manifest.options_page, 'src/options.html');
  assert.deepEqual(manifest.permissions, ['activeTab', 'contextMenus', 'scripting', 'storage']);
  assert.equal(Object.hasOwn(manifest, 'host_permissions'), false);

  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-v050-dashboard-'));
  let context;
  try {
    context = await launchExtension({ extensionRoot, userDataDir, headless: true, executablePath: executable.path });
    const worker = await extensionWorker(context);
    const match = /^chrome-extension:\/\/([^/]+)\//u.exec(worker.url());
    assert.ok(match);
    const extensionId = match[1];
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/options.html`);
    await page.waitForSelector('body[data-dashboard-ready="true"]', { timeout: 10000 });

    assert.equal(await page.locator('h1').count(), 1);
    const sections = await page.locator('main section[data-dashboard-section]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-dashboard-section'))
    );
    assert.deepEqual(sections, [
      'Overview', 'Activity', 'Sites & Sessions', 'Learning Events',
      'Saved Sentences', 'Dogfood Notes', 'Data & Privacy', 'System / Replay'
    ]);
    assert.equal(await page.getByRole('navigation').count(), 1);
    assert.equal(await page.locator('[aria-live="polite"]').count() >= 1, true);

    await seedDashboard(page);
    await page.getByTestId('overview-event-count').waitFor({ state: 'visible' });
    assert.match(await page.getByTestId('overview-event-count').textContent(), /2/);
    assert.match(await page.getByTestId('overview-site-count').textContent(), /2/);
    assert.match(await page.locator('#activityList').textContent(), /sentence_saved|dogfood_note_created/);
    assert.match(await page.locator('#savedSentenceList').textContent(), /The model learns quickly\./);
    assert.match(await page.locator('#dogfoodNoteList').textContent(), /Dashboard standalone note\./);
    const overviewText = await page.locator('#overviewSection').textContent();
    assert.doesNotMatch(overviewText, /mastery|confidence|level/i);

    await page.getByLabel('Event type').selectOption('sentence_saved');
    assert.match(await page.locator('#learningEventList').textContent(), /sentence_saved/);
    assert.doesNotMatch(await page.locator('#learningEventList').textContent(), /dogfood_note_created/);

    await page.getByRole('button', { name: /Unsave/i }).click();
    await page.waitForFunction(() => !document.getElementById('savedSentenceList').textContent.includes('The model learns quickly.'));
    const afterUnsave = await page.evaluate(async () => {
      const data = await HaloDogfoodDashboard.repository.readReplayDataset();
      return data.events.map((event) => event.eventType);
    });
    assert.ok(afterUnsave.includes('sentence_unsaved'));

    const noteTextarea = page.getByLabel('New dogfood note');
    await noteTextarea.fill('A second dashboard note.');
    await page.getByRole('button', { name: /Create note/i }).click();
    await page.waitForFunction(() => document.getElementById('dogfoodNoteList').textContent.includes('A second dashboard note.'));
    const secondNote = page.locator('[data-note-card]').filter({ hasText: 'A second dashboard note.' });
    await secondNote.getByLabel('Revise dogfood note').fill('A revised dashboard note.');
    await secondNote.getByRole('button', { name: /Revise/i }).click();
    await page.waitForFunction(() => document.getElementById('dogfoodNoteList').textContent.includes('A revised dashboard note.'));
    const revised = page.locator('[data-note-card]').filter({ hasText: 'A revised dashboard note.' });
    await revised.getByRole('button', { name: /Remove note/i }).click();
    await page.waitForFunction(() => !document.getElementById('dogfoodNoteList').textContent.includes('A revised dashboard note.'));

    const captureToggle = page.getByLabel('Local capture enabled');
    assert.equal(await captureToggle.isChecked(), true);
    await captureToggle.uncheck();
    await page.waitForFunction(() => document.getElementById('captureStatus').textContent.includes('Paused'));
    await captureToggle.check();
    await page.waitForFunction(() => document.getElementById('captureStatus').textContent.includes('Active'));

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export JSONL/i }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /halo-dogfood-events.*\.jsonl$/);

    await page.getByRole('button', { name: /Replay now/i }).click();
    await page.waitForFunction(() => document.getElementById('replayStatus').textContent.includes('PASS'));
    assert.match(await page.locator('#systemStatus').textContent(), /halo-learning-local/);

    page.once('dialog', async (dialog) => {
      assert.match(dialog.message(), /all dogfood data/i);
      await dialog.accept();
    });
    await page.getByRole('button', { name: /Delete all dogfood data/i }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="overview-event-count"]').textContent.includes('0'));
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
