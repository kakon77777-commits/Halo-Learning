# CC-CEDICT — v0.3.0 activated Traditional-Chinese source

**Decision:** selected, hash-verified, and bundled as the `zh-Hant` lexical
build input for Halo Learning v0.3.0.

## Release identity and format pin

- Dataset: CC-CEDICT, published by MDBG and the CC-CEDICT community.
- Upstream release timestamp/version: `2026-08-24T05:05:01Z`.
- Release identity: `MDBG-2026-08-24T05:05:01Z-124925`.
- Entry count in the verified header: `124925`.
- Format identity: **`CC-CEDICT-V1`**.
- Header syntax: `version=1`, `subversion=0`, `format=ts`, `charset=UTF-8`.
- Official verified-release page: https://www.mdbg.net/chinese/dictionary?page=cc-cedict
- Official project download page: https://cc-cedict.org/editor/editor.php?handler=Download
- V1 syntax documentation: https://cc-cedict.org/wiki/syntax
- V2 syntax documentation: https://cc-cedict.org/wiki/syntax_v2
- File SHA-256: `27b881871e6ca5cacbc376e5b0fd0d60187e8940f9e6b2b7ac83d3c1f05bf5d4`.
- File bytes: `9,838,770`.
- Review and retrieval date: 2026-08-25.

The dataset release identity is deliberately separate from the format identity.
The v0.3.0 importer accepts the Version 1 edition and rejects V2 double-bracket
pinyin syntax. No unverified V2 parser is included.

## Retrieval transport

The official MDBG release page explicitly prohibits automated/scripted access.
Halo Learning therefore did not script-download from that page. The exact bytes
were retrieved from public mirror `rhcarvalho/cedict` at commit
`6514f6822e8dc582fb924a00e1afdf5bbc66fe62`, whose commit identity, file header,
release timestamp, entry count, license notice, size, and SHA-256 match the
official release evidence.

The mirror is recorded only as retrieval transport. It does not replace MDBG /
CC-CEDICT as the canonical upstream source.

## License and redistribution

The pinned file header and verified download page identify Creative Commons
Attribution-ShareAlike 4.0 International (`CC-BY-SA-4.0`). Commercial use is
allowed. Redistribution requires attribution, a license link, indication of
changes, and share-alike licensing for adaptations.

The exact manifest and acquisition receipt are:

- `data/corpora/cc-cedict-v1-2026-08-24/dataset-manifest.json`;
- `data/corpora/cc-cedict-v1-2026-08-24/acquisition-receipt.json`.

## Semantic boundary

- Traditional headwords are canonical `zh-Hant` lookup surfaces.
- Simplified headwords and pinyin remain source evidence and are not indexed as
  Traditional spellings.
- CC-CEDICT is not treated as a structured POS corpus.
- Importer `halo-cc-cedict-importer@1.1.0` emits `v` at confidence `0.55` only
  for the narrow, explicit all-infinitive gloss cue; otherwise POS remains `x`
  at confidence `0`.
- Every derived POS carries `derived:cc-cedict-gloss-cues-v1` provenance.

This is conservative lexical evidence, not a production NLP-accuracy claim.
