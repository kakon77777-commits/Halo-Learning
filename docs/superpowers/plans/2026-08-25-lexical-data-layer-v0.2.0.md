# Halo Learning v0.2.0 Lexical Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first provider-agnostic, offline lexical-data layer for English and Traditional Chinese with validated contracts, licensed-source records, deterministic importers and indexes, integrity receipts, fail-soft registry behavior, and v0.2.0 release evidence.

**Architecture:** Keep the v0.1.0 browser semantic pipeline unchanged. New dependency-free Node/CommonJS packages normalize corpus records into `LexicalEntry`, build a deterministic integrity-protected index, and expose it through a registry compatible with the existing `DictionaryProvider.lookup(surface, lang)` seam. Full upstream corpora are never bundled; source files are user-acquired inputs whose exact bytes are hashed before import, while synthetic fixtures exercise the same import path in tests and release builds.

**Tech Stack:** Node 22 built-ins (`node:test`, `crypto`, `fs`, `perf_hooks`), dependency-free JavaScript, JSON Schema handoff artifacts, Manifest V3 extension baseline, artifact-tool workbook update.

**Spec:** `docs/source/Halo_Learning_統一實作規格_Agent_Handoff_v0.1.md`

## Global Constraints

- Local-first; corpus import and lookup perform no network requests.
- Provider-agnostic; no LLM/NLP SDK enters contracts, importers, index, or registry.
- English (`en`) and Traditional Chinese (`zh-Hant`) only.
- Corpus bytes require source, version, license, redistribution note, locale, and SHA-256 before import.
- Full Princeton WordNet or CC-CEDICT data is not bundled in this release.
- CC-CEDICT does not supply POS truth; any POS is conservative derived provenance and may remain `x`.
- A missing, unsupported, or corrupt index never disables the v0.1 bootstrap provider.
- Semantic entries do not contain renderer state; renderer projection cannot write back to lexical semantics.
- No remote API, analytics, login, billing, cloud sync, or additional language scope.

## V020 Checklist

- [x] V020-01 Contracts — `DatasetManifest`, `LicenseRecord`, `LexicalEntry`, `CorpusBuildReceipt`.
- [x] V020-02 Corpus Research — official source/license/provenance records for WordNet 3.0 and CC-CEDICT; reject noncommercial/nonredistributable candidates.
- [x] V020-03 EN Importer — deterministic Princeton WordNet `data.*` parser.
- [x] V020-04 ZH Importer — Traditional-field CC-CEDICT parser with conservative derived POS provenance.
- [x] V020-05 Index — deterministic index, lookup, longest-match, integrity check, benchmark budget.
- [x] V020-06 Fallback — bootstrap provider remains usable without or after corrupt corpus indexes.
- [x] V020-07 Reproducibility — input/index hashes, receipts, data manifest, third-party notices.
- [x] V020-08 Release Gate — full suite/build/benchmark/security checks, docs/workbench status, release package.

---

### Task 1 / V020-01: Lexical Contracts and Runtime Validation

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `packages/contracts/lexical-contracts.js`
- Create: `packages/contracts/schemas/dataset-manifest.schema.json`
- Create: `packages/contracts/schemas/license-record.schema.json`
- Create: `packages/contracts/schemas/lexical-entry.schema.json`
- Create: `packages/contracts/schemas/corpus-build-receipt.schema.json`
- Test: `tests/lexical-contracts.test.js`

**Interfaces:**
- Produces: `normalizeLicenseRecord(value) -> frozen LicenseRecord`.
- Produces: `normalizeDatasetManifest(value) -> frozen DatasetManifest`.
- Produces: `normalizeLexicalEntry(value) -> frozen LexicalEntry`.
- Produces: `normalizeCorpusBuildReceipt(value) -> frozen CorpusBuildReceipt`.
- Contract invariants: `schemaVersion === 1`, locale is `en|zh-Hant`, hashes are lowercase 64-hex SHA-256, POS is `n|v|adj|adv|prep|conj|det|pron|aux|modal|x`, confidence is `0..1`.

