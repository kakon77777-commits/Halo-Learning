# Halo Learning Basic Marking MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable Chrome/Chromium Basic MVP that marks English and Traditional-Chinese text with configurable POS labels, optional POS colors, deterministic density, local settings, and clean provider seams for future dictionaries/AI.

**Architecture:** The extension keeps semantic analysis separate from visual projection. Pure shared modules produce `SemanticToken[]`; a projection module maps tokens plus `MarkingProfile` to a render plan; the content script only renders that plan into the current page. The Basic MVP uses no remote service and no bundled third-party dictionary corpus; future dictionaries enter through a stable provider/import interface.

**Tech Stack:** Manifest V3, dependency-free JavaScript (UMD modules so the same files run in Chrome and Node tests), Chrome `activeTab`/`scripting`/`storage`, Node 22 built-in test runner.

**Spec:** `docs/source/Halo_Learning_統一實作規格_Agent_Handoff_v0.1.md`

## Global Constraints

- Local-first; no page content is transmitted.
- Provider-agnostic core; no model SDK in semantic or marking modules.
- English and Traditional Chinese are the only Basic MVP target languages.
- Original page text must remain recoverable; removing marks restores text.
- POS color is optional and never the only semantic carrier.
- Default POS label position is top-right; position is configurable.
- Annotation density is configurable and deterministic for the same text/profile.
- Unknown/low-confidence tokens are not force-labeled as known parts of speech.
- No third-party dictionary dataset is bundled in v0.1.0; dictionary import/provider contracts are included.
- No hidden API, cookies, browsing history, analytics, cloud sync, login, billing, or remote code.

---

### Task 1: Semantic Core and Dictionary Provider Contract

**Files:**
- Create: `apps/extension/src/shared/linguistics.js`
- Create: `apps/extension/src/shared/dictionary-provider.js`
- Test: `tests/linguistics.test.js`

**Interfaces:**
- Produces: `HaloLinguistics.tokenize(text, languageMode) -> SemanticToken[]`
- Produces: `HaloLinguistics.analyzeEnglish(text)`, `HaloLinguistics.analyzeChinese(text)`
- Produces: `HaloDictionary.createDictionaryProvider(entries, meta)` and `provider.lookup(surface, lang)`
- `SemanticToken` fields: `text,start,end,lang,pos,confidence,source,priority`.

- [x] **Step 1: Write failing tests** for English function-word/POS recognition, English suffix heuristics, Chinese longest-match tokenization, preservation of whitespace/punctuation offsets, and unknown-token uncertainty.
- [x] **Step 2: Run** `node --test tests/linguistics.test.js` and verify failures are caused by missing modules/functions.
- [x] **Step 3: Implement minimal semantic core** with explicit English closed-class lexicons, small transparent Chinese bootstrap lexicon, conservative suffix heuristics, and no forced high-confidence guess for unknown words.
- [x] **Step 4: Run** `node --test tests/linguistics.test.js`; expected all Task-1 tests PASS.
- [x] **Step 5: Commit** semantic core and tests.

### Task 2: Projection Profile and Marking Plan

**Files:**
- Create: `apps/extension/src/shared/projection.js`
- Create: `apps/extension/src/shared/settings.js`
- Test: `tests/projection.test.js`

**Interfaces:**
- Consumes: `SemanticToken[]` from Task 1.
- Produces: `HaloProjection.createMarkingPlan(tokens, profile) -> RenderToken[]`.
- Produces: `HaloSettings.DEFAULT_SETTINGS`, `normalizeSettings(input)`.
- `RenderToken` includes original semantic token plus `marked`, `label`, `colorClass`, and `labelPosition`.

- [x] **Step 1: Write failing tests** for default top-right POS labels, label/color independent toggles, deterministic density, confidence threshold, language filtering, and valid settings normalization.
- [x] **Step 2: Run** `node --test tests/projection.test.js`; verify RED.
- [x] **Step 3: Implement minimal projection/settings modules**. Density selection must be deterministic and priority-aware; labels use text abbreviations and color is a secondary channel only.
- [x] **Step 4: Run** `node --test tests/projection.test.js`; expected PASS.
- [x] **Step 5: Commit** projection/settings and tests.

### Task 3: Browser Page Renderer and Reversible Marking

**Files:**
- Create: `apps/extension/src/content.js`
- Create: `apps/extension/src/content.css`
- Create: `apps/extension/test-fixtures/demo.html`
- Test: `tests/source-contract.test.js`

**Interfaces:**
- Consumes: `HaloLinguistics`, `HaloProjection`, normalized settings.
- Produces page message handlers: `HALO_APPLY_MARKING`, `HALO_REMOVE_MARKING`, `HALO_STATUS`.
- DOM contract: generated spans use `data-halo-token="1"` and preserve `data-halo-original` text.

- [x] **Step 1: Write failing source-contract tests** asserting that renderer code defines reversible mark/remove handlers, skips dangerous/editable elements, imposes node/token budgets, and uses CSS pseudo-labels rather than replacing the visible word with a label.
- [x] **Step 2: Run** `node --test tests/source-contract.test.js`; verify RED.
- [x] **Step 3: Implement renderer** using a TreeWalker over eligible visible text nodes, replace only selected token ranges, add absolute POS labels without layout-height allocation, and restore all wrappers on remove.
- [x] **Step 4: Run** source-contract tests and full `node --test tests/*.test.js`; expected PASS.
- [x] **Step 5: Commit** renderer, CSS, fixture and tests.

### Task 4: Manifest, Popup Controls, Local Settings and Release Bundle

**Files:**
- Create: `apps/extension/manifest.json`
- Create: `apps/extension/src/popup.html`
- Create: `apps/extension/src/popup.css`
- Create: `apps/extension/src/popup.js`
- Create: `apps/extension/README.md`
- Create: `README.md`
- Create: `docs/MNVP_INTEGRATION_NOTES.md`
- Test: extend `tests/source-contract.test.js`

**Interfaces:**
- Popup writes only normalized settings to `chrome.storage.local` key `haloSettings`.
- Apply injects shared semantic/profile files plus `content.js`, inserts `content.css`, then sends `HALO_APPLY_MARKING`.
- Remove sends `HALO_REMOVE_MARKING`.

- [x] **Step 1: Extend failing tests** for MV3 manifest, minimum permissions (`activeTab`,`scripting`,`storage`), no host permissions, no remote scripts, popup controls for labels/colors/density/language/position, and packaging paths.
- [x] **Step 2: Run** source-contract test; verify RED.
- [x] **Step 3: Implement popup/manifest/docs** with bilingual concise UI and local-only behavior.
- [x] **Step 4: Run** `node --test tests/*.test.js`, JSON-parse manifest, and scan for `http://`/`https://` in executable extension source; expected PASS and zero remote executable dependencies.
- [x] **Step 5: Package** `dist/halo-learning-magic-hand-basic-v0.1.0.zip` with `manifest.json` at archive root; create outer bundle containing extension source, tests, docs and dist ZIP.
- [x] **Step 6: Commit** release candidate.

## Self-Review

- Spec coverage intentionally targets only the Basic Marking slice of the larger Halo Learning system. Learner projection, Gap Planner, Halo Story, remote AI/NLP, full IndexedDB event sourcing, billing, and production dictionary ingestion remain outside this plan, but their future seams are not blocked.
- No placeholder implementation steps are required for this slice.
- Type names are consistent across tasks: `SemanticToken`, `MarkingProfile`, `RenderToken`, and `haloSettings`.
