'use strict';

async function waitForExtensionServiceWorkerVersion(options) {
  const { session, scriptUrl, previousVersionId } = options || {};
  const timeoutMs = Number.isFinite(options && options.timeoutMs) ? options.timeoutMs : 5000;
  const schedule = options && options.setTimeout ? options.setTimeout : setTimeout;
  const unschedule = options && options.clearTimeout ? options.clearTimeout : clearTimeout;
  if (!session || typeof session.send !== 'function' || typeof session.on !== 'function' || typeof session.off !== 'function' ||
      typeof schedule !== 'function' || typeof unschedule !== 'function' ||
      typeof scriptUrl !== 'string' || !scriptUrl.startsWith('chrome-extension://') ||
      typeof previousVersionId !== 'string' || previousVersionId.length === 0) {
    throw new TypeError('CDP session, extension worker script URL, and previous version id are required');
  }

  let timer;
  let listener;
  let settled = false;
  const cleanup = () => {
    if (timer !== undefined) { const active = timer; timer = undefined; unschedule(active); }
    if (listener) { const active = listener; listener = null; session.off('ServiceWorker.workerVersionUpdated', active); }
  };
  const result = new Promise((resolve, reject) => {
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    listener = (event) => {
      const fresh = (event && Array.isArray(event.versions) ? event.versions : []).find((version) =>
        version && version.scriptURL === scriptUrl && version.status === 'activated' &&
        version.runningStatus === 'running' && typeof version.versionId === 'string' &&
        version.versionId.length > 0 && version.versionId !== previousVersionId);
      if (!fresh || settled) return;
      settled = true;
      const selected = fresh.versionId;
      cleanup();
      resolve(selected);
    };
    timer = schedule(() => fail(new Error('CDP fresh service-worker version timed out')), timeoutMs);
    session.on('ServiceWorker.workerVersionUpdated', listener);
    try { Promise.resolve(session.send('ServiceWorker.enable')).catch(fail); } catch (error) { fail(error); }
  });
  try {
    return await result;
  } finally {
    cleanup();
  }
}

async function waitForExtensionServiceWorkerTargetReplacement(options) {
  const { session, scriptUrl, action } = options || {};
  const timeoutMs = Number.isFinite(options && options.timeoutMs) ? options.timeoutMs : 5000;
  const schedule = options && options.setTimeout ? options.setTimeout : setTimeout;
  const unschedule = options && options.clearTimeout ? options.clearTimeout : clearTimeout;
  if (!session || typeof session.send !== 'function' || typeof session.on !== 'function' || typeof session.off !== 'function' ||
      typeof schedule !== 'function' || typeof unschedule !== 'function' ||
      typeof scriptUrl !== 'string' || !scriptUrl.startsWith('chrome-extension://') ||
      typeof action !== 'function') {
    throw new TypeError('CDP session, extension worker script URL, and reload action are required');
  }

  await session.send('Target.setDiscoverTargets', { discover: true });
  const snapshot = await session.send('Target.getTargets');
  const current = (snapshot && Array.isArray(snapshot.targetInfos) ? snapshot.targetInfos : []).find((target) =>
    target && target.type === 'service_worker' && target.url === scriptUrl &&
    typeof target.targetId === 'string' && target.targetId.length > 0);
  if (!current) throw new Error('current extension service-worker target is unavailable');

  let timer;
  let createdListener;
  let destroyedListener;
  let settled = false;
  let oldDestroyed = false;
  let replacementTargetId = null;
  const cleanup = () => {
    if (timer !== undefined) { const active = timer; timer = undefined; unschedule(active); }
    if (createdListener) { const active = createdListener; createdListener = null; session.off('Target.targetCreated', active); }
    if (destroyedListener) { const active = destroyedListener; destroyedListener = null; session.off('Target.targetDestroyed', active); }
  };

  return new Promise((resolve, reject) => {
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const maybeResolve = () => {
      if (settled || !oldDestroyed || !replacementTargetId) return;
      settled = true;
      const result = Object.freeze({
        oldTargetId: current.targetId,
        newTargetId: replacementTargetId
      });
      cleanup();
      resolve(result);
    };
    createdListener = (event) => {
      const target = event && event.targetInfo;
      if (!target || target.type !== 'service_worker' || target.url !== scriptUrl ||
          typeof target.targetId !== 'string' || target.targetId.length === 0 ||
          target.targetId === current.targetId) return;
      replacementTargetId = target.targetId;
      maybeResolve();
    };
    destroyedListener = (event) => {
      if (!event || event.targetId !== current.targetId) return;
      oldDestroyed = true;
      maybeResolve();
    };
    timer = schedule(() => fail(new Error('CDP extension service-worker target replacement timed out')), timeoutMs);
    session.on('Target.targetCreated', createdListener);
    session.on('Target.targetDestroyed', destroyedListener);
    try {
      Promise.resolve(action()).catch(fail);
    } catch (error) {
      fail(error);
    }
  }).finally(cleanup);
}

