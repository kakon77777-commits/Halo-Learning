(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloProfilePersistence = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SETTINGS_LOCK_NAME = 'halo-settings-write';

  function createProfilePersistence(options) {
    const settings = options || {};
    const storage = settings.storage;
    const storageKey = settings.storageKey;
    const lockManager = settings.lockManager;
    const normalizeSettings = settings.normalizeSettings;
    const migrateSettings = settings.migrateSettings || normalizeSettings;
    const mergeUiSettings = settings.mergeUiSettings;
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
      throw new TypeError('storage: get and set are required');
    }
    if (typeof storageKey !== 'string' || !storageKey) throw new TypeError('storageKey: is required');
    if (typeof normalizeSettings !== 'function') throw new TypeError('normalizeSettings: must be a function');
    if (typeof mergeUiSettings !== 'function') throw new TypeError('mergeUiSettings: must be a function');

    async function load() {
      const stored = await storage.get(storageKey);
      return migrateSettings(stored && stored[storageKey]);
    }

    async function saveEdit(uiPatch) {
      if (!lockManager || typeof lockManager.request !== 'function') {
        throw new Error('LockManager is required for safe settings persistence');
      }
      return lockManager.request(SETTINGS_LOCK_NAME, { mode: 'exclusive' }, async () => {
        const current = await load();
        const next = mergeUiSettings(current, uiPatch, normalizeSettings);
        if (next.profileRevision !== current.profileRevision) {
          await storage.set({ [storageKey]: next });
        }
        return next;
      });
    }

    return Object.freeze({ load, saveEdit });
  }

  return Object.freeze({ SETTINGS_LOCK_NAME, createProfilePersistence });
});
