const test = require('node:test');
const assert = require('node:assert/strict');

const Pipeline = require('../apps/extension/src/shared/sentence-pipeline');

function text(value, id) {
  return {
    nodeType: 3,
    nodeValue: value,
    _id: id,
    parentElement: null,
    ownerDocument: null
  };
}

function element(tagName, attributes = {}, children = [], style = {}) {
  const attributeMap = new Map(
    Object.entries(attributes).map(([name, value]) => [name.toLowerCase(), String(value)])
  );
  const node = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes: [],
    parentElement: null,
    ownerDocument: null,
    _style: style,
    hasAttribute(name) {
      return attributeMap.has(String(name).toLowerCase());
    },
    getAttribute(name) {
      return attributeMap.get(String(name).toLowerCase()) ?? null;
    },
    appendChild(child) {
      child.parentElement = this;
      child.ownerDocument = this.ownerDocument;
      this.childNodes.push(child);
      assignDocument(child, this.ownerDocument);
      return child;
    }
  };
  for (const child of children) node.appendChild(child);
  return node;
}

function assignDocument(node, document) {
  if (!node) return;
  node.ownerDocument = document;
  for (const child of node.childNodes || []) assignDocument(child, document);
}

function fixtureRoot(children) {
  const document = {
    defaultView: {
      getComputedStyle(node) {
        return {
          display: node._style?.display || 'inline',
          visibility: node._style?.visibility || 'visible',
          contentVisibility: node._style?.contentVisibility || 'visible',
          opacity: node._style?.opacity ?? '1'
        };
      }
    }
  };
  const root = element('article', {}, children, { display: 'block' });
  assignDocument(root, document);
  return root;
}

function publicRun(run) {
  return {
    nodeId: run.nodeId,
    text: run.text,
    start: run.start,
    end: run.end,
    boundaryBefore: run.boundaryBefore,
    rootRevision: run.rootRevision
  };
}

function assertTwoSentenceBoundary(root, expectedBoundary, secondStart, secondEnd) {
  const options = { getNodeId: (node) => node._id };
  const runs = Pipeline.createTextRuns(root, options);
  assert.equal(runs.map((run) => run.boundaryBefore + run.text).join(''), `First${expectedBoundary}Second.`);
  assert.deepEqual(runs.map(publicRun), [
    { nodeId: 'first', text: 'First', start: 0, end: 5, boundaryBefore: '', rootRevision: 0 },
    {
      nodeId: 'second',
      text: 'Second.',
      start: secondStart,
      end: secondEnd,
      boundaryBefore: expectedBoundary,
      rootRevision: 0
    }
  ]);
  const records = Pipeline.buildSentenceRecords(root, options);
  assert.deepEqual(records, [
    {
      id: '0:0:5',
      text: 'First',
      start: 0,
      end: 5,
      language: 'en',
      rootRevision: 0,
      fragments: [{ nodeId: 'first', start: 0, end: 5 }]
    },
    {
      id: `0:${secondStart}:${secondEnd}`,
      text: 'Second.',
      start: secondStart,
      end: secondEnd,
      language: 'en',
      rootRevision: 0,
      fragments: [{ nodeId: 'second', start: 0, end: 7 }]
    }
  ]);
  for (const record of records) {
    const rebuilt = record.fragments.map((fragment) => {
      const run = runs.find((candidate) => candidate.nodeId === fragment.nodeId);
      return run.node.nodeValue.slice(fragment.start, fragment.end);
    }).join('');
    assert.equal(rebuilt, record.text);
  }
}

