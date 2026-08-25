# Halo Learning v0.3.0 Semantic Annotation Engine Implementation Plan

> Execute this plan on `workbench/v0.3.0-semantic-annotation` with strict
> RED → GREEN → REFACTOR evidence. Do not start v0.4.0.

**Goal:** Activate verified Princeton WordNet and CC-CEDICT data in the local
extension runtime, produce formal English and Traditional-Chinese semantic
annotations, project them through independent visual channels, and pass the
v0.3.0 release gate from both a Git checkout and a standalone source package.

**Architecture:** Pinned corpus bytes build a canonical lexical model and an
integrity-protected compact runtime index. A Manifest V3 service worker loads
that packaged index into a provider-agnostic dictionary registry and annotates
text locally. Content code performs only projection and reversible DOM work.

**Runtime:** Node.js >=22, dependency-free CommonJS/UMD modules, Manifest V3,
Node built-in test runner, SHA-256 from Web Crypto/Node crypto.

## Baseline record

- Base branch: `main`
- Base/head before: `cc844f37ac1da0ccfbdb85e0d8448245132c5e3b`
- Working branch: `workbench/v0.3.0-semantic-annotation`
- Direct full suite: `node --test tests/*.test.js` → 53/53 PASS
- v0.2.0 validator: `node scripts/validate-v0.2.0.js` → 10/10 PASS
- `npm test`: environment wrapper blocked by network-approval transport; direct
  execution of the exact package-script command is the canonical baseline run.

## Task checklist

- [ ] V030-01 Contracts
- [ ] V030-02 English NLP
- [ ] V030-03 Chinese NLP
- [ ] V030-04 Grammar Layer
- [ ] V030-05 Visual Profiles
- [ ] V030-06 Profile Migration
- [ ] V030-07 Quality Corpus
- [ ] V030-08 Release Gate

## Phase 1 — V030-01 contracts and schema

### Step 1.1: Write failing semantic-contract tests

**Create:**

- `tests/semantic-contracts.test.js`
- `tests/fixtures/semantic-contracts.js`

Cover:

- valid `SemanticAnnotation/v1`, `SemanticToken/v1`, `AnnotationSet/v1`, and
  `MarkingProfile/v2` values;
- required confidence, provider, algorithm, dataset, timestamp, offsets, refs,
  and provenance constraints;
- unknown as `x` or absent optional analysis;
- rejection of invalid locale, confidence, offsets, overlap, or annotation;
- immutable validated output;
- explicit legacy token migration.

Run and confirm RED:

```bash
node --test tests/semantic-contracts.test.js
```

Expected failure: semantic contract module does not exist.

### Step 1.2: Implement minimum contracts and JSON Schemas

**Create:**

- `packages/contracts/semantic-contracts.js`
- `packages/contracts/schemas/semantic-annotation.schema.json`
- `packages/contracts/schemas/semantic-token.schema.json`
- `packages/contracts/schemas/annotation-set.schema.json`
- `packages/contracts/schemas/marking-profile.schema.json`

Implement dependency-free validation, normalization, deep freezing, and the
legacy one-way adapter. Do not import UI modules.

Run GREEN and regression:

```bash
node --test tests/semantic-contracts.test.js
node --test tests/*.test.js
```

### Step 1.3: Record contract evidence

**Create:** `docs/releases/v0.3.0-task-evidence.yaml`

Record files, contracts, migrations, tests, acceptance evidence, limitations,
security notes, and next dependency for V030-01.

## Phase 2 — verified corpus activation and runtime index

### Step 2.1: Write failing verified-release/source-gate tests

**Create/modify:**

- `tests/verified-corpus.test.js`
- `tests/data-source-records.test.js`
- `tests/cc-cedict-importer.test.js`
- `tests/wordnet-importer.test.js`

Tests require:

- exact WordNet 3.0 upstream archive identity and hashes;
- exact CC-CEDICT release identity plus separate `CC-CEDICT-V1` syntax identity;
- V1 header and V2-line rejection;
- attribution/redistribution requirements and transport provenance;
- WordNet morphology-exception import;
- adjective marker normalization without losing source evidence.

Run and confirm RED on each new behavior before implementation.

### Step 2.2: Extend provenance contracts without breaking v0.2 fixtures

**Modify:**

- `packages/contracts/lexical-contracts.js`
- `packages/contracts/schemas/dataset-manifest.schema.json`
- `packages/contracts/schemas/corpus-build-receipt.schema.json`
- `packages/lexical-data/source-gate.js`
- `docs/data-sources/source-records.json`
- `docs/data-sources/PRINCETON_WORDNET_3.0.md`
- `docs/data-sources/CC_CEDICT.md`
- `THIRD_PARTY_NOTICES.md`

