'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Policy = require('../apps/extension/src/shared/site-policy');

function safeScan(signals) {
  return Object.freeze({ schemaVersion: 1, status: 'ok', signals: Object.freeze(signals || []) });
}

function classify(url, options) {
  const settings = options || {};
  return Policy.classifySite({
    url,
    userDenylist: settings.userDenylist || [],
    sensitiveAttributes: settings.sensitiveAttributes || safeScan()
  });
}

function element(attributes, counters) {
  const values = { ...(attributes || {}) };
  const reads = counters || {};
  return {
    get tagName() {
      reads.tagName = (reads.tagName || 0) + 1;
      return values.tagName || 'INPUT';
    },
    get value() {
      reads.value = (reads.value || 0) + 1;
      throw new Error('value must never be read');
    },
    get textContent() {
      reads.textContent = (reads.textContent || 0) + 1;
      throw new Error('textContent must never be read');
    },
    get innerText() {
      reads.innerText = (reads.innerText || 0) + 1;
      throw new Error('innerText must never be read');
    },
    getAttribute(name) {
      reads[name] = (reads[name] || 0) + 1;
      return Object.hasOwn(values, name) ? values[name] : null;
    },
    hasAttribute(name) {
      reads[`has:${name}`] = (reads[`has:${name}`] || 0) + 1;
      return Object.hasOwn(values, name);
    }
  };
}

function documentWith(elements, overrides) {
  const settings = overrides || {};
  return {
    querySelectorAll(selector) {
      assert.equal(selector, Policy.SECURITY_SELECTOR);
      if (settings.throwQuery) throw new Error('hostile query');
      return elements;
    }
  };
}

test('PolicyDecision/v1 is frozen, closed, and uses only exact allowlisted codes', () => {
  const decisions = [
    classify('https://public.example/article'),
    classify('https://bank.example/account'),
    classify('file:///private/path'),
    Policy.classifySite(null)
  ];
  for (const decision of decisions) {
    assert.equal(Object.isFrozen(decision), true);
    assert.deepEqual(Object.keys(decision).sort(), [
      'allow', 'category', 'evidenceKind', 'reasonCode', 'schemaVersion'
    ]);
    assert.equal(decision.schemaVersion, 1);
    assert.ok(Policy.POLICY_CATEGORIES.includes(decision.category));
    assert.ok(Policy.POLICY_REASON_CODES.includes(decision.reasonCode));
    assert.ok(Policy.POLICY_EVIDENCE_KINDS.includes(decision.evidenceKind));
    assert.doesNotMatch(JSON.stringify(decision), /public\.example|bank\.example|private\/path/);
  }
});

test('default categories use exact host/path labels for the required sensitive matrix', () => {
  const cases = [
    ['https://bank.example/account', 'banking'],
    ['https://pay.example/checkout', 'payment-checkout'],
    ['https://bitwarden.example/vault', 'password-manager'],
    ['https://public.example/login', 'authentication'],
    ['https://mail.example/inbox', 'webmail'],
    ['https://chat.example/messages', 'private-messaging'],
    ['https://health.example/patient', 'medical-insurance'],
    ['https://insurance.example/member', 'medical-insurance'],
    ['https://government.example/personal-data', 'government-personal-data'],
    ['https://agency.gov/personal-data', 'government-personal-data'],
    ['https://cloud.example/secrets', 'developer-secrets'],
    ['https://developer.example/api-keys', 'developer-secrets']
  ];
  for (const [url, category] of cases) {
    const decision = classify(url);
    assert.equal(decision.allow, false, url);
    assert.equal(decision.category, category, url);
    assert.equal(decision.reasonCode, 'SENSITIVE_URL_CATEGORY', url);
  }
  for (const url of [
    'https://notbank.example/article',
    'https://private.example/notcheckout',
    'https://cloud.example/secrets-attacker',
    'https://government.example/public-records',
    'https://public.example/personal-data'
  ]) assert.equal(classify(url).allow, true, url);
});

