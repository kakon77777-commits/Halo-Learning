'use strict';

const { normalizeLexicalEntry } = require('../../contracts/lexical-contracts');
const { verifyInputFiles } = require('../shared/build-utils');

const IMPORTER = Object.freeze({ id: 'halo-wordnet-data-importer', version: '1.1.0' });
const POS_BY_SYNSET_TYPE = Object.freeze({ n: 'n', v: 'v', a: 'adj', s: 'adj', r: 'adv' });
const POS_BY_EXCEPTION_ROLE = Object.freeze({
  'noun-exceptions': 'n',
  'verb-exceptions': 'v',
  'adjective-exceptions': 'adj',
  'adverb-exceptions': 'adv'
});

function reject(path, lineNumber, code, offset) {
  return Object.freeze({
    path,
    lineNumber,
    code,
    recordRef: offset ? `${path}:${offset}` : `${path}:${lineNumber}`
  });
}

function parseCoreRecord(rawLine, path, lineNumber) {
  const separator = rawLine.indexOf('|');
  if (separator < 0) return { rejected: reject(path, lineNumber, 'MALFORMED_CORE_FIELDS') };
  const fields = rawLine.slice(0, separator).trim().split(/\s+/);
  const gloss = rawLine.slice(separator + 1).trim();
  if (fields.length < 5 || !/^\d{8}$/.test(fields[0]) || !/^\d{2}$/.test(fields[1])) {
    return { rejected: reject(path, lineNumber, 'MALFORMED_CORE_FIELDS') };
  }

  const offset = fields[0];
  const synsetType = fields[2];
  if (!Object.hasOwn(POS_BY_SYNSET_TYPE, synsetType)) {
    return { rejected: reject(path, lineNumber, 'UNSUPPORTED_SYNSET_TYPE', offset) };
  }
  if (!/^[0-9a-fA-F]{2}$/.test(fields[3])) {
    return { rejected: reject(path, lineNumber, 'MALFORMED_WORD_COUNT', offset) };
  }
  const wordCount = Number.parseInt(fields[3], 16);
  if (wordCount < 1 || fields.length < 4 + (wordCount * 2) + 1 || !gloss) {
    return { rejected: reject(path, lineNumber, 'MALFORMED_CORE_FIELDS', offset) };
  }

  const words = [];
  for (let index = 0; index < wordCount; index += 1) {
    const word = fields[4 + (index * 2)];
    const lexicalId = fields[5 + (index * 2)];
    if (!word || !/^[0-9a-fA-F]{1,2}$/.test(lexicalId)) {
      return { rejected: reject(path, lineNumber, 'MALFORMED_WORD_FIELDS', offset) };
    }
    words.push(word);
  }

  const pointerCountIndex = 4 + (wordCount * 2);
  const pointerCountField = fields[pointerCountIndex];
  if (!/^\d{3}$/.test(pointerCountField)) {
    return { rejected: reject(path, lineNumber, 'MALFORMED_POINTER_COUNT', offset) };
  }
  const pointerCount = Number.parseInt(pointerCountField, 10);
  if (fields.length < pointerCountIndex + 1 + (pointerCount * 4)) {
    return { rejected: reject(path, lineNumber, 'TRUNCATED_POINTER_FIELDS', offset) };
  }

  return { offset, synsetType, words, gloss };
}

function entryFromWord(word, wordIndex, record, context) {
  const withoutMarker = word.replace(/\((?:a|p|ip)\)$/i, '');
  const surface = withoutMarker.replaceAll('_', ' ');
  const fieldRef = `source:${context.path}:${context.lineNumber}`;
  const transformations = ['wordnet-ss-type-map:v1'];
  if (withoutMarker !== word) transformations.push('wordnet-adjective-marker-strip:v1');
  if (surface !== withoutMarker) transformations.push('wordnet-underscores-to-spaces:v1');
  return normalizeLexicalEntry({
    schemaVersion: 1,
    entryId: `${context.manifest.datasetId}:${context.manifest.version}:${context.path}:${record.offset}:${wordIndex}`,
    locale: 'en',
    surface,
    normalizedSurface: surface.toLocaleLowerCase('en-US'),
    lemma: surface,
    pos: POS_BY_SYNSET_TYPE[record.synsetType],
    posConfidence: 1,
    glosses: [{
      text: record.gloss,
      locale: 'en',
      ref: `${context.path}:${context.lineNumber}#gloss`
    }],
    glossRefs: [`${context.path}:${context.lineNumber}#gloss`],
    aliases: [],
    source: {
      datasetId: context.manifest.datasetId,
      version: context.manifest.version,
      recordRef: `${context.path}:${record.offset}`,
      lineNumber: context.lineNumber
    },
    provenance: {
      fieldOrigins: {
        surface: `${fieldRef}:word[${wordIndex}]`,
        lemma: `${fieldRef}:word[${wordIndex}]`,
        pos: `${fieldRef}:ss_type`,
        glosses: `${fieldRef}:gloss`
      },
      transformations
    }
  });
}