- [x] **Step 1: Write failing contract tests.** Hand-build valid EN/ZH objects, round-trip through JSON, and assert malformed locale/hash/license/entry provenance is rejected. Mutation target: removing any required field or range check must fail at least one test.
- [x] **Step 2: Run RED.** `node --test tests/lexical-contracts.test.js`; expected failure is missing `packages/contracts/lexical-contracts.js`.
- [x] **Step 3: Implement minimal runtime validators and JSON Schema artifacts.** Do not add external schema libraries; throw `TypeError` with a field path.
- [x] **Step 4: Run GREEN and full regression.** `node --test tests/lexical-contracts.test.js tests/*.test.js`.
- [x] **Step 5: Record task evidence and commit.** Commit message: `feat(contracts): add lexical data schemas`.

### Task 2 / V020-02: Source, License, and Provenance Gate

**Files:**
+- Create: `packages/lexical-data/source-gate.js`
- Create: `docs/data-sources/source-records.json`
- Create: `docs/data-sources/PRINCETON_WORDNET_3.0.md`
- Create: `docs/data-sources/CC_CEDICT.md`
- Create: `docs/data-sources/REJECTED_SOURCES.md`
- Test: `tests/data-source-records.test.js`

**Interfaces:**
- Produces machine-readable selected-source records with `officialSourceUrl`, `officialLicenseUrl`, `versionPolicy`, `commercialUseAllowed`, `redistributionAllowed`, `redistributionRequirements`, `verifiedAt`, and `bundled=false`.
- Selected EN target: Princeton WordNet 3.0 under the WordNet license.
- Selected ZH-Hant target: the Traditional field of the verified CC-CEDICT release; snapshot license must be captured at acquisition, with the current download page reviewed as CC BY-SA 4.0.

- [x] **Step 1: Write failing source-gate tests.** Assert exactly one selected `en` and one selected `zh-Hant` record, official HTTPS evidence, commercial and redistribution allowance, and `bundled === false`.
- [x] **Step 2: Run RED.** Expected failure: missing `source-records.json`.
- [x] **Step 3: Add source records and human-readable reviews.** Record the CC-CEDICT wiki/download license-version discrepancy and reject NTU CWN for this product release because its terms prohibit commercial use and reproduction without permission.
- [x] **Step 4: Run GREEN.** `node --test tests/data-source-records.test.js`.
- [x] **Step 5: Commit.** `docs(data): record licensed lexical sources`.

### Task 3 / V020-03: Princeton WordNet Importer

**Files:**
- Create: `packages/lexical-data/shared/build-utils.js`
- Create: `packages/lexical-data/en/wordnet-importer.js`
- Create: `fixtures/lexical/wordnet-3.0-synthetic/data.noun`
- Create: `fixtures/lexical/wordnet-3.0-synthetic/data.verb`
- Create: `fixtures/lexical/wordnet-3.0-synthetic/dataset-manifest.json`
- Test: `tests/wordnet-importer.test.js`

**Interfaces:**
- Produces: `importWordNetFiles(files, manifest) -> { entries, rejected, receiptDraft }`.
- Parses official `data.*` core fields: synset offset, synset type, hexadecimal word count, lemmas, and gloss.
- Normalizes adjective satellite `s` to `adj`; collocation underscores become spaces; every entry retains `recordRef`, line number, dataset/version, and field provenance.

- [x] **Step 1: Write failing importer tests.** Use literal synthetic `data.noun`/`data.verb` records; assert exact entries, POS/gloss references, deterministic ordering, and explicit rejection of malformed lines.
- [x] **Step 2: Run RED.** Missing importer must be the failure reason.
- [x] **Step 3: Implement minimal parser and SHA/canonical JSON utilities.** Never fetch; require manifest input hash to match the provided bytes.
- [x] **Step 4: Run GREEN and regression.** `node --test tests/wordnet-importer.test.js tests/*.test.js`.
- [x] **Step 5: Commit.** `feat(data): add deterministic WordNet importer`.

### Task 4 / V020-04: CC-CEDICT Traditional Chinese Importer

**Files:**
- Create: `packages/lexical-data/zh/cc-cedict-importer.js`
- Create: `fixtures/lexical/cc-cedict-synthetic/cedict_ts.u8`
- Create: `fixtures/lexical/cc-cedict-synthetic/dataset-manifest.json`
- Test: `tests/cc-cedict-importer.test.js`

