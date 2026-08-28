'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Entry = require('../apps/extension/src/shared/browser-entry');

function idempotenceFixture() {
  let runtimeLive = false;
  let cssInsertions = 0;
  let packagedScriptInsertions = 0;

  const chrome = {
    tabs: {
      async sendMessage(_tabId, message) {
        if (message && message.type === 'HALO_STATUS') {
          if (!runtimeLive) throw new Error('Could not establish connection. Receiving end does not exist.');
          return { active: false };
        }
        return { accepted: true };
      }
    },
    scripting: {
      async insertCSS() {
        cssInsertions += 1;
      },
      async executeScript(options) {
        if (options && Array.isArray(options.files)) {
          packagedScriptInsertions += 1;
          runtimeLive = true;
        }
      }
    }
  };

  return {
    chrome,
    counts() {
      return { cssInsertions, packagedScriptInsertions };
    }
  };
}

test('packaged runtime injection is idempotent per live tab receiver', async () => {
  const fixture = idempotenceFixture();

  await Entry.injectPackagedRuntime({ chrome: fixture.chrome, tabId: 17 });
  await Entry.injectPackagedRuntime({ chrome: fixture.chrome, tabId: 17 });

  assert.deepEqual(fixture.counts(), {
    cssInsertions: 1,
    packagedScriptInsertions: 1
  });
});
