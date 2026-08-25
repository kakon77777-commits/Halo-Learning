(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloTriggerController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const TRIGGER_MODES = Object.freeze(['adaptive-hover', 'explicit-only', 'hybrid']);
  const TRIGGER_EVENTS = new Set([
    'POINTER_ENTER',
    'POINTER_LEAVE',
    'MODIFIER_HOVER',
    'HOVER_THRESHOLD',
    'EXPLICIT_OPEN',
    'OUTSIDE_CLICK',
    'ESCAPE',
    'DISMISS_TIMEOUT',
    'ROUTE_CLEANUP',
    'CANCEL'
  ]);

  function frozenState(value) {
    return Object.freeze(value);
  }

  function finiteDelay(value, fallback, name) {
    const number = value === undefined ? fallback : Number(value);
    if (!Number.isFinite(number) || number < 0) {
      throw new TypeError(`${name}: must be a finite non-negative number`);
    }
    return number;
  }

  function targetIdOf(event) {
    if (!event || typeof event.targetId !== 'string' || !event.targetId || event.targetId.length > 256) {
      throw new TypeError('event.targetId: must be a non-empty string of at most 256 characters');
    }
    return event.targetId;
  }

  function eventAt(event, now) {
    const value = event.at === undefined ? now() : Number(event.at);
    if (!Number.isFinite(value) || value < 0) throw new TypeError('event.at: must be a finite non-negative number');
    return value;
  }

  function createTriggerController(options) {
    const settings = options || {};
    if (!TRIGGER_MODES.includes(settings.mode)) {
      throw new TypeError('mode: must be adaptive-hover, explicit-only, or hybrid');
    }
    const schedule = settings.setTimeout || root.setTimeout;
    const unschedule = settings.clearTimeout || root.clearTimeout;
    if (typeof schedule !== 'function' || typeof unschedule !== 'function') {
      throw new TypeError('setTimeout and clearTimeout are required');
    }
    const now = typeof settings.now === 'function' ? settings.now : () => Date.now();
    const openPanel = typeof settings.openPanel === 'function' ? settings.openPanel : () => {};
    const closePanel = typeof settings.closePanel === 'function' ? settings.closePanel : () => {};
    const primeThresholdMs = finiteDelay(settings.primeThresholdMs, 600, 'primeThresholdMs');
    const openThresholdMs = finiteDelay(settings.openThresholdMs, 1000, 'openThresholdMs');
    const dismissDelayMs = finiteDelay(settings.dismissDelayMs, 180, 'dismissDelayMs');
    if (openThresholdMs < primeThresholdMs) {
      throw new TypeError('openThresholdMs: must be greater than or equal to primeThresholdMs');
    }

    let current = frozenState({ name: 'idle' });
    let lastAt = -Infinity;
    let hoverGeneration = 0;
    let dismissGeneration = 0;
    let hoverTimer = null;
    let dismissTimer = null;

    function cancelHover() {
      hoverGeneration += 1;
      if (hoverTimer !== null) unschedule(hoverTimer);
      hoverTimer = null;
    }

    function cancelDismiss() {
      dismissGeneration += 1;
      if (dismissTimer !== null) unschedule(dismissTimer);
      dismissTimer = null;
    }

    function cancelTimers() {
      cancelHover();
      cancelDismiss();
    }

    function scheduleHover(targetId, delay) {
      const generation = hoverGeneration;
      hoverTimer = schedule(() => {
        hoverTimer = null;
        dispatch({
          type: 'HOVER_THRESHOLD',
          targetId,
          generation,
          at: Math.max(lastAt, Number(now()) || 0)
        });
      }, delay);
    }

    function scheduleDismiss(targetId) {
      cancelDismiss();
      const generation = dismissGeneration;
      dismissTimer = schedule(() => {
        dismissTimer = null;
        dispatch({
          type: 'DISMISS_TIMEOUT',
          targetId,
          generation,
          at: Math.max(lastAt, Number(now()) || 0)
        });
      }, dismissDelayMs);
    }

    function open(targetId, source) {
      cancelTimers();
      const next = frozenState({ name: 'core-open', targetId, source });
      openPanel(Object.freeze({ targetId, source }));
      current = next;
      return current;
    }

    function dismiss(reason) {
      cancelTimers();
      if (current.name === 'idle' || current.name === 'dismissed') return current;
      const targetId = current.targetId;
      if (current.name === 'core-open') closePanel(reason);
      current = frozenState({ name: 'dismissed', targetId, reason });
      return current;
    }

    function beginHover(targetId) {
      if (settings.mode === 'explicit-only') return current;
      if (current.name === 'core-open' && current.targetId === targetId) {
        cancelDismiss();
        return current;
      }
      if ((current.name === 'candidate' || current.name === 'primed') && current.targetId === targetId) {
        return current;
      }
      if (current.name === 'core-open') closePanel('target-switch');
      cancelTimers();
      current = frozenState({ name: 'candidate', targetId });
      scheduleHover(targetId, primeThresholdMs);
      return current;
    }

    function threshold(event) {
      const targetId = targetIdOf(event);
      if (event.generation !== undefined && event.generation !== hoverGeneration) return current;
      if (current.targetId !== targetId) return current;
      if (current.name === 'candidate') {
        current = frozenState({ name: 'primed', targetId });
        scheduleHover(targetId, openThresholdMs - primeThresholdMs);
        return current;
      }
      if (current.name === 'primed') return open(targetId, 'hover');
      return current;
    }

    function terminate(type) {
      cancelTimers();
      if (current.name === 'core-open') closePanel(type === 'ROUTE_CLEANUP' ? 'route-cleanup' : 'cancel');
      current = frozenState({ name: 'cancelled' });
      return current;
    }

    function dispatch(rawEvent) {
      if (current.name === 'cancelled') return current;
      if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent) ||
          !TRIGGER_EVENTS.has(rawEvent.type)) {
        throw new TypeError('event.type: is not a canonical trigger event');
      }
      const at = eventAt(rawEvent, now);
      const explicit = rawEvent.type === 'EXPLICIT_OPEN' || rawEvent.type === 'MODIFIER_HOVER';
      if (!explicit && at < lastAt) return current;
      lastAt = Math.max(lastAt, at);

      if (rawEvent.type === 'ROUTE_CLEANUP' || rawEvent.type === 'CANCEL') return terminate(rawEvent.type);
      if (rawEvent.type === 'EXPLICIT_OPEN' || rawEvent.type === 'MODIFIER_HOVER') {
        return open(targetIdOf(rawEvent), 'explicit');
      }
      if (rawEvent.type === 'POINTER_ENTER') return beginHover(targetIdOf(rawEvent));
      if (rawEvent.type === 'POINTER_LEAVE') {
        const targetId = targetIdOf(rawEvent);
        if (current.targetId !== targetId) return current;
        if (current.name === 'candidate' || current.name === 'primed') {
          cancelHover();
          current = frozenState({ name: 'idle' });
        } else if (current.name === 'core-open') {
          scheduleDismiss(targetId);
        }
        return current;
      }
      if (rawEvent.type === 'HOVER_THRESHOLD') return threshold(rawEvent);
      if (rawEvent.type === 'DISMISS_TIMEOUT') {
        const targetId = targetIdOf(rawEvent);
        if (rawEvent.generation !== undefined && rawEvent.generation !== dismissGeneration) return current;
        if (current.name !== 'core-open' || current.targetId !== targetId) return current;
        return dismiss('pointer-leave');
      }
      if (rawEvent.type === 'OUTSIDE_CLICK') return dismiss('outside-click');
      if (rawEvent.type === 'ESCAPE') return dismiss('escape');
      return current;
    }

    return Object.freeze({ dispatch, state: () => current });
  }

  return Object.freeze({ TRIGGER_MODES, createTriggerController });
});
