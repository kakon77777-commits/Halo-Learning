(function (root) {
  'use strict';

  const status = document.getElementById('dogfoodCaptureStatus');
  const dashboard = document.getElementById('openDashboardButton');
  if (!status || !dashboard || !root.chrome || !root.chrome.runtime) return;

  async function refreshStatus() {
    try {
      const value = await root.chrome.runtime.sendMessage({ type: 'HALO_DOGFOOD_STATUS' });
      if (!value || value.schemaVersion !== 1) throw new Error('status unavailable');
      status.textContent = value.captureEnabled
        ? 'Local capture active · 本機紀錄中'
        : 'Local capture paused · 本機紀錄已暫停';
    } catch (_error) {
      status.textContent = 'Local capture unavailable · 本機紀錄無法取得';
    }
  }

  dashboard.addEventListener('click', () => {
    try {
      const result = root.chrome.runtime.openOptionsPage();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_error) {}
  });

  refreshStatus();
})(typeof globalThis !== 'undefined' ? globalThis : this);
