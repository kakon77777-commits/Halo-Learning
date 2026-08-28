'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Entry = require('../apps/extension/src/shared/browser-entry');
const ServiceWorker = require('../apps/extension/src/service-worker');

function browserFixture(options) {
  const settings = options || {};
  const calls = [];
  const injectedTabs = new Set();
  const listeners = {
    installed: [],
    clicked: [],
    command: []
  };
  const chromeApi = {
    runtime: {
      lastError: null,
      onInstalled: { addListener(listener) { listeners.installed.push(listener); } }
    },
    contextMenus: {
      remove(id, callback) {
        calls.push(['remove-menu', id]);
        callback();
      },
      create(value, callback) {
        calls.push(['create-menu', value]);
        callback();
      },
      onClicked: { addListener(listener) { listeners.clicked.push(listener); } }
    },
    commands: {
      onCommand: { addListener(listener) { listeners.command.push(listener); } }
    },
    tabs: {
      async query(value) {
        calls.push(['query', value]);
        return settings.tabs || [{ id: 17 }];
      },
      async sendMessage(tabId, message) {
        if (message && message.type === 'HALO_STATUS') {
          calls.push(['status-message', tabId, message]);
          if (!injectedTabs.has(tabId)) throw new Error('receiver unavailable');
          return { active: false };
        }
        calls.push(['message', tabId, message]);
        if (settings.messageError) throw settings.messageError;
        return { accepted: true };
      }
    },
    scripting: {
      async insertCSS(value) {
        calls.push(['css', value]);
        if (settings.cssError) throw settings.cssError;
      },
      async executeScript(value) {
        calls.push(['script', value]);
        if (settings.scriptError) throw settings.scriptError;
        if (value && value.target && Array.isArray(value.files)) injectedTabs.add(value.target.tabId);
      }
    }
  };
  return { chromeApi, calls, listeners };
}

test('canonical browser entry injects local files in order then sends the exact explicit envelope', async () => {
  const fixture = browserFixture();
  const result = await Entry.injectAndSendExplicitSelection({ chrome: fixture.chromeApi, tabId: 17 });

  assert.deepEqual(fixture.calls, [
    ['status-message', 17, { type: 'HALO_STATUS' }],
    ['css', { target: { tabId: 17 }, files: ['src/content.css'] }],
    ['script', { target: { tabId: 17 }, files: Entry.INJECT_FILES }],
    ['message', 17, { type: 'HALO_EXPLICIT_SELECTION', action: 'analyze-selection' }]
  ]);
  assert.deepEqual(result, { accepted: true });
  assert.equal(Object.isFrozen(Entry.INJECT_FILES), true);
  assert.ok(Entry.INJECT_FILES.includes('src/shared/trigger-controller.js'));
  assert.ok(Entry.INJECT_FILES.includes('src/shared/site-policy.js'));
  assert.ok(
    Entry.INJECT_FILES.indexOf('src/shared/site-policy.js') < Entry.INJECT_FILES.indexOf('src/shared/settings.js')
  );
  assert.ok(
    Entry.INJECT_FILES.indexOf('src/shared/trigger-controller.js') < Entry.INJECT_FILES.indexOf('src/content.js')
  );
  assert.ok(Entry.INJECT_FILES.every((value) => !/^(?:https?:|data:|\/)/i.test(value)));
});

test('injection or tab-message failure rejects safely without continuing later stages', async () => {
  const injectionFailure = browserFixture({ scriptError: new Error('tab closed') });
  await assert.rejects(
    () => Entry.injectAndSendExplicitSelection({ chrome: injectionFailure.chromeApi, tabId: 17 }),
    /tab closed/
  );
  assert.equal(injectionFailure.calls.some(([name]) => name === 'message'), false);

  const missingTab = browserFixture();
  await assert.rejects(
    () => Entry.injectAndSendExplicitSelection({ chrome: missingTab.chromeApi, tabId: -1 }),
    /tabId/
  );
  assert.deepEqual(missingTab.calls, []);
});

test('install/update replaces exactly one selection context menu and registration is idempotent', async () => {
  const fixture = browserFixture();
  const service = ServiceWorker.createBrowserTriggerService({
    chrome: fixture.chromeApi,
    browserEntry: Entry
  });
  service.register();
  service.register();

  assert.equal(fixture.listeners.installed.length, 1);
  assert.equal(fixture.listeners.clicked.length, 1);
  assert.equal(fixture.listeners.command.length, 1);
  await service.installContextMenu();
  assert.deepEqual(fixture.calls, [
    ['remove-menu', 'halo-analyze-selection'],
    ['create-menu', {
      id: 'halo-analyze-selection',
      title: 'Analyze selection with Halo Learning',
      contexts: ['selection']
    }]
  ]);
});

test('command and context actions use the same packaged path and never forward selected text', async () => {
  const fixture = browserFixture();
  const service = ServiceWorker.createBrowserTriggerService({
    chrome: fixture.chromeApi,
    browserEntry: Entry
  });

  await service.handleContextClick({
    menuItemId: 'halo-analyze-selection',
    selectionText: 'private selected text'
  }, { id: 21 });
  await service.handleCommand('halo-analyze-selection');

  const scripts = fixture.calls.filter(([name]) => name === 'script');
  const messages = fixture.calls.filter(([name]) => name === 'message');
  assert.equal(scripts.length, 2);
  assert.deepEqual(scripts[0][1].files, Entry.INJECT_FILES);
  assert.deepEqual(scripts[1][1].files, Entry.INJECT_FILES);
  assert.deepEqual(messages, [
    ['message', 21, Entry.EXPLICIT_SELECTION_MESSAGE],
    ['message', 17, Entry.EXPLICIT_SELECTION_MESSAGE]
  ]);
  assert.doesNotMatch(JSON.stringify(fixture.calls), /private selected text/);
});

test('irrelevant actions, tab close, and browser API failure are contained per event', async () => {
  const fixture = browserFixture({ tabs: [], messageError: new Error('receiver unavailable') });
  const service = ServiceWorker.createBrowserTriggerService({
    chrome: fixture.chromeApi,
    browserEntry: Entry
  });

  assert.equal(await service.handleContextClick({ menuItemId: 'other' }, { id: 2 }), false);
  assert.equal(await service.handleContextClick({ menuItemId: 'halo-analyze-selection' }, {}), false);
  assert.equal(await service.handleCommand('other'), false);
  assert.equal(await service.handleCommand('halo-analyze-selection'), false);
  await assert.doesNotReject(() => service.runSafely(() => Entry.injectAndSendExplicitSelection({
    chrome: fixture.chromeApi,
    tabId: 2
  })));
});
