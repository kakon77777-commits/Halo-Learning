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
    const onError = typeof settings.onError === 'function' ? settings.onError : () => {};
    const primeThresholdMs = finiteDelay(settings.primeThresholdMs, 600, 'primeThresholdMs');
    const openThresholdMs = finiteDelay(settings.openThresholdMs, 1000, 'openThresholdMs');
    const dismissDelayMs = finiteDelay(settings.dismissDelayMs, 180, 'dismissDelayMs');
    if (openThresholdMs < primeThresholdMs) {
      throw new TypeError('openThresholdMs: must be greater than or equal to primeThresholdMs');
    }

    let current = frozenState({ name: 'idle' });
    let lastAt = -Infinity;
    let lastPriority = -Infinity;
    let hoverGeneration = 0;
    let dismissGeneration = 0;
    let hoverTimer = null;
    let dismissTimer = null;
    let transitionGeneration = 0;
    let dispatchSerial = 0;

    function safeEffect(effect) {
      try {
        effect();
      } catch (error) {
        try { onError(error); } catch (_ignored) {}
      }
    }

    function cancelHover(serial) {
      hoverGeneration += 1;
      const timer = hoverTimer;
      const handle = timer && typeof timer === 'object' ? timer.handle : timer;
      hoverTimer = null;
      if (handle !== null) safeEffect(() => unschedule(handle));
      return serial === undefined || serial === transitionGeneration;
    }

    function cancelDismiss(serial) {
      dismissGeneration += 1;
      const timer = dismissTimer;
      const handle = timer && typeof timer === 'object' ? timer.handle : timer;
      dismissTimer = null;
      if (handle !== null) safeEffect(() => unschedule(handle));
      return serial === undefined || serial === transitionGeneration;
    }

    function cancelTimers(serial) {
      if (!cancelHover(serial)) return false;
      return cancelDismiss(serial);
    }

    function scheduleHover(targetId, delay, serial) {
      const generation = hoverGeneration;
      const slot = { handle: null };
      hoverTimer = slot;
      let handle;
      try { handle = schedule(() => {
        if (hoverTimer === slot) hoverTimer = null;
        dispatch({
          type: 'HOVER_THRESHOLD',
          targetId,
          generation,
          at: Math.max(lastAt, Number(now()) || 0)
        });
      }, delay); } catch (error) { if (hoverTimer === slot) hoverTimer = null; safeEffect(() => { throw error; }); return false; }
      if (hoverTimer !== slot || (serial !== undefined && serial !== transitionGeneration)) { safeEffect(() => unschedule(handle)); return false; }
      slot.handle = handle;
      return true;
    }

    function scheduleDismiss(targetId, serial) {
      const transition = transitionGeneration;
      if (!cancelDismiss(serial) || transition !== transitionGeneration) return;
      const generation = dismissGeneration;
      const slot = { handle: null };
      dismissTimer = slot;
      let handle;
      try { handle = schedule(() => {
        if (dismissTimer === slot) dismissTimer = null;
        dispatch({
          type: 'DISMISS_TIMEOUT',
          targetId,
          generation,
          at: Math.max(lastAt, Number(now()) || 0)
        });
      }, dismissDelayMs); } catch (error) { if (dismissTimer === slot) dismissTimer = null; safeEffect(() => { throw error; }); return; }
      if (dismissTimer !== slot || (serial !== undefined && serial !== transitionGeneration)) { safeEffect(() => unschedule(handle)); return; }
      slot.handle = handle;
    }

    function open(targetId, source, serial) {
      current = frozenState({ name: 'core-open', targetId, source });
      const transition = ++transitionGeneration;
      if (!cancelTimers(transition) || transition !== transitionGeneration) return current;
      safeEffect(() => openPanel(Object.freeze({ targetId, source })));
      return current;
    }

    function dismiss(reason, serial) {
      if (current.name === 'idle' || current.name === 'dismissed') return current;
      const targetId = current.targetId;
      const wasOpen = current.name === 'core-open';
      current = frozenState({ name: 'dismissed', targetId, reason });
      const transition = ++transitionGeneration;
      if (!cancelTimers(transition) || transition !== transitionGeneration) return current;
      if (wasOpen) safeEffect(() => closePanel(reason));
      return current;
    }

    function beginHover(targetId, serial) {
      if (current.name === 'core-open' && current.targetId === targetId) {
        const intent = ++transitionGeneration;
        cancelDismiss(intent);
        return current;
      }
      if (settings.mode === 'explicit-only') return current;
      if ((current.name === 'candidate' || current.name === 'primed') && current.targetId === targetId) {
        return current;
      }
      const wasOpen = current.name === 'core-open';
      current = frozenState({ name: 'candidate', targetId });
      const transition = ++transitionGeneration;
      if (!cancelTimers(transition) || transition !== transitionGeneration) return current;
      if (wasOpen) safeEffect(() => closePanel('target-switch'));
      if (current.name !== 'candidate' || current.targetId !== targetId) return current;
      scheduleHover(targetId, primeThresholdMs, transition);
      return current;
    }

    function threshold(event, serial) {
      const targetId = targetIdOf(event);
      if (event.generation !== undefined && event.generation !== hoverGeneration) return current;
      if (current.targetId !== targetId) return current;
      if (current.name === 'candidate') {
        current = frozenState({ name: 'primed', targetId });
        const intent = ++transitionGeneration;
        scheduleHover(targetId, openThresholdMs - primeThresholdMs, intent);
        return current;
      }
      if (current.name === 'primed') return open(targetId, 'hover', serial);
      return current;
    }

    function terminate(type, serial) {
      const wasOpen = current.name === 'core-open';
      current = frozenState({ name: 'cancelled' });
      transitionGeneration += 1;
      cancelTimers();
      if (wasOpen) safeEffect(() => closePanel(type === 'ROUTE_CLEANUP' ? 'route-cleanup' : 'cancel'));
      return current;
    }

    function dispatch(rawEvent) {
      const serial = ++dispatchSerial;
      if (current.name === 'cancelled') return current;
      if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent) ||
          !TRIGGER_EVENTS.has(rawEvent.type)) {
        throw new TypeError('event.type: is not a canonical trigger event');
      }
      const at = eventAt(rawEvent, now);
      const explicit = rawEvent.type === 'EXPLICIT_OPEN' || rawEvent.type === 'MODIFIER_HOVER';
      const terminal = rawEvent.type === 'ROUTE_CLEANUP' || rawEvent.type === 'CANCEL';
      const priority = terminal ? 2 : (explicit ? 1 : 0);
      if (!explicit && !terminal && at < lastAt) return current;
      if (!explicit && !terminal && at === lastAt && lastPriority > priority) {
        if (rawEvent.type === 'HOVER_THRESHOLD') return current;
        if (rawEvent.type === 'POINTER_ENTER') {
          const targetId = targetIdOf(rawEvent);
          if (current.name !== 'core-open' || current.source !== 'explicit' || current.targetId !== targetId) return current;
        }
      }
      if (at > lastAt) {
        lastAt = at;
        lastPriority = priority;
      } else if (at === lastAt) {
        lastPriority = Math.max(lastPriority, priority);
      } else if (explicit || terminal) {
        lastPriority = Math.max(lastPriority, priority);
      }

      if (terminal) return terminate(rawEvent.type, serial);
      if (rawEvent.type === 'EXPLICIT_OPEN' || rawEvent.type === 'MODIFIER_HOVER') {
        return open(targetIdOf(rawEvent), 'explicit', serial);
      }
      if (rawEvent.type === 'POINTER_ENTER') return beginHover(targetIdOf(rawEvent), serial);
      if (rawEvent.type === 'POINTER_LEAVE') {
        const targetId = targetIdOf(rawEvent);
        if (current.targetId !== targetId) return current;
        if (current.name === 'candidate' || current.name === 'primed') {
          current = frozenState({ name: 'idle' });
          transitionGeneration += 1;
          cancelHover(serial);
        } else if (current.name === 'core-open') {
          const intent = ++transitionGeneration;
          scheduleDismiss(targetId, intent);
        }
        return current;
      }
      if (rawEvent.type === 'HOVER_THRESHOLD') return threshold(rawEvent, serial);
      if (rawEvent.type === 'DISMISS_TIMEOUT') {
        const targetId = targetIdOf(rawEvent);
        if (rawEvent.generation !== undefined && rawEvent.generation !== dismissGeneration) return current;
        if (current.name !== 'core-open' || current.targetId !== targetId) return current;
        return dismiss('pointer-leave', serial);
      }
      if (rawEvent.type === 'OUTSIDE_CLICK') return dismiss('outside-click', serial);
      if (rawEvent.type === 'ESCAPE') return dismiss('escape', serial);
      return current;
    }

    return Object.freeze({ dispatch, state: () => current });
  }

  return Object.freeze({ TRIGGER_MODES, createTriggerController });
});