async function stopExtensionServiceWorker(options) {
  const { session, scriptUrl } = options || {};
  const timeoutMs = Number.isFinite(options && options.timeoutMs) ? options.timeoutMs : 5000;
  const schedule = options && options.setTimeout ? options.setTimeout : setTimeout;
  const unschedule = options && options.clearTimeout ? options.clearTimeout : clearTimeout;
  if (!session || typeof session.send !== 'function' || typeof session.on !== 'function' || typeof session.off !== 'function' ||
      typeof schedule !== 'function' || typeof unschedule !== 'function' ||
      typeof scriptUrl !== 'string' || !scriptUrl.startsWith('chrome-extension://')) throw new TypeError('CDP session with on/off and extension worker script URL is required');
  let lookupTimer;
  let stopTimer;
  let lookupListener;
  let stopListener;
  function cleanupLookup() {
    if (lookupTimer !== undefined) { const timer = lookupTimer; lookupTimer = undefined; unschedule(timer); }
    if (lookupListener) { const listener = lookupListener; lookupListener = null; session.off('ServiceWorker.workerVersionUpdated', listener); }
  }
  function cleanupStop() {
    if (stopTimer !== undefined) { const timer = stopTimer; stopTimer = undefined; unschedule(timer); }
    if (stopListener) { const listener = stopListener; stopListener = null; session.off('ServiceWorker.workerVersionUpdated', listener); }
  }
  try {
    const versionId = await new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanupLookup();
        reject(error);
      };
      lookupListener = (event) => {
        const live = (event && Array.isArray(event.versions) ? event.versions : []).find((version) => version && version.scriptURL === scriptUrl && version.status === 'activated' && version.runningStatus === 'running' && typeof version.versionId === 'string');
        if (!live || settled) return;
        settled = true;
        const selected = live.versionId;
        cleanupLookup();
        resolve(selected);
      };
      lookupTimer = schedule(() => fail(new Error('CDP service-worker lookup timed out')), timeoutMs);
      session.on('ServiceWorker.workerVersionUpdated', lookupListener);
      try { Promise.resolve(session.send('ServiceWorker.enable')).catch(fail); } catch (error) { fail(error); }
    });
    let stopIssued = false;
    const stopped = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        cleanupStop();
        if (error) reject(error); else resolve();
      };
      stopListener = (event) => {
        if (!stopIssued) return;
        const match = (event && Array.isArray(event.versions) ? event.versions : []).find((version) => version && version.versionId === versionId && version.scriptURL === scriptUrl && version.runningStatus === 'stopped');
        if (match) finish();
      };
      stopTimer = schedule(() => finish(new Error('CDP service-worker stop timed out')), timeoutMs);
      session.on('ServiceWorker.workerVersionUpdated', stopListener);
    });
    stopIssued = true;
    let sent;
    try { sent = Promise.resolve(session.send('ServiceWorker.stopWorker', { versionId })); } catch (error) { sent = Promise.reject(error); }
    await Promise.all([sent, stopped]);
    return versionId;
  } finally {
    cleanupLookup();
    cleanupStop();
  }
}
module.exports = Object.freeze({
  stopExtensionServiceWorker,
  waitForExtensionServiceWorkerTargetReplacement,
  waitForExtensionServiceWorkerVersion
});
