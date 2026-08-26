'use strict';

async function stopExtensionServiceWorker(options) {
  const { session, scriptUrl } = options || {};
  const timeoutMs = Number.isFinite(options && options.timeoutMs) ? options.timeoutMs : 5000;
  if (!session || typeof session.send !== 'function' || typeof session.on !== 'function' ||
      typeof scriptUrl !== 'string' || !scriptUrl.startsWith('chrome-extension://')) {
    throw new TypeError('CDP session and extension worker script URL are required');
  }
  let timer;
  let listener;
  try {
    let stoppedResolve;
    let selectedVersionId = null;
    const stopped = new Promise((resolve) => { stoppedResolve = resolve; });
    const versionId = await new Promise((resolve, reject) => {
      listener = (event) => {
        for (const version of event && Array.isArray(event.versions) ? event.versions : []) {
          if (version && version.scriptURL === scriptUrl && version.versionId === selectedVersionId &&
              version.runningStatus === 'stopped') stoppedResolve(version.versionId);
          if (version && version.scriptURL === scriptUrl && version.status === 'activated' &&
              version.runningStatus === 'running' && typeof version.versionId === 'string') {
            selectedVersionId = version.versionId;
            resolve(version.versionId);
            return;
          }
        }
      };
      session.on('ServiceWorker.workerVersionUpdated', listener);
      timer = setTimeout(() => reject(new Error('CDP service-worker lookup timed out')), timeoutMs);
      Promise.resolve(session.send('ServiceWorker.enable')).catch(reject);
    });
    await session.send('ServiceWorker.stopWorker', { versionId });
    const stoppedId = await Promise.race([stopped, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('CDP service-worker stop timed out')), timeoutMs);
    })]);
    if (stoppedId !== versionId) throw new Error('CDP stopped the wrong service-worker version');
    return versionId;
  } finally {
    clearTimeout(timer);
    if (listener && typeof session.off === 'function') session.off('ServiceWorker.workerVersionUpdated', listener);
  }
}

module.exports = Object.freeze({ stopExtensionServiceWorker });
