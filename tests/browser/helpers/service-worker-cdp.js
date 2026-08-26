'use strict';

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
module.exports = Object.freeze({ stopExtensionServiceWorker });
