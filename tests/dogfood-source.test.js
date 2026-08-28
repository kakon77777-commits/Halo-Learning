'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Source = require('../apps/extension/src/shared/dogfood-source');

test('ordinary identity drops query/fragment before hashing', async () => {
  const a = await Source.createSourceRef({ url: 'https://Example.com/read/ch1?token=secret#x', language: 'en' });
  const b = await Source.createSourceRef({ url: 'https://example.com/read/ch1?other=2#y', language: 'en' });
  assert.equal(a.domain, 'example.com');
  assert.equal(a.normalizedPathHash, b.normalizedPathHash);
  assert.equal(a.fullUrl, null);
  assert.doesNotMatch(JSON.stringify(a), /secret|other=2|#x|#y/);
});

test('explicit return context may retain the exact local URL', async () => {
  const source = await Source.createSourceRef({
    url: 'https://example.com/read/ch1?view=1#paragraph',
    language: 'en',
    retainFullUrl: true
  });
  assert.equal(source.fullUrl, 'https://example.com/read/ch1?view=1#paragraph');
});
