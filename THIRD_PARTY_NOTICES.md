# Third-Party Data Notices — Halo Learning v0.3.0

Halo Learning v0.3.0 bundles the verified lexical datasets below to provide a
fully local, reproducible English and Traditional-Chinese semantic baseline.
Generated runtime projections retain dataset and record references. No corpus
is uploaded or fetched at runtime.

## Princeton WordNet 3.0

- Copyright: WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved.
- Source release: https://wordnetcode.princeton.edu/3.0/
- Format: https://wordnet.princeton.edu/documentation/wndb5wn
- License: WordNet 3.0 License, https://wordnet.princeton.edu/documentation/wnlicens7wn
- Upstream archive SHA-256: `640db279c949a88f61f851dd54ebbb22d003f8b90b85267042ef85a3781d3a52`.
- Bundled upstream license: `data/corpora/princeton-wordnet-3.0/LICENSE`; the extension package carries the same complete text as `LICENSES/WordNet-3.0.txt`.

Permission is granted by the upstream license to use, copy, modify, and
distribute the software/database without fee or royalty, provided the complete
copyright, license, and disclaimer are preserved on all copies and
modifications. Princeton's name may not be used for advertising or publicity.

## CC-CEDICT — MDBG verified release 2026-08-24T05:05:01Z

- Project/publisher: CC-CEDICT / MDBG.
- Official verified-release page: https://www.mdbg.net/chinese/dictionary?page=cc-cedict
- Project download page: https://cc-cedict.org/editor/editor.php?handler=Download
- Format: Version 1 edition (`CC-CEDICT-V1`), https://cc-cedict.org/wiki/syntax
- License: Creative Commons Attribution-ShareAlike 4.0 International,
  https://creativecommons.org/licenses/by-sa/4.0/
- Dataset file SHA-256: `27b881871e6ca5cacbc376e5b0fd0d60187e8940f9e6b2b7ac83d3c1f05bf5d4`.
- Embedded upstream attribution includes CEDICT copyright (C) 1997, 1998 Paul Andrew Denisowski.

Attribution: this product contains data from CC-CEDICT, published by MDBG and
maintained by the CC-CEDICT community. The bundled snapshot is redistributed
under CC BY-SA 4.0. Halo Learning converts the source into a compact lexical
runtime projection; that adaptation remains under the same license. Source
provenance and modification/build receipts are retained in the release.

## Synthetic fixtures

The following authored fixtures contain no copied dictionary definitions:

- `fixtures/lexical/wordnet-3.0-synthetic/`;
- `fixtures/lexical/cc-cedict-synthetic/`.

Their manifests identify `LicenseRef-Halo-Synthetic-Fixture`. They remain useful
for small failure-path tests but are not the v0.3.0 runtime corpus.
