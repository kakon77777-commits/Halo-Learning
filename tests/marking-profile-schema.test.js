'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Settings = require('../apps/extension/src/shared/settings');

const schema = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', 'packages', 'contracts', 'schemas', 'marking-profile.schema.json'
), 'utf8'));

function errorsFor(value, rule, location = '$') {
  const errors = [];
  if (rule.const !== undefined && value !== rule.const) errors.push(`${location}: const`);
  if (rule.enum && !rule.enum.includes(value)) errors.push(`${location}: enum`);
  if (rule.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${location}: object`];
    for (const name of rule.required || []) if (!Object.hasOwn(value, name)) errors.push(`${location}.${name}: required`);
    if (rule.additionalProperties === false) {
      for (const name of Object.keys(value)) if (!Object.hasOwn(rule.properties || {}, name)) errors.push(`${location}.${name}: additional`);
    }
    for (const [name, child] of Object.entries(rule.properties || {})) {
      if (Object.hasOwn(value, name)) errors.push(...errorsFor(value[name], child, `${location}.${name}`));
    }
  } else if (rule.type === 'integer') {
    if (!Number.isSafeInteger(value)) errors.push(`${location}: integer`);
  } else if (rule.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${location}: number`);
  } else if (rule.type === 'string' && typeof value !== 'string') errors.push(`${location}: string`);
  else if (rule.type === 'boolean' && typeof value !== 'boolean') errors.push(`${location}: boolean`);
  if (typeof value === 'number' && rule.minimum !== undefined && value < rule.minimum) errors.push(`${location}: minimum`);
  if (typeof value === 'number' && rule.maximum !== undefined && value > rule.maximum) errors.push(`${location}: maximum`);
  if (typeof value === 'string' && rule.minLength !== undefined && value.length < rule.minLength) errors.push(`${location}: minLength`);
  return errors;
}

test('marking-profile schema accepts the exact canonical normalized serialization', () => {
  const profile = Settings.normalizeSettings({ profileRevision: 9, triggerMode: 'explicit-only' });
  assert.deepEqual(errorsFor(profile, schema), []);
  assert.ok(schema.required.includes('profileRevision'));
  assert.ok(schema.required.includes('runtimeBudgets'));
  assert.equal(schema.properties.runtimeBudgets.additionalProperties, false);
});

test('marking-profile schema rejects missing, extra, noninteger, and out-of-range runtime budgets', () => {
  const profile = Settings.normalizeSettings({});
  for (const invalid of [
    { ...profile, profileRevision: 1.5 },
    { ...profile, unexpected: true },
    { ...profile, runtimeBudgets: { ...profile.runtimeBudgets, extra: 1 } },
    { ...profile, runtimeBudgets: { ...profile.runtimeBudgets, timeSliceMs: 0 } },
    { ...profile, runtimeBudgets: { ...profile.runtimeBudgets, viewportBufferPx: 1201 } }
  ]) assert.ok(errorsFor(invalid, schema).length > 0);
});
