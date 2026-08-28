'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const guidePath = path.resolve(__dirname, '..', 'docs', 'dogfood', 'v0.5.0-local-install.md');

test('v0.5 local install guide is explicit dogfood-only and covers the real persistence workflow', () => {
  assert.equal(fs.existsSync(guidePath), true, 'local dogfood install guide must exist');
  const text = fs.readFileSync(guidePath, 'utf8');
  assert.match(text, /LOCAL DOGFOOD — NOT PUBLIC v0\.5 RELEASE/u);
  assert.match(text, /npm ci/u);
  assert.match(text, /npm run dogfood:test/u);
  assert.match(text, /dogfood:browser/u);
  assert.match(text, /npm run dogfood:package/u);
  assert.match(text, /chrome:\/\/extensions|edge:\/\/extensions/u);
  assert.match(text, /Load unpacked/u);
  assert.match(text, /apps\/extension\//u);
  assert.match(text, /English|EN/u);
  assert.match(text, /zh-Hant|Traditional Chinese|繁體中文/u);
  assert.match(text, /Data Dashboard|Dashboard/u);
  assert.match(text, /Save Sentence/u);
  assert.match(text, /Dogfood Note|dogfood note/u);
  assert.match(text, /restart|重新啟動/u);
  assert.match(text, /export[^\n]*before[^\n]*delete|刪除前[^\n]*匯出/iu);
  assert.match(text, /public_release_ready:\s*false/u);
  assert.doesNotMatch(text, /public_release_ready:\s*true/u);
});