Add verified-release fields while retaining backward-compatible fixture
validation. Keep dataset release, syntax/format, and retrieval transport distinct.

### Step 2.3: Activate pinned corpus bytes

**Add:**

- `data/corpora/princeton-wordnet-3.0/` extracted dictionary, exception, license,
  manifest, and acquisition receipt files;
- `data/corpora/cc-cedict-v1-2026-08-24/` V1 text, manifest, and acquisition
  receipt files.

Copy only bytes whose SHA-256 has already been independently checked. The build
must recheck every bundled file; a network download is never canonical input.

### Step 2.4: Write failing runtime-index tests

**Create:**

- `tests/runtime-lexical-index.test.js`
- `tests/runtime-index-build.test.js`

Cover compact schema, deterministic canonical serialization, payload hash,
English candidate lookup, morphology lookup, Chinese longest match, provenance
reconstruction, corruption rejection, and importer-representation isolation.

Run RED:

```bash
node --test tests/runtime-lexical-index.test.js tests/runtime-index-build.test.js
```

### Step 2.5: Implement compact builder and provider

**Create/modify:**

- `packages/lexical-index/runtime-lexical-index.js`
- `packages/lexical-data/en/wordnet-importer.js`
- `packages/lexical-data/zh/cc-cedict-importer.js`
- `scripts/build-lexical-runtime.js`
- `package.json`

Generate:

- `apps/extension/data/lexical-runtime-index.json`
- `dist/lexical-v0.3.0/build-receipts.json`
- `dist/lexical-v0.3.0/runtime-index-manifest.json`

Run GREEN, deterministic rebuild comparison, and full regression.

## Phase 3 — runtime DictionaryProvider chain

### Step 3.1: Write failing provider and service tests

**Create/modify:**

- `tests/runtime-dictionary-provider.test.js`
- `tests/dictionary-registry.test.js`
- `tests/extension-semantic-service.test.js`

Cover packaged-first lookup, bootstrap fallback, missing/corrupt/hash-invalid
index, local-only resource loading, provider status diagnostics, and no
WordNet/CC importer object escaping from the provider.

### Step 3.2: Implement provider chain and service worker

**Create/modify:**

- `apps/extension/src/shared/runtime-dictionary-provider.js`
- `apps/extension/src/service-worker.js`
- `apps/extension/manifest.json`
- `apps/extension/src/shared/dictionary-provider.js`
- `packages/lexical-index/dictionary-registry.js`

The service worker loads only `chrome.runtime.getURL(...)`; no remote URL or
host permission is permitted. Return a bootstrap provider on every verified
load failure.

Run focused GREEN, extension policy tests, and full regression.

## Phase 4 — V030-02 English semantic layer

### Step 4.1: Add failing English fixtures

**Create:**

- `tests/fixtures/quality/en-annotations.json`
- `tests/english-semantic-annotations.test.js`

Cover offsets, tokenization, lemma, irregular and regular morphology, simplified
POS, lexical/gloss refs, closed class, confidence/provenance, ambiguity, and
unknown handling. First run must fail because the semantic engine is absent.

### Step 4.2: Implement minimum English analyzer

**Create:** `apps/extension/src/shared/semantic-annotations.js`

Implement provider-driven English analysis and immutable AnnotationSet output.
Only accept regular morphology when the candidate lemma exists. Never turn a
suffix alone into known evidence.

Run focused GREEN and all contract/provider regressions.

## Phase 5 — V030-03 Traditional-Chinese semantic layer

### Step 5.1: Add failing Chinese fixtures

**Create:**

- `tests/fixtures/quality/zh-hant-annotations.json`
- `tests/chinese-semantic-annotations.test.js`

Cover deterministic longest match, offsets, Traditional/Simplified form,
lexical/gloss refs, conservative POS, confidence/provenance, equal-candidate
ordering, and one-character unknown fallback.

### Step 5.2: Implement minimum Chinese analyzer

**Modify:** `apps/extension/src/shared/semantic-annotations.js`

Use only provider lookups and stable lexical IDs. Preserve `x` for insufficient
CC-CEDICT evidence. Run focused GREEN, determinism loop, and full regression.

## Phase 6 — V030-04 bounded grammar layer

### Step 6.1: Write failing grammar tests

**Create:** `tests/grammar-annotations.test.js`

Cover fixture-backed English subject/predicate/object, finite/past/progressive/
perfect evidence, chunks, omitted uncertain analysis, and provenance.

### Step 6.2: Implement bounded rules

**Create:** `apps/extension/src/shared/grammar-annotations.js`
**Modify:** `apps/extension/src/shared/semantic-annotations.js`

