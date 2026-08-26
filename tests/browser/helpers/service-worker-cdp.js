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
    const versionId = await new Promise((resolve, reject) => {
      listener = (event) => {
        for (const version of event && Array.isArray(event.versions) ? event.versions : []) {
          if (version && version.scriptURL === scriptUrl && typeof version.versionId === 'string') {
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
    return versionId;
  } finally {
    clearTimeout(timer);
    if (listener && typeof session.off === 'function') session.off('ServiceWorker.workerVersionUpdated', listener);
  }
}

module.exports = Object.freeze({ stopExtensionServiceWorker });
