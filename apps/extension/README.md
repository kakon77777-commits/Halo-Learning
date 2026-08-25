# Halo Learning — Magic Hand Basic v0.2.0

A local-first Chrome/Chromium extension that adds configurable semantic POS annotations to English and Traditional-Chinese text already visible on the current page.

## Current browser slice

- English + Traditional Chinese token analysis.
- Compact POS labels, default position: top-right.
- Optional POS colors; color is never the only semantic carrier.
- Configurable density, language mode, and label position.
- Conservative confidence threshold: unknown words are not forced into a POS class.
- Click-scoped `activeTab` injection only; no host permissions.
- No server, account, analytics, cookies, browsing-history access, hidden API, or remote code.
- Remove restores the wrapped text nodes.

## Install locally

1. Extract the bundle.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select `apps/extension/` — the folder containing `manifest.json`.
6. Open a normal web page, click the extension, choose settings, then **Apply · 套用**.

Browser-internal pages such as `chrome://...` cannot be injected by extensions.

## v0.2.0 lexical boundary

The source release now includes verified lexical contracts, offline WordNet/CC-CEDICT importers, a deterministic index, and a fail-soft registry. The extension package itself continues to ship only the small transparent bootstrap lexicon, so it starts without a corpus and preserves the validated v0.1 browser behavior. It does **not** bundle a third-party dictionary corpus.

Example entry:

```json
{"surface":"orbit","lang":"en","pos":"n","gloss":"軌道"}
```

The v0.2.0 core index can add lemma, senses, gloss references, source-record evidence, and provenance without changing the page renderer. Wiring the full semantic annotation engine into browser marking belongs to v0.3.0; this release does not jump that boundary.

## Known limits

- English POS is a conservative local rule baseline, not a full parser.
- Chinese segmentation is longest-match over the bootstrap lexicon; unknown Han characters remain low-confidence.
- Dynamic pages need **Apply** again after large content changes in this Basic slice.
- Complex DOMs can still have site-specific rendering quirks; node and token budgets limit page impact.
- The browser package does not yet consume a full imported lexical index; v0.2.0 validates the provider boundary and fail-soft core path.
- Full IndexedDB event sourcing, learner mastery, Halo Story, remote high-precision NLP and AI explanation are deliberately deferred.