test('auditable service registry blocks representative sensitive routes but not hostname lookalikes', () => {
  const blocked = [
    ['https://chase.com/personal/checking', 'banking'],
    ['https://secure.chase.com/web/auth/dashboard', 'banking'],
    ['https://outlook.live.com/mail/0/inbox', 'webmail'],
    ['https://discord.com/channels/123/456', 'private-messaging'],
    ['https://myaccount.uhc.com/member/claims', 'medical-insurance'],
    ['https://console.aws.amazon.com/secretsmanager/listsecrets', 'developer-secrets'],
    ['https://console.cloud.google.com/security/secret-manager', 'developer-secrets'],
    ['https://portal.azure.com/#view/Microsoft_Azure_KeyVault/SecretListBlade', 'developer-secrets'],
    ['https://vault.bitwarden.com/#/vault', 'password-manager'],
    ['https://www.paypal.com/checkoutnow', 'payment-checkout'],
    ['https://secure.ssa.gov/myaccount/', 'government-personal-data']
  ];
  for (const [url, category] of blocked) {
    const decision = classify(url);
    assert.equal(decision.allow, false, url);
    assert.equal(decision.category, category, url);
  }

  for (const url of [
    'https://chase.com.attacker.test/personal/checking',
    'https://notchase.com/personal/checking',
    'https://outlook.live.com.attacker.test/mail',
    'https://discord.com.attacker.test/channels/123',
    'https://myaccount.uhc.com.attacker.test/member',
    'https://www.paypal.com.attacker.test/checkoutnow',
    'https://vault.bitwarden.com.attacker.test/#/vault',
    'https://secure.ssa.gov.attacker.test/myaccount',
    'https://console.aws.amazon.com.attacker.test/secretsmanager',
    'https://console.cloud.google.com.attacker.test/security/secret-manager',
    'https://portal.azure.com.attacker.test/#view/KeyVault/secrets'
  ]) assert.equal(classify(url).allow, true, url);
});

test('route matching safely includes query and hash and rejects multiply encoded or ambiguous routes', () => {
  assert.equal(classify('https://console.aws.amazon.com/home?service=secretsmanager').category, 'developer-secrets');
  assert.equal(classify('https://portal.azure.com/#view/KeyVault/secrets').category, 'developer-secrets');
  for (const url of [
    'https://public.example/%256cogin',
    'https://public.example/%252Flogin',
    'https://public.example/%2Flogin',
    'https://public.example/%5clogin',
    'https://public.example/%2e%2e/login',
    'https://user:password@public.example/article'
  ]) {
    const decision = classify(url);
    assert.deepEqual(decision, {
      schemaVersion: 1,
      allow: false,
      category: 'policy-error',
      reasonCode: 'AMBIGUOUS_URL',
      evidenceKind: 'POLICY_ERROR'
    }, url);
  }
});

test('forged known-host suffix suppresses only host evidence while independent sensitive routes still block', () => {
  const blocked = [
    ['https://chase.com.attacker.test/login', 'authentication'],
    ['https://vault.bitwarden.com.attacker.test/checkout', 'payment-checkout'],
    ['https://outlook.live.com.attacker.test/password-reset', 'authentication'],
    ['https://chase.com.attacker.test/%6cogin', 'authentication'],
    ['https://vault.bitwarden.com.attacker.test/%63heckout', 'payment-checkout'],
    ['https://outlook.live.com.attacker.test/%70assword-reset', 'authentication'],
    ['https://chase.com.attacker.test/?next=login', 'authentication'],
    ['https://vault.bitwarden.com.attacker.test/?flow=%63heckout', 'payment-checkout'],
    ['https://outlook.live.com.attacker.test/#%70assword-reset', 'authentication']
  ];
  for (const [url, category] of blocked) {
    const decision = classify(url);
    assert.equal(decision.allow, false, url);
    assert.equal(decision.category, category, url);
    assert.equal(decision.evidenceKind, 'PATH_LABEL', url);
  }
  for (const url of [
    'https://chase.com.attacker.test/%256cogin',
    'https://vault.bitwarden.com.attacker.test/%252Fcheckout',
    'https://outlook.live.com.attacker.test/%2epassword-reset',
    'https://chase.com.attacker.test/?next=%256cogin',
    'https://vault.bitwarden.com.attacker.test/#%252Fcheckout'
  ]) {
    const decision = classify(url);
    assert.equal(decision.allow, false, url);
    assert.equal(decision.reasonCode, 'AMBIGUOUS_URL', url);
  }
  for (const url of [
    'https://chase.com.attacker.test/article',
    'https://vault.bitwarden.com.attacker.test/help',
    'https://outlook.live.com.attacker.test/public-news',
    'https://chase.com.attacker.test/?topic=article',
    'https://outlook.live.com.attacker.test/#public-news'
  ]) assert.equal(classify(url).allow, true, url);
});

test('denylist canonicalizes case, one trailing dot, and IDNA then sorts and deduplicates', () => {
  const denylist = Policy.normalizeDenylist([
    'Private.Example.',
    'private.example',
    '例子.測試',
    'A.EXAMPLE'
  ]);
  assert.deepEqual(denylist, ['a.example', 'private.example', 'xn--fsqu00a.xn--g6w251d']);
  assert.equal(Object.isFrozen(denylist), true);
});