function parseExceptionFile(file, manifest, rejected) {
  const pos = POS_BY_EXCEPTION_ROLE[file.role];
  const records = [];
  const lines = file.content.toString('utf8').split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex].trim();
    const lineNumber = lineIndex + 1;
    if (!rawLine) continue;
    const fields = rawLine.split(/\s+/).map((field) => field.replaceAll('_', ' '));
    if (fields.length < 2 || fields.some((field) => !field)) {
      rejected.push(reject(file.path, lineNumber, 'MALFORMED_EXCEPTION_RECORD'));
      continue;
    }
    records.push(Object.freeze({
      inflected: fields[0].toLocaleLowerCase('en-US'),
      lemmas: Object.freeze(fields.slice(1).map((lemma) => lemma.toLocaleLowerCase('en-US'))),
      pos,
      source: Object.freeze({
        datasetId: manifest.datasetId,
        version: manifest.version,
        recordRef: `${file.path}:${lineNumber}`,
        lineNumber
      })
    }));
  }
  return records;
}

function compareEntries(left, right) {
  return left.normalizedSurface.localeCompare(right.normalizedSurface, 'en') ||
    left.pos.localeCompare(right.pos) || left.entryId.localeCompare(right.entryId);
}

function importWordNetFiles(files, manifestValue) {
  const verified = verifyInputFiles(files, manifestValue);
  if (verified.manifest.locale !== 'en') throw new TypeError('manifest.locale: WordNet importer requires en');
  const entries = [];
  const rejected = [];
  const morphologyExceptions = [];

  for (const file of verified.files) {
    if (file.role === 'license') continue;
    if (Object.hasOwn(POS_BY_EXCEPTION_ROLE, file.role)) {
      morphologyExceptions.push(...parseExceptionFile(file, verified.manifest, rejected));
      continue;
    }
    const lines = file.content.toString('utf8').split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const rawLine = lines[lineIndex];
      const lineNumber = lineIndex + 1;
      if (!rawLine.trim() || /^\s/.test(rawLine)) continue;
      const parsed = parseCoreRecord(rawLine, file.path, lineNumber);
      if (parsed.rejected) {
        rejected.push(parsed.rejected);
        continue;
      }
      parsed.words.forEach((word, wordIndex) => {
        entries.push(entryFromWord(word, wordIndex, parsed, {
          path: file.path,
          lineNumber,
          manifest: verified.manifest
        }));
      });
    }
  }

  entries.sort(compareEntries);
  rejected.sort((left, right) => left.path.localeCompare(right.path) || left.lineNumber - right.lineNumber);
  morphologyExceptions.sort((left, right) => left.inflected.localeCompare(right.inflected, 'en') ||
    left.pos.localeCompare(right.pos) || left.source.recordRef.localeCompare(right.source.recordRef));
  const receiptDraft = Object.freeze({
    datasetId: verified.manifest.datasetId,
    datasetVersion: verified.manifest.version,
    importer: IMPORTER,
    inputHash: Object.freeze({ algorithm: 'sha256', value: verified.hash }),
    entryCount: entries.length,
    rejectedCount: rejected.length,
    canonicalOrder: true
  });
  return Object.freeze({
    entries: Object.freeze(entries),
    rejected: Object.freeze(rejected),
    morphologyExceptions: Object.freeze(morphologyExceptions),
    receiptDraft
  });
}

module.exports = Object.freeze({ IMPORTER, importWordNetFiles });
