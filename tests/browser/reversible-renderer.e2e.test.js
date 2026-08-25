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
const rendererPath = path.join(extensionRoot, 'src', 'shared', 'reversible-renderer.js');

test('real Chromium verifies all renderer lifecycle sequences and isolated clamped panel', async () => {
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-reversible-renderer-'));
  let context;
  try {
    context = await launchExtension({
      extensionRoot,
      userDataDir,
      headless: true,
      executablePath: executable.path
    });
    await withFixtureServer({
      '/renderer.html': {
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><head><style>section{all:unset!important;position:static!important;color:rgb(1,2,3)!important}[data-halo-owned="panel"]{display:none!important;position:static!important;width:999px!important;height:999px!important;visibility:hidden!important}.halo-token{display:block!important;height:90px!important}</style></head><body><article id="lesson"><span id="outer">The <span id="inner">mo<a id="link" href="/model">del</a></span></span><em id="emphasis"> learns.</em></article><span id="authored" class="halo-token">Page-authored lookalike.</span></body></html>'
      }
    }, async ({ origin }) => {
      const page = await context.newPage();
      const requests = [];
      page.on('request', (request) => requests.push(request.url()));
      await page.goto(origin + '/renderer.html');
      await page.addScriptTag({ path: rendererPath });

      const result = await page.evaluate(() => {
        const article = document.getElementById('lesson');
        const link = document.getElementById('link');
        const emphasis = document.getElementById('emphasis');
        const authored = document.getElementById('authored');
        const renderer = HaloReversibleRenderer.createReversibleRenderer({ document });
        const sourceText = article.textContent;

        function textNodesWithin(element) {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const nodes = [];
          for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
          return nodes;
        }

        function markedFragment(node, nodeId, start, end, pos) {
          return {
            node,
            nodeId,
            start,
            end,
            text: node.nodeValue.slice(start, end),
            renderPlan: {
              marked: true,
              pos,
              label: pos,
              colorClass: `halo-pos-${pos}`,
              labelPosition: 'top-right'
            }
          };
        }

        function renderRequest(runId, rootRevision, analysisKey, fragments) {
          return {
            schemaVersion: 1,
            runId,
            rootId: 'lesson-root',
            rootRevision,
            analysisKey,
            root: article,
            fragments
          };
        }

        const initialNodes = textNodesWithin(article);
        const modelParts = initialNodes.filter((node) => ['mo', 'del'].includes(node.nodeValue));
        const learns = initialNodes.find((node) => node.nodeValue === ' learns.');
        const firstRequest = renderRequest('run-1', 1, 'analysis-1', [
          markedFragment(modelParts[0], 'model-a', 0, 2, 'n'),
          markedFragment(modelParts[1], 'model-b', 0, 3, 'n'),
          markedFragment(learns, 'learns', 1, 7, 'v')
        ]);
        const applied = renderer.apply(firstRequest);
        const firstWrappers = [...article.querySelectorAll('[data-halo-owned="token"]')];
        const duplicate = renderer.apply(firstRequest);
        const applyApply = {
          action: duplicate.action,
          sameWrappers: [...article.querySelectorAll('[data-halo-owned="token"]')]
            .every((wrapper, index) => wrapper === firstWrappers[index]),
          wrapperCount: firstWrappers.length,
          nested: article.querySelectorAll('[data-halo-owned="token"] [data-halo-owned="token"]').length,
          text: article.textContent
        };

        renderer.removeRoot('lesson-root');
        const applyRemove = {
          wrappers: article.querySelectorAll('[data-halo-owned="token"]').length,
          text: article.textContent,
          linkIdentity: document.getElementById('link') === link,
          emphasisIdentity: document.getElementById('emphasis') === emphasis,
          nestedSpanIdentity: document.getElementById('inner').parentNode === document.getElementById('outer'),
          authoredIdentity: document.getElementById('authored') === authored
        };

        const reappliedNodes = textNodesWithin(article);
        const reappliedModel = reappliedNodes.filter((node) => ['mo', 'del'].includes(node.nodeValue));
        renderer.apply(renderRequest('run-2', 1, 'analysis-2', [
          markedFragment(reappliedModel[0], 'model-a', 0, 2, 'n'),
          markedFragment(reappliedModel[1], 'model-b', 0, 3, 'n')
        ]));
        const applyRemoveApply = {
          wrappers: article.querySelectorAll('[data-halo-owned="token"]').length,
          text: article.textContent
        };

        emphasis.textContent = ' studies.';
        const mutatedNode = emphasis.firstChild;
        renderer.apply(renderRequest('run-3', 2, 'analysis-3', [
          markedFragment(mutatedNode, 'studies-v2', 1, 8, 'v')
        ]));
        const mutationApply = {
          wrappers: article.querySelectorAll('[data-halo-owned="token"]').length,
          text: article.textContent,
          emphasisIdentity: document.getElementById('emphasis') === emphasis
        };

        const beforePanelHeight = article.getBoundingClientRect().height;
        renderer.openPanel({
          title: '<b>Literal title</b>',
          body: 'Local analysis',
          status: 'Ready',
          anchor: { x: innerWidth + 500, y: innerHeight + 500 }
        });
        const panelHost = document.querySelector('[data-halo-owned="panel"]');
        const panel = panelHost.shadowRoot.querySelector('[role="dialog"]');
        const panelRect = panel.getBoundingClientRect();
        const hostStyle = getComputedStyle(panelHost);
        const panelResult = {
          shadowOpen: panelHost.shadowRoot.mode === 'open',
          role: panel.getAttribute('role'),
          modal: panel.getAttribute('aria-modal'),
          literalTitle: panelHost.shadowRoot.getElementById('halo-panel-title').textContent,
          hostVisible: hostStyle.display !== 'none' && hostStyle.visibility === 'visible' &&
            hostStyle.position === 'fixed' && hostStyle.width === '0px' && hostStyle.height === '0px',
          pageRuleDidNotWin: getComputedStyle(panel).position === 'fixed',
          clamped: panelRect.left >= 0 && panelRect.top >= 0 &&
            panelRect.right <= innerWidth && panelRect.bottom <= innerHeight,
          layoutHeightUnchanged: article.getBoundingClientRect().height === beforePanelHeight
        };

        renderer.removeAll();
        const routeCleanup = {
          wrappers: article.querySelectorAll('[data-halo-owned="token"]').length,
          panelHosts: document.querySelectorAll('[data-halo-owned="panel"]').length,
          text: article.textContent,
          rootCount: renderer.status().rootCount
        };

        const transactionRoot = document.createElement('p');
        transactionRoot.textContent = 'model';
        const movedDestination = document.createElement('aside');
        movedDestination.append('Before ', ' after');
        document.body.append(transactionRoot, movedDestination);
        const transactionalRenderer = HaloReversibleRenderer.createReversibleRenderer({ document });
        const transactionText = transactionRoot.firstChild;
        transactionalRenderer.apply({
          schemaVersion: 1,
          runId: 'transaction-run',
          rootId: 'transaction-root',
          rootRevision: 1,
          analysisKey: 'transaction-analysis',
          root: transactionRoot,
          fragments: [markedFragment(transactionText, 'transaction-text', 0, 5, 'n')]
        });
        const movedWrapper = transactionRoot.querySelector('[data-halo-owned="token"]');
        const forgedLookalike = movedWrapper.cloneNode(true);
        forgedLookalike.textContent = 'forged';
        transactionRoot.appendChild(forgedLookalike);
        movedDestination.insertBefore(movedWrapper, movedDestination.lastChild);
        const destinationChildren = [...movedDestination.childNodes];
        const originalNormalize = movedDestination.normalize;
        movedDestination.normalize = function () {
          originalNormalize.call(this);
          throw new Error('browser moved normalize failed');
        };
        let rollbackMessage = null;
        try {
          transactionalRenderer.removeRoot('transaction-root');
        } catch (error) {
          rollbackMessage = error.message;
        }
        movedDestination.normalize = originalNormalize;
        const movedRollback = {
          message: rollbackMessage,
          exactChildren: destinationChildren.every((node, index) => movedDestination.childNodes[index] === node),
          stillOwned: transactionalRenderer.ownsToken(movedWrapper),
          forgedOwned: transactionalRenderer.ownsToken(forgedLookalike),
          rootCount: transactionalRenderer.status().rootCount
        };
        transactionalRenderer.removeAll();

        const detachedRoot = document.createElement('p');
        detachedRoot.textContent = 'model';
        document.body.appendChild(detachedRoot);
        const detachedRenderer = HaloReversibleRenderer.createReversibleRenderer({ document });
        detachedRenderer.apply({
          schemaVersion: 1,
          runId: 'detached-run',
          rootId: 'detached-root',
          rootRevision: 1,
          analysisKey: 'detached-analysis',
          root: detachedRoot,
          fragments: [markedFragment(detachedRoot.firstChild, 'detached-text', 0, 5, 'n')]
        });
        const detachedWrapper = detachedRoot.querySelector('[data-halo-owned="token"]');
        const detachedText = detachedWrapper.firstChild;
        const thirdParty = document.createElement('i');
        thirdParty.textContent = '!';
        detachedWrapper.appendChild(thirdParty);
        detachedRoot.removeChild(detachedWrapper);
        detachedRenderer.removeRoot('detached-root');
        detachedRoot.appendChild(detachedWrapper);
        detachedRenderer.apply({
          schemaVersion: 1,
          runId: 'detached-reapply',
          rootId: 'detached-root',
          rootRevision: 1,
          analysisKey: 'detached-reanalysis',
          root: detachedRoot,
          fragments: [markedFragment(detachedText, 'detached-text-reused', 0, 5, 'n')]
        });
        const parentlessCleanup = {
          outerOwned: detachedRenderer.ownsToken(detachedWrapper),
          outerHaloAttributes: detachedWrapper.getAttributeNames().filter((name) => name.startsWith('data-halo-')),
          privateTokens: [...detachedRoot.querySelectorAll('[data-halo-owned="token"]')]
            .filter((element) => detachedRenderer.ownsToken(element)).length,
          nestedTokens: detachedRoot.querySelectorAll('[data-halo-owned="token"] [data-halo-owned="token"]').length,
          text: detachedRoot.textContent
        };
        detachedRenderer.removeAll();

        return {
          applied: applied.action,
          sourceText,
          applyApply,
          applyRemove,
          applyRemoveApply,
          mutationApply,
          panelResult,
          routeCleanup,
          movedRollback,
          parentlessCleanup
        };
      });

      assert.equal(result.applied, 'applied');
      assert.deepEqual(result.applyApply, {
        action: 'duplicate',
        sameWrappers: true,
        wrapperCount: 3,
        nested: 0,
        text: result.sourceText
      });
      assert.deepEqual(result.applyRemove, {
        wrappers: 0,
        text: result.sourceText,
        linkIdentity: true,
        emphasisIdentity: true,
        nestedSpanIdentity: true,
        authoredIdentity: true
      });
      assert.equal(result.applyRemoveApply.wrappers, 2);
      assert.equal(result.applyRemoveApply.text, result.sourceText);
      assert.deepEqual(result.mutationApply, {
        wrappers: 1,
        text: 'The model studies.',
        emphasisIdentity: true
      });
      assert.deepEqual(result.panelResult, {
        shadowOpen: true,
        role: 'dialog',
        modal: 'false',
        literalTitle: '<b>Literal title</b>',
        hostVisible: true,
        pageRuleDidNotWin: true,
        clamped: true,
        layoutHeightUnchanged: true
      });
      assert.deepEqual(result.routeCleanup, {
        wrappers: 0,
        panelHosts: 0,
        text: 'The model studies.',
        rootCount: 0
      });
      assert.deepEqual(result.movedRollback, {
        message: 'browser moved normalize failed',
        exactChildren: true,
        stillOwned: true,
        forgedOwned: false,
        rootCount: 1
      });
      assert.deepEqual(result.parentlessCleanup, {
        outerOwned: false,
        outerHaloAttributes: [],
        privateTokens: 1,
        nestedTokens: 0,
        text: 'model!'
      });
      assert.ok(requests.every((url) => url.startsWith(origin)), 'renderer makes no remote request');
    });
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
