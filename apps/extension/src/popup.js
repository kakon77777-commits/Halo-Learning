(function () {
  'use strict';

  const STORAGE_KEY = 'haloSettings';
  const CHANNEL_CONTROLS = Object.freeze({
    posLabel: 'posLabels',
    posColor: 'posColors',
    lemma: 'lemma',
    morphology: 'morphology',
    glossHint: 'glossHint',
    grammarRole: 'grammarRole',
    tenseAspect: 'tenseAspect',
    chunk: 'chunk',
    learningState: 'learningState'
  });
  let currentSettings = null;
  const profilePersistence = HaloProfilePersistence.createProfilePersistence({
    storage: chrome.storage.local,
    storageKey: STORAGE_KEY,
    lockManager: navigator.locks,
    normalizeSettings: HaloSettings.normalizeSettings,
    migrateSettings: HaloSettings.migrateSettings,
    mergeUiSettings: HaloProfileControls.mergeUiSettings
  });

  const get = (id) => document.getElementById(id);
  const controls = {
    density: get('density'),
    densityValue: get('densityValue'),
    languageMode: get('languageMode'),
    labelPosition: get('labelPosition'),
    triggerMode: get('triggerMode'),
    sitePolicyHost: get('sitePolicyHost'),
    blockSiteButton: get('blockSiteButton'),
    allowSiteButton: get('allowSiteButton'),
    analyzeSelectionButton: get('analyzeSelectionButton'),
    applyButton: get('applyButton'),
    removeButton: get('removeButton'),
    status: get('status')
  };
  for (const [channel, id] of Object.entries(CHANNEL_CONTROLS)) controls[channel] = get(id);
  const actionMutex = HaloPopupActions.createActionMutex(document.querySelectorAll('input, select, button'));

  function showStatus(message, isError) {
    controls.status.textContent = message;
    controls.status.classList.toggle('error', Boolean(isError));
  }

  function renderSettings(settings) {
    currentSettings = settings;
    for (const channel of Object.keys(CHANNEL_CONTROLS)) {
      controls[channel].checked = Boolean(settings.channels[channel]);
    }
    controls.density.value = String(Math.round(settings.density * 100));
    controls.densityValue.value = `${Math.round(settings.density * 100)}%`;
    controls.languageMode.value = settings.languageMode;
    controls.labelPosition.value = settings.labelPosition;
    controls.triggerMode.value = settings.triggerMode;
  }

  function readUiPatch() {
    const baseline = currentSettings || HaloSettings.DEFAULT_SETTINGS;
    const patch = {};
    const channels = {};
    for (const channel of Object.keys(CHANNEL_CONTROLS)) {
      const value = controls[channel].checked;
      if (value !== Boolean(baseline.channels[channel])) channels[channel] = value;
    }
    if (Object.keys(channels).length) patch.channels = channels;
    const density = Number(controls.density.value) / 100;
    if (density !== baseline.density) patch.density = density;
    if (controls.languageMode.value !== baseline.languageMode) patch.languageMode = controls.languageMode.value;
    if (controls.labelPosition.value !== baseline.labelPosition) patch.labelPosition = controls.labelPosition.value;
    if (controls.triggerMode.value !== baseline.triggerMode) patch.triggerMode = controls.triggerMode.value;
    return patch;
  }

  async function persistSettings(uiPatch) {
    const settings = await profilePersistence.saveEdit(uiPatch || readUiPatch());
    renderSettings(settings);
    return settings;
  }

  async function currentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !Number.isInteger(tab.id)) throw new Error('No active browser tab');
    return tab;
  }

  function exactTabHostname(tab) {
    if (!tab || typeof tab.url !== 'string') throw new Error('Current host is unavailable');
    const url = new URL(tab.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('This page cannot be added');
    return HaloSitePolicy.normalizeDenylist([url.hostname])[0];
  }

  function renderCurrentHost(hostname) {
    const denied = Boolean(currentSettings &&
      currentSettings.sitePolicy.userDenylist.includes(hostname));
    controls.sitePolicyHost.value = `${hostname} · ${denied ? 'Blocked / 已封鎖' : 'Allowed / 允許'}`;
    controls.blockSiteButton.disabled = denied;
    controls.allowSiteButton.disabled = !denied;
  }

  async function refreshCurrentHost() {
    const tab = await currentTab();
    const hostname = exactTabHostname(tab);
    renderCurrentHost(hostname);
    return Object.freeze({ tab, hostname });
  }

  async function setCurrentHostBlocked(blocked) {
    const result = await actionMutex.run(async () => {
      try {
        const { tab, hostname } = await refreshCurrentHost();
        const denylist = new Set(currentSettings.sitePolicy.userDenylist);
        if (blocked) denylist.add(hostname);
        else denylist.delete(hostname);
        const sitePolicy = {
          schemaVersion: 1,
          userDenylist: HaloSitePolicy.normalizeDenylist([...denylist])
        };
        const settings = await persistSettings({ sitePolicy });
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'HALO_POLICY_REEVALUATE', settings });
        } catch (_error) {
          // A tab without an injected Halo runtime has no work to clean up.
        }
        showStatus(blocked
          ? 'Host blocked locally · 已在本機封鎖'
          : 'Host removed from block list · 已移除封鎖', false);
        return Object.freeze({ hostname });
      } catch (error) {
        showStatus(`Site policy error · ${error.message || error}`, true);
        return null;
      }
    });
    if (result && result.hostname) renderCurrentHost(result.hostname);
    return result;
  }

  async function inject(tabId) {
    await HaloBrowserEntry.injectPackagedRuntime({ chrome, tabId });
  }

  async function analyzeSelection() {
    return actionMutex.run(async () => {
      showStatus('Analyzing selection… · 正在解析選取', false);
      try {
        await persistSettings();
        const tab = await currentTab();
        const result = await HaloBrowserEntry.injectAndSendExplicitSelection({ chrome, tabId: tab.id });
        if (!result || result.accepted !== true) {
          showStatus('Select page text first · 請先選取頁面文字', false);
          return;
        }
        showStatus('Selection opened locally · 已在本機開啟', false);
      } catch (error) {
        showStatus(`Cannot analyze this selection · ${error.message || error}`, true);
      }
    });
  }

  async function apply() {
    return actionMutex.run(async () => {
      showStatus('Applying… · 正在套用', false);
      try {
        const settings = await persistSettings();
        const tab = await currentTab();
        await inject(tab.id);
        const result = await chrome.tabs.sendMessage(tab.id, { type: 'HALO_APPLY_MARKING', settings });
        if (result && result.lastError) throw new Error(result.lastError);
        const marked = result && result.markedTokens ? result.markedTokens : 0;
        const semantic = result && result.semanticTokens ? result.semanticTokens : 0;
        const queued = result && result.queuedRoots ? ` · ${result.queuedRoots} queued` : '';
        showStatus(`Marked ${marked} / ${semantic} semantic tokens${queued} · 已標記`, false);
      } catch (error) {
        showStatus(`Cannot mark this page · ${error.message || error}`, true);
      }
    });
  }

  async function remove() {
    return actionMutex.run(async () => {
      try {
        const tab = await currentTab();
        await chrome.tabs.sendMessage(tab.id, { type: 'HALO_REMOVE_MARKING' });
        showStatus('Removed · 已移除', false);
      } catch (_error) {
        showStatus('No active Halo marks · 目前沒有標記', false);
      }
    });
  }

  async function init() {
    const settings = await profilePersistence.load();
    renderSettings(settings);
    try { await refreshCurrentHost(); } catch (_error) {
      controls.sitePolicyHost.value = 'Unavailable · 無法取得';
      controls.blockSiteButton.disabled = true;
      controls.allowSiteButton.disabled = true;
    }
    showStatus('Ready · 就緒', false);
  }

  controls.density.addEventListener('input', () => {
    controls.densityValue.value = `${controls.density.value}%`;
  });
  for (const channel of Object.keys(CHANNEL_CONTROLS)) {
    controls[channel].addEventListener('change', () => {
      persistSettings({ channels: { [channel]: controls[channel].checked } })
        .catch((error) => showStatus(`Settings error · ${error.message || error}`, true));
    });
  }
  controls.density.addEventListener('change', () => {
    persistSettings({ density: Number(controls.density.value) / 100 })
      .catch((error) => showStatus(`Settings error · ${error.message || error}`, true));
  });
  controls.languageMode.addEventListener('change', () => {
    persistSettings({ languageMode: controls.languageMode.value })
      .catch((error) => showStatus(`Settings error · ${error.message || error}`, true));
  });
  controls.labelPosition.addEventListener('change', () => {
    persistSettings({ labelPosition: controls.labelPosition.value })
      .catch((error) => showStatus(`Settings error · ${error.message || error}`, true));
  });
  controls.triggerMode.addEventListener('change', () => {
    persistSettings({ triggerMode: controls.triggerMode.value })
      .catch((error) => showStatus(`Settings error · ${error.message || error}`, true));
  });
  controls.analyzeSelectionButton.addEventListener('click', analyzeSelection);
  controls.blockSiteButton.addEventListener('click', () => setCurrentHostBlocked(true));
  controls.allowSiteButton.addEventListener('click', () => setCurrentHostBlocked(false));
  controls.applyButton.addEventListener('click', apply);
  controls.removeButton.addEventListener('click', remove);

  init().catch((error) => showStatus(`Settings error · ${error.message || error}`, true));
})();