Rules consume canonical annotations and emit new annotations; they never alter
lexical provenance or invent Chinese grammar fields. Run focused GREEN and all
semantic tests.

## Phase 7 — V030-05/V030-06 visual profiles and migration

### Step 7.1: Write failing profile/projection tests

**Modify/create:**

- `tests/projection.test.js`
- `tests/profile-migration.test.js`
- `tests/content-rendering.test.js`

Cover every channel independently, all-off → zero decoration, POS color disabled
without a non-color carrier, profile migration/idempotence, different plans from
the same token, byte-identical SemanticTokens after projection, density and
position independence, and reversible DOM segments.

### Step 7.2: Implement profile v2 and pure RenderPlan

**Modify:**

- `apps/extension/src/shared/settings.js`
- `apps/extension/src/shared/projection.js`
- `apps/extension/src/content.js`
- `apps/extension/src/content.css`
- `apps/extension/src/popup.html`
- `apps/extension/src/popup.js`

Add only compact channel controls. Disabled/unavailable channels remain off.
Content awaits the local semantic service, renders plan decorations with safe
DOM APIs, and preserves Apply/Remove behavior.

Run focused GREEN and complete v0.1/v0.2 regression.

## Phase 8 — V030-07 quality harness

### Step 8.1: Write failing metric tests

**Create:**

- `tests/quality-metrics.test.js`
- `scripts/run-semantic-quality.js`

Test per-class precision/recall/F1, macro-F1, segmentation boundary metrics,
zero-denominator handling, fixture metadata, and stable JSON report output.

### Step 8.2: Run actual fixture evaluation

**Generate:** `docs/validation/v0.3.0-semantic-quality.json`

Run:

```bash
node scripts/run-semantic-quality.js
```

Record actual English and Chinese POS macro-F1, segmentation precision/recall/F1,
fixture counts, token counts, and explicit scope limitations. The workbook gate
must fail if either required simplified-POS macro-F1 is below 0.90.

## Phase 9 — V030-08 portable release validation

### Step 9.1: Write failing standalone-validator tests

**Create/modify:**

- `tests/release-validator-v0.3.0.test.js`
- `tests/release-validator.test.js`

Cover Git checkout mode, no-`.git` source-audit mode, trailing whitespace,
conflict markers, missing/corrupt index, fallback simulation, prohibited remote
code, package manifest, and normal exit behavior.

### Step 9.2: Implement validator and package builder

**Create/modify:**

- `scripts/validate-v0.3.0.js`
- `scripts/audit-source-tree.js`
- `scripts/package-v0.3.0.js`
- `package.json`

Build:

- `dist/halo-learning-magic-hand-v0.3.0.zip`
- `releases/Halo_Learning_v0.3.0_Semantic_Annotation_Engine_Release.zip`
- `dist/data-manifest-v0.3.0.json`

The source release includes all verified build inputs and validation scripts but
no `.git`. Extract it to a fresh temporary directory and run its validator.

### Step 9.3: Update release records and workbook

**Modify/create:**

- `README.md`
- `apps/extension/README.md`
- `docs/VALIDATION_REPORT_v0.3.0.md`
- `docs/VALIDATION_REPORT.md`
- `docs/releases/v0.3.0-task-evidence.yaml`
- `docs/workbench/Halo_Learning_v0.1.0_to_v1.0_Workflow.md`
- `docs/workbench/Halo_Learning_v0.1.0_to_v1.0_Workbench.xlsx`

Set only v0.3.0 tasks/gate to Complete after fresh evidence. Leave v0.4.0 and
later untouched.

## Final verification sequence

Run from the repository root after all implementation and documentation edits:

```bash
node --test tests/*.test.js
node scripts/build-lexical-runtime.js --verify
node scripts/run-semantic-quality.js --verify
node scripts/validate-v0.3.0.js --development
node scripts/package-v0.3.0.js
```

Then extract the standalone source release into a fresh temporary directory and
run:

```bash
node --test tests/*.test.js
node scripts/build-lexical-runtime.js --verify
node scripts/run-semantic-quality.js --verify
node scripts/validate-v0.3.0.js --standalone
```

Also run syntax checks for every shipped JavaScript file and inspect workbook
renders/formulas. Every PASS claim must have a fresh normal exit 0.

## Self-review and release boundary

Because this task explicitly disallows unrequested sub-agent delegation, perform
a complete local diff review against the canonical specification and every
V030-01–V030-08 acceptance row. Re-run all affected tests after any review fix.

When all blocking gates are green:

1. verify `git diff --check`;
2. make one or more meaningful commits on the working branch;
3. run the final clean-tree validator after the release-boundary commit;
4. leave `main` unchanged and keep the completed workbench branch;
5. report v0.3.0 and stop—do not begin v0.4.0.
