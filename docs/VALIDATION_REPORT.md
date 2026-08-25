# Halo Learning Basic MVP v0.1.0 — Validation Report

**Date:** 2026-08-25

## Scope validated

- bilingual English / Traditional-Chinese semantic token baseline;
- conservative POS classification and Chinese longest-match bootstrap segmentation;
- semantic/projection separation;
- independent POS-label and POS-color channels;
- deterministic density and confidence gating;
- reversible DOM marking;
- skipped editable/code/script/style elements;
- Manifest V3 minimal permissions;
- local-only popup injection and settings;
- extension ZIP layout with `manifest.json` at archive root.

## Automated evidence

Canonical command:

```bash
node --test tests/*.test.js
```

Expected release gate: all 16 tests pass, 0 fail.

Additional release gates:

```bash
node --check apps/extension/src/*.js
node --check apps/extension/src/shared/*.js
```

All JavaScript files must parse successfully.

Executable-source remote dependency scan:

```bash
grep -RInE 'https?://' apps/extension/src --include='*.js'
```

Expected: no matches.

## Browser boundary

The package is designed for Chrome/Chromium Manifest V3 and uses only `activeTab`, `scripting`, and `storage`. The automated suite validates contracts and pure behavior; it does not claim full cross-site browser E2E coverage. The included `apps/extension/test-fixtures/demo.html` is the manual smoke-test fixture for the first browser pass.

## Known limits

- bootstrap lexical data is intentionally small;
- no third-party dictionary corpus is bundled;
- no high-precision remote NLP or AI explanation yet;
- no IndexedDB learner/event database yet;
- no Halo Story loop yet;
- dynamic pages may require re-applying after major DOM changes;
- no claim of production-grade POS accuracy is made for the Basic local heuristics.
