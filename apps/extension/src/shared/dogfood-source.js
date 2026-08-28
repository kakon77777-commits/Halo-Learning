(function (root, factory) {
  const contractsModule = typeof module === 'object' && module.exports
    ? require('./dogfood-contracts')
    : root.HaloDogfoodContracts;
  const api = factory(root, contractsModule);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDogfoodSource = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Contracts) {
  'use strict';

  const PATH_NORMALIZATION_VERSION = 'path-v1';

  function normalizePageUrl(value) {
    if (typeof value !== 'string' || !value || value.length > 4096) {
      throw new TypeError('url: bounded string required');
    }
    let parsed;
    try {
      parsed = new root.URL(value);
    } catch (_error) {
      throw new TypeError('url: valid absolute URL required');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new TypeError('url: only credential-free http/https pages are supported');
    }
    const domain = parsed.hostname.toLowerCase();
    if (!domain || domain.length > 253) throw new TypeError('url: canonical hostname required');
    return Object.freeze({
      domain,
      pathname: parsed.pathname || '/',
      fullUrl: parsed.href
    });
  }

  function resolveCrypto(cryptoApi) {
    const value = cryptoApi || root.crypto;
    if (!value || !value.subtle || typeof value.subtle.digest !== 'function') {
      throw new TypeError('cryptoApi.subtle.digest: required');
    }
    return value;
  }

  async function sha256Text(value, cryptoApi) {
    const text = String(value);
    const encoder = typeof root.TextEncoder === 'function' ? new root.TextEncoder() : null;
    if (!encoder) throw new TypeError('TextEncoder: required');
    const bytes = encoder.encode(text);
    const digest = await resolveCrypto(cryptoApi).subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `sha256:${hex}`;
  }

  async function createSourceRef(options) {
    const settings = options || {};
    const normalized = normalizePageUrl(settings.url);
    const language = settings.language === undefined ? 'und' : settings.language;
    const normalizedPathHash = await sha256Text(normalized.pathname, settings.cryptoApi);
    const sourceId = await sha256Text(`${normalized.domain}\n${normalizedPathHash}`, settings.cryptoApi);
    const value = {
      schema: 'SourceRef/v1',
      sourceId,
      domain: normalized.domain,
      normalizedPathHash,
      pathNormalizationVersion: PATH_NORMALIZATION_VERSION,
      fullUrl: settings.retainFullUrl === true ? normalized.fullUrl : null,
      language
    };
    return Contracts && typeof Contracts.normalizeSourceRef === 'function'
      ? Contracts.normalizeSourceRef(value)
      : Object.freeze(value);
  }

  async function createLocalControlSourceRef(options) {
    const settings = options || {};
    return createSourceRef({
      url: 'https://halo.local/data-privacy',
      language: 'und',
      retainFullUrl: false,
      cryptoApi: settings.cryptoApi
    });
  }

  async function createSentenceHash(text, cryptoApi) {
    if (typeof text !== 'string' || !text || text.length > 12000) {
      throw new TypeError('sentence text: non-empty string of at most 12000 characters required');
    }
    return sha256Text(text, cryptoApi);
  }

  return Object.freeze({
    PATH_NORMALIZATION_VERSION,
    normalizePageUrl,
    sha256Text,
    createSourceRef,
    createLocalControlSourceRef,
    createSentenceHash
  });
});
