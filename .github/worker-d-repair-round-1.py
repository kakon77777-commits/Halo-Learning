from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    source = target.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: replacement count={count}; expected 1")
    target.write_text(source.replace(old, new), encoding="utf-8", newline="\n")


replace_once(
    "tests/browser/dynamic-dom.e2e.test.js",
    """        Object.defineProperty(globalThis, 'chrome', {
          configurable: true,
          value: {
            runtime: {
              onMessage: { addListener: (listener) => listeners.push(listener) },
              sendMessage: async (message) => {
                if (message.type === 'HALO_CANCEL_REQUEST') {
                  cancelRequests.push(message.requestId);
                  return { status: 'cancelled' };
                }
                if (message.type !== 'HALO_ENRICH_BATCH') return null;
                semanticRequests.push(message);
                if (message.items.some((item) => item.text === 'Pending semantic response.')) {
                  return new Promise((resolve) => pendingResponses.set(message.requestId, { resolve, message }));
                }
                return responseFor(message);
              }
            }
          }
        });
""",
    """        const chromeNamespace = globalThis.chrome && typeof globalThis.chrome === 'object'
          ? globalThis.chrome
          : {};
        if (globalThis.chrome !== chromeNamespace) {
          Object.defineProperty(globalThis, 'chrome', { configurable: true, value: chromeNamespace });
        }
        Object.defineProperty(chromeNamespace, 'runtime', {
          configurable: true,
          writable: true,
          value: {
            onMessage: { addListener: (listener) => listeners.push(listener) },
            sendMessage: async (message) => {
              if (message.type === 'HALO_CANCEL_REQUEST') {
                cancelRequests.push(message.requestId);
                return { status: 'cancelled' };
              }
              if (message.type !== 'HALO_ENRICH_BATCH') return null;
              semanticRequests.push(message);
              if (message.items.some((item) => item.text === 'Pending semantic response.')) {
                return new Promise((resolve) => pendingResponses.set(message.requestId, { resolve, message }));
              }
              return responseFor(message);
            }
          }
        });
""",
)

replace_once(
    "scripts/collect-worker-b-browser-evidence.js",
    """    const restartEvent = context.waitForEvent('serviceworker', { timeout: 12_000 });
    const statusResponse = page.evaluate(() => chrome.runtime.sendMessage({ type: 'HALO_DICTIONARY_STATUS' }));
    const restartedWorker = await restartEvent;
    status = await statusResponse;
    details.workerRestart = { stoppedVersionId: stopped, status };
    gates.workerRestart = Boolean(typeof stopped === 'string' && Boolean(stopped) && restartedWorker !== worker && status && status.mode === 'ready');
    const restartedLifetime = status && status.networkActivity && status.networkActivity.lifetimeId;
    gates.cacheLossReload = Boolean(initialLifetime && restartedLifetime && initialLifetime !== restartedLifetime &&
      status.networkActivity.fetchAttempts >= 1);
    worker = restartedWorker;
""",
    """    // Playwright keeps the same Worker handle across MV3 idle/restart cycles and does not
    // emit a second `serviceworker` event. The CDP stop above proves suspension; a successful
    // runtime message on the retained handle proves browser-driven restart, while the runtime
    // lifetime id proves a fresh service-worker lifetime/cache reload.
    status = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'HALO_DICTIONARY_STATUS' }));
    const restartedLifetime = status && status.networkActivity && status.networkActivity.lifetimeId;
    details.workerRestart = {
      stoppedVersionId: stopped,
      workerHandleReused: true,
      initialLifetime,
      restartedLifetime,
      status
    };
    gates.workerRestart = Boolean(typeof stopped === 'string' && Boolean(stopped) &&
      status && status.mode === 'ready' && initialLifetime && restartedLifetime &&
      initialLifetime !== restartedLifetime);
    gates.cacheLossReload = Boolean(initialLifetime && restartedLifetime && initialLifetime !== restartedLifetime &&
      status.networkActivity.fetchAttempts >= 1);
""",
)