test('user denylist matches only an exact hostname or its subdomain and rejects suffix tricks', () => {
  const denylist = Policy.normalizeDenylist(['private.example']);
  assert.equal(classify('https://private.example/a', { userDenylist: denylist }).allow, false);
  assert.equal(classify('https://sub.private.example/a', { userDenylist: denylist }).allow, false);
  for (const url of [
    'https://private.example.attacker.test/a',
    'https://notprivate.example/a',
    'https://privateexample/a',
    'https://private.example.evil/a'
  ]) assert.equal(classify(url, { userDenylist: denylist }).allow, true, url);
});

test('denylist rejects wildcard, URL, path, port, controls, empty labels, and bounded-input violations', () => {
  for (const value of [
    '*.example', 'https://private.example', 'private.example/path', 'private.example:443',
    ' private.example', 'private.example ', 'private..example', '.private.example',
    'private.example\u0000', 'private.example?', 'private.example#x', ''
  ]) assert.throws(() => Policy.normalizeDenylist([value]), /denylist/i, JSON.stringify(value));
  assert.throws(() => Policy.normalizeDenylist('private.example'), /denylist/i);
  assert.throws(
    () => Policy.normalizeDenylist(Array.from({ length: Policy.DENYLIST_LIMITS.maxEntries + 1 }, (_, i) => `h${i}.example`)),
    /denylist/i
  );
  assert.throws(() => Policy.normalizeDenylist(['a'.repeat(64) + '.example']), /denylist/i);
});

test('denylist snapshots only a dense own-data array and rejects holes, accessors, extras, and hostile proxies', () => {
  const hole = [];
  hole.length = 1;
  const accessor = [];
  Object.defineProperty(accessor, '0', {
    enumerable: true,
    get() { throw new Error('must not invoke denylist getter'); }
  });
  Object.defineProperty(accessor, 'length', { value: 1 });
  const extra = ['private.example'];
  Object.defineProperty(extra, 'secret', { value: 'must not be accepted' });
  let valueReads = 0;
  const unstable = new Proxy(['private.example'], {
    get(target, name, receiver) {
      if (name === 'length' || name === '0') valueReads += 1;
      return Reflect.get(target, name, receiver);
    },
    ownKeys() { throw new Error('hostile proxy'); }
  });
  const transparent = new Proxy(['private.example'], {
    get(target, name, receiver) {
      if (name === 'length' || name === '0') valueReads += 1;
      return Reflect.get(target, name, receiver);
    }
  });

  for (const value of [hole, accessor, extra, unstable, transparent]) {
    assert.throws(() => Policy.normalizeDenylist(value), /denylist/i);
  }
  assert.equal(valueReads, 0);
});

test('invalid URL, denylist, scan, or throwing input always returns a blocked sanitized decision', () => {
  const hostile = new Proxy({}, { getOwnPropertyDescriptors() { throw new Error('page secret'); } });
  const inputs = [
    { url: 'not a url', userDenylist: [], sensitiveAttributes: safeScan() },
    { url: 'https://public.example', userDenylist: ['*.example'], sensitiveAttributes: safeScan() },
    { url: 'https://public.example', userDenylist: [], sensitiveAttributes: ['UNKNOWN_SIGNAL'] },
    hostile
  ];
  for (const input of inputs) {
    const decision = Policy.classifySite(input);
    assert.equal(decision.allow, false);
    assert.equal(decision.category, 'policy-error');
    assert.ok(['INVALID_URL', 'POLICY_INPUT_ERROR'].includes(decision.reasonCode));
    assert.doesNotMatch(JSON.stringify(decision), /page secret|UNKNOWN_SIGNAL|not a url/);
  }
});

test('security scan detects password, OTP, payment, sensitive name, and presence signals without private reads', () => {
  const counters = {};
  const scan = Policy.scanSecurityAttributes(documentWith([
    element({ type: 'password' }, counters),
    element({ autocomplete: 'one-time-code' }, counters),
    element({ autocomplete: 'cc-number' }, counters),
    element({ name: 'client_secret' }, counters),
    element({ 'data-sensitive': '' }, counters)
  ]));
  assert.deepEqual(scan, {
    schemaVersion: 1,
    status: 'ok',
    signals: ['ONE_TIME_CODE_AUTOCOMPLETE', 'PASSWORD_TYPE', 'PAYMENT_AUTOCOMPLETE', 'PRIVATE_PRESENCE', 'SENSITIVE_NAME']
  });
  assert.equal(Object.isFrozen(scan), true);
  assert.equal(Object.isFrozen(scan.signals), true);
  assert.equal(counters.value || 0, 0);
  assert.equal(counters.textContent || 0, 0);
  assert.equal(counters.innerText || 0, 0);
  const decision = Policy.classifySite({
    url: 'https://public.example/article',
    userDenylist: [],
    sensitiveAttributes: scan
  });
  assert.deepEqual(decision, {
    schemaVersion: 1,
    allow: false,
    category: 'sensitive-form',
    reasonCode: 'SENSITIVE_FORM_ATTRIBUTE',
    evidenceKind: 'FORM_ATTRIBUTE'
  });
});

