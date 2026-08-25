# Third-Party Data Notices — Halo Learning v0.2.0

Halo Learning v0.2.0 includes importer support for the data sources below. The release artifact does **not** bundle upstream Princeton WordNet or CC-CEDICT corpus bytes. It bundles only small synthetic records authored for format, integrity, and fallback tests.

## Princeton WordNet 3.0 importer target

- Project: Princeton WordNet
- Source: https://wordnet.princeton.edu/
- Format: https://wordnet.princeton.edu/documentation/wndb5wn
- License: WordNet License, https://wordnet.princeton.edu/documentation/wnlicens7wn

If a user supplies WordNet data to the local build tool, the exact input bytes, version, license record, file hashes, and redistribution note must be present in its `DatasetManifest`. The build tool does not download or redistribute that source.

## CC-CEDICT Traditional Chinese importer target

- Project: CC-CEDICT / MDBG
- Verified release entry point: https://cc-cedict.org/editor/editor.php?handler=Download
- Format: https://cc-cedict.org/wiki/syntax
- License: capture the license notice shipped with the exact acquired release; the download page reviewed on 2026-08-25 identifies CC BY-SA 4.0.

If a user supplies CC-CEDICT data to the local build tool, attribution and share-alike obligations remain attached to the generated data. The exact release license and SHA-256 must be recorded before import. The build tool uses only the Traditional headword as a `zh-Hant` lookup surface.

## Synthetic fixtures

Files below are authored test data and contain no copied dictionary definitions:

- `fixtures/lexical/wordnet-3.0-synthetic/`
- `fixtures/lexical/cc-cedict-synthetic/`

Their manifests identify `LicenseRef-Halo-Synthetic-Fixture`, byte lengths, and SHA-256 values. Synthetic fixture coverage does not establish full-corpus performance or linguistic accuracy.
