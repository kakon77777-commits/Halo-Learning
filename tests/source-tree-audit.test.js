const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SourceAudit = require('../scripts/audit-source-tree');

function fixtureRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-source-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'apps', 'extension', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'extension', 'src', 'safe.js'), "'use strict';\n");
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture\n');
  return root;
}

test('standalone source audit accepts clean authored source without Git metadata', (t) => {
  const root = fixtureRoot(t);
  const report = SourceAudit.auditSourceTree(root);

  assert.equal(SourceAudit.isInsideGitWorktree(root), false);
  assert.equal(report.ok, true);
  assert.equal(report.filesChecked, 2);
});

test('standalone source audit rejects trailing whitespace and conflict markers with stable codes', (t) => {
  const root = fixtureRoot(t);
  fs.writeFileSync(path.join(root, 'apps', 'extension', 'src', 'bad.js'), 'const value = 1; \n<<<<<<< branch\n');
  const report = SourceAudit.auditSourceTree(root);

  assert.equal(report.ok, false);
  assert.deepEqual(report.issues.map((item) => item.code).sort(), ['CONFLICT_MARKER', 'TRAILING_WHITESPACE']);
});

test('standalone source audit rejects executable remote URLs but ignores binary package bytes', (t) => {
  const root = fixtureRoot(t);
  fs.writeFileSync(path.join(root, 'apps', 'extension', 'src', 'remote.js'), "fetch('https://remote.invalid');\n");
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'artifact.zip'), Buffer.from([0, 255, 60, 60, 60]));
  const report = SourceAudit.auditSourceTree(root);

  assert.ok(report.issues.some((item) => item.code === 'REMOTE_EXECUTABLE_URL'));
  assert.equal(report.issues.some((item) => item.path.includes('artifact.zip')), false);
});

test('development checkout detection recognizes a Git worktree', (t) => {
  const root = fixtureRoot(t);
  const initialized = childProcess.spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(SourceAudit.isInsideGitWorktree(root), true);
});
