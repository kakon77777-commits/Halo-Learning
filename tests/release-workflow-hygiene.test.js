'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(
  __dirname,
  '..',
  '.github',
  'workflows',
  'architect-v0.4.0-final-convergence.yml'
);

test('development validator runs before release packaging dirties the checkout', {
  skip: !fs.existsSync(workflowPath)
}, () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const validatorIndex = workflow.indexOf('npm run validate');
  const packageIndex = workflow.indexOf('npm run package:release');

  assert.notEqual(validatorIndex, -1, 'development validator command must exist');
  assert.notEqual(packageIndex, -1, 'release packaging command must exist');
  assert.ok(
    validatorIndex < packageIndex,
    'development validator must run on the clean source checkout before package outputs are generated'
  );
  assert.doesNotMatch(workflow, /git\s+clean\s+-fdx\b/, 'workflow must not use destructive cleanup to satisfy hygiene');
});
