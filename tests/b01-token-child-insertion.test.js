'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Pipeline = require('../apps/extension/src/shared/sentence-pipeline');

function text(value, id) {
  return { nodeType: 3, nodeValue: value, _id: id, parentElement: null, parentNode: null, ownerDocument: null };
}
function element(tagName, children = []) {
  const attributes = new Map();
  const node = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    childNodes: [], parentElement: null, parentNode: null, ownerDocument: null,
    hasAttribute(name) { return attributes.has(String(name).toLowerCase()); },
    getAttribute(name) { return attributes.get(String(name).toLowerCase()) ?? null; },
    appendChild(child) { child.parentElement = this; child.parentNode = this; child.ownerDocument = this.ownerDocument; this.childNodes.push(child); return child; }
  };
  for (const child of children) node.appendChild(child);
  return node;
}
function fixture() {
  const bang = text('!', 'bang');
  const inserted = element('i', [bang]);
  const root = element('p', [text('The initial system', 'lead'), inserted, text(' learns.', 'tail')]);
  const document = { defaultView: { getComputedStyle: () => ({ display:'inline', visibility:'visible', contentVisibility:'visible', opacity:'1' }) } };
  const assign = node => { node.ownerDocument = document; for (const child of node.childNodes || []) assign(child); };
  assign(root);
  return { root, bang };
}

test('B01 page-authored token child punctuation can preserve the prior sentence boundary', () => {
  const { root, bang } = fixture();
  const records = Pipeline.buildSentenceRecords(root, {
    getNodeId: node => node._id,
    locale: 'en',
    isSentenceTerminatorProtected: node => node === bang
  });
  assert.deepEqual(records.map(record => record.text), ['The initial system! learns.']);
});
