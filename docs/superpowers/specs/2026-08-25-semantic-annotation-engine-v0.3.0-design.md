# Halo Learning v0.3.0 Semantic Annotation Engine Design

**Date:** 2026-08-25
**Release:** v0.3.0 — Semantic Annotation Engine
**Base:** v0.2.0 Lexical Data Layer (`cc844f37ac1da0ccfbdb85e0d8448245132c5e3b`)
**Branch:** `workbench/v0.3.0-semantic-annotation`

## 1. Purpose

v0.3.0 connects the verified lexical-data pipeline introduced in v0.2.0 to a
provider-agnostic semantic annotation engine and then projects those immutable
annotations through configurable visual profiles.

The canonical pipeline remains:

```text
page text
  -> DictionaryProvider
  -> SemanticToken / AnnotationSet
  -> MarkingProfile
  -> RenderPlan
  -> reversible DOM artifacts
```

This release does not implement Halo Story, learner mastery, cloud services,
remote NLP, accounts, billing, or a broad user-interface redesign.

## 2. Release task mapping

| Task ID | Workstream | Blocking outcome |
| --- | --- | --- |
| V030-01 | Contracts | Versioned SemanticToken, SemanticAnnotation, AnnotationSet, and MarkingProfile contracts |
| V030-02 | English NLP | Deterministic tokens with lemma, simplified POS, morphology, lexical/gloss references, confidence, provenance |
| V030-03 | Chinese NLP | Deterministic Traditional-Chinese longest-match segmentation with Simplified counterpart and conservative POS |
| V030-04 | Grammar Layer | Bounded high-confidence role, tense/aspect, and chunk annotations; uncertain values omitted |
| V030-05 | Visual Profiles | Independently configurable semantic channels and color as a secondary carrier |
| V030-06 | Profile Migration | Explicit migration from v0.1/v0.2 settings without changing semantic truth |
| V030-07 | Quality Corpus | English and Traditional-Chinese fixtures with actual macro-F1 and segmentation metrics |
| V030-08 | Release Gate | Full regression, fallback, provenance, package, and standalone validation evidence |

## 3. Architectural decisions

### 3.1 Canonical data and runtime data are distinct

The verified corpus inputs and their acquisition records are canonical build
inputs. The extension consumes a compact, deterministic runtime projection.
The runtime projection is not allowed to become a new semantic source: it can
always be rebuilt from the pinned corpus bytes and the versioned importer.

The v0.2.0 verbose index is retained as the canonical interchange model. A full
real-corpus diagnostic produced 331,903 lexical records and roughly 314 MB of
minified JSON. Packaging that representation directly would be needlessly
large. v0.3.0 therefore adds `RuntimeLexicalIndex/v1`, which stores shared
dataset metadata once and compact lookup tuples with an integrity hash.

### 3.2 Corpus identity, syntax identity, and retrieval transport are separate

Princeton WordNet is pinned to release 3.0. Its upstream archive identity and
SHA-256 are recorded independently of the hashes for the extracted dictionary
and morphology files.

CC-CEDICT is pinned to the verified MDBG release dated
`2026-08-24T05:05:01Z`, with 124,925 entries, and to **Version 1 edition / V1
syntax** (`version=1`, `subversion=0`, `format=ts`). The release date is not the
format version. Because MDBG explicitly prohibits scripted downloads, retrieval
uses a pinned public transport mirror commit whose file header and SHA-256 are
verified against the official release identity. The acquisition receipt names
MDBG/CC-CEDICT as upstream and the mirror only as transport.

No NTU Chinese WordNet or other redistribution-incompatible corpus is used.

### 3.3 Extension-local semantic service

The Manifest V3 service worker owns runtime dictionary initialization and text
annotation. It reads only the packaged runtime index through an extension URL,
validates its payload hash, and constructs a provider-agnostic
`DictionaryProvider`.

The content script sends text-node strings through extension-local message
passing and receives `AnnotationSet` values. No message leaves the installed
extension. The content script owns DOM selection, RenderPlan application, and
reversal; it does not infer or mutate semantics.

This design avoids exposing the dictionary as a web-accessible resource,
requires no host permission beyond the existing explicit `activeTab` flow, and
keeps importer formats out of the renderer.

### 3.4 Fail-soft provider chain

