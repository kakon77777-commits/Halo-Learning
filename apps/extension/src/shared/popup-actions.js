(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloPopupActions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createActionMutex(rawControls) {
    const controls = [...new Set(Array.from(rawControls || []))].filter(Boolean);
    let owner = null;

    async function run(operation) {
      if (typeof operation !== 'function') throw new TypeError('operation: must be a function');
      if (owner !== null) return Object.freeze({ accepted: false, busy: true });
      const token = Object.freeze({});
      owner = token;
      const prior = controls.map((control) => Boolean(control.disabled));
      for (const control of controls) control.disabled = true;
      try {
        return await operation();
      } finally {
        if (owner === token) {
          controls.forEach((control, index) => { control.disabled = prior[index]; });
          owner = null;
        }
      }
    }

    return Object.freeze({ run, busy: () => owner !== null });
  }

  return Object.freeze({ createActionMutex });
});