**Interfaces:**
- Produces: `importCcCedict(text, manifest) -> { entries, rejected, receiptDraft }`.
- Uses only the Traditional headword as the `zh-Hant` lookup key; Simplified source spelling is retained as non-indexed provenance.
- Produces: `deriveCcCedictPos(glosses) -> { pos, confidence, derivationId }`; ambiguous entries return `x`, never a confident guess.

- [x] **Step 1: Write failing importer tests.** Assert Traditional surface preservation, pinyin/gloss refs, longest candidate length, conservative `to ... -> v` derivation, unknown POS fallback, deterministic duplicate handling, and malformed-line rejection.
- [x] **Step 2: Run RED.** Missing importer must be the failure reason.
- [x] **Step 3: Implement the minimal V1-compatible parser.** Reject unsupported/ambiguous syntax rather than silently truncating. Do not index Simplified aliases as `zh-Hant`.
- [x] **Step 4: Run GREEN and regression.** `node --test tests/cc-cedict-importer.test.js tests/*.test.js`.
- [x] **Step 5: Commit.** `feat(data): add Traditional CC-CEDICT importer`.

### Task 5 / V020-05: Deterministic Local Lexical Index

**Files:**
- Create: `packages/lexical-index/lexical-index.js`
- Create: `scripts/benchmark-lexical-index.js`
- Test: `tests/lexical-index.test.js`

**Interfaces:**
- Produces: `buildLexicalIndex(entries, options) -> LexicalIndex` with stable ordering and SHA-256.
- Produces: `serializeLexicalIndex(index) -> canonical JSON`.
- Produces: `loadLexicalIndex(json) -> verified LexicalIndex`; corrupt hash throws `LexicalIndexIntegrityError`.
- Produces: `index.lookup(surface, locale)` and `index.longestMatch(text, start, 'zh-Hant')`.
- Release budget: synthetic 20k-entry index p95 lookup `< 5 ms`, serialized size `<= 1024 bytes/entry`, measured heap delta `<= 8192 bytes/entry`; benchmark evidence states that this is not a full-corpus production claim.

- [x] **Step 1: Write failing index tests.** Assert duplicate senses remain addressable, normalized EN case lookup, exact Traditional lookup, longest match, stable hash across input order, and tamper rejection.
- [x] **Step 2: Run RED.** Missing index module must be the failure reason.
- [x] **Step 3: Implement minimal deterministic index.** No renderer imports and no network or provider SDK.
- [x] **Step 4: Run GREEN, then benchmark.** `node --test tests/lexical-index.test.js`; `node --expose-gc scripts/benchmark-lexical-index.js`.
- [x] **Step 5: Commit.** `feat(index): add verified local lexical index`.

### Task 6 / V020-06: Dictionary Registry and Fail-Soft Fallback

**Files:**
- Create: `packages/lexical-index/dictionary-registry.js`
- Test: `tests/dictionary-registry.test.js`

**Interfaces:**
- Produces: `createDictionaryRegistry({ bootstrapProvider, indexes })`.
- Registry contract: `lookup(surface, lang)`, `longestMatch(text, start, lang)`, `register(serializedIndex)`, `status()`.
- Language aliases normalize existing `zh` calls to `zh-Hant`; unsupported locales are not expanded.
- Invalid/missing corpus indexes are recorded as degraded status and fall back to `bootstrapProvider.lookup`.

- [x] **Step 1: Write failing fallback tests.** Assert corpus precedence, no-corpus bootstrap lookup, corrupt-index recovery, missing-file recovery, and no mutation of the bootstrap provider.
- [x] **Step 2: Run RED.** Missing registry must be the failure reason.
- [x] **Step 3: Implement minimal registry.** Catch only known index load/integrity failures; expose sanitized error codes, not corpus content.
- [x] **Step 4: Run GREEN and the original 16-test suite.** `node --test tests/dictionary-registry.test.js tests/*.test.js`.
- [x] **Step 5: Commit.** `feat(dictionary): add fail-soft lexical registry`.

### Task 7 / V020-07: Reproducible Build Receipts and Notices

