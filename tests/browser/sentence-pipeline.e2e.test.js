const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchExtension, resolveChromiumExecutable } = require('./helpers/extension-harness');
const { withFixtureServer } = require('./helpers/fixture-server');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const extensionRoot = path.join(repositoryRoot, 'apps', 'extension');
const pipelinePath = path.join(extensionRoot, 'src', 'shared', 'sentence-pipeline.js');
const linguisticsPath = path.join(extensionRoot, 'src', 'shared', 'linguistics.js');

test('real Chromium preserves nested inline DOM while every sentence and token maps exactly', async () => {
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-sentence-pipeline-'));
  let context;
  try {
    context = await launchExtension({
      extensionRoot,
      userDataDir,
      headless: true,
      executablePath: executable.path
    });
    await withFixtureServer({
      '/lesson.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="zh-Hant"><body><article id="lesson"><span data-level="outer">The <span data-level="inner">mo<a href="/model">del</a></span></span><em> learns.</em> <span>人工<a href="/zh">智慧</a></span><em>學習。</em><span style="display:none">HIDDEN TEXT.</span><form><label>Account password</label><input type="password" autocomplete="current-password" value="never-read"></form></article></body></html>'
      }
    }, async ({ origin }) => {
      const page = await context.newPage();
      const requests = [];
      page.on('request', (request) => requests.push(request.url()));
      await page.goto(origin + '/lesson.html');
      await page.addScriptTag({ path: pipelinePath });
      await page.addScriptTag({ path: linguisticsPath });

      const result = await page.evaluate(() => {
        const root = document.getElementById('lesson');

        function inspect() {
          const runs = HaloSentencePipeline.createTextRuns(root, { rootRevision: 23 });
          const records = HaloSentencePipeline.buildSentenceRecords(root, { rootRevision: 23 });
          return {
            records,
            runText: runs.map((run) => run.boundaryBefore + run.text).join(''),
            sentenceChecks: records.map((record) => ({
              text: record.text,
              rebuilt: record.fragments.map((fragment) => {
                const run = runs.find((candidate) => candidate.nodeId === fragment.nodeId);
                return run.node.nodeValue.slice(fragment.start, fragment.end);
              }).join(''),
              fragmentsAreNodeLocal: record.fragments.every((fragment) => {
                const run = runs.find((candidate) => candidate.nodeId === fragment.nodeId);
                return fragment.start >= 0 && fragment.end <= run.node.nodeValue.length;
              }),
              hasNodeReference: record.fragments.some((fragment) => Object.hasOwn(fragment, 'node')),
              tokenChecks: HaloLinguistics.tokenize(record.text, record.language === 'zh-Hant' ? 'zh' : record.language)
                .map((token) => {
                  const fragments = HaloSentencePipeline.mapAggregateSpanToFragments(
                    runs,
                    record.start + token.start,
                    record.start + token.end
                  );
                  return {
                    text: token.text,
                    rebuilt: fragments.map((fragment) =>
                      fragment.node.nodeValue.slice(fragment.start, fragment.end)
                    ).join(''),
                    fragmentCount: fragments.length
                  };
                })
            }))
          };
        }

        const initial = inspect();
        const paragraph = document.createElement('p');
        paragraph.textContent = 'Dynamic sentence.';
        root.appendChild(paragraph);
        const dynamic = inspect();
        return {
          initial,
          dynamic,
          links: Array.from(root.querySelectorAll('a')).map((link) => link.getAttribute('href')),
          emphasis: Array.from(root.querySelectorAll('em')).map((node) => node.textContent),
          nestedSpanPresent: Boolean(root.querySelector('[data-level="outer"] [data-level="inner"]')),
          passwordFieldPresent: Boolean(root.querySelector('input[type="password"]'))
        };
      });

      assert.equal(result.initial.runText, 'The model learns. 人工智慧學習。');
      assert.deepEqual(result.initial.sentenceChecks.map((check) => check.text), [
        'The model learns.',
        '人工智慧學習。'
      ]);
      for (const sentence of result.initial.sentenceChecks) {
        assert.equal(sentence.rebuilt, sentence.text);
        assert.equal(sentence.fragmentsAreNodeLocal, true);
        assert.equal(sentence.hasNodeReference, false);
        for (const token of sentence.tokenChecks) assert.equal(token.rebuilt, token.text);
      }
      const model = result.initial.sentenceChecks[0].tokenChecks.find((token) => token.text === 'model');
      assert.equal(model.fragmentCount, 2, 'one token split by inline markup maps to two local fragments');

      assert.deepEqual(result.dynamic.sentenceChecks.map((check) => check.text), [
        'The model learns.',
        '人工智慧學習。',
        'Dynamic sentence.'
      ]);
      assert.deepEqual(result.links, ['/model', '/zh']);
      assert.deepEqual(result.emphasis, [' learns.', '學習。']);
      assert.equal(result.nestedSpanPresent, true);
      assert.equal(result.passwordFieldPresent, true);
      assert.ok(result.dynamic.sentenceChecks.every((sentence) =>
        !sentence.text.includes('HIDDEN') && !sentence.text.includes('password')
      ));
      assert.ok(requests.every((url) => url.startsWith(origin)), 'fixture makes no remote requests');
    });
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
