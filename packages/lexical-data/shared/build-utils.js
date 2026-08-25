'use strict';

const crypto = require('node:crypto');
const { normalizeDatasetManifest } = require('../../contracts/lexical-contracts');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const pairs = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${pairs.join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeInputFile(file, index) {
  if (!file || typeof file !== 'object' || Array.isArray(file)) {
    throw new TypeError(`files[${index}]: must be an object`);
  }
  if (typeof file.role !== 'string' || !file.role.trim()) {
    throw new TypeError(`files[${index}].role: must be a non-empty string`);
  }
  if (typeof file.path !== 'string' || !file.path.trim()) {
    throw new TypeError(`files[${index}].path: must be a non-empty string`);
  }
  if (typeof file.content !== 'string' && !Buffer.isBuffer(file.content)) {
    throw new TypeError(`files[${index}].content: must be a string or Buffer`);
  }
  return Object.freeze({
    role: file.role.trim(),
    path: file.path.trim(),
    content: Buffer.isBuffer(file.content) ? Buffer.from(file.content) : Buffer.from(file.content, 'utf8')
  });
}

function fingerprintInputFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw new TypeError('files: must be a non-empty array');
  const normalizedFiles = files.map(normalizeInputFile).sort((left, right) => left.path.localeCompare(right.path));
  const paths = new Set();
  const roles = new Set();
  for (const file of normalizedFiles) {
    if (paths.has(file.path)) throw new TypeError(`files.${file.path}: duplicate path`);
    if (roles.has(file.role)) throw new TypeError(`files.${file.role}: duplicate role`);
    paths.add(file.path);
    roles.add(file.role);
  }
  const descriptors = normalizedFiles.map((file) => Object.freeze({
    role: file.role,
    path: file.path,
    bytes: file.content.byteLength,
    sha256: sha256Hex(file.content)
  }));
  return Object.freeze({
    files: Object.freeze(normalizedFiles),
    descriptors: Object.freeze(descriptors),
    hash: sha256Hex(canonicalJson(descriptors))
  });
}

function verifyInputFiles(files, manifestValue) {
  const manifest = normalizeDatasetManifest(manifestValue);
  const fingerprint = fingerprintInputFiles(files);
  if (manifest.files.length !== fingerprint.descriptors.length) {
    throw new TypeError('manifest.files: count does not match provided files');
  }
  for (let index = 0; index < fingerprint.descriptors.length; index += 1) {
    const expected = manifest.files[index];
    const actual = fingerprint.descriptors[index];
    for (const field of ['role', 'path', 'bytes', 'sha256']) {
      if (expected[field] !== actual[field]) {
        throw new TypeError(`manifest.files[${index}].${field}: does not match provided input`);
      }
    }
  }
  if (manifest.hash.value !== fingerprint.hash) {
    throw new TypeError('manifest.hash.sha256: does not match the canonical input descriptor hash');
  }
  return Object.freeze({ manifest, ...fingerprint });
}

module.exports = Object.freeze({
  canonicalJson,
  sha256Hex,
  fingerprintInputFiles,
  verifyInputFiles
});