function assertPolicyHiddenBlock(attributes, style, caseId) {
  const unreadable = text('', `${caseId}-secret`);
  Object.defineProperty(unreadable, 'nodeValue', {
    get() {
      throw new Error(`${caseId} hidden text was read`);
    }
  });
  const root = fixtureRoot([
    text('First.', 'first'),
    element('section', attributes, [unreadable], { display: 'block', ...style }),
    text('Second.', 'second')
  ]);
  const options = { getNodeId: (node) => node._id, isVisible: () => true };
  const runs = Pipeline.createTextRuns(root, options);
  assert.equal(runs.map((run) => run.boundaryBefore + run.text).join(''), 'First.Second.', caseId);
  assert.deepEqual(runs.map(publicRun), [
    { nodeId: 'first', text: 'First.', start: 0, end: 6, boundaryBefore: '', rootRevision: 0 },
    { nodeId: 'second', text: 'Second.', start: 6, end: 13, boundaryBefore: '', rootRevision: 0 }
  ], caseId);
  assert.deepEqual(Pipeline.buildSentenceRecords(root, options), [
    {
      id: '0:0:13',
      text: 'First.Second.',
      start: 0,
      end: 13,
      language: 'en',
      rootRevision: 0,
      fragments: [
        { nodeId: 'first', start: 0, end: 6 },
        { nodeId: 'second', start: 0, end: 7 }
      ]
    }
  ], caseId);
}

test('aggregate token spans map across nested node-local fragments without drift', () => {
  const runs = [
    { nodeId: 'a', text: 'The ', start: 0, end: 4 },
    { nodeId: 'b', text: 'model', start: 4, end: 9 },
    { nodeId: 'c', text: ' learns.', start: 9, end: 17 }
  ];
  assert.deepEqual(Pipeline.mapAggregateSpanToFragments(runs, 4, 15), [
    { nodeId: 'b', start: 0, end: 5 },
    { nodeId: 'c', start: 0, end: 6 }
  ]);
});

test('mapping uses exact UTF-16 code-unit offsets for every valid aggregate span', () => {
  const aggregate = 'A💡e\u0301學習';
  const runs = [
    { nodeId: 'a', text: 'A💡', start: 0, end: 3 },
    { nodeId: 'b', text: 'e\u0301', start: 3, end: 5 },
    { nodeId: 'c', text: '學習', start: 5, end: 7 }
  ];

  for (let start = 0; start < aggregate.length; start += 1) {
    for (let end = start + 1; end <= aggregate.length; end += 1) {
      const fragments = Pipeline.mapAggregateSpanToFragments(runs, start, end);
      const rebuilt = fragments.map((fragment) => {
        const run = runs.find((candidate) => candidate.nodeId === fragment.nodeId);
        assert.ok(fragment.start >= 0 && fragment.end <= run.text.length);
        return run.text.slice(fragment.start, fragment.end);
      }).join('');
      assert.equal(rebuilt, aggregate.slice(start, end), `[${start}, ${end})`);
    }
  }
});

test('mapping rejects malformed or out-of-bounds aggregate spans', () => {
  const runs = [{ nodeId: 'a', text: 'text', start: 0, end: 4 }];
  assert.throws(() => Pipeline.mapAggregateSpanToFragments(runs, -1, 2), /span/i);
  assert.throws(() => Pipeline.mapAggregateSpanToFragments(runs, 3, 2), /span/i);
  assert.throws(() => Pipeline.mapAggregateSpanToFragments(runs, 0, 5), /span/i);
});

test('mixed English and Traditional Chinese sentences keep exact UTF-16 offsets', () => {
  const source = '  Models 💡 learn. 人工智慧學習。  ';
  const sentences = Pipeline.segmentSentences(source, { locale: 'zh-Hant' });
  assert.deepEqual(sentences, [
    { text: 'Models 💡 learn.', start: 2, end: 18 },
    { text: '人工智慧學習。', start: 19, end: 26 }
  ]);
  for (const sentence of sentences) {
    assert.equal(sentence.text, source.slice(sentence.start, sentence.end));
  }
});

test('deterministic fallback preserves closers and splits English and Chinese terminators', () => {
  const source = 'She said “Ready?” 下一句！Last one.';
  assert.deepEqual(Pipeline.segmentSentences(source, { forceFallback: true }), [
    { text: 'She said “Ready?”', start: 0, end: 17 },
    { text: '下一句！', start: 18, end: 22 },
    { text: 'Last one.', start: 22, end: 31 }
  ]);
});

test('language detection is restricted to English and Traditional Chinese modes', () => {
  assert.equal(Pipeline.detectLanguage('Models learn.'), 'en');
  assert.equal(Pipeline.detectLanguage('人工智慧學習。'), 'zh-Hant');
  assert.equal(Pipeline.detectLanguage('Models 學習'), 'both');
  assert.equal(Pipeline.detectLanguage('123 💡'), 'unknown');
});