Runtime provider selection is:

```text
verified packaged RuntimeLexicalIndex
  -> bootstrap DictionaryProvider fallback
  -> unknown annotation
```

Missing files, JSON errors, schema errors, or hash mismatches make the packaged
provider unavailable. They never disable the bootstrap provider or reversible
rendering. A corrupted index is not partially trusted.

## 4. Versioned semantic contracts

### 4.1 SemanticAnnotation/v1

Every annotation has:

- `type`;
- schema-valid `value`;
- `confidence` in `[0, 1]`;
- `source` and `provider`;
- `algorithm.id` and `algorithm.version`;
- optional `datasetRef` with dataset ID and release version;
- `generatedAt` as an ISO-8601 timestamp or deterministic equivalent supplied
  by the annotation run;
- zero or more provenance record references.

Absence means “not established.” The contract never fills missing knowledge
with a UI default.

### 4.2 SemanticToken/v1

Each token contains:

- `surface`, `normalizedSurface`, `language`, `start`, and `end`;
- optional `lemma`, `simplifiedPos`, `morphology`, `grammarRole`, and
  `tenseAspect`;
- `glossRefs[]` and `lexicalRefs[]`;
- token-level `confidence`, `provenance[]`, and `priority`;
- `annotations[]` containing the evidence for derived fields.

`language` is canonicalized to `en` or `zh-Hant`. Unknown tokens remain tokens
with `simplifiedPos: "x"` or without an optional analysis. Low confidence is
preserved.

### 4.3 AnnotationSet/v1

An annotation set records:

- version, language mode, original text length, deterministic run identity,
  algorithm version, and generation time;
- provider/dataset provenance;
- ordered non-overlapping SemanticTokens;
- diagnostics, including fallback activation and unavailable capabilities.

Semantic values are deep-frozen at the engine boundary in the reference
runtime. Projection functions are pure and must pass immutability regression
tests.

### 4.4 MarkingProfile/v2

The profile has independent boolean channels for:

- POS label;
- POS color;
- lemma;
- morphology;
- gloss hint;
- grammar role;
- tense/aspect;
- chunk/structure;
- learning state.

Learning-state projection is declared unavailable and defaults off in v0.3.0.
No synthetic learning state is generated. POS color is effective only when a
non-color semantic carrier (currently POS label) is visible.

## 5. Runtime lexical index

`RuntimeLexicalIndex/v1` contains:

- schema version, builder version, deterministic build time, and locale set;
- compact dataset manifests, license records, source hashes, and build receipt
  references;
- a stable gloss table;
- English lookup rows keyed by normalized surface, retaining lemma, simplified
  POS, confidence, lexical record reference, gloss reference, and dataset
  reference;
- English exception morphology keyed by inflected form;
- Traditional-Chinese rows keyed by Traditional surface, retaining Simplified
  counterpart, conservative POS evidence, pinyin evidence, lexical/gloss
  references, and dataset reference;
- longest-match metadata;
- SHA-256 over a canonical serialization of the payload.

The loader recomputes the hash before constructing indexes. Duplicate lexical
senses remain available as candidates; selection is deterministic by
confidence, POS stability, and lexical-record ID.

## 6. Semantic analysis

### 6.1 English

Tokenization accepts alphabetic words and internal apostrophes. Lookup order is:

1. normalized surface in the verified runtime provider;
2. WordNet exception morphology;
3. conservative regular morphology candidates;
4. closed-class/bootstrap provider;
5. unknown.

The selected analysis retains all candidate evidence used. Regular morphology
is accepted only when the resulting lemma exists in the provider. Morphology
features cover bounded forms such as plural, third-person singular, past,
past-participle, present-participle, comparative, and superlative. A suffix is
not sufficient on its own to assert a known POS.

### 6.2 Traditional Chinese

Segmentation scans left to right and chooses the longest verified Traditional
surface at each Han position. Equal-length candidates are ordered by stable
lexical ID. If the verified provider has no match, the bootstrap provider is
tried; otherwise one Han character becomes an unknown token. The algorithm is
deterministic for a fixed provider.

CC-CEDICT is not treated as a high-accuracy POS corpus. Only explicit or narrowly
derived POS evidence is retained, at its original conservative confidence.
Traditional and Simplified forms are lexical facts, not display rewrites.

