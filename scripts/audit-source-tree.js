#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const AUDIT_TARGETS = Object.freeze([
  'apps/extension/src',
  'apps/extension/manifest.json',
  'apps/extension/README.md',
  'packages',
  'scripts',
  'tests',
  'docs/releases',
  'docs/validation',
  'docs/workbench/Halo_Learning_v0.1.0_to_v1.0_Workflow.md',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'package.json'
]);
const TEXT_EXTENSIONS = Object.freeze(new Set(['.js', '.json', '.md', '.css', '.html', '.yaml', '.yml', '.txt']));
const EXECUTABLE_PREFIXES = Object.freeze(['apps/extension/src/', 'packages/']);

function issue(code, relativePath, line) {
  const result = { code, path: relativePath };
  if (Number.isInteger(line)) result.line = line;
  return Object.freeze(result);
}

function collectFiles(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const files = [];
  const pending = [target];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(next);
      else if (entry.isFile()) files.push(next);
    }
  }
  return files;
}

function isInsideGitWorktree(rootValue) {
  const result = childProcess.spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: path.resolve(rootValue),
    encoding: 'utf8'
  });
  return result.status === 0 && result.stdout.trim() === 'true';
}

function auditSourceTree(rootValue) {
  const root = path.resolve(rootValue);
  const files = [...new Set(AUDIT_TARGETS.flatMap((relative) => collectFiles(path.join(root, relative))))]
    .filter((filePath) => TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .sort();
  const issues = [];
  for (const filePath of files) {
    const relative = path.relative(root, filePath).split(path.sep).join('/');
    const source = fs.readFileSync(filePath, 'utf8');
    if (source.includes('\0')) continue;
    const lines = source.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].endsWith('\r') ? lines[index].slice(0, -1) : lines[index];
      if (/[ \t]+$/.test(line)) issues.push(issue('TRAILING_WHITESPACE', relative, index + 1));
      if (/^(<<<<<<<|=======|>>>>>>>)(?:\s|$)/.test(line)) issues.push(issue('CONFLICT_MARKER', relative, index + 1));
    }
    const executableJavaScript = path.extname(filePath) === '.js' &&
      EXECUTABLE_PREFIXES.some((prefix) => relative.startsWith(prefix));
    if (executableJavaScript && /https?:\/\//.test(source)) {
      issues.push(issue('REMOTE_EXECUTABLE_URL', relative));
    }
    if (executableJavaScript &&
        /(BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|api[_-]?key\s*[:=]\s*['"][^'"]+)/i.test(source)) {
      issues.push(issue('SECRET_PATTERN', relative));
    }
  }
  return Object.freeze({
    ok: issues.length === 0,
    mode: 'package-source-audit',
    filesChecked: files.length,
    issues: Object.freeze(issues)
  });
}

function parseCli(args) {
  if (args.length === 0) return path.resolve(__dirname, '..');
  if (args.length === 2 && args[0] === '--root') return path.resolve(args[1]);
  throw new TypeError('usage: node scripts/audit-source-tree.js [--root <dir>]');
}

if (require.main === module) {
  try {
    const report = auditSourceTree(parseCli(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ AUDIT_TARGETS, auditSourceTree, isInsideGitWorktree });
