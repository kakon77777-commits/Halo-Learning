# Halo Learning v0.2.0 — Lexical Data Layer

Halo Learning v0.2.0 adds a provider-agnostic, offline lexical-data supply layer to the v0.1.0 Magic Hand baseline. It normalizes English and Traditional-Chinese dictionary records, verifies source bytes and licenses, builds a deterministic local index, and fails back to the existing bootstrap provider when an index is missing or corrupt.

## Architecture boundaries

Browser marking remains:

`page text -> SemanticToken[] -> MarkingProfile -> RenderToken[] -> reversible DOM overlay`

Lexical data flows through a separate semantic path:

`local corpus bytes -> verified DatasetManifest -> LexicalEntry[] -> integrity-protected LexicalIndex -> DictionaryProvider seam`

The index stores canonical lexical semantics and provenance, not colors, CSS, label positions, or renderer state. Lookup maps are rebuilt runtime projections. English and `zh-Hant` are the only admitted locales.

## What v0.2.0 includes

- Runtime and JSON Schema contracts for datasets, licenses, lexical entries, and build receipts.
- Local-only importers for Princeton WordNet 3.0 `data.*` format and the Traditional field of a verified CC-CEDICT release.
- Conservative CC-CEDICT POS derivation: only an unambiguous gloss cue yields low-confidence `v`; otherwise POS remains `x`.
- Stable index bytes and SHA-256 regardless of importer entry order.
- English case-normalized lookup, Traditional exact lookup, and Traditional longest-match.
- Fail-soft dictionary registry that preserves the v0.1 bootstrap provider.
- Atomic local build, manifest, receipts, third-party notices, benchmark evidence, and release audit.

No upstream WordNet or CC-CEDICT corpus bytes are included. The committed records are synthetic format fixtures with their own manifests and hashes. The build tool never downloads data.

## Layout

- `apps/extension/` — the v0.2.0 Manifest V3 package; visual behavior remains the validated v0.1 Basic Marking baseline.
- `packages/contracts/` — dependency-free runtime contracts and JSON Schema handoff artifacts.
- `packages/lexical-data/` — source gate, deterministic EN/ZH importers, and hash utilities.
- `packages/lexical-index/` — integrity-checked local index and fail-soft registry.
- `fixtures/lexical/` — synthetic format fixtures only.
- `scripts/` — data build, benchmark, and v0.2.0 release validator.
- `docs/data-sources/` — source, license, format, redistribution, and rejection evidence.
- `docs/workbench/` — updated release workbook and Markdown workflow.
- `dist/` — extension ZIP plus generated synthetic index, receipts, and data manifest.

## Verify

The canonical release command is:

```bash
node scripts/validate-v0.2.0.js
```

The gate runs all 53 tests, parses executable JavaScript, scans executable sources for remote URLs and secret patterns, rebuilds fixture bytes deterministically, runs the synthetic 20k index budget, audits licenses/provenance/hashes, checks fail-soft regression evidence, audits the extension ZIP root/version, and confirms the workbench stops at v0.2.0.

To build a separately acquired local dataset:

```bash
node scripts/build-lexical-data.js \
  --en-dir /path/to/verified-wordnet-manifest-directory \
  --zh-file /path/to/verified-cc-cedict/cedict_ts.u8 \
  --out /path/to/new-output-directory
```

Each input directory must include an exact `dataset-manifest.json`; hash or provenance mismatch fails closed. The output directory must not already exist.

## Validation boundary

The automated suite verifies the lexical contracts, importers, deterministic index, local build, fallback path, security scope, and the original 16 Basic Marking tests. It does not claim full-corpus performance, production-grade NLP/POS accuracy, or complete cross-site browser E2E. Those gates remain future releases.
