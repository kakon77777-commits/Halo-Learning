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

test('final release workflow fail-closes validator pipes and gives reversible renderer an X server', (t) => {
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
});
