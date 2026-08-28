'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Settings = require('../apps/extension/src/shared/settings');
const Contracts = require('../packages/contracts/semantic-contracts');
const SitePolicy = require('../apps/extension/src/shared/site-policy');

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
  } else if (rule.type === 'array') {
    if (!Array.isArray(value)) return [`${location}: array`];
    if (rule.maxItems !== undefined && value.length > rule.maxItems) errors.push(`${location}: maxItems`);
    if (rule.uniqueItems && new Set(value).size !== value.length) errors.push(`${location}: uniqueItems`);
    if (rule.items) value.forEach((item, index) => errors.push(...errorsFor(item, rule.items, `${location}[${index}]`)));
    if (rule['x-haloCanonicalHostnameDenylist']) {
      try {
        const normalized = SitePolicy.normalizeDenylist(value);
        if (normalized.length !== value.length || normalized.some((item, index) => item !== value[index])) {
          errors.push(`${location}: canonicalDenylist`);
        }
      } catch (_error) {
        errors.push(`${location}: canonicalDenylist`);
      }
    }
  } else if (rule.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${location}: number`);
  } else if (rule.type === 'string' && typeof value !== 'string') errors.push(`${location}: string`);
  else if (rule.type === 'boolean' && typeof value !== 'boolean') errors.push(`${location}: boolean`);
  if (typeof value === 'number' && rule.minimum !== undefined && value < rule.minimum) errors.push(`${location}: minimum`);
  if (typeof value === 'number' && rule.maximum !== undefined && value > rule.maximum) errors.push(`${location}: maximum`);
  if (typeof value === 'string' && rule.minLength !== undefined && value.length < rule.minLength) errors.push(`${location}: minLength`);
  if (typeof value === 'string' && rule.pattern !== undefined && !(new RegExp(rule.pattern)).test(value)) errors.push(`${location}: pattern`);
  return errors;
}

function runtimeAccepts(value) {
  try { Contracts.normalizeMarkingProfile(value); return true; } catch { return false; }
}

test('marking-profile schema accepts the exact canonical normalized serialization', () => {
  const profile = Settings.migrateSettings({ profileRevision: 9, triggerMode: 'explicit-only' });
  assert.deepEqual(errorsFor(profile, schema), []);
  assert.ok(schema.required.includes('profileRevision'));
  assert.ok(schema.required.includes('runtimeBudgets'));
  assert.ok(schema.required.includes('sitePolicy'));
  assert.equal(schema.properties.sitePolicy.additionalProperties, false);
  assert.equal(schema.properties.runtimeBudgets.additionalProperties, false);
});

test('canonical runtime and JSON schema accept and reject the identical closed corpus', () => {
  const valid = Settings.migrateSettings({ profileRevision: 3 });
  const invalid = [];
  for (const name of schema.required) {
    const candidate = { ...valid };
    delete candidate[name];
    invalid.push(candidate);
  }
  invalid.push(
    { ...valid, extra: true },
    { ...valid, profileId: '   ' },
    { ...valid, channels: { ...valid.channels, extra: true } },
    { ...valid, runtimeBudgets: { ...valid.runtimeBudgets, extra: 1 } },
    { ...valid, sitePolicy: { ...valid.sitePolicy, extra: true } },
    { ...valid, sitePolicy: { ...valid.sitePolicy, userDenylist: ['*.example'] } },
    { ...valid, sitePolicy: { ...valid.sitePolicy, userDenylist: ['z.example', 'a.example'] } },
    { ...valid, sitePolicy: { ...valid.sitePolicy, userDenylist: ['Private.Example'] } },
    { ...valid, maxTextNodes: 49 },
    { ...valid, maxTextNodes: 2001 },
    { ...valid, maxMarkedTokens: 99 },
    { ...valid, maxMarkedTokens: 10001 }
  );
  const inherited = Object.create(valid);
  const inheritedChannels = { ...valid, channels: Object.create(valid.channels) };
  const inheritedBudgets = { ...valid, runtimeBudgets: Object.create(valid.runtimeBudgets) };
  invalid.push(inherited, inheritedChannels, inheritedBudgets);
  for (const candidate of [valid, ...invalid]) {
    assert.equal(runtimeAccepts(candidate), errorsFor(candidate, schema).length === 0, JSON.stringify(candidate));
  }
});

test('legacy settings pass only through migration and emerge canonical', () => {
  const legacy = { posLabels: false, languageMode: 'zh', maxTextNodes: 12 };
  assert.equal(runtimeAccepts(legacy), false);
  const migrated = Settings.migrateSettings(legacy);
  assert.equal(runtimeAccepts(migrated), true);
  assert.deepEqual(errorsFor(migrated, schema), []);
  assert.equal(migrated.maxTextNodes, 50);
});

test('marking-profile schema rejects missing, extra, noninteger, and out-of-range runtime budgets', () => {
  const profile = Settings.migrateSettings({});
  for (const invalid of [
    { ...profile, profileRevision: 1.5 },
    { ...profile, unexpected: true },
    { ...profile, runtimeBudgets: { ...profile.runtimeBudgets, extra: 1 } },
    { ...profile, runtimeBudgets: { ...profile.runtimeBudgets, timeSliceMs: 0 } },
    { ...profile, runtimeBudgets: { ...profile.runtimeBudgets, viewportBufferPx: 1201 } }
  ]) assert.ok(errorsFor(invalid, schema).length > 0);
});