test('TextRuns preserve mixed node text and insert boundaries without crossing inline elements', () => {
  const root = fixtureRoot([
    text('Models ', 'lead'),
    element('span', {}, [text('💡', 'idea')]),
    element('a', { href: '/learn' }, [text(' learn', 'link')]),
    element('em', {}, [text('.', 'emphasis')]),
    element('span', {}, [text('PRIVATE', 'hidden')], { display: 'none' }),
    element('p', {}, [
      text('人工', 'zh-a'),
      element('a', { href: '/zh' }, [text('智慧', 'zh-link')]),
      element('em', {}, [text('學習。', 'zh-emphasis')])
    ], { display: 'block' })
  ]);

  const runs = Pipeline.createTextRuns(root, {
    getNodeId: (node) => node._id,
    rootRevision: 7
  });
  assert.deepEqual(runs.map(publicRun), [
    { nodeId: 'lead', text: 'Models ', start: 0, end: 7, boundaryBefore: '', rootRevision: 7 },
    { nodeId: 'idea', text: '💡', start: 7, end: 9, boundaryBefore: '', rootRevision: 7 },
    { nodeId: 'link', text: ' learn', start: 9, end: 15, boundaryBefore: '', rootRevision: 7 },
    { nodeId: 'emphasis', text: '.', start: 15, end: 16, boundaryBefore: '', rootRevision: 7 },
    { nodeId: 'zh-a', text: '人工', start: 17, end: 19, boundaryBefore: '\n', rootRevision: 7 },
    { nodeId: 'zh-link', text: '智慧', start: 19, end: 21, boundaryBefore: '', rootRevision: 7 },
    { nodeId: 'zh-emphasis', text: '學習。', start: 21, end: 24, boundaryBefore: '', rootRevision: 7 }
  ]);
  assert.ok(runs.every(Object.isFrozen));
  assert.ok(Object.isFrozen(runs));
});

test('TextRun extraction filters unsuitable and sensitive subtrees before reading text', () => {
  const unreadableSecret = text('', 'password-value');
  Object.defineProperty(unreadableSecret, 'nodeValue', {
    get() {
      throw new Error('private value was read');
    }
  });
  const root = fixtureRoot([
    element('script', {}, [text('script words', 'script')]),
    element('style', {}, [text('style words', 'style')]),
    element('noscript', {}, [text('noscript words', 'noscript')]),
    element('textarea', {}, [text('textarea words', 'textarea')]),
    element('input', {}, [text('input words', 'input')]),
    element('select', {}, [element('option', {}, [text('option words', 'option')])]),
    element('template', {}, [text('template words', 'template')]),
    element('pre', {}, [text('pre words', 'pre')]),
    element('code', {}, [text('code words', 'code')]),
    element('kbd', {}, [text('keyboard words', 'kbd')]),
    element('samp', {}, [text('sample words', 'samp')]),
    element('button', {}, [text('button words', 'button')]),
    element('svg', {}, [text('vector words', 'svg')]),
    element('math', {}, [text('math words', 'math')]),
    element('nav', {}, [text('navigation words', 'nav')]),
    element('section', { role: 'navigation' }, [text('role navigation words', 'role-navigation')]),
    element('section', { contenteditable: 'true' }, [text('draft words', 'editable')]),
    element('section', { role: 'textbox' }, [text('textbox words', 'textbox')]),
    element('section', { 'aria-hidden': 'true' }, [text('aria words', 'aria')]),
    element('section', { hidden: '' }, [text('hidden words', 'hidden')]),
    element('section', {}, [text('transparent words', 'transparent')], { opacity: '0' }),
    element('section', { 'data-halo-owned': 'true' }, [text('Halo UI', 'halo')]),
    element('form', {}, [
      element('label', {}, [text('Account password', 'password-label')]),
      element('input', { type: 'password', autocomplete: 'current-password' }, [unreadableSecret])
    ]),
    element('p', {}, [text('Approved text.', 'approved')], { display: 'block' })
  ]);

  const runs = Pipeline.createTextRuns(root, { getNodeId: (node) => node._id });
  assert.deepEqual(runs.map((run) => [run.nodeId, run.text]), [['approved', 'Approved text.']]);
});

