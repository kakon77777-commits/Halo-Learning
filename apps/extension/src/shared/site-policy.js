(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloSitePolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const POLICY_SCHEMA_VERSION = 1;
  const DENYLIST_LIMITS = Object.freeze({
    maxEntries: 128,
    maxInputLength: 512,
    maxHostnameLength: 253,
    maxLabelLength: 63
  });
  const ATTRIBUTE_SCAN_LIMITS = Object.freeze({ maxElements: 128, maxMilliseconds: 8 });
  const SECURITY_SELECTOR = [
    'input', 'select', 'textarea', 'form', '[role]',
    '[data-private]', '[data-sensitive]', '[data-1p-ignore]', '[data-bwignore]'
  ].join(',');

  const POLICY_CATEGORIES = Object.freeze([
    'public', 'user-denylist', 'banking', 'payment-checkout', 'password-manager',
    'authentication', 'webmail', 'private-messaging', 'medical-insurance',
    'government-personal-data', 'developer-secrets', 'sensitive-form',
    'unsupported', 'policy-error'
  ]);
  const POLICY_REASON_CODES = Object.freeze([
    'ALLOW', 'USER_DENYLIST', 'SENSITIVE_URL_CATEGORY', 'SENSITIVE_FORM_ATTRIBUTE',
    'UNSUPPORTED_PROTOCOL', 'INVALID_URL', 'DOM_SCAN_ERROR',
    'DOM_SCAN_BUDGET_EXCEEDED', 'POLICY_INPUT_ERROR'
  ]);
  const POLICY_EVIDENCE_KINDS = Object.freeze([
    'NONE', 'HOST_LABEL', 'PATH_LABEL', 'HOST_AND_PATH_LABEL', 'FORM_ATTRIBUTE',
    'URL_PROTOCOL', 'POLICY_ERROR'
  ]);
  const ATTRIBUTE_SIGNALS = Object.freeze([
    'PASSWORD_TYPE', 'PASSWORD_AUTOCOMPLETE', 'ONE_TIME_CODE_AUTOCOMPLETE',
    'PAYMENT_AUTOCOMPLETE', 'SENSITIVE_NAME', 'PRIVATE_PRESENCE'
  ]);

  const DEFAULT_CATEGORY_RULES = Object.freeze([
    Object.freeze({ category: 'banking', host: Object.freeze(['bank', 'banking', 'onlinebanking']) }),
    Object.freeze({
      category: 'payment-checkout',
      host: Object.freeze(['pay', 'payment', 'payments', 'checkout']),
      path: Object.freeze(['checkout', 'payment', 'payments']),
      either: true
    }),
    Object.freeze({
      category: 'password-manager',
      host: Object.freeze(['1password', 'bitwarden', 'dashlane', 'keeper', 'lastpass', 'password-manager'])
    }),
    Object.freeze({
      category: 'authentication',
      path: Object.freeze(['auth', 'login', 'signin', 'sign-in', 'password-reset'])
    }),
    Object.freeze({ category: 'webmail', host: Object.freeze(['mail', 'webmail']) }),
    Object.freeze({
      category: 'private-messaging',
      host: Object.freeze(['chat', 'messages', 'messenger', 'private-messaging'])
    }),
    Object.freeze({
      category: 'medical-insurance',
      host: Object.freeze(['health', 'medical', 'patient', 'insurance'])
    }),
    Object.freeze({
      category: 'government-personal-data',
      host: Object.freeze(['gov', 'government']),
      path: Object.freeze(['account', 'benefits', 'identity', 'personal-data', 'tax']),
      both: true,
      governmentTld: true
    }),
    Object.freeze({
      category: 'developer-secrets',
      host: Object.freeze(['cloud', 'console', 'developer']),
      path: Object.freeze(['access-keys', 'api-keys', 'credentials', 'secrets']),
      both: true
    })
  ]);

  const SENSITIVE_AUTOCOMPLETE = Object.freeze({
    'current-password': 'PASSWORD_AUTOCOMPLETE',
    'new-password': 'PASSWORD_AUTOCOMPLETE',
    'one-time-code': 'ONE_TIME_CODE_AUTOCOMPLETE',
    'cc-number': 'PAYMENT_AUTOCOMPLETE',
    'cc-csc': 'PAYMENT_AUTOCOMPLETE',
    'cc-exp': 'PAYMENT_AUTOCOMPLETE',
    'cc-exp-month': 'PAYMENT_AUTOCOMPLETE',
    'cc-exp-year': 'PAYMENT_AUTOCOMPLETE'
  });
  const SENSITIVE_NAMES = new Set([
    'access-token', 'api-key', 'card-number', 'client-secret', 'credit-card', 'csc',
    'cvc', 'cvv', 'one-time-code', 'otp', 'passcode', 'password', 'private-key',
    'security-code'
  ]);
  const PRESENCE_ATTRIBUTES = Object.freeze([
    'data-private', 'data-sensitive', 'data-1p-ignore', 'data-bwignore'
  ]);

  function freezeDecision(allow, category, reasonCode, evidenceKind) {
    if (!POLICY_CATEGORIES.includes(category) || !POLICY_REASON_CODES.includes(reasonCode) ||
        !POLICY_EVIDENCE_KINDS.includes(evidenceKind)) {
      throw new TypeError('PolicyDecision/v1: noncanonical code');
    }
    return Object.freeze({ schemaVersion: POLICY_SCHEMA_VERSION, allow, category, reasonCode, evidenceKind });
  }

  const POLICY_INPUT_ERROR = freezeDecision(false, 'policy-error', 'POLICY_INPUT_ERROR', 'POLICY_ERROR');
  const INVALID_URL = freezeDecision(false, 'policy-error', 'INVALID_URL', 'POLICY_ERROR');

  function normalizeHostname(value) {
    if (typeof value !== 'string' || !value || value.length > DENYLIST_LIMITS.maxInputLength ||
        /[\u0000-\u0020\u007f*\\/@:?#]/u.test(value)) {
      throw new TypeError('denylist hostname: invalid entry');
    }
    let candidate = value;
    if (candidate.endsWith('.')) candidate = candidate.slice(0, -1);
    if (!candidate || candidate.startsWith('.') || candidate.endsWith('.') || candidate.includes('..')) {
      throw new TypeError('denylist hostname: invalid labels');
    }
    let parsed;
    try {
      parsed = new root.URL('http:' + '//' + candidate + '/');
    } catch (_error) {
      throw new TypeError('denylist hostname: invalid IDNA hostname');
    }
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || hostname.length > DENYLIST_LIMITS.maxHostnameLength || parsed.port ||
        parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new TypeError('denylist hostname: invalid canonical hostname');
    }
    const labels = hostname.split('.');
    for (const label of labels) {
      if (!label || label.length > DENYLIST_LIMITS.maxLabelLength ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)) {
        throw new TypeError('denylist hostname: invalid canonical label');
      }
    }
    return hostname;
  }

  function normalizeDenylist(values) {
    if (!Array.isArray(values) || !Number.isSafeInteger(values.length) ||
        values.length > DENYLIST_LIMITS.maxEntries) {
      throw new TypeError('denylist: bounded array required');
    }
    const descriptors = Object.getOwnPropertyDescriptors(values);
    const normalized = [];
    for (let index = 0; index < values.length; index += 1) {
      const descriptor = descriptors[index];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || !descriptor.enumerable) {
        throw new TypeError(`denylist[${index}]: own data entry required`);
      }
      normalized.push(normalizeHostname(descriptor.value));
    }
    return Object.freeze([...new Set(normalized)].sort());
  }

  function scanResult(status, values) {
    if (status === 'ok') {
      return Object.freeze({
        schemaVersion: POLICY_SCHEMA_VERSION,
        status,
        signals: Object.freeze([...new Set(values)].sort())
      });
    }
    return Object.freeze({ schemaVersion: POLICY_SCHEMA_VERSION, status, failureCode: values });
  }

  function scanFailure(code) {
    return scanResult('blocked', code);
  }

  function boundedAttribute(element, name) {
    const method = element.getAttribute;
    if (typeof method !== 'function') throw new TypeError('attribute reader unavailable');
    const value = method.call(element, name);
    if (value === null) return null;
    if (typeof value !== 'string' || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new TypeError('ambiguous security attribute');
    }
    return value.trim().toLowerCase();
  }

  function presentAttribute(element, name) {
    const method = element.hasAttribute;
    if (typeof method !== 'function') throw new TypeError('attribute presence reader unavailable');
    const value = method.call(element, name);
    if (typeof value !== 'boolean') throw new TypeError('ambiguous attribute presence');
    return value;
  }

  function scanSecurityAttributes(documentLike, options) {
    try {
      const settings = options || {};
      const now = Object.prototype.hasOwnProperty.call(settings, 'now') ? settings.now : () => {
        if (root.performance && typeof root.performance.now === 'function') return root.performance.now();
        return Date.now();
      };
      if (typeof now !== 'function') return scanFailure('DOM_SCAN_ERROR');
      const start = now();
      if (typeof start !== 'number' || !Number.isFinite(start)) return scanFailure('DOM_SCAN_ERROR');
      if (!documentLike || typeof documentLike.querySelectorAll !== 'function') return scanFailure('DOM_SCAN_ERROR');
      const nodes = documentLike.querySelectorAll(SECURITY_SELECTOR);
      const length = nodes && nodes.length;
      if (!Number.isSafeInteger(length) || length < 0) return scanFailure('DOM_SCAN_ERROR');
      if (length > ATTRIBUTE_SCAN_LIMITS.maxElements) return scanFailure('DOM_SCAN_BUDGET_EXCEEDED');
      const signals = [];
      for (let index = 0; index < length; index += 1) {
        const elapsed = now() - start;
        if (!Number.isFinite(elapsed) || elapsed < 0) return scanFailure('DOM_SCAN_ERROR');
        if (elapsed >= ATTRIBUTE_SCAN_LIMITS.maxMilliseconds) return scanFailure('DOM_SCAN_BUDGET_EXCEEDED');
        const node = nodes[index];
        if (!node || (typeof node !== 'object' && typeof node !== 'function')) return scanFailure('DOM_SCAN_ERROR');
        const tagName = node.tagName;
        if (typeof tagName !== 'string' || !tagName || tagName.length > 20) return scanFailure('DOM_SCAN_ERROR');
        const tag = tagName.toUpperCase();
        const type = boundedAttribute(node, 'type');
        if (tag === 'INPUT' && type === 'hidden') continue;
        if (tag === 'INPUT' && type === 'password') signals.push('PASSWORD_TYPE');
        const autocomplete = boundedAttribute(node, 'autocomplete');
        if (autocomplete) {
          for (const token of autocomplete.split(/\s+/u)) {
            if (Object.hasOwn(SENSITIVE_AUTOCOMPLETE, token)) signals.push(SENSITIVE_AUTOCOMPLETE[token]);
          }
        }
        boundedAttribute(node, 'inputmode');
        const name = boundedAttribute(node, 'name');
        if (name) {
          const normalizedName = name.split(/[^a-z0-9]+/u).filter(Boolean).join('-');
          if (SENSITIVE_NAMES.has(normalizedName)) signals.push('SENSITIVE_NAME');
        }
        boundedAttribute(node, 'role');
        for (const attribute of PRESENCE_ATTRIBUTES) {
          if (presentAttribute(node, attribute)) signals.push('PRIVATE_PRESENCE');
        }
      }
      return scanResult('ok', signals);
    } catch (_error) {
      return scanFailure('DOM_SCAN_ERROR');
    }
  }

  function exactInput(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('policy input required');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('plain policy input required');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const allowed = ['url', 'userDenylist', 'sensitiveAttributes', 'document', 'scanOptions'];
    for (const name of Object.keys(descriptors)) if (!allowed.includes(name)) throw new TypeError('unknown policy input');
    const result = {};
    for (const name of ['url', 'userDenylist']) {
      const descriptor = descriptors[name];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || !descriptor.enumerable) {
        throw new TypeError(`policy.${name}: own data required`);
      }
      result[name] = descriptor.value;
    }
    for (const name of ['sensitiveAttributes', 'document', 'scanOptions']) {
      const descriptor = descriptors[name];
      if (descriptor) {
        if (!Object.prototype.hasOwnProperty.call(descriptor, 'value') || !descriptor.enumerable) {
          throw new TypeError(`policy.${name}: own data required`);
        }
        result[name] = descriptor.value;
      }
    }
    return result;
  }

  function parseUrl(source) {
    let value = source;
    if (typeof value !== 'string') {
      if (!root.URL || !(value instanceof root.URL)) throw new TypeError('policy URL: string or URL required');
      value = value.href;
    }
    if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new TypeError('policy URL: invalid');
    }
    let parsed;
    try { parsed = new root.URL(value); } catch (_error) { throw new TypeError('policy URL: invalid'); }
    const hostname = parsed.hostname.endsWith('.') ? parsed.hostname.slice(0, -1).toLowerCase() : parsed.hostname.toLowerCase();
    if (['http:', 'https:'].includes(parsed.protocol)) normalizeHostname(hostname);
    if (parsed.pathname.length > 2048) throw new TypeError('policy URL: path too long');
    return { parsed, hostname };
  }

  function attributeScanOf(input) {
    let value;
    if (Object.hasOwn(input, 'document')) value = scanSecurityAttributes(input.document, input.scanOptions);
    else value = input.sensitiveAttributes;
    if (Array.isArray(value)) value = scanResult('ok', value);
    if (!value || typeof value !== 'object' || value.schemaVersion !== POLICY_SCHEMA_VERSION ||
        !['ok', 'blocked'].includes(value.status)) throw new TypeError('attribute scan: invalid');
    if (value.status === 'blocked') {
      if (!['DOM_SCAN_ERROR', 'DOM_SCAN_BUDGET_EXCEEDED'].includes(value.failureCode)) {
        throw new TypeError('attribute scan: invalid failure');
      }
      return value;
    }
    if (!Array.isArray(value.signals) || value.signals.length > ATTRIBUTE_SIGNALS.length) {
      throw new TypeError('attribute scan: invalid signals');
    }
    for (const signal of value.signals) if (!ATTRIBUTE_SIGNALS.includes(signal)) throw new TypeError('attribute scan: invalid signal');
    return value;
  }

  function pathLabels(pathname) {
    const labels = [];
    for (const segment of pathname.split('/')) {
      if (!segment) continue;
      let decoded;
      try { decoded = decodeURIComponent(segment); } catch (_error) { throw new TypeError('policy URL: invalid path'); }
      if (decoded.length > 128 || /[\u0000-\u001f\u007f]/u.test(decoded)) throw new TypeError('policy URL: invalid path');
      for (const label of decoded.toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter(Boolean)) labels.push(label);
      if (labels.length > 128) throw new TypeError('policy URL: too many path labels');
    }
    return labels;
  }

  function matchingCategory(hostname, pathname) {
    const hosts = hostname.split('.');
    const paths = pathLabels(pathname);
    for (const rule of DEFAULT_CATEGORY_RULES) {
      const hostMatch = Boolean(rule.host && rule.host.some((label) => hosts.includes(label))) ||
        Boolean(rule.governmentTld && hosts[hosts.length - 1] === 'gov');
      const pathMatch = Boolean(rule.path && rule.path.some((label) => paths.includes(label)));
      if ((rule.both && hostMatch && pathMatch) ||
          (rule.either && (hostMatch || pathMatch)) ||
          (!rule.both && !rule.either && ((rule.host && hostMatch) || (rule.path && pathMatch)))) {
        return {
          category: rule.category,
          evidenceKind: hostMatch && pathMatch ? 'HOST_AND_PATH_LABEL' : (hostMatch ? 'HOST_LABEL' : 'PATH_LABEL')
        };
      }
    }
    return null;
  }

  function classifySite(rawInput) {
    try {
      const input = exactInput(rawInput);
      let url;
      try { url = parseUrl(input.url); } catch (_error) { return INVALID_URL; }
      if (!['http:', 'https:'].includes(url.parsed.protocol)) {
        return freezeDecision(false, 'unsupported', 'UNSUPPORTED_PROTOCOL', 'URL_PROTOCOL');
      }
      const denylist = normalizeDenylist(input.userDenylist);
      if (denylist.some((entry) => url.hostname === entry || url.hostname.endsWith(`.${entry}`))) {
        return freezeDecision(false, 'user-denylist', 'USER_DENYLIST', 'HOST_LABEL');
      }
      const category = matchingCategory(url.hostname, url.parsed.pathname);
      if (category) {
        return freezeDecision(false, category.category, 'SENSITIVE_URL_CATEGORY', category.evidenceKind);
      }
      const scan = attributeScanOf(input);
      if (scan.status === 'blocked') {
        return freezeDecision(false, 'policy-error', scan.failureCode, 'POLICY_ERROR');
      }
      if (scan.signals.length) {
        return freezeDecision(false, 'sensitive-form', 'SENSITIVE_FORM_ATTRIBUTE', 'FORM_ATTRIBUTE');
      }
      return freezeDecision(true, 'public', 'ALLOW', 'NONE');
    } catch (_error) {
      return POLICY_INPUT_ERROR;
    }
  }

  return Object.freeze({
    POLICY_SCHEMA_VERSION,
    DENYLIST_LIMITS,
    ATTRIBUTE_SCAN_LIMITS,
    SECURITY_SELECTOR,
    POLICY_CATEGORIES,
    POLICY_REASON_CODES,
    POLICY_EVIDENCE_KINDS,
    ATTRIBUTE_SIGNALS,
    DEFAULT_CATEGORY_RULES,
    normalizeDenylist,
    scanSecurityAttributes,
    classifySite
  });
});
