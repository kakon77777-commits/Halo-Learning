# Halo Learning — Magic Hand v0.3.0

This Chrome/Chromium Manifest V3 extension performs English and Traditional-Chinese semantic annotation locally, then renders only the visual channels selected in `MarkingProfile/v2`.

## Runtime flow

`visible page text → packaged verified lexical index → DictionaryProvider → AnnotationSet → MarkingProfile → reversible spans`

The background service worker loads `data/lexical-runtime-index.json` from the extension installation. If that file is missing, corrupt, or cannot be loaded, the provider degrades safely to the authored bootstrap lexicon. No WordNet or CC-CEDICT source format reaches the renderer.

## Controls

- language: English, Traditional Chinese, both, or auto;
- density and minimum confidence;
- label position;
- POS label and secondary POS color;
- lemma, morphology, gloss hint, grammar role, tense/aspect, and chunk channels;
- learning-state channel shown as unavailable and disabled in v0.3.0;
- Apply and Remove.

POS color cannot operate as the only POS carrier. With every visual channel off, semantic analysis remains available in memory while the page receives zero semantic decoration.

## Privacy and permissions

- permissions: `activeTab`, `scripting`, `storage`;
- no host permissions;
- no remote code, remote NLP, analytics, account, advertising, or page upload;
- no cookie, token, password, browsing-history, or form-value access;
- sensitive forms fail closed based on URL and attribute names;
- generated display text is assigned through safe DOM text APIs;
- Remove unwraps Halo spans and normalizes the original text nodes.

## Install unpacked

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select this `apps/extension/` directory.
5. Open a normal web page and use the Halo Learning popup.

Browser-internal pages such as `chrome://...` cannot be injected.

## Verified scope and limits

The package contains the compact projection of verified Princeton WordNet 3.0 and CC-CEDICT V1-edition data. `THIRD_PARTY_NOTICES.md` and the complete WordNet license under `LICENSES/` travel with the packaged extension; full source/provenance/build evidence remains in the repository source release.

The semantic engine is a deterministic baseline, not a production parser. English grammar coverage is intentionally bounded. CC-CEDICT is not a full POS corpus, so Traditional-Chinese POS supplementation is conservative and explicitly sourced. Dynamic-page lifecycle handling and broad cross-site browser E2E are v0.4.0 scope and are not claimed complete here.
