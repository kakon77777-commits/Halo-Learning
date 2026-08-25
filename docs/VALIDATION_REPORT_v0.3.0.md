# Halo Learning v0.3.0 — Validation Report

**Release:** Semantic Annotation Engine
**Date:** 2026-08-25
**Development gate:** `node scripts/validate-v0.3.0.js --development`
**Standalone gate:** `node scripts/validate-v0.3.0.js --standalone`

## Scope validated

- stable provider-neutral `SemanticAnnotation/v1`, `SemanticToken/v1`, `AnnotationSet/v1`, and `MarkingProfile/v2` contracts;
- exact verified Princeton WordNet 3.0 and CC-CEDICT 2026-08-24 V1-edition corpus bytes, licenses, acquisition receipts, file hashes, importer versions, and build receipts;
- deterministic compact lexical runtime rebuild and payload-integrity validation;
- packaged-index-first dictionary runtime with bootstrap fallback after missing/corrupt index simulation;
- English token, lemma, simplified POS, morphology, lexical/gloss references, confidence, provenance, and conservative unknown handling;
- Traditional-Chinese deterministic longest-match segmentation, Traditional/Simplified evidence, lexical/gloss references, conservative POS evidence, confidence, provenance, and per-code-point unknown handling;
- bounded English grammar annotations that isolate sentence/language boundaries and omit unsupported claims;
- nine independently configurable projection channels, POS color redundancy, semantic/projection immutability, and all-channels-off zero-decoration behavior;
- reversible DOM Apply/Remove regression, local-only MV3 permissions, and sensitive-form fail-closed source contract;
- v0.1/v0.2 `MarkingProfile/v2` migration and all v0.1/v0.2 regression tests;
- extension and source-package exact inventory plus every-file byte equivalence;
- distinct clean-Git development hygiene and no-Git standalone source-package audit;
- workbench boundary: v0.3.0 Complete and v0.4.0 Not Started.

## Fresh automated evidence

| Gate | Evidence | Result |
|---|---|---|
| Full automated suite | `node --test tests/*.test.js` | 142/142 PASS, normal exit 0 |
| Runtime lexical build | `node --max-old-space-size=2048 scripts/build-lexical-runtime.js --verify` | deterministic artifact match, normal exit 0 |
| Semantic quality | `node --max-old-space-size=1024 scripts/run-semantic-quality.js --verify` | thresholds PASS, normal exit 0 |
| Shipped JavaScript syntax | v0.3 validator checks extension, packages, scripts, and tests | PASS |
| Extension regression/security | full suite plus validator manifest/source audit | PASS |
| Bootstrap fallback | missing/corrupt runtime simulation | PASS |
| Extension ZIP | exact source inventory/bytes, MV3 version, third-party notice, and complete WordNet license | PASS |
| Development hygiene | source audit, `git diff --check`, staged diff check, clean status | PASS at release boundary |
| Standalone portability | extracted source package, no `.git`, fresh suite/build/quality/validator | PASS at release boundary |

The canonical validator reports twelve named release gates and requires a normal exit. Development mode fails unless it is inside a clean Git worktree. Standalone mode fails if it is inside a Git worktree and substitutes a package/source audit for Git operations.

## Lexical runtime evidence

| Measure | Fresh evidence |
|---|---:|
| Normalized importer entries | 331,903 |
| Rejected importer records | 0 |
| English runtime rows | 206,978 |
| Traditional-Chinese runtime rows | 124,925 |
| Morphology rows | 6,052 |
| Deduplicated glosses | 220,471 |
| Serialized runtime bytes | 48,544,254 |
| Runtime payload SHA-256 | `f2a63b7b5af3673a7faea6acaed53776cb94bcf4146949d965a37b76003fca21` |

The runtime projection preserves distinct lexical senses even when surface and simplified POS match. Browser validation hashes the canonical packaged payload directly, validates canonical array order in one linear pass, enforces the same complete dataset-manifest, license, verified-release transport, and row evidence required by the Node loader, and freezes the verified document before lookup. A fresh Node 22/WebCrypto cold-load check of the 48,544,255-byte on-disk JSON file (payload plus final newline) completed in about 3.57 seconds; this is engineering evidence, not a cross-browser performance guarantee.

The CC-CEDICT release identity (`MDBG-2026-08-24T05:05:01Z-124925`) remains distinct from its format identity (`CC-CEDICT-V1`). The importer rejects V2 syntax because no V2 parser is claimed. Princeton WordNet and CC-CEDICT notices and redistribution requirements are preserved in the corpus evidence and third-party notices.

## Semantic quality evidence

| Metric | Fixture scale | Actual | Gate | Result |
|---|---:|---:|---:|---|
| English simplified-POS macro-F1 | 11 cases / 48 tokens | 1.0 | ≥ 0.90 | PASS |
| Traditional-Chinese simplified-POS macro-F1 | 11 cases / 49 tokens | 0.986111111111111 | ≥ 0.90 | PASS |
| Traditional-Chinese token-span segmentation F1 | 11 cases / 49 tokens | 1.0 | ≥ 0.90 | PASS |

All 11 English and 11 Traditional-Chinese cases match expected token spans. Expected lemma, morphology, Simplified-form, unknown, and confidence checks pass. The quality report deliberately records the two context-sensitive Traditional-Chinese POS fixture errors rather than relabelling them to match the engine.

These are authored regression fixtures totaling 22 cases and 97 tokens. They are not statistically representative and do not support a production-grade NLP accuracy claim.

## Projection and privacy evidence

- Every visual channel can be disabled independently.
- All channels off yields zero projection decoration while the immutable `AnnotationSet` remains present.
- Position, density, color, and enabled-channel changes leave serialized canonical tokens unchanged.
- Each visible channel is thresholded against its own annotation confidence; low-confidence POS cannot inherit higher lexical/gloss confidence.
- Canonical derived fields require annotation evidence whose type and value both match; legacy projection fallback is restricted to explicit pre-v1 tokens.
- In bilingual mode, a mixed-script CC-CEDICT longest match owns its span once, so English sub-tokenization cannot create overlapping canonical tokens.
- Grammar rules reset at sentence punctuation and non-English tokens; English chunks contain only clause-local English token indexes.
- POS color is suppressed when no textual POS carrier is enabled.
- The content script does not read renderer artifacts back into semantic truth.
- The service worker reads only the installed local index through the extension origin.
- No host permission, remote endpoint, telemetry, account, cookie, token, password, history, or form-value access is present.
- Sensitive form attributes cause local analysis to fail closed.
- A failed service-worker request uses the same conservative local semantic engine with the authored bootstrap provider; suffix-shaped unknowns remain `x`.
- Popup edits preserve non-UI profile fields (`profileId`, enabled state, confidence threshold, and processing budgets).

## Known limitations

- Full cross-site browser E2E is not claimed; it remains a v0.4.0 gate.
- Dynamic DOM/SPA lifecycle, viewport scheduling, and the ≥20-site fixture matrix are not implemented in v0.3.0.
- WordNet and CC-CEDICT provide lexical candidates, not full contextual word-sense disambiguation.
- CC-CEDICT is not a comprehensive POS corpus; Chinese POS evidence remains conservative and incomplete.
- English context and grammar rules are bounded deterministic baselines.
- The 48.5 MB uncompressed runtime index favors local reproducibility over later sharding/performance optimization; formal cross-browser startup/performance budgets remain v0.4.0 work.
- Release packaging requires local `zip`/`unzip` executables. Corpus and generated binary artifacts are covered by manifest/hash gates rather than the authored-text source audit.
- Learning-state projection is explicitly unavailable because learner events/mastery are later-release scope.