### 6.3 Bounded grammar layer

Grammar annotations are local deterministic rules over established tokens. The
first gate includes only patterns with explicit fixtures, such as:

- an English nominal/pronoun before a finite predicate as candidate subject;
- a verified finite verb or auxiliary chain as predicate;
- a following nominal as candidate object;
- bounded English tense/aspect evidence from auxiliaries and morphology;
- transparent chunk ranges derived from those established patterns.

The rules emit confidence and algorithm provenance. They omit a value when a
fixture-backed rule does not apply. Chinese grammar-role and tense/aspect
channels remain unavailable unless a conservative rule is explicitly tested.

## 7. Projection and reversible rendering

The projection step reads SemanticTokens and MarkingProfile/v2 and emits a
RenderPlan. It may select density and visual placement, but it may not alter,
backfill, or normalize semantic fields.

With all channels off, every plan item is unmarked and the DOM receives zero
semantic decoration while the AnnotationSet remains intact. Changing density,
label position, color, or enabled channels must leave a serialized SemanticToken
byte-for-byte unchanged.

Renderer spans store only the original page substring and projection metadata
needed for reversal. Removing spans restores text nodes and normalizes their
parents. Renderer data attributes are not read back as semantic evidence.

## 8. Quality harness

Hand-annotated English and Traditional-Chinese fixtures are stored as versioned
test data. The harness reports:

- English simplified-POS macro-F1;
- Traditional-Chinese simplified-POS macro-F1 over tokens whose gold POS is
  established;
- Chinese segmentation boundary precision, recall, and F1;
- fixture and token counts;
- exact token offsets, lemma, morphology, lexical lookup, unknown handling,
  confidence, channel selection, and semantic/projection separation checks.

Macro-F1 is the unweighted mean of per-class F1 values over gold classes. The
release gate requires `>= 0.90` for the workbook’s simplified-POS fixture gate.
Metrics describe only the checked fixtures and are not a production NLP
accuracy claim.

## 9. Validation and packaging

The v0.3.0 validator runs:

1. source and contract tests;
2. corpus header, license, provenance, and SHA-256 validation;
3. deterministic runtime-index rebuild and hash comparison;
4. quality harness and metric thresholds;
5. extension syntax, local-only policy, provider fallback, projection, and DOM
   regression checks;
6. package content and manifest checks;
7. development hygiene when inside a Git worktree;
8. standalone source audit when `.git` is absent.

`git diff --check` and cleanliness are development gates. A source package has
no `.git`; its validator instead checks source files for conflict markers,
trailing whitespace, prohibited remote code, and missing required artifacts.
An extracted standalone package must obtain a normal exit 0 without Git.

## 10. Security and privacy properties

- all corpora and inference execute locally;
- no remote model, analytics, advertising, login, or telemetry is added;
- no token, cookie, password, browser history, or form value is read;
- skipped DOM categories from v0.1.0 remain skipped;
- no model-generated HTML or script exists;
- all generated DOM nodes use `textContent`;
- provider data is schema-validated and integrity-checked before use;
- remote failure cannot occur in the core path because the runtime performs no
  remote request;
- importer/source representations do not enter the renderer.

## 11. Compatibility and migrations

v0.1/v0.2 settings are migrated explicitly to MarkingProfile/v2. Existing
language, density, confidence, label position, POS-label, and POS-color choices
are preserved. New channels receive documented defaults. Legacy SemanticToken
fixtures can be migrated through a one-way adapter for validation, but canonical
runtime output is v1 and is never inferred from renderer artifacts.

No database migration is required in v0.3.0. The profile schema migration is a
versioned pure function and is covered by idempotence tests.

## 12. Known design limits

- The semantic engine is a deterministic fixture-backed baseline, not a claim of
  production-grade disambiguation or parsing accuracy.
- WordNet and CC-CEDICT provide lexical candidates, not full contextual word
  sense disambiguation.
- CC-CEDICT POS information is intentionally sparse and conservative.
- The packaged runtime index increases extension size; v0.3.0 prioritizes
  reproducibility and local availability over later sharding optimizations.
- Full cross-site browser E2E remains evidence to collect in the browser-runtime
  release; automated DOM/runtime regression remains blocking here.
