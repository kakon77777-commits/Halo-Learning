const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const fixtureRoot = path.join(repositoryRoot, 'fixtures', 'browser');
const matrixPath = path.join(fixtureRoot, 'matrix.json');

function readMatrix() {
  return JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
}

test('matrix declares exactly twenty distinct required fixture classes', () => {
  const matrix = readMatrix();
  assert.equal(matrix.schemaVersion, 1);
  assert.equal(matrix.fixtures.length, 20);
  assert.equal(new Set(matrix.fixtures.map((value) => value.id)).size, 20);
  assert.equal(new Set(matrix.fixtures.map((value) => value.class)).size, 20);
  for (const fixture of matrix.fixtures) {
    assert.ok(fixture.file);
    assert.ok(fs.existsSync(path.join(fixtureRoot, fixture.file)), `${fixture.file} must exist`);
    assert.ok(fixture.assertions.includes('source-text-preserved'));
    assert.ok(fixture.assertions.includes('no-duplicate-wrapper'));
    assert.ok(fixture.assertions.includes('remove-correct'));
  }
});
