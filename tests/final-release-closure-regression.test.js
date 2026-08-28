const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FinalValidator = require('../scripts/validate-v0.4.0-final');

const ROOT = path.resolve(__dirname, '..');
const FINAL_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'v040-final-release-revalidation.yml');

test('final selected-runtime validator reads canonical shard count from build receipt statistics', () => {
  const selected = FinalValidator.validateSelectedRuntime(ROOT);
  assert.equal(selected.bucketCount, 64);
  assert.equal(selected.shardCount, 128);
  assert.equal(selected.deterministic, true);
});

test('final validator requires the canonical B08 evidence envelope and has no open evidence blocker after publication', () => {
  const b08 = FinalValidator.FINAL_ACCEPTANCE_MAP.find((item) => item.id === 'canonical-browser-evidence-envelope');
  assert.ok(b08, 'final acceptance map must require canonical B08 evidence');
  assert.ok(
    b08.evidenceAny.includes('docs/validation/v0.4.0-b08-canonical-browser-evidence.md'),
    'B08 acceptance must bind the canonical evidence envelope path'
  );
  assert.deepEqual(FinalValidator.FINAL_EVIDENCE_BLOCKERS, []);
});

test('final release workflow fail-closes validator pipes and isolates focus-sensitive installed-browser gates', (t) => {
  if (!fs.existsSync(FINAL_WORKFLOW)) {
    t.skip('GitHub workflow metadata is intentionally absent from the standalone source package');
    return;
  }

  const workflow = fs.readFileSync(FINAL_WORKFLOW, 'utf8');

  assert.match(
    workflow,
    /name: Final development validator must pass[\s\S]*?run: \|\n\s+set -euo pipefail\n\s+node scripts\/validate-v0\.4\.0-final\.js --development \| tee/,
    'development validator must propagate a non-zero Node exit code through tee'
  );

  assert.match(
    workflow,
    /name: Reversible renderer\n\s+run: xvfb-run -a timeout --kill-after=10s 180s node --test tests\/browser\/reversible-renderer\.e2e\.test\.js/,
    'reversible renderer launches a headed persistent extension context and therefore needs Xvfb in CI'
  );

  assert.match(
    workflow,
    /\n  allowed-site-marking:\n[\s\S]*?name: Allowed-site marking product path\n\s+run: xvfb-run -a timeout --kill-after=10s 240s node --test tests\/browser\/final-closure-allowed-marking\.e2e\.test\.js/,
    'allowed-site native marking acceptance must run in an isolated final-release job'
  );

  assert.match(
    workflow,
    /\n  trigger-controller:\n[\s\S]*?name: Trigger controller installed-browser lifecycle\n\s+run: xvfb-run -a timeout --kill-after=10s 180s node --test tests\/browser\/trigger-controller\.e2e\.test\.js/,
    'native-shortcut trigger acceptance must run in an isolated final-release job'
  );

  const productBrowser = workflow.match(/\n  product-browser:\n([\s\S]*?)\n  [a-z0-9-]+:\n/);
  assert.ok(productBrowser, 'product-browser job must remain present');
  assert.doesNotMatch(
    productBrowser[1],
    /name: Allowed-site marking product path/,
    'combined product-browser job must not rerun the focus-sensitive allowed-site marking lifecycle'
  );
  assert.doesNotMatch(
    productBrowser[1],
    /name: Trigger controller/,
    'combined product-browser job must not rerun the focus-sensitive trigger lifecycle'
  );

  const releaseArtifactUpload = workflow.match(
    /name: halo-v0\.4\.0-final-release-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}[\s\S]*?retention-days: 30/
  );
  assert.ok(releaseArtifactUpload, 'final release artifact upload must remain present');
  assert.match(
    releaseArtifactUpload[0],
    /dist\/halo-learning-v0\.4\.0-package-manifest\.json/,
    'final release artifact envelope must upload the canonical package manifest path'
  );
  assert.doesNotMatch(
    releaseArtifactUpload[0],
    /dist\/halo-learning-magic-hand-v0\.4\.0-package-manifest\.json/,
    'final release artifact envelope must not reference a non-existent package manifest path'
  );
});
