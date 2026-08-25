# Princeton WordNet 3.0 — v0.2.0 source review

**Decision:** selected as the English importer target; upstream data is not bundled.

## Evidence

- Project and download entry point: https://wordnet.princeton.edu/
- Official WordNet 3.0 license: https://wordnet.princeton.edu/documentation/wnlicens7wn
- Official `data.*` file format: https://wordnet.princeton.edu/documentation/wndb5wn
- License identifier: `WordNet`.
- Review date: 2026-08-25.

The official license allows use, copy, modification, and distribution without fee or royalty. Redistribution requires the WordNet copyright, license statements, and disclaimer to remain on every copy, including modified copies. Princeton's name may not be used for advertising or publicity.

## Acquisition and provenance policy

1. The importer accepts only local, user-acquired WordNet 3.0 `data.noun`, `data.verb`, `data.adj`, and `data.adv` files.
2. The build records byte length and SHA-256 for every file before parsing.
3. The manifest pins version `3.0`, official source/format/license URLs, retrieval timestamp, and redistribution note.
4. Any hash mismatch fails closed; the existing bootstrap dictionary remains available.
5. This release contains only synthetic format fixtures and makes no claim about a full-corpus build.

## Parser boundary

The v0.2.0 importer reads the documented synset offset, synset type, hexadecimal word count, word/lexical ID pairs, and gloss. It does not interpret pointers or verb frames. Unsupported or malformed records are rejected with line evidence rather than silently guessed.
