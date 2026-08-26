'use strict';
const fs = require('node:fs');

function replaceExact(path, before, after) {
  const source = fs.readFileSync(path, 'utf8');
  if (!source.includes(before)) throw new Error(`B02 patch anchor missing: ${path}`);
  const next = source.replace(before, after);
  if (next === source) throw new Error(`B02 patch produced no change: ${path}`);
  fs.writeFileSync(path, next, 'utf8');
}

const renderer = 'apps/extension/src/shared/reversible-renderer.js';
const test = 'tests/reversible-renderer.test.js';

replaceExact(renderer,
`        track(wrapper);
        expectChildList(parent, children, [wrapper]);`,
`        track(wrapper);
        // replaceWith(...children) first detaches every child from the owned wrapper,
        // then replaces the wrapper in its parent. Chromium reports both records.
        expectChildList(wrapper, [], children);
        expectChildList(parent, children, [wrapper]);`);

replaceExact(renderer,
`          if (survivorIndex < 0) {
            for (const node of group) expectChildList(container, [], [node]);
          } else {
            for (const node of group.slice(0, survivorIndex)) expectChildList(container, [], [node]);
            const survivor = group[survivorIndex];
            expectMutation({ type: 'characterData', target: survivor, oldValue: survivor.nodeValue });
            for (const node of group.slice(survivorIndex + 1)) expectChildList(container, [], [node]);
          }`,
`          if (survivorIndex < 0) {
            for (const node of group) expectChildList(container, [], [node]);
          } else {
            for (const node of group.slice(0, survivorIndex)) expectChildList(container, [], [node]);
            const survivor = group[survivorIndex];
            let survivorValue = survivor.nodeValue;
            for (const node of group.slice(survivorIndex + 1)) {
              // DOM normalize mutates the survivor once for each non-empty text node
              // that it merges; empty nodes are removed without a characterData record.
              if (node.nodeValue !== '') {
                expectMutation({ type: 'characterData', target: survivor, oldValue: survivorValue });
                survivorValue += node.nodeValue;
              }
              expectChildList(container, [], [node]);
            }
          }`);

replaceExact(test,
`  const containers = new Set([dom.link, nested]);`,
`  const containers = new Set([wrapper, dom.link, nested]);`);

replaceExact(test,
`  const normativeRecords = [
    childRemoval(dom.link, leadingEmpty),
    characterChange(first, 'A'),
    childRemoval(dom.link, middleEmpty),
    childRemoval(dom.link, ownedText),
    childRemoval(dom.link, following),
    characterChange(second, 'C'),
    childRemoval(dom.link, secondFollowing),
    characterChange(nestedFirst, 'E'),
    childRemoval(nested, nestedEmpty),
    childRemoval(nested, nestedFollowing),
    childRemoval(dom.link, trailingEmpty),
    characterChange(standalone, 'S')
  ];`,
`  const normativeRecords = [
    childRemoval(wrapper, ownedText),
    childRemoval(dom.link, leadingEmpty),
    childRemoval(dom.link, middleEmpty),
    characterChange(first, 'A'),
    childRemoval(dom.link, ownedText),
    characterChange(first, 'Amodel'),
    childRemoval(dom.link, following),
    characterChange(second, 'C'),
    childRemoval(dom.link, secondFollowing),
    childRemoval(nested, nestedEmpty),
    characterChange(nestedFirst, 'E'),
    childRemoval(nested, nestedFollowing),
    childRemoval(dom.link, trailingEmpty)
  ];`);

replaceExact(test,
`  const mixedRecords = normativeRecords.map((record, index) => index === 0`,
`  const mixedRecords = normativeRecords.map((record, index) => index === 1`);

for (const path of ['scripts/b02-apply-once.js', '.github/workflows/b02-apply-once.yml']) {
  if (fs.existsSync(path)) fs.unlinkSync(path);
}
