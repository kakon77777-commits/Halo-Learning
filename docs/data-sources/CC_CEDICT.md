# CC-CEDICT — v0.2.0 Traditional Chinese source review

**Decision:** selected as the `zh-Hant` importer target; upstream data is not bundled.

## Evidence

- Official project download page: https://cc-cedict.org/editor/editor.php?handler=Download
- Format documentation: https://cc-cedict.org/wiki/syntax
- Review date: 2026-08-25.

The current download page identifies the work as CC BY-SA 4.0 and permits commercial use with attribution and share-alike obligations. An older project wiki page still identifies CC BY-SA 3.0. Therefore Halo Learning does not infer a license from the dataset name alone: acquisition must capture the license notice accompanying the exact release and store it in `LicenseRecord`.

## Traditional Chinese and POS boundary

- The importer uses the explicit Traditional headword as the canonical `zh-Hant` surface.
- The Simplified headword remains source provenance and is not indexed as Traditional Chinese.
- CC-CEDICT's own format guidance says it does not supply parts of speech as structured corpus truth.
- A small, transparent gloss-cue heuristic may derive low-confidence POS (for example, a gloss beginning with `to ` can suggest a verb). Every derived POS carries `derived:cc-cedict-gloss-cues-v1`; ambiguous cases remain `x`.
- This derived POS is not a production NLP-accuracy claim and cannot overwrite source fields.

## Acquisition and provenance policy

1. Use the verified release linked by the official download page, not the non-verified editor snapshot.
2. Capture release timestamp/version, license notice, URL, byte length, and SHA-256.
3. Reject unsupported or malformed lines with line evidence.
4. Do not package the full corpus until the exact snapshot, hash, attribution, and share-alike release obligations have been reviewed for that artifact.
