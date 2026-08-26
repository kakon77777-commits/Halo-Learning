const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { resolveChromiumExecutable } = require('./helpers/extension-harness');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const rendererPath = path.join(repositoryRoot, 'apps', 'extension', 'src', 'shared', 'reversible-renderer.js');
const contentCssPath = path.join(repositoryRoot, 'apps', 'extension', 'src', 'content.css');

async function withBrowser(callback) {
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  const browser = await chromium.launch({ executablePath: executable.path, headless: true, args: ['--no-sandbox'] });
  try {
    await callback(browser, executable);
  } finally {
    await browser.close();
  }
}

async function preparePage(browser) {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.setContent(`<!doctype html><html lang="en"><body>
    <button id="trigger" type="button">Open semantic details</button>
    <main><p id="sentence">The model learns safely.</p></main>
    <span id="token" class="halo-token halo-noncolor-marker halo-label-top-right" data-halo-owned="token" data-halo-pos="n">model</span>
  </body></html>`);
  await page.addStyleTag({ path: contentCssPath });
  await page.addScriptTag({ path: rendererPath });
  await page.evaluate(() => {
    window.__haloRenderer = HaloReversibleRenderer.createReversibleRenderer({ document });
  });
  return page;
}

test('real Chromium moves focus into the labelled panel and restores the explicit trigger on close', async () => {
  await withBrowser(async (browser) => {
    const page = await preparePage(browser);
    await page.locator('#trigger').focus();
    await page.evaluate(() => {
      window.__haloRenderer.openPanel({
        title: 'Semantic details',
        body: 'Noun · model',
        status: 'Ready',
        trigger: document.querySelector('#trigger'),
        anchor: { x: 24, y: 24 }
      });
    });

    const panelState = await page.evaluate(() => {
      const host = document.querySelector('[data-halo-owned="panel"]');
      const panel = host.shadowRoot.querySelector('.halo-core-panel');
      const status = host.shadowRoot.querySelector('.halo-core-status');
      return {
        role: panel.getAttribute('role'),
        labelledBy: panel.getAttribute('aria-labelledby'),
        activeId: host.shadowRoot.activeElement && host.shadowRoot.activeElement.id,
        titleTabIndex: host.shadowRoot.querySelector('#halo-panel-title').getAttribute('tabindex'),
        live: status.getAttribute('aria-live'),
        statusRole: status.getAttribute('role'),
        statusText: status.textContent
      };
    });
    assert.deepEqual(panelState, {
      role: 'dialog',
      labelledBy: 'halo-panel-title',
      activeId: 'halo-panel-title',
      titleTabIndex: '-1',
      live: 'polite',
      statusRole: 'status',
      statusText: 'Ready'
    });

    await page.evaluate(() => window.__haloRenderer.closePanel('closed'));
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'trigger');
    await page.close();
  });
});

test('real Chromium keeps POS annotation readable without color and without per-token accessibility spam', async () => {
  await withBrowser(async (browser) => {
    const page = await preparePage(browser);
    const token = await page.locator('#token').evaluate((node) => ({
      tabindex: node.getAttribute('tabindex'),
      ariaLabel: node.getAttribute('aria-label'),
      decoration: getComputedStyle(node).textDecorationStyle,
      pseudoContent: getComputedStyle(node, '::after').content
    }));
    assert.equal(token.tabindex, null);
    assert.equal(token.ariaLabel, null);
    assert.equal(token.decoration, 'dotted');
    assert.ok(token.pseudoContent.includes('n'));
    await page.close();
  });
});

test('real Chromium honors reduced motion and forced-color noncolor markers', async () => {
  await withBrowser(async (browser) => {
    const page = await preparePage(browser);
    await page.addStyleTag({ content: '@keyframes halo-test { from { opacity: .5; } to { opacity: 1; } }' });
    await page.locator('#token').evaluate((node) => {
      node.style.transition = 'opacity 10s linear';
      node.style.animation = 'halo-test 10s linear infinite';
    });
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    const style = await page.locator('#token').evaluate((node) => {
      const computed = getComputedStyle(node);
      return {
        transitionDuration: computed.transitionDuration,
        animationName: computed.animationName,
        outlineStyle: computed.outlineStyle
      };
    });
    assert.equal(style.transitionDuration, '0s');
    assert.equal(style.animationName, 'none');
    assert.equal(style.outlineStyle, 'dotted');
    await page.close();
  });
});

test('real Chromium panel remains inside viewport at 200 percent root text scaling', async () => {
  await withBrowser(async (browser) => {
    const page = await preparePage(browser);
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    await page.evaluate(() => {
      document.querySelector('#trigger').focus();
      window.__haloRenderer.openPanel({
        title: 'Long semantic details that must wrap safely',
        body: 'A deliberately long explanation '.repeat(30),
        status: 'Enriched',
        trigger: document.querySelector('#trigger'),
        anchor: { x: 620, y: 460 }
      });
    });
    const rect = await page.evaluate(() => {
      const host = document.querySelector('[data-halo-owned="panel"]');
      const panel = host.shadowRoot.querySelector('.halo-core-panel');
      const value = panel.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        scrollWidth: panel.scrollWidth,
        clientWidth: panel.clientWidth
      };
    });
    assert.ok(rect.left >= 0);
    assert.ok(rect.top >= 0);
    assert.ok(rect.right <= 640);
    assert.ok(rect.bottom <= 480);
    assert.ok(rect.width <= 640);
    assert.ok(rect.scrollWidth <= rect.clientWidth + 1);
    await page.close();
  });
});
