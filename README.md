# Halo Learning v0.3.0 — Semantic Annotation Engine

Halo Learning v0.3.0 connects the verified lexical-data layer to the local Manifest V3 extension. English and Traditional-Chinese page text now flows through provider-neutral semantic contracts before any user-selected visual projection:

`page text → DictionaryProvider → SemanticToken / AnnotationSet → MarkingProfile → RenderPlan → reversible DOM artifact`

Semantic truth never contains colors, label positions, CSS, or renderer state. The renderer receives only a projection of the immutable annotation set, and removing the projection restores the original text.

## Included in v0.3.0

- `SemanticAnnotation/v1`, `SemanticToken/v1`, `AnnotationSet/v1`, and `MarkingProfile/v2` runtime contracts plus JSON Schema handoff artifacts.
- A deterministic compact runtime index built from verified Princeton WordNet 3.0 and CC-CEDICT V1-edition bytes.
- A packaged-index-first `DictionaryProvider` with a built-in authored bootstrap fallback for missing, corrupt, or unloadable index data.
- English token, lemma, simplified POS, basic morphology, lexical/gloss references, confidence, and provenance.
- Traditional-Chinese deterministic longest-match segmentation, Traditional/Simplified forms, lexical/gloss references, conservative POS evidence, confidence, and provenance.
- A bounded English grammar layer for supported subject/predicate/object, chunk, and tense/aspect patterns; unsupported analyses remain absent.
- Independent projection switches for POS label, POS color, lemma, morphology, gloss hint, grammar role, tense/aspect, chunk, and learning state. Learning state is explicitly unavailable and disabled in this release.
- Explicit v0.1/v0.2 settings migration to `MarkingProfile/v2`.
- English and Traditional-Chinese quality fixtures with actual macro-F1 and token-span metrics.
- Separate Git-development and no-`.git` standalone-package validation gates.

## Verified lexical artifacts

| Dataset | Upstream identity | Format identity | License | Bundled source SHA-256 |
|---|---|---|---|---|
| Princeton WordNet | 3.0 / `Princeton-WordNet-3.0` | `WordNet-database-files-3.0` | WordNet 3.0 License | `9c082f9c9d193e0458e89bc5a290757d2d9fec54c8bed54eb2f85ad588cf60a2` |
| CC-CEDICT | `MDBG-2026-08-24T05:05:01Z-124925` | `CC-CEDICT-V1` | CC BY-SA 4.0 | `205018c6e766de913f808a5a8471163ceca96ea8cca053883baba8bd55545541` |

The compact runtime index is built from 331,903 normalized importer entries and preserves distinct same-POS lexical senses. It contains 206,978 English rows, 124,925 Traditional-Chinese rows, 6,052 morphology rows, and 220,471 deduplicated glosses. Its canonical payload hash is:

`f2a63b7b5af3673a7faea6acaed53776cb94bcf4146949d965a37b76003fca21`

Corpus manifests, acquisition receipts, file hashes, importer versions, build receipts, licenses, attribution requirements, and redistribution notes are under `data/corpora/`, `dist/lexical-v0.3.0/`, `docs/data-sources/`, and `THIRD_PARTY_NOTICES.md`. CC-CEDICT data and the derived lexical projection retain the applicable CC BY-SA 4.0 attribution/share-alike boundary.

## Local extension

The extension package is `dist/halo-learning-magic-hand-v0.3.0.zip`. It requests only `activeTab`, `scripting`, and `storage`, with no host permissions. Its service worker loads only the packaged local index and exposes a bounded local annotation-message interface. It does not upload page text, execute remote code, inspect cookies/history, or read form values.

To load the unpacked source:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select `apps/extension/`.
5. On a normal page, open Halo Learning and choose **Apply · 套用**.

Sensitive forms fail closed. Browser-internal pages cannot be injected. **Remove · 移除** unwraps Halo-created spans and restores the original text nodes.

## Build and verify

```bash
node --test tests/*.test.js
node --max-old-space-size=2048 scripts/build-lexical-runtime.js --verify
node --max-old-space-size=1024 scripts/run-semantic-quality.js --verify
```

Development checkout gate, which requires a clean Git worktree:

```bash
node scripts/validate-v0.3.0.js --development
```

Extracted source-package gate, which intentionally runs without `.git`:

```bash
node scripts/validate-v0.3.0.js --standalone
```

Rebuild release packages:

```bash
node scripts/package-v0.3.0.js
```

Release packaging and ZIP-byte verification require the standard `zip` and `unzip` command-line tools. Corpus/raw-data bytes are validated against pinned manifest hashes; the separate authored-source audit intentionally scans text source rather than treating binary artifacts as source code.

## Quality boundary

The committed quality report covers 22 authored cases and 97 tokens. Recorded results are English simplified-POS macro-F1 `1.0`, Traditional-Chinese simplified-POS macro-F1 `0.986111111111111`, and Traditional-Chinese token-span segmentation F1 `1.0`.

These figures describe the checked regression fixtures only. They are not a statistically representative benchmark or a claim of production-grade NLP accuracy. WordNet and CC-CEDICT provide lexical candidates, not full contextual disambiguation; CC-CEDICT is not a comprehensive POS corpus. Full cross-site browser E2E remains unclaimed and belongs to v0.4.0. The 48.5 MB uncompressed index is intentionally unsharded in v0.3.0; a fresh Node/WebCrypto cold-load measurement on the release artifact was about 3.57 seconds, not a cross-browser performance claim.

## Deliberately deferred

v0.3.0 does not add Halo Story, learner mastery, an event-sourced learner database, cloud sync, login, billing/subscription, mobile native apps, teacher backend, analytics, advertising, remote NLP/AI, or own-model training. The workbench stops at the v0.3.0 release gate; v0.4.0 remains Not Started.