test('renderer remapping consults private token authority and never trusts matching public fields', () => {
  const forged = element('span', {
    'data-halo-owned': 'token',
    'data-halo-run': 'run-forged',
    'data-halo-root': 'root-forged',
    'data-halo-original': 'forged',
    'data-halo-pos': 'n'
  }, [text('forged', 'forged-token')]);
  const privatelyOwned = element('span', {
    'data-halo-owned': 'token',
    'data-halo-run': 'run-private',
    'data-halo-root': 'root-private',
    'data-halo-original': 'model',
    'data-halo-pos': 'n'
  }, [text('model', 'owned-token')]);
  const root = fixtureRoot([
    text('The ', 'lead'),
    forged,
    text(' and ', 'middle'),
    privatelyOwned,
    text(' learns.', 'tail'),
    element('div', { 'data-halo-owned': 'panel' }, [text('Panel detail', 'owned-panel')])
  ]);
  const ownsToken = (element) => element === privatelyOwned;

  assert.deepEqual(
    Pipeline.createTextRuns(root, {
      getNodeId: (node) => node._id,
      includeHaloOwnedTokens: true,
      ownsToken
    }).map((run) => [run.nodeId, run.text]),
    [
      ['lead', 'The '],
      ['forged-token', 'forged'],
      ['middle', ' and '],
      ['owned-token', 'model'],
      ['tail', ' learns.']
    ]
  );
  assert.equal(Pipeline.isRemappableHaloToken(forged, { includeHaloOwnedTokens: true, ownsToken }), false);
  assert.equal(Pipeline.isRemappableHaloToken(privatelyOwned, { ownsToken }), true);
});

test('sensitive-name filtering is scoped to form regions and preserves educational prose', () => {
  const root = fixtureRoot([
    element('p', { id: 'password-guide' }, [text('Use a password manager.', 'guide')], { display: 'block' })
  ]);
  assert.deepEqual(
    Pipeline.createTextRuns(root, { getNodeId: (node) => node._id }).map((run) => run.text),
    ['Use a password manager.']
  );
});

test('consecutive BR elements retain deterministic hard-boundary UTF-16 offsets', () => {
  const root = fixtureRoot([
    text('First', 'first'),
    element('br'),
    element('br'),
    text('Second.', 'second')
  ]);
  const runs = Pipeline.createTextRuns(root, { getNodeId: (node) => node._id });
  assert.deepEqual(runs.map(publicRun), [
    { nodeId: 'first', text: 'First', start: 0, end: 5, boundaryBefore: '', rootRevision: 0 },
    { nodeId: 'second', text: 'Second.', start: 7, end: 14, boundaryBefore: '\n\n', rootRevision: 0 }
  ]);
  assert.deepEqual(Pipeline.buildSentenceRecords(root, { getNodeId: (node) => node._id }), [
    {
      id: '0:0:5',
      text: 'First',
      start: 0,
      end: 5,
      language: 'en',
      rootRevision: 0,
      fragments: [{ nodeId: 'first', start: 0, end: 5 }]
    },
    {
      id: '0:7:14',
      text: 'Second.',
      start: 7,
      end: 14,
      language: 'en',
      rootRevision: 0,
      fragments: [{ nodeId: 'second', start: 0, end: 7 }]
    }
  ]);
});

test('an empty HR preserves one hard separator with exact sentence fragments', () => {
  assertTwoSentenceBoundary(fixtureRoot([
    text('First', 'first'),
    element('hr'),
    text('Second.', 'second')
  ]), '\n', 6, 13);
});

test('an empty block containing BR preserves both structural separators', () => {
  assertTwoSentenceBoundary(fixtureRoot([
    text('First', 'first'),
    element('div', {}, [element('br')], { display: 'block' }),
    text('Second.', 'second')
  ]), '\n\n', 7, 14);
});