test('hidden inputs skip name and other sensitive inspection and never touch value or text', () => {
  const counters = {};
  const hidden = element({ type: 'hidden', name: 'client_secret', autocomplete: 'current-password' }, counters);
  const scan = Policy.scanSecurityAttributes(documentWith([hidden]));
  assert.deepEqual(scan, safeScan());
  assert.equal(counters.name || 0, 0);
  assert.equal(counters.autocomplete || 0, 0);
  assert.equal(counters.inputmode || 0, 0);
  assert.equal(counters.role || 0, 0);
  assert.equal(counters.value || 0, 0);
  assert.equal(counters.textContent || 0, 0);
  assert.equal(counters.innerText || 0, 0);
});

test('hidden elements still consume the per-element time and static-result checks', () => {
  let ticks = 0;
  const scan = Policy.scanSecurityAttributes(documentWith([element({ type: 'hidden' })]), {
    now() { ticks += 1; return ticks; }
  });
  assert.equal(scan.status, 'ok');
  assert.equal(ticks, 4);
});

test('throwing, ambiguous, element-over-budget, and time-over-budget scans fail closed', () => {
  const throwingTag = element({});
  Object.defineProperty(throwingTag, 'tagName', { get() { throw new Error('hostile tag'); } });
  const cases = [
    Policy.scanSecurityAttributes(documentWith([], { throwQuery: true })),
    Policy.scanSecurityAttributes(documentWith([throwingTag])),
    Policy.scanSecurityAttributes(documentWith(
      Array.from({ length: Policy.ATTRIBUTE_SCAN_LIMITS.maxElements + 1 }, () => element({}))
    )),
    Policy.scanSecurityAttributes(documentWith([element({})]), {
      now: (() => { let tick = 0; return () => (tick += Policy.ATTRIBUTE_SCAN_LIMITS.maxMilliseconds); })()
    })
  ];
  for (const scan of cases) {
    assert.equal(scan.status, 'blocked');
    assert.ok(['DOM_SCAN_ERROR', 'DOM_SCAN_BUDGET_EXCEEDED'].includes(scan.failureCode));
    const decision = Policy.classifySite({
      url: 'https://public.example/article',
      userDenylist: [],
      sensitiveAttributes: scan
    });
    assert.equal(decision.allow, false);
    assert.equal(decision.evidenceKind, 'POLICY_ERROR');
  }
});

test('security scan enforces stable static results and monotonic time at every boundary including zero nodes', () => {
  function clock(values) {
    let index = 0;
    return () => values[Math.min(index++, values.length - 1)];
  }
  function changingNodes(nodes, lengths) {
    let read = 0;
    return new Proxy(nodes, {
      get(target, name, receiver) {
        if (name === 'length') return lengths[Math.min(read++, lengths.length - 1)];
        return Reflect.get(target, name, receiver);
      }
    });
  }
  let nullNodeTicks = 0;
  const cases = [
    Policy.scanSecurityAttributes(documentWith([]), { now: clock([0, Number.NaN, 1]) }),
    Policy.scanSecurityAttributes(documentWith([]), { now: clock([2, 1, 3]) }),
    Policy.scanSecurityAttributes(documentWith([], {}), { now: clock([0, 1, 9]) }),
    Policy.scanSecurityAttributes(documentWith(changingNodes([element({})], [1, 0, 0])), {
      now: clock([0, 1, 2, 3])
    }),
    Policy.scanSecurityAttributes(documentWith([null]), { now() { nullNodeTicks += 1; return nullNodeTicks; } })
  ];
  for (const scan of cases) assert.equal(scan.status, 'blocked');
  assert.equal(cases[2].failureCode, 'DOM_SCAN_BUDGET_EXCEEDED');
  assert.equal(nullNodeTicks, 4);
});

test('unsupported protocols fail closed before attribute decisions', () => {
  for (const url of ['file:///tmp/page.html', 'chrome://settings', 'about:blank', 'data:text/html,public']) {
    const decision = classify(url);
    assert.deepEqual(decision, {
      schemaVersion: 1,
      allow: false,
      category: 'unsupported',
      reasonCode: 'UNSUPPORTED_PROTOCOL',
      evidenceKind: 'URL_PROTOCOL'
    });
  }
});
