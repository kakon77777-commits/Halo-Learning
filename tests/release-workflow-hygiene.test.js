'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.join(__dirname, '..');
const workflowPath = path.join(repositoryRoot, '.github', 'workflows', 'architect-v0.4.0-final-convergence.yml');
const gitignorePath = path.join(repositoryRoot, '.gitignore');

test('B09 release workflow preserves development hygiene while keeping package-integrity artifacts available', {
  skip: !fs.existsSync(workflowPath)
}, () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const gitignore = fs.readFileSync(gitignorePath, 'utf8');
  const packageIndex = workflow.indexOf('npm run package:release');
  const validatorIndex = workflow.indexOf('npm run validate > "$HALO_EVIDENCE_ROOT/development-validator.log"');

  assert.notEqual(packageIndex, -1, 'release packaging command must exist');
  assert.notEqual(validatorIndex, -1, 'development validator command must exist with external evidence logging');
  assert.ok(packageIndex < validatorIndex, 'package integrity artifacts must exist before the development validator runs');
  assert.match(workflow, /HALO_EVIDENCE_ROOT:\s*\/tmp\/halo-v040-release-evidence/);
  assert.match(workflow, /post-package-source-status\.txt/);
  assert.match(workflow, /pre-development-validator-git-status\.txt/);
  assert.match(workflow, /post-development-validator-git-status\.txt/);
  assert.doesNotMatch(
    workflow,
    /(?:>|tee\s+)[^\n]*evidence\/architect-release/,
    'release-evidence logs must not be created inside the source checkout'
  );
  assert.doesNotMatch(workflow, /git\s+clean\s+-fdx\b/, 'workflow must not use destructive cleanup to satisfy hygiene');

  for (const generated of [
    'dist/halo-learning-magic-hand-v0.4.0.zip',
    'dist/halo-learning-v0.4.0-package-manifest.json',
    'releases/Halo_Learning_v0.4.0_Browser_Runtime_UX_Release.zip'
  ]) {
    assert.match(gitignore, new RegExp(`^${generated.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}$`, 'm'));
  }
});