test('a filtered visible PRE still separates surrounding visible sentences', () => {
  assertTwoSentenceBoundary(fixtureRoot([
    text('First', 'first'),
    element('pre', {}, [text('filtered code', 'filtered')], { display: 'block' }),
    text('Second.', 'second')
  ]), '\n', 6, 13);
});

test('consecutive empty boundaries retain offsets without leading or trailing phantom records', () => {
  assertTwoSentenceBoundary(fixtureRoot([
    element('hr'),
    text('First', 'first'),
    element('hr'),
    element('hr'),
    text('Second.', 'second'),
    element('hr')
  ]), '\n\n', 7, 14);
});

test('content-visibility hidden descendants are rejected before text access', () => {
  const unreadable = text('', 'content-visibility-secret');
  Object.defineProperty(unreadable, 'nodeValue', {
    get() {
      throw new Error('content-visibility hidden text was read');
    }
  });
  const root = fixtureRoot([
    text('Visible.', 'visible'),
    element('section', {}, [unreadable], { contentVisibility: 'hidden' }),
    text(' Still visible.', 'still-visible')
  ]);
  assert.deepEqual(
    Pipeline.createTextRuns(root, {
      getNodeId: (node) => node._id,
      isVisible: () => true
    }).map((run) => run.text),
    ['Visible.', ' Still visible.']
  );
});

test('policy-hidden blocks contribute neither text nor aggregate boundary offsets', () => {
  const cases = [
    { id: 'aria-hidden', attributes: { 'aria-hidden': 'true' }, style: {} },
    { id: 'hidden-attribute', attributes: { hidden: '' }, style: {} },
    { id: 'display-none', attributes: {}, style: { display: 'none' } },
    { id: 'content-visibility-hidden', attributes: {}, style: { contentVisibility: 'hidden' } }
  ];
  for (const fixture of cases) {
    assertPolicyHiddenBlock(fixture.attributes, fixture.style, fixture.id);
  }
});

test('fresh extraction reflects dynamic roots and partially hidden descendants', () => {
  const root = fixtureRoot([
    element('p', {}, [
      text('Visible.', 'visible'),
      element('span', {}, [text(' Hidden.', 'hidden')], { visibility: 'hidden' })
    ], { display: 'block' })
  ]);
  const options = { getNodeId: (node) => node._id };
  assert.deepEqual(Pipeline.createTextRuns(root, options).map((run) => run.text), ['Visible.']);

  root.appendChild(element('p', {}, [text('動態內容。', 'dynamic')], { display: 'block' }));
  assert.deepEqual(Pipeline.createTextRuns(root, options).map((run) => run.text), ['Visible.', '動態內容。']);
});

test('sentence records map exact source fragments then release all DOM node references', () => {
  const root = fixtureRoot([
    text('Models ', 'lead'),
    element('a', { href: '/learn' }, [text('learn', 'link')]),
    element('em', {}, [text('. ', 'emphasis')]),
    element('span', {}, [text('人工智慧學習。', 'zh')])
  ]);
  const records = Pipeline.buildSentenceRecords(root, {
    getNodeId: (node) => node._id,
    rootRevision: 11
  });

  assert.deepEqual(records, [
    {
      id: '11:0:13',
      text: 'Models learn.',
      start: 0,
      end: 13,
      language: 'en',
      rootRevision: 11,
      fragments: [
        { nodeId: 'lead', start: 0, end: 7 },
        { nodeId: 'link', start: 0, end: 5 },
        { nodeId: 'emphasis', start: 0, end: 1 }
      ]
    },
    {
      id: '11:14:21',
      text: '人工智慧學習。',
      start: 14,
      end: 21,
      language: 'zh-Hant',
      rootRevision: 11,
      fragments: [{ nodeId: 'zh', start: 0, end: 7 }]
    }
  ]);
  assert.ok(Object.isFrozen(records));
  assert.ok(records.every((record) => Object.isFrozen(record) && Object.isFrozen(record.fragments)));
  assert.equal(JSON.stringify(records).includes('nodeValue'), false);
  for (const record of records) {
    for (const fragment of record.fragments) assert.equal(Object.hasOwn(fragment, 'node'), false);
  }
});
