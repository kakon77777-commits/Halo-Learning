# Halo Learning v0.2.0 — Validation Report

**Release:** Lexical Data Layer  
**Date:** 2026-08-25  
**Canonical gate:** `node scripts/validate-v0.2.0.js`

## Scope validated

- `DatasetManifest`, `LicenseRecord`, `LexicalEntry`, and `CorpusBuildReceipt` runtime contracts;
- English and Traditional-Chinese-only locale boundary;
- official source/license/format records and redistribution decisions;
- deterministic WordNet 3.0-format and CC-CEDICT-format importers;
- explicit malformed/duplicate record evidence;
- exact input-file and aggregate SHA-256 verification before parsing;
- stable local index bytes/hash, multi-sense lookup, Traditional longest-match, and tamper rejection;
- corpus-first dictionary registry with bootstrap fallback for missing/corrupt indexes;
- deterministic atomic fixture build, receipts, data manifest, and third-party notices;
- original v0.1.0 Basic Marking regression suite;
- Manifest V3 local-only extension package and ZIP-root/version boundary;
- workbook/Markdown status boundary: v0.2.0 complete, v0.3.0 untouched.

## Fresh automated evidence

The full test suite contains 53 tests. The release validator requires all 53 to pass with a normal exit, then executes additional artifact, security, benchmark, and status gates within the same command.

Fresh gate result on 2026-08-25: **PASS — normal exit 0; 53/53 tests; 10/10 release gates.** The gate checked 16 executable JavaScript files, reproduced the committed fixture artifacts byte-for-byte, verified two build receipts and nine accepted lexical entries, and audited the 0.2.0 extension ZIP at archive root.

Synthetic 20k index budget:

| Measure | Gate | Recorded evidence | Result |
|---|---:|---:|---|
| lookup p95 | `< 5 ms` | `docs/validation/v0.2.0-index-benchmark.json` | PASS |
| serialized bytes / entry | `<= 1024` | `docs/validation/v0.2.0-index-benchmark.json` | PASS |
| measured heap bytes / entry | `<= 8192` | `docs/validation/v0.2.0-index-benchmark.json` | PASS |

The benchmark is an engineering fixture, not a full-corpus production-performance or NLP-accuracy claim.

## Data and license boundary

Princeton WordNet 3.0 and a verified CC-CEDICT release are supported importer targets. Their source records preserve official URLs, version policy, license/redistribution conditions, and the requirement to hash exact acquired bytes. NTU Chinese Wordnet is explicitly excluded because its public terms are noncommercial and nonredistributable for this product boundary.

No upstream dictionary corpus bytes are bundled. The release contains only Halo Learning-authored synthetic format fixtures. Each synthetic file has source/version/license/byte length/SHA-256 evidence in its `DatasetManifest`, and the generated index has normalized build receipts.

## Security and privacy evidence

- no downloader or network call in contracts, importers, index, registry, or build path;
- no LLM/NLP provider SDK in the core domain;
- executable-source scan rejects remote URL literals and common private-key/API-key patterns;
- extension permissions remain `activeTab`, `scripting`, and `storage`, with no host permissions;
- index errors expose stable codes rather than corpus content or filesystem paths;
- corpus path traversal and partial-output publication fail closed;
- no token, cookie, password, history, analytics, account, remote API, or user-learning store was added.

## Release limitations

- Full upstream corpus builds were not performed or redistributed in this release.
- CC-CEDICT provides no structured POS truth; the importer records a low-confidence gloss-derived cue or `x`.
- The v0.2.0 extension package still uses the bootstrap dictionary; browser integration of the richer annotation layer is v0.3.0 scope.
- Complete cross-site browser E2E remains unclaimed.
- No production-grade POS/NLP accuracy claim is made.