**Files:**
- Create: `scripts/build-lexical-data.js`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `dist/data-manifest.json` (generated)
- Create: `dist/lexical-fixture/lexical-index.json` (generated)
- Create: `dist/lexical-fixture/build-receipts.json` (generated)
- Test: `tests/lexical-build.test.js`

**Interfaces:**
- CLI: `node scripts/build-lexical-data.js --en-dir <dir> --zh-file <file> --out <dir>`.
- Verifies each input SHA-256 before parsing; writes atomically through a temporary sibling directory; never downloads data.
- Same input bytes and importer versions produce the same `lexical-index.json` hash even when `builtAt` differs.

- [x] **Step 1: Write failing CLI integration test.** Build twice in OS temp directories, assert identical index bytes/hash, receipt input hashes, rejected-count visibility, and refusal on a mismatched manifest hash.
- [x] **Step 2: Run RED.** Missing build script must be the failure reason.
- [x] **Step 3: Implement minimal build CLI and notices.** Notices distinguish importer support from bundled upstream corpus; release fixture data is synthetic.
- [x] **Step 4: Run GREEN and build release fixture.** Use fixed `SOURCE_DATE_EPOCH=1787616000` for stable evidence.
- [x] **Step 5: Commit.** `build(data): add reproducible lexical receipts`.

### Task 8 / V020-08: Release Gate, Documentation, Workbench, and Package

**Files:**
- Create: `scripts/validate-v0.2.0.js`
- Create: `docs/VALIDATION_REPORT_v0.2.0.md`
- Create: `docs/releases/v0.2.0-task-evidence.yaml`
- Create: `docs/validation/v0.2.0-index-benchmark.json`
- Modify: `README.md`
- Modify: `apps/extension/README.md`
- Modify: `apps/extension/manifest.json`
- Create: `docs/workbench/Halo_Learning_v0.1.0_to_v1.0_Workbench.xlsx`
- Create: `docs/workbench/Halo_Learning_v0.1.0_to_v1.0_Workflow.md`
- Create: `dist/halo-learning-magic-hand-v0.2.0.zip`

**Interfaces:**
- Release command: `node scripts/validate-v0.2.0.js`.
- Gate sequence: full tests, parse checks, executable-source remote scan, deterministic fixture build, index benchmark, manifest/license/provenance audit, extension ZIP root/version audit.
- Workbench update: Dashboard baseline/gate count, Version Roadmap v0.2.0 status, v0.2.0 Task statuses/notes only; v0.3.0 remains Not Started.

- [x] **Step 1: Write release-validator behavior tests where practical.** The validator must return nonzero if an isolated gate fixture lacks provenance or contains a remote executable URL.
- [x] **Step 2: Implement release validator and update release metadata/docs.** Do not claim browser cross-site E2E.
- [x] **Step 3: Edit workbook with artifact-tool, preserving existing style/data validation; render and inspect all sheets.** Update the Markdown mirror consistently.
- [x] **Step 4: Run fresh Release Gate.** `node scripts/validate-v0.2.0.js`; required normal exit `0`.
- [x] **Step 5: Verify Git diff, secrets/remote-data scope, ZIP contents, and workbook formula/error scan.** All v0.2.0 blocking tasks must have evidence; v0.3.0 must remain untouched.
- [x] **Step 6: Commit release boundary.** `release: Halo Learning v0.2.0 lexical data layer`.
- [x] **Step 7: Package one outer source/evidence/workbench ZIP, excluding `.git` and full upstream corpora, then stop.**

## Self-Review

- Spec coverage: V020-01 through V020-08 each maps to one task and a concrete gate.
- Scope: no learner model, Halo Story, browser runtime expansion, remote provider, new language, or corpus redistribution was added.
- Contract consistency: all importers produce the same `LexicalEntry`; the index consumes only that contract; the registry preserves the v0.1 provider seam.
- Test integrity: every production behavior begins with a real failing test; docs/source records are checked through their consuming release gate rather than source-text grep assertions.
- Known deliberate limitation: CC-CEDICT POS is not dataset truth and remains derived/unknown with explicit provenance; full-corpus performance and NLP accuracy are not claimed in v0.2.0.
