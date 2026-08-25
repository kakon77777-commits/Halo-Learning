# Princeton WordNet 3.0 — v0.3.0 activated source

**Decision:** selected, hash-verified, and bundled as the English lexical build
input for Halo Learning v0.3.0.

## Upstream and license evidence

- Dataset: Princeton WordNet 3.0.
- Upstream version: `3.0`.
- Release identity: `Princeton-WordNet-3.0`.
- Database format identity: `WordNet-database-files-3.0`.
- Official release index: https://wordnetcode.princeton.edu/3.0/
- Official archive: https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz
- Official database format: https://wordnet.princeton.edu/documentation/wndb5wn
- Official license: https://wordnet.princeton.edu/documentation/wnlicens7wn
- Archive SHA-256: `640db279c949a88f61f851dd54ebbb22d003f8b90b85267042ef85a3781d3a52`.
- Archive bytes: `11,537,239`.
- Review and retrieval date: 2026-08-25.

The official license permits use, copying, modification, and distribution
without fee or royalty. Every copy or modification must retain the WordNet
copyright, license, and disclaimer. Princeton University or Princeton may not
be used in advertising or publicity for the distribution.

The exact upstream `LICENSE` is bundled at
`data/corpora/princeton-wordnet-3.0/LICENSE` and is itself pinned by SHA-256.

## Activated bytes and provenance

The repository bundles the four `data.*` files, four morphology exception
files, and the upstream license. Their individual byte counts and SHA-256 values
are in:

- `data/corpora/princeton-wordnet-3.0/dataset-manifest.json`;
- `data/corpora/princeton-wordnet-3.0/acquisition-receipt.json`.

The aggregate descriptor hash is
`9c082f9c9d193e0458e89bc5a290757d2d9fec54c8bed54eb2f85ad588cf60a2`.
Build tooling rechecks every file before parsing; any mismatch fails closed and
does not disable the bootstrap dictionary.

## Parser boundary

Importer `halo-wordnet-data-importer@1.1.0` reads documented synset records,
maps WordNet synset types to Halo simplified POS, strips documented adjective
markers while recording the transformation, and imports `*.exc` morphology as
source-traceable evidence. Pointers, frames, and contextual word-sense
disambiguation are not asserted in this release.

The dataset is lexical evidence, not production-grade POS/parser accuracy.
