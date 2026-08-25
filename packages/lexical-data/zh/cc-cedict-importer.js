'use strict';

const { normalizeLexicalEntry } = require('../../contracts/lexical-contracts');
const { canonicalJson, verifyInputFiles } = require('../shared/build-utils');

const IMPORTER = Object.freeze({ id: 'halo-cc-cedict-importer', version: '1.0.0' });
const DERIVATION_ID = 'derived:cc-cedict-gloss-cues-v1';

function deriveCcCedictPos(glosses) {
  if (!Array.isArray(glosses) || glosses.length === 0 || glosses.some((gloss) => typeof gloss !== 'string' || !gloss.trim())) {
    throw new TypeError('glosses: must be a non-empty array of non-empty strings');
  }
  const allVerbInfinitives = glosses.every((gloss) => /^to(?:\s|$)/i.test(gloss.trim()));
  return Object.freeze({
    pos: allVerbInfinitives ? 'v' : 'x',
    confidence: allVerbInfinitives ? 0.55 : 0,
    derivationId: DERIVATION_ID
  });
}

function rejected(path, lineNumber, code) {
  return Object.freeze({ path, lineNumber, code, recordRef: `${path}:${lineNumber}` });
}

function parseRecord(rawLine, path, lineNumber) {
  const match = /^(\S+)\s+(\S+)\s+\[([^\[\]]+)\]\s+\/(.*)\/$/.exec(rawLine);
  if (!match) return { rejected: rejected(path, lineNumber, 'MALFORMED_RECORD') };
  const traditional = match[1].normalize('NFC');
  const simplified = match[2].normalize('NFC');
  const pinyin = match[3].trim();
  const glosses = match[4].split('/').map((gloss) => gloss.trim());
  if (!traditional || !simplified || !pinyin || glosses.some((gloss) => !gloss)) {
    return { rejected: rejected(path, lineNumber, 'MALFORMED_RECORD') };
  }
  return { traditional, simplified, pinyin, glosses };
}

function entryFromRecord(record, context) {
  const pos = deriveCcCedictPos(record.glosses);
  const sourceRef = `source:${context.path}:${context.lineNumber}`;
  return normalizeLexicalEntry({
    schemaVersion: 1,
    entryId: `${context.manifest.datasetId}:${context.manifest.version}:${context.path}:${context.lineNumber}`,
    locale: 'zh-Hant',
    surface: record.traditional,
    normalizedSurface: record.traditional,
    lemma: record.traditional,
    pos: pos.pos,
    posConfidence: pos.confidence,
    glosses: record.glosses.map((gloss, index) => ({
      text: gloss,
      locale: 'en',
      ref: `${context.path}:${context.lineNumber}#gloss[${index}]`
    })),
    glossRefs: record.glosses.map((_gloss, index) => `${context.path}:${context.lineNumber}#gloss[${index}]`),
    aliases: [],
    source: {
      datasetId: context.manifest.datasetId,
      version: context.manifest.version,
      recordRef: `${context.path}:${context.lineNumber}`,
      lineNumber: context.lineNumber,
      recordData: {
        traditional: record.traditional,
        simplified: record.simplified,
        pinyin: record.pinyin
      }
    },
    provenance: {
      fieldOrigins: {
        surface: `${sourceRef}:traditional`,
        lemma: `${sourceRef}:traditional`,
        pos: pos.derivationId,
        glosses: `${sourceRef}:glosses`,
        pinyin: `${sourceRef}:pinyin`,
        simplified: `${sourceRef}:simplified`
      },
      transformations: [
        'cc-cedict-traditional-field:v1',
        pos.derivationId
      ]
    }
  });
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function importCcCedict(text, manifestValue) {
  if (typeof text !== 'string' && !Buffer.isBuffer(text)) {
    throw new TypeError('text: must be a string or Buffer');
  }
  if (!manifestValue || !Array.isArray(manifestValue.files) || manifestValue.files.length !== 1) {
    throw new TypeError('manifest.files: CC-CEDICT importer requires exactly one file');
  }
  const descriptor = manifestValue.files[0];
  const verified = verifyInputFiles([{
    role: descriptor.role,
    path: descriptor.path,
    content: text
  }], manifestValue);
  if (verified.manifest.locale !== 'zh-Hant') {
    throw new TypeError('manifest.locale: CC-CEDICT importer requires zh-Hant');
  }

  const path = verified.files[0].path;
  const entries = [];
  const rejections = [];
  const seen = new Set();
  let maxSurfaceLength = 0;
  const lines = verified.files[0].content.toString('utf8').split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex].trim();
    const lineNumber = lineIndex + 1;
    if (!rawLine || rawLine.startsWith('#')) continue;
    const parsed = parseRecord(rawLine, path, lineNumber);
    if (parsed.rejected) {
      rejections.push(parsed.rejected);
      continue;
    }
    const duplicateKey = canonicalJson({
      traditional: parsed.traditional,
      simplified: parsed.simplified,
      pinyin: parsed.pinyin,
      glosses: parsed.glosses
    });
    if (seen.has(duplicateKey)) {
      rejections.push(rejected(path, lineNumber, 'DUPLICATE_RECORD'));
      continue;
    }
    seen.add(duplicateKey);
    entries.push(entryFromRecord(parsed, {
      path,
      lineNumber,
      manifest: verified.manifest
    }));
    maxSurfaceLength = Math.max(maxSurfaceLength, [...parsed.traditional].length);
  }

  entries.sort((left, right) => compareUtf8(left.normalizedSurface, right.normalizedSurface) ||
    compareUtf8(left.entryId, right.entryId));
  rejections.sort((left, right) => left.lineNumber - right.lineNumber);
  return Object.freeze({
    entries: Object.freeze(entries),
    rejected: Object.freeze(rejections),
    maxSurfaceLength,
    receiptDraft: Object.freeze({
      datasetId: verified.manifest.datasetId,
      datasetVersion: verified.manifest.version,
      importer: IMPORTER,
      inputHash: Object.freeze({ algorithm: 'sha256', value: verified.hash }),
      entryCount: entries.length,
      rejectedCount: rejections.length,
      canonicalOrder: true
    })
  });
}

module.exports = Object.freeze({
  IMPORTER,
  DERIVATION_ID,
  deriveCcCedictPos,
  importCcCedict
});
