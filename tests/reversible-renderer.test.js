const test = require('node:test');
const assert = require('node:assert/strict');

const Renderer = require('../apps/extension/src/shared/reversible-renderer');
const Dynamic = require('../apps/extension/src/shared/dynamic-dom-controller');

class FakeNode {
  constructor(nodeType, ownerDocument) {
    this.nodeType = nodeType;
    this.ownerDocument = ownerDocument || null;
    this.parentNode = null;
    this.childNodes = [];
  }

  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }

  get isConnected() {
    for (let current = this; current; current = current.parentNode) {
      if (current.nodeType === 9) return true;
    }
    return false;
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    const source = String(value);
    if (source) this.appendChild(this.ownerDocument.createTextNode(source));
  }

  _insertAt(node, index) {
    if (node.nodeType === 11 && !node.host) {
      const children = [...node.childNodes];
      for (const child of children) this._insertAt(child, index++);
      return node;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    node.ownerDocument = this.nodeType === 9 ? this : this.ownerDocument;
    this.childNodes.splice(index, 0, node);
    return node;
  }

  appendChild(node) {
    return this._insertAt(node, this.childNodes.length);
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  insertBefore(node, reference) {
    const index = reference === null ? this.childNodes.length : this.childNodes.indexOf(reference);
    if (index < 0) throw new Error('reference is not a child');
    return this._insertAt(node, index);
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error('node is not a child');
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  replaceChild(next, previous) {
    const index = this.childNodes.indexOf(previous);
    if (index < 0) throw new Error('node is not a child');
    this.removeChild(previous);
    this._insertAt(next, index);
    return previous;
  }

  replaceWith(...nodes) {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    let index = parent.childNodes.indexOf(this);
    parent.removeChild(this);
    for (const node of nodes) parent._insertAt(node, index++);
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  contains(candidate) {
    for (let current = candidate; current; current = current.parentNode) {
      if (current === this) return true;
    }
    return false;
  }

  normalize() {
    for (const child of [...this.childNodes]) {
      if (child.nodeType !== 3) child.normalize();
    }
    for (let index = this.childNodes.length - 1; index >= 0; index -= 1) {
      const child = this.childNodes[index];
      if (child.nodeType === 3 && child.nodeValue === '') this.removeChild(child);
    }
    for (let index = this.childNodes.length - 1; index > 0; index -= 1) {
      const child = this.childNodes[index];
      const previous = this.childNodes[index - 1];
      if (child.nodeType === 3 && previous.nodeType === 3) {
        previous.nodeValue += child.nodeValue;
        this.removeChild(child);
      }
    }
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1 && child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

class FakeText extends FakeNode {
  constructor(value, document) {
    super(3, document);
    this.nodeValue = String(value);
  }

  get textContent() {
    return this.nodeValue;
  }

  set textContent(value) {
    this.nodeValue = String(value);
  }

  splitText(offset) {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.nodeValue.length) {
      throw new RangeError('invalid split offset');
    }
    const suffix = new FakeText(this.nodeValue.slice(offset), this.ownerDocument);
    this.nodeValue = this.nodeValue.slice(0, offset);
    if (this.parentNode) this.parentNode.insertBefore(suffix, this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null);
    return suffix;
  }
}

class FakeStyle {
  constructor() {
    this.priorities = new Map();
  }

  setProperty(name, value, priority = '') {
    this[name] = String(value);
    this.priorities.set(String(name), String(priority));
  }

  getPropertyValue(name) {
    return this[name] || '';
  }

  getPropertyPriority(name) {
    return this.priorities.get(String(name)) || '';
  }
}

class FakeElement extends FakeNode {
  constructor(tagName, document) {
    super(1, document);
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.style = new FakeStyle();
    this.shadowRoot = null;
  }

  get className() {
    return this.getAttribute('class') || '';
  }

  set className(value) {
    this.setAttribute('class', value);
  }

  setAttribute(name, value) {
    this.attributes.set(String(name).toLowerCase(), String(value));
  }

  getAttribute(name) {
    return this.attributes.get(String(name).toLowerCase()) ?? null;
  }

  getAttributeNames() {
    return [...this.attributes.keys()];
  }

  hasAttribute(name) {
    return this.attributes.has(String(name).toLowerCase());
  }

  removeAttribute(name) {
    this.attributes.delete(String(name).toLowerCase());
  }

  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attribute) {
      return this.hasAttribute(attribute[1]) &&
        (attribute[2] === undefined || this.getAttribute(attribute[1]) === attribute[2]);
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  attachShadow(options) {
    assert.equal(options.mode, 'open');
    this.shadowRoot = new FakeShadowRoot(this.ownerDocument, this);
    return this.shadowRoot;
  }

  getBoundingClientRect() {
    return { width: 320, height: 180, left: 0, top: 0, right: 320, bottom: 180 };
  }
}

class FakeShadowRoot extends FakeNode {
  constructor(document, host) {
    super(11, document);
    this.host = host;
  }
}

class FakeDocumentFragment extends FakeNode {
  constructor(document) {
    super(11, document);
  }
}

class FakeDocument extends FakeNode {
  constructor() {
    super(9, null);
    this.ownerDocument = this;
    this.defaultView = { innerWidth: 800, innerHeight: 600 };
    this.documentElement = new FakeElement('html', this);
    this.body = new FakeElement('body', this);
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
  }

  createElement(name) {
    return new FakeElement(name, this);
  }

  createTextNode(value) {
    return new FakeText(value, this);
  }

  createDocumentFragment() {
    return new FakeDocumentFragment(this);
  }
}

function fixture() {
  const document = new FakeDocument();
  const article = document.createElement('article');
  const lead = document.createTextNode('The ');
  const link = document.createElement('a');
  link.setAttribute('href', '/model');
  const model = document.createTextNode('model');
  link.appendChild(model);
  const emphasis = document.createElement('em');
  const learns = document.createTextNode(' learns.');
  emphasis.appendChild(learns);
  article.append(lead, link, emphasis);
  document.body.appendChild(article);
  return { document, article, lead, link, model, emphasis, learns };
}

function request(root, settings) {
  const values = settings || {};
  return {
    schemaVersion: 1,
    runId: values.runId || 'run-1',
    rootId: values.rootId || 'root-1',
    rootRevision: values.rootRevision || 1,
    analysisKey: values.analysisKey || 'analysis-1',
    root,
    fragments: values.fragments || []
  };
}

function fragment(node, nodeId, start, end, projection) {
  return {
    node,
    nodeId,
    start,
    end,
    text: node.nodeValue.slice(start, end),
    renderPlan: {
      marked: true,
      pos: 'n',
      label: 'n',
      colorClass: 'halo-pos-n',
      labelPosition: 'top-right',
      ...projection
    }
  };
}

function fragmentWithBoundary(node, nodeId, start, end, boundaryKey, projection) {
  return { ...fragment(node, nodeId, start, end, projection), boundaryKey };
}

test('node-local operations sort from last offset to first', () => {
  const operations = Renderer.planNodeOperations([
    { nodeId: 'a', start: 0, end: 3 },
    { nodeId: 'a', start: 4, end: 9 },
    { nodeId: 'b', start: 0, end: 5 }
  ]);

  assert.deepEqual(operations.map((value) => [value.nodeId, value.start]), [
    ['b', 0],
    ['a', 4],
    ['a', 0]
  ]);
});

test('same root revision and analysis key is an idempotent no-op', () => {
  const state = Renderer.createRenderState();
  state.record({ rootId: 'r', rootRevision: 2, analysisKey: 'k', wrappers: 3 });

  assert.equal(state.classify({ rootId: 'r', rootRevision: 2, analysisKey: 'k' }), 'duplicate');
  assert.equal(state.classify({ rootId: 'r', rootRevision: 3, analysisKey: 'k' }), 'reconcile');
});

test('apply is exact, node-local, and preserves inline element identity', () => {
  const dom = fixture();
  let suppressionEpochs = 0;
  const renderer = Renderer.createReversibleRenderer({
    document: dom.document,
    suppressMutations(callback) {
      suppressionEpochs += 1;
      return callback();
    }
  });
  const renderRequest = request(dom.article, {
    fragments: [
      fragment(dom.model, 'model-node', 0, 5),
      fragment(dom.learns, 'learn-node', 1, 7, { pos: 'v', label: 'v', colorClass: 'halo-pos-v' })
    ]
  });

  const first = renderer.apply(renderRequest);
  const wrappers = dom.article.querySelectorAll('[data-halo-owned="token"]');
  const wrapperIdentities = [...wrappers];
  const second = renderer.apply(renderRequest);

  assert.equal(first.action, 'applied');
  assert.equal(second.action, 'duplicate');
  assert.equal(suppressionEpochs, 1);
  assert.equal(dom.article.textContent, 'The model learns.');
  assert.equal(dom.link.parentNode, dom.article);
  assert.equal(dom.emphasis.parentNode, dom.article);
  assert.equal(dom.link.getAttribute('href'), '/model');
  assert.deepEqual(dom.article.querySelectorAll('[data-halo-owned="token"]'), wrapperIdentities);
  assert.equal(dom.article.querySelectorAll('[data-halo-owned="token"] [data-halo-owned="token"]').length, 0);
  for (const wrapper of wrappers) {
    assert.equal(wrapper.getAttribute('data-halo-run'), 'run-1');
    assert.equal(wrapper.getAttribute('data-halo-root'), 'root-1');
    assert.equal(wrapper.className.includes('halo-token'), true);
    assert.ok(wrapper.getAttribute('data-halo-original'));
    assert.ok(wrapper.getAttribute('data-halo-carrier'), 'a non-color carrier is retained');
  }
});

test('remove unwraps only this renderer run and preserves page-authored lookalikes and third-party children', () => {
  const dom = fixture();
  const authored = dom.document.createElement('span');
  authored.className = 'halo-token';
  authored.setAttribute('data-halo-owned', 'article-author');
  authored.textContent = ' Authored.';
  dom.article.appendChild(authored);
  const renderer = Renderer.createReversibleRenderer({ document: dom.document });
  renderer.apply(request(dom.article, { fragments: [fragment(dom.model, 'model-node', 0, 5)] }));
  const owned = dom.article.querySelector('[data-halo-owned="token"]');
  const thirdParty = dom.document.createElement('i');
  thirdParty.textContent = '!';
  owned.appendChild(thirdParty);

  const result = renderer.removeRoot('root-1');

  assert.equal(result.action, 'removed');
  assert.equal(dom.article.querySelectorAll('[data-halo-owned="token"]').length, 0);
  assert.equal(authored.parentNode, dom.article);
  assert.equal(thirdParty.parentNode, dom.link);
  assert.equal(dom.article.textContent, 'The model! learns. Authored.');
  assert.equal(renderer.status().rootCount, 0);
});

test('apply remove apply and mutation apply remain reversible with bounded live-root state', () => {
  const dom = fixture();
  const renderer = Renderer.createReversibleRenderer({ document: dom.document });
  renderer.apply(request(dom.article, { fragments: [fragment(dom.model, 'model-node', 0, 5)] }));
  renderer.removeRoot('root-1');
  assert.equal(dom.article.textContent, 'The model learns.');

  const restoredModel = dom.link.childNodes.find((node) => node.nodeType === 3);
  renderer.apply(request(dom.article, {
    runId: 'run-2',
    analysisKey: 'analysis-2',
    fragments: [fragment(restoredModel, 'model-node', 0, 5)]
  }));
  renderer.removeRoot('root-1');
  dom.link.textContent = 'system';
  renderer.apply(request(dom.article, {
    runId: 'run-3',
    rootRevision: 2,
    analysisKey: 'analysis-3',
    fragments: [fragment(dom.link.childNodes[0], 'model-node-v2', 0, 6, { label: 'n' })]
  }));

  assert.equal(dom.article.textContent, 'The system learns.');
  assert.equal(dom.article.querySelectorAll('[data-halo-owned="token"]').length, 1);
  assert.deepEqual(renderer.status().roots, [{
    rootId: 'root-1',
    rootRevision: 2,
    analysisKey: 'analysis-3',
    runId: 'run-3',
    wrappers: 1
  }]);
  renderer.removeAll();
  assert.equal(dom.article.textContent, 'The system learns.');
  assert.equal(renderer.status().rootCount, 0);
});

test('same boundaries reconcile projection attributes in place', () => {
  const dom = fixture();
  const renderer = Renderer.createReversibleRenderer({ document: dom.document });
  renderer.apply(request(dom.article, { fragments: [fragment(dom.model, 'model-node', 0, 5)] }));
  const wrapper = dom.article.querySelector('[data-halo-owned="token"]');
  const ownedText = wrapper.childNodes[0];

  const result = renderer.reconcile(request(dom.article, {
    runId: 'run-2',
    analysisKey: 'analysis-2',
    fragments: [fragment(ownedText, 'model-node', 0, 5, {
      pos: 'v',
      label: 'verb',
      colorClass: 'halo-pos-v',
      metaLabel: 'present'
    })]
  }));

  assert.equal(result.action, 'updated');
  assert.equal(dom.article.querySelector('[data-halo-owned="token"]'), wrapper);
  assert.equal(wrapper.getAttribute('data-halo-run'), 'run-2');
  assert.equal(wrapper.getAttribute('data-halo-pos'), 'verb');
  assert.equal(wrapper.getAttribute('data-halo-meta'), 'present');
  assert.equal(dom.article.textContent, 'The model learns.');
});

test('stable aggregate boundary identity permits in-place reconcile after local text splitting', () => {
  const dom = fixture();
  const renderer = Renderer.createReversibleRenderer({ document: dom.document });
  renderer.apply(request(dom.article, {
    fragments: [fragmentWithBoundary(dom.learns, 'learn-node', 1, 7, '10:16:learn-node')]
  }));
  const wrapper = dom.article.querySelector('[data-halo-owned="token"]');
  const ownedText = wrapper.childNodes[0];

  const result = renderer.reconcile(request(dom.article, {
    runId: 'run-2',
    analysisKey: 'analysis-2',
    fragments: [fragmentWithBoundary(ownedText, 'run-shifted-after-split', 0, 6, '10:16:learn-node', {
      pos: 'v',
      label: 'verb'
    })]
  }));

  assert.equal(result.action, 'updated');
  assert.equal(dom.article.querySelector('[data-halo-owned="token"]'), wrapper);
  assert.equal(dom.article.textContent, 'The model learns.');
});

test('different boundaries rebuild once without moving containing elements', () => {
  const dom = fixture();
  let epochs = 0;
  const renderer = Renderer.createReversibleRenderer({
    document: dom.document,
    suppressMutations(callback) {
      epochs += 1;
      return callback();
    }
  });
  renderer.apply(request(dom.article, {
    fragments: [fragment(dom.learns, 'learn-node', 1, 7, { pos: 'v', label: 'v' })]
  }));
  const oldWrapper = dom.article.querySelector('[data-halo-owned="token"]');
  const ownedText = oldWrapper.childNodes[0];

  const result = renderer.reconcile(request(dom.article, {
    runId: 'run-2',
    analysisKey: 'analysis-2',
    fragments: [fragment(ownedText, 'learn-node', 0, 5, { pos: 'v', label: 'verb' })]
  }));

  assert.equal(result.action, 'rebuilt');
  assert.equal(epochs, 2, 'one apply epoch plus one complete reconcile epoch');
  assert.equal(oldWrapper.parentNode, null);
  assert.equal(dom.emphasis.parentNode, dom.article);
  assert.equal(dom.article.textContent, 'The model learns.');
  assert.equal(dom.article.querySelectorAll('[data-halo-owned="token"]').length, 1);
  assert.equal(dom.article.querySelector('[data-halo-owned="token"]').textContent, 'learn');
});

test('request validation rejects stale versions, forged text, unsafe classes, and overlaps before mutation', () => {
  const dom = fixture();
  const renderer = Renderer.createReversibleRenderer({ document: dom.document });
  const validFragment = fragment(dom.model, 'model-node', 0, 5);

  assert.throws(() => renderer.apply({ ...request(dom.article, { fragments: [validFragment] }), schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => renderer.apply(request(dom.article, {
    fragments: [{ ...validFragment, text: 'forged' }]
  })), /source text/);
  assert.throws(() => renderer.apply(request(dom.article, {
    fragments: [fragment(dom.model, 'model-node', 0, 5, { colorClass: 'page-owned-class' })]
  })), /class/);
  assert.throws(() => renderer.apply(request(dom.article, {
    fragments: [
      fragment(dom.model, 'model-node', 0, 4),
      fragment(dom.model, 'model-node', 3, 5)
    ]
  })), /overlap/);
  assert.equal(dom.article.textContent, 'The model learns.');
});

test('core panel uses an isolated dialog, literal text, fixed clamped positioning, and deterministic close status', () => {
  const dom = fixture();
  const renderer = Renderer.createReversibleRenderer({ document: dom.document });

  const opened = renderer.openPanel({
    title: '<img src=x onerror=alert(1)>',
    body: 'Literal <b>learning</b> detail',
    status: 'Ready',
    anchor: { x: 790, y: 590 }
  });
  const host = dom.document.body.querySelector('[data-halo-owned="panel"]');
  const panel = host.shadowRoot.querySelector('[role="dialog"]');

  assert.equal(opened.action, 'opened');
  assert.equal(host.style.position, 'fixed');
  assert.equal(panel.getAttribute('aria-modal'), 'false');
  assert.equal(panel.getAttribute('aria-labelledby'), 'halo-panel-title');
  for (const property of ['display', 'position', 'width', 'height', 'visibility']) {
    assert.equal(host.style.getPropertyPriority(property), 'important', `${property} resists hostile page CSS`);
  }
  assert.equal(host.style.getPropertyValue('display'), 'block');
  assert.equal(host.style.getPropertyValue('position'), 'fixed');
  assert.equal(host.style.getPropertyValue('width'), '0px');
  assert.equal(host.style.getPropertyValue('height'), '0px');
  assert.equal(host.style.getPropertyValue('visibility'), 'visible');
  assert.equal(host.shadowRoot.querySelector('#halo-panel-title'), null, 'the fake selector does not synthesize HTML from text');
  assert.equal(panel.textContent, '<img src=x onerror=alert(1)>Literal <b>learning</b> detailReady');
  assert.ok(Number.parseFloat(panel.style.left) >= 8 && Number.parseFloat(panel.style.left) <= 472);
  assert.ok(Number.parseFloat(panel.style.top) >= 8 && Number.parseFloat(panel.style.top) <= 412);
  assert.deepEqual(renderer.status().panel, { open: true, closeReason: null });

  const closed = renderer.closePanel('route-cleanup');
  assert.equal(closed.action, 'closed');
  assert.equal(host.parentNode, null);
  assert.deepEqual(renderer.status().panel, { open: false, closeReason: 'route-cleanup' });
  assert.equal(renderer.closePanel('again').action, 'noop');
});

function assertOriginalFixtureStructure(dom) {
  assert.deepEqual(dom.article.childNodes, [dom.lead, dom.link, dom.emphasis]);
  assert.deepEqual(dom.link.childNodes, [dom.model]);
  assert.deepEqual(dom.emphasis.childNodes, [dom.learns]);
  assert.equal(dom.lead.nodeValue, 'The ');
  assert.equal(dom.model.nodeValue, 'model');
  assert.equal(dom.learns.nodeValue, ' learns.');
  assert.equal(dom.article.textContent, 'The model learns.');
}

test('apply rolls back earlier nodes when a later split or replacement throws', () => {
  for (const fault of ['split', 'replace']) {
    const dom = fixture();
    const renderer = Renderer.createReversibleRenderer({ document: dom.document });
    const originalSplit = dom.model.splitText;
    const originalReplace = dom.link.replaceChild;
    if (fault === 'split') {
      dom.model.splitText = () => { throw new Error('second-node split failed'); };
    } else {
      dom.link.replaceChild = () => { throw new Error('second-node replace failed'); };
    }

    assert.throws(() => renderer.apply(request(dom.article, {
      fragments: [
        fragment(dom.model, 'model-node', 0, 5),
        fragment(dom.learns, 'learn-node', 1, 7, { pos: 'v', label: 'v' })
      ]
    })), new RegExp(`second-node ${fault} failed`));

    dom.model.splitText = originalSplit;
    dom.link.replaceChild = originalReplace;
    assertOriginalFixtureStructure(dom);
    assert.equal(dom.article.querySelectorAll('[data-halo-owned="token"]').length, 0);
    assert.equal(renderer.status().rootCount, 0);
    assert.equal(renderer.status().lastAction, 'idle');
    assert.deepEqual(renderer.removeAll(), { action: 'removed-all', wrappers: 0 });
  }
});

test('apply rolls back when mutation suppression throws after running the callback', () => {
  const dom = fixture();
  const renderer = Renderer.createReversibleRenderer({
    document: dom.document,
    suppressMutations(callback) {
      callback();
      throw new Error('suppression failed after callback');
    }
  });

  assert.throws(() => renderer.apply(request(dom.article, {
    fragments: [fragment(dom.model, 'model-node', 0, 5)]
  })), /suppression failed after callback/);

  assertOriginalFixtureStructure(dom);
  assert.equal(renderer.status().rootCount, 0);
  assert.equal(renderer.status().lastAction, 'idle');
});

test('in-place reconcile restores every projection attribute when an update throws', () => {
  const dom = fixture();
  const renderer = Renderer.createReversibleRenderer({ document: dom.document });
  renderer.apply(request(dom.article, { fragments: [fragment(dom.model, 'model-node', 0, 5)] }));
  const wrapper = dom.article.querySelector('[data-halo-owned="token"]');
  const ownedText = wrapper.childNodes[0];
  const attributesBefore = [...wrapper.attributes.entries()];
  const statusBefore = renderer.status();
  const originalSetAttribute = wrapper.setAttribute;
  let failed = false;
  wrapper.setAttribute = function (name, value) {
    if (name === 'data-halo-meta' && !failed) {
      failed = true;
      throw new Error('projection attribute failed');
    }
    return originalSetAttribute.call(this, name, value);
  };

  assert.throws(() => renderer.reconcile(request(dom.article, {
    runId: 'run-2',
    analysisKey: 'analysis-2',
    fragments: [fragmentWithBoundary(ownedText, 'model-node-v2', 0, 5, 'model-node:0:5', {
      pos: 'v', label: 'verb', metaLabel: 'present'
    })]
  })), /projection attribute failed/);

  wrapper.setAttribute = originalSetAttribute;
  assert.deepEqual([...wrapper.attributes.entries()], attributesBefore);
  assert.deepEqual(renderer.status(), statusBefore);
  assert.equal(dom.article.querySelector('[data-halo-owned="token"]'), wrapper);
  assert.equal(dom.article.textContent, 'The model learns.');
  assert.equal(renderer.removeAll().wrappers, 1);
});

test('rebuild reconcile restores the prior wrapper and state when the new split fails', () => {
  const dom = fixture();
  const renderer = Renderer.createReversibleRenderer({ document: dom.document });
  renderer.apply(request(dom.article, {
    fragments: [fragment(dom.learns, 'learn-node', 1, 7, { pos: 'v', label: 'v' })]
  }));
  const wrapper = dom.article.querySelector('[data-halo-owned="token"]');
  const ownedText = wrapper.childNodes[0];
  const attributesBefore = [...wrapper.attributes.entries()];
  const statusBefore = renderer.status();
  const originalSplit = ownedText.splitText;
  ownedText.splitText = () => { throw new Error('rebuild split failed'); };

  assert.throws(() => renderer.reconcile(request(dom.article, {
    runId: 'run-2',
    analysisKey: 'analysis-2',
    fragments: [fragment(ownedText, 'learn-node-v2', 0, 5, { pos: 'v', label: 'verb' })]
  })), /rebuild split failed/);

  ownedText.splitText = originalSplit;
  assert.equal(dom.article.querySelector('[data-halo-owned="token"]'), wrapper);
  assert.deepEqual(wrapper.childNodes, [ownedText]);
  assert.deepEqual([...wrapper.attributes.entries()], attributesBefore);
  assert.deepEqual(renderer.status(), statusBefore);
  assert.equal(dom.article.textContent, 'The model learns.');
});

test('removeRoot restores wrappers, text-node identity, and state when normalization throws', () => {
  const dom = fixture();
  const renderer = Renderer.createReversibleRenderer({ document: dom.document });
  renderer.apply(request(dom.article, { fragments: [fragment(dom.model, 'model-node', 0, 5)] }));
  const wrapper = dom.article.querySelector('[data-halo-owned="token"]');
  const ownedText = wrapper.childNodes[0];
  const statusBefore = renderer.status();
  const originalNormalize = dom.link.normalize;
  dom.link.normalize = function () {
    originalNormalize.call(this);
    throw new Error('normalize failed');
  };

  assert.throws(() => renderer.removeRoot('root-1'), /normalize failed/);

  dom.link.normalize = originalNormalize;
  assert.equal(wrapper.parentNode, dom.link);
  assert.deepEqual(wrapper.childNodes, [ownedText]);
  assert.deepEqual(renderer.status(), statusBefore);
  assert.equal(dom.article.textContent, 'The model learns.');
  assert.equal(renderer.removeAll().wrappers, 1);
});

test('openPanel preserves the prior panel and leaves no artifact when preparation or append fails', () => {
  for (const fault of ['anchor', 'append', 'attachShadow']) {
    const dom = fixture();
    const renderer = Renderer.createReversibleRenderer({ document: dom.document });
    renderer.openPanel({ title: 'Original', body: 'Stable', status: 'Ready', anchor: { x: 20, y: 20 } });
    const originalHost = dom.document.body.querySelector('[data-halo-owned="panel"]');
    const statusBefore = renderer.status();
    const originalAppend = dom.document.body.appendChild;
    const originalCreate = dom.document.createElement;
    let model = { title: 'Replacement', anchor: { x: 30, y: 30 } };
    if (fault === 'anchor') {
      model = {
        title: 'Replacement',
        anchor: { get x() { throw new Error('anchor getter failed'); }, y: 30 }
      };
    } else if (fault === 'append') {
      dom.document.body.appendChild = function (node) {
        originalAppend.call(this, node);
        throw new Error('append failed after insertion');
      };
    } else {
      dom.document.createElement = function (name) {
        const element = originalCreate.call(this, name);
        if (String(name).toLowerCase() === 'div') {
          element.attachShadow = () => { throw new Error('attachShadow failed'); };
        }
        return element;
      };
    }

    assert.throws(() => renderer.openPanel(model), new RegExp(`${fault === 'anchor' ? 'anchor getter' : fault} failed`));

    dom.document.body.appendChild = originalAppend;
    dom.document.createElement = originalCreate;
    assert.deepEqual(dom.document.body.querySelectorAll('[data-halo-owned="panel"]'), [originalHost]);
    assert.equal(originalHost.parentNode, dom.document.body);
    assert.equal(originalHost.shadowRoot.querySelector('.halo-core-body').textContent, 'Stable');
    assert.deepEqual(renderer.status(), statusBefore);
    renderer.removeAll();
  }
});

test('cleanup works without WeakRef and survives temporary root detachment', () => {
  const savedWeakRef = globalThis.WeakRef;
  let noWeakRenderer;
  const withoutWeakRef = fixture();
  try {
    globalThis.WeakRef = undefined;
    noWeakRenderer = Renderer.createReversibleRenderer({ document: withoutWeakRef.document });
  } finally {
    globalThis.WeakRef = savedWeakRef;
  }
  noWeakRenderer.apply(request(withoutWeakRef.article, {
    fragments: [fragment(withoutWeakRef.model, 'model-node', 0, 5)]
  }));
  assert.equal(noWeakRenderer.removeAll().wrappers, 1);
  assert.equal(withoutWeakRef.article.querySelectorAll('[data-halo-owned="token"]').length, 0);

  const detached = fixture();
  const renderer = Renderer.createReversibleRenderer({ document: detached.document });
  renderer.apply(request(detached.article, { fragments: [fragment(detached.model, 'model-node', 0, 5)] }));
  detached.document.body.removeChild(detached.article);
  assert.equal(renderer.status().rootCount, 1);
  detached.document.body.appendChild(detached.article);
  assert.equal(renderer.removeAll().wrappers, 1);
  assert.deepEqual(detached.article.childNodes, [detached.lead, detached.link, detached.emphasis]);
  assert.equal(detached.link.textContent, 'model');
  assert.equal(detached.emphasis.textContent, ' learns.');
  assert.equal(detached.article.textContent, 'The model learns.');
});

test('throwing WeakRef preparation never grants detached token authority', () => {
  const dom = fixture();
  const candidates = [];
  class ThrowingWeakRef {
    constructor() {
      throw new Error('weak handle preparation failed');
    }
  }
  const renderer = Renderer.createReversibleRenderer({
    document: dom.document,
    WeakRef: ThrowingWeakRef,
    trackOwnedNode(node) {
      candidates.push(node);
    }
  });

  assert.throws(() => renderer.apply(request(dom.article, {
    fragments: [fragment(dom.model, 'model-node', 0, 5)]
  })), /weak handle preparation failed/);

  assert.equal(candidates.some((node) => renderer.ownsToken(node)), false);
  assert.equal(dom.article.querySelectorAll('[data-halo-owned="token"]').length, 0);
  assert.equal(dom.article.textContent, 'The model learns.');
  assert.equal(renderer.status().rootCount, 0);
  assert.equal(renderer.removeAll().wrappers, 0);
});

test('throwing precommit preparation hook revokes every detached candidate', () => {
  const dom = fixture();
  const candidates = [];
  const renderer = Renderer.createReversibleRenderer({
    document: dom.document,
    trackOwnedNode(node) {
      candidates.push(node);
    },
    prepareCapabilities() {
      throw new Error('precommit preparation failed');
    }
  });

  assert.throws(() => renderer.apply(request(dom.article, {
    fragments: [fragment(dom.model, 'model-node', 0, 5)]
  })), /precommit preparation failed/);

  assert.equal(candidates.some((node) => renderer.ownsToken(node)), false);
  assert.equal(dom.article.querySelectorAll('[data-halo-owned="token"]').length, 0);
  assert.equal(dom.article.textContent, 'The model learns.');
  assert.equal(renderer.status().rootCount, 0);
});

test('rebuild handle preparation failure cannot leave new private authority', () => {
  const dom = fixture();
  const candidates = [];
  let throwOnWrapperDeref = false;
  class ControlledWeakRef {
    constructor(value) {
      this.value = value;
    }

    deref() {
      if (throwOnWrapperDeref && this.value && this.value.tagName === 'SPAN') {
        throw new Error('prior wrapper handle failed');
      }
      return this.value;
    }
  }
  const renderer = Renderer.createReversibleRenderer({
    document: dom.document,
    WeakRef: ControlledWeakRef,
    trackOwnedNode(node) {
      candidates.push(node);
    }
  });
  renderer.apply(request(dom.article, { fragments: [fragment(dom.model, 'model-node', 0, 5)] }));
  const priorWrapper = dom.article.querySelector('[data-halo-owned="token"]');
  candidates.length = 0;
  throwOnWrapperDeref = true;

  assert.throws(() => renderer.reconcile(request(dom.article, {
    rootRevision: 2,
    analysisKey: 'analysis-rebuilt',
    fragments: [fragment(priorWrapper.childNodes[0], 'replacement-node', 1, 4)]
  })), /prior wrapper handle failed/);

  assert.equal(candidates.some((node) => node !== priorWrapper && renderer.ownsToken(node)), false);
  throwOnWrapperDeref = false;
  assert.equal(renderer.ownsToken(priorWrapper, 'root-1'), true);
  assert.equal(renderer.status().rootCount, 1);
  assert.equal(dom.article.textContent, 'The model learns.');
});

test('private token owner binding survives every public marker change', () => {
  const dom = fixture();
  const renderer = Renderer.createReversibleRenderer({ document: dom.document });
  renderer.apply(request(dom.article, { fragments: [fragment(dom.model, 'model-node', 0, 5)] }));
  const owned = dom.article.querySelector('[data-halo-owned="token"]');
  const forged = dom.document.createElement('span');
  for (const [name, value] of owned.attributes) forged.setAttribute(name, value);
  forged.textContent = 'model';

  owned.setAttribute('data-halo-owned', 'page-value');
  owned.setAttribute('data-halo-run', 'page-run');
  owned.setAttribute('data-halo-root', 'page-root');
  owned.setAttribute('data-halo-original', 'page-original');
  owned.className = 'page-class';

  assert.equal(renderer.ownsToken(owned), true);
  assert.equal(renderer.ownsToken(owned, 'root-1'), true);
  assert.equal(renderer.ownsToken(owned, 'another-root'), false);
  assert.equal(renderer.ownsToken(forged), false);
  assert.equal(renderer.ownsToken(forged, 'root-1'), false);
});

test('private ownership ignores forged markers and survives public marker tampering', () => {
  const dom = fixture();
  const renderer = Renderer.createReversibleRenderer({ document: dom.document });
  renderer.apply(request(dom.article, { fragments: [fragment(dom.model, 'model-node', 0, 5)] }));
  const owned = dom.article.querySelector('[data-halo-owned="token"]');
  const forged = dom.document.createElement('span');
  for (const [name, value] of owned.attributes) forged.setAttribute(name, value);
  forged.textContent = 'forged';
  dom.article.appendChild(forged);
  const thirdParty = dom.document.createElement('i');
  thirdParty.textContent = '!';
  owned.appendChild(thirdParty);
  owned.setAttribute('data-halo-owned', 'tampered');
  owned.setAttribute('data-halo-run', 'forged-run');
  owned.setAttribute('data-halo-root', 'forged-root');
  owned.setAttribute('data-halo-original', 'forged-original');
  owned.className = 'page-changed';

  const result = renderer.removeRoot('root-1');

  assert.equal(result.wrappers, 1);
  assert.equal(owned.parentNode, null);
  assert.equal(thirdParty.parentNode, dom.link);
  assert.equal(forged.parentNode, dom.article);
  assert.equal(forged.getAttribute('data-halo-owned'), 'token');
  assert.equal(renderer.status().rootCount, 0);
});

test('a fragment inside another root private wrapper is rejected before nesting', () => {
  const dom = fixture();
  const renderer = Renderer.createReversibleRenderer({ document: dom.document });
  renderer.apply(request(dom.article, {
    rootId: 'root-one',
    fragments: [fragment(dom.model, 'model-node', 0, 5)]
  }));
  const wrapper = dom.article.querySelector('[data-halo-owned="token"]');
  const ownedText = wrapper.childNodes[0];

  assert.throws(() => renderer.apply(request(dom.article, {
    rootId: 'root-two',
    runId: 'run-two',
    analysisKey: 'analysis-two',
    fragments: [fragment(ownedText, 'foreign-owned-text', 0, 5)]
  })), /another renderer root/);

  assert.equal(dom.article.querySelectorAll('[data-halo-owned="token"] [data-halo-owned="token"]').length, 0);
  assert.equal(dom.article.querySelector('[data-halo-owned="token"]'), wrapper);
  assert.equal(renderer.status().rootCount, 1);
  assert.equal(dom.article.textContent, 'The model learns.');
});

test('removeRoot rolls back a privately owned wrapper moved outside its render root', () => {
  const dom = fixture();
  const aside = dom.document.createElement('aside');
  const before = dom.document.createTextNode('Before ');
  const after = dom.document.createTextNode(' after');
  aside.append(before, after);
  dom.document.body.appendChild(aside);
  const renderer = Renderer.createReversibleRenderer({ document: dom.document });
  renderer.apply(request(dom.article, { fragments: [fragment(dom.model, 'model-node', 0, 5)] }));
  const wrapper = dom.article.querySelector('[data-halo-owned="token"]');
  aside.insertBefore(wrapper, after);
  const asideChildrenBefore = [...aside.childNodes];
  const statusBefore = renderer.status();
  const originalNormalize = aside.normalize;
  aside.normalize = function () {
    originalNormalize.call(this);
    throw new Error('moved destination normalize failed');
  };

  assert.throws(() => renderer.removeRoot('root-1'), /moved destination normalize failed/);

  aside.normalize = originalNormalize;
  assert.deepEqual(aside.childNodes, asideChildrenBefore);
  assert.equal(wrapper.parentNode, aside);
  assert.equal(renderer.ownsToken(wrapper), true);
  assert.deepEqual(renderer.status(), statusBefore);
  assert.equal(renderer.removeAll().wrappers, 1);
  assert.equal(renderer.ownsToken(wrapper), false);
  assert.equal(aside.textContent, 'Before model after');
});

test('removeAll restores every distinct moved-wrapper destination when a later destination fails', () => {
  const dom = fixture();
  const firstAside = dom.document.createElement('aside');
  const secondAside = dom.document.createElement('aside');
  firstAside.append(dom.document.createTextNode('First '), dom.document.createTextNode('.'));
  secondAside.append(dom.document.createTextNode('Second '), dom.document.createTextNode('.'));
  dom.document.body.append(firstAside, secondAside);
  const renderer = Renderer.createReversibleRenderer({ document: dom.document });
  renderer.apply(request(dom.article, {
    fragments: [
      fragment(dom.model, 'model-node', 0, 5),
      fragment(dom.learns, 'learn-node', 1, 7, { pos: 'v', label: 'v' })
    ]
  }));
  const wrappers = dom.article.querySelectorAll('[data-halo-owned="token"]');
  firstAside.insertBefore(wrappers[0], firstAside.childNodes[1]);
  secondAside.insertBefore(wrappers[1], secondAside.childNodes[1]);
  const firstBefore = [...firstAside.childNodes];
  const secondBefore = [...secondAside.childNodes];
  const originalNormalize = secondAside.normalize;
  secondAside.normalize = function () {
    originalNormalize.call(this);
    throw new Error('second moved destination failed');
  };

  assert.throws(() => renderer.removeAll(), /second moved destination failed/);

  secondAside.normalize = originalNormalize;
  assert.deepEqual(firstAside.childNodes, firstBefore);
  assert.deepEqual(secondAside.childNodes, secondBefore);
  assert.equal(renderer.ownsToken(wrappers[0]), true);
  assert.equal(renderer.ownsToken(wrappers[1]), true);
  assert.equal(renderer.status().rootCount, 1);
  assert.equal(renderer.removeAll().wrappers, 2);
  assert.equal(firstAside.textContent, 'First model.');
  assert.equal(secondAside.textContent, 'Second learns.');
});

test('rollback reports both failures and retains private cleanup authority', () => {
  const dom = fixture();
  const aside = dom.document.createElement('aside');
  aside.append(dom.document.createTextNode('Before '), dom.document.createTextNode(' after'));
  dom.document.body.appendChild(aside);
  const renderer = Renderer.createReversibleRenderer({ document: dom.document });
  renderer.apply(request(dom.article, { fragments: [fragment(dom.model, 'model-node', 0, 5)] }));
  const wrapper = dom.article.querySelector('[data-halo-owned="token"]');
  aside.insertBefore(wrapper, aside.childNodes[1]);
  const originalNormalize = aside.normalize;
  const originalInsertBefore = aside.insertBefore;
  aside.normalize = function () {
    originalNormalize.call(this);
    throw new Error('initiating normalize failure');
  };
  aside.insertBefore = function () {
    throw new Error('rollback insertion failure');
  };

  let failure;
  try {
    renderer.removeRoot('root-1');
  } catch (error) {
    failure = error;
  }

  aside.normalize = originalNormalize;
  aside.insertBefore = originalInsertBefore;
  assert.ok(failure instanceof AggregateError);
  assert.match(failure.errors[0].message, /initiating normalize failure/);
  assert.ok(failure.errors.some((error) => /rollback insertion failure/.test(error.message)));
  assert.equal(renderer.ownsToken(wrapper), true);
  assert.equal(renderer.status().rootCount, 1);
  assert.doesNotThrow(() => renderer.removeAll());
  assert.equal(renderer.ownsToken(wrapper), false);
  assert.equal(renderer.status().rootCount, 0);
  assert.equal(aside.textContent, 'Before model after');
});

test('parentless removal scrubs public markers and revokes private authority before root reuse', () => {
  const dom = fixture();
  const renderer = Renderer.createReversibleRenderer({ document: dom.document });
  renderer.apply(request(dom.article, { fragments: [fragment(dom.model, 'model-node', 0, 5)] }));
  const wrapper = dom.article.querySelector('[data-halo-owned="token"]');
  const ownedText = wrapper.childNodes[0];
  const thirdParty = dom.document.createElement('i');
  thirdParty.textContent = '!';
  wrapper.appendChild(thirdParty);
  wrapper.setAttribute('data-halo-extra', 'forged-semantic-field');
  wrapper.setAttribute('data-page-id', 'keep-me');
  wrapper.setAttribute('title', 'Halo title');
  wrapper.className += ' page-class halo-extra-class';
  dom.link.removeChild(wrapper);

  const removed = renderer.removeRoot('root-1');

  assert.equal(removed.wrappers, 1);
  assert.equal(renderer.ownsToken(wrapper), false);
  assert.equal(renderer.status().rootCount, 0);
  assert.equal(wrapper.getAttributeNames().some((name) => name.startsWith('data-halo-')), false);
  assert.equal(wrapper.hasAttribute('title'), false);
  assert.equal(wrapper.className, 'page-class');
  assert.equal(wrapper.getAttribute('data-page-id'), 'keep-me');
  assert.deepEqual(wrapper.childNodes, [ownedText, thirdParty]);
  assert.equal(wrapper.textContent, 'model!');

  dom.link.appendChild(wrapper);
  renderer.apply(request(dom.article, {
    runId: 'run-reused',
    analysisKey: 'analysis-reused',
    fragments: [fragment(ownedText, 'reused-text', 0, 5)]
  }));
  assert.equal(renderer.ownsToken(wrapper), false);
  assert.equal(dom.article.querySelectorAll('[data-halo-owned="token"]').length, 1);
  assert.equal(dom.article.querySelectorAll('[data-halo-owned="token"] [data-halo-owned="token"]').length, 0);
  renderer.removeAll();
  assert.equal(dom.article.textContent, 'The model! learns.');
});

test('renderer mutation tracking admits only private nodes and exact page-node operations', () => {
  const dom = fixture();
  const pageNodes = new Set([
    dom.document.body, dom.article, dom.lead, dom.link, dom.model, dom.emphasis, dom.learns
  ]);
  const sanitizer = Dynamic.createRendererMutationSanitizer();
  const tracked = [];
  const operations = [];
  const renderer = Renderer.createReversibleRenderer({
    document: dom.document,
    trackOwnedNode(node) {
      assert.equal(pageNodes.has(node), false, 'page nodes must never receive transient private authority');
      tracked.push(node);
      sanitizer.trackNode(node);
    },
    trackMutation(operation) {
      operations.push(operation);
      sanitizer.expect(operation);
    }
  });

  renderer.apply(request(dom.article, { fragments: [fragment(dom.model, 'model-node', 0, 5)] }));
  const wrapper = dom.article.querySelector('[data-halo-owned="token"]');

  assert.equal(tracked.includes(wrapper), true);
  assert.equal(operations.some((operation) =>
    operation.type === 'characterData' && operation.target === dom.model && operation.oldValue === 'model'
  ), true);
  assert.equal(operations.some((operation) =>
    operation.type === 'childList' && operation.target === dom.link &&
      operation.addedNodes.includes(wrapper)
  ), true);
  assert.equal(sanitizer.sanitize({
    type: 'characterData',
    target: dom.model,
    oldValue: 'model'
  }), null);
  assert.deepEqual(sanitizer.sanitize({
    type: 'attributes',
    target: dom.link,
    attributeName: 'class',
    oldValue: 'page-class'
  }), {
    type: 'attributes',
    target: dom.link,
    attributeName: 'class',
    oldValue: 'page-class'
  });
});

test('cleanup operation tracking does not grant transient authority to third-party children or touched parents', () => {
  const dom = fixture();
  let active = false;
  const forbidden = new Set([dom.article, dom.link, dom.model]);
  const sanitizer = Dynamic.createRendererMutationSanitizer();
  const renderer = Renderer.createReversibleRenderer({
    document: dom.document,
    suppressMutations(callback) {
      active = true;
      try {
        return callback();
      } finally {
        active = false;
      }
    },
    trackOwnedNode(node) {
      if (active) assert.equal(forbidden.has(node), false, 'cleanup must not own page or third-party nodes');
      sanitizer.trackNode(node);
    },
    trackMutation: (operation) => sanitizer.expect(operation)
  });
  renderer.apply(request(dom.article, { fragments: [fragment(dom.model, 'model-node', 0, 5)] }));
  const wrapper = dom.article.querySelector('[data-halo-owned="token"]');
  const thirdParty = dom.document.createElement('i');
  thirdParty.textContent = '!';
  wrapper.appendChild(thirdParty);
  forbidden.add(thirdParty);

  assert.doesNotThrow(() => renderer.removeRoot('root-1'));
  assert.equal(thirdParty.parentNode, dom.link);
});
