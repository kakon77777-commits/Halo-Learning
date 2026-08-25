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
    mergeUiSettings: HaloProfileControls.mergeUiSettings
  });

  const get = (id) => document.getElementById(id);
  const controls = {
    density: get('density'),
    densityValue: get('densityValue'),
    languageMode: get('languageMode'),
    labelPosition: get('labelPosition'),
    triggerMode: get('triggerMode'),
    analyzeSelectionButton: get('analyzeSelectionButton'),
    applyButton: get('applyButton'),
    removeButton: get('removeButton'),
    status: get('status')
  };
  for (const [channel, id] of Object.entries(CHANNEL_CONTROLS)) controls[channel] = get(id);

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

  async function inject(tabId) {
    await HaloBrowserEntry.injectPackagedRuntime({ chrome, tabId });
  }

  async function analyzeSelection() {
    controls.analyzeSelectionButton.disabled = true;
    controls.applyButton.disabled = true;
    controls.removeButton.disabled = true;
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
    } finally {
      controls.analyzeSelectionButton.disabled = false;
      controls.applyButton.disabled = false;
      controls.removeButton.disabled = false;
    }
  }

  async function apply() {
    controls.applyButton.disabled = true;
    controls.removeButton.disabled = true;
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
    } finally {
      controls.applyButton.disabled = false;
      controls.removeButton.disabled = false;
    }
  }

  async function remove() {
    controls.applyButton.disabled = true;
    controls.removeButton.disabled = true;
    try {
      const tab = await currentTab();
      await chrome.tabs.sendMessage(tab.id, { type: 'HALO_REMOVE_MARKING' });
      showStatus('Removed · 已移除', false);
    } catch (_error) {
      showStatus('No active Halo marks · 目前沒有標記', false);
    } finally {
      controls.applyButton.disabled = false;
      controls.removeButton.disabled = false;
    }
  }

  async function init() {
    const settings = await profilePersistence.load();
    renderSettings(settings);
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
  controls.applyButton.addEventListener('click', apply);
  controls.removeButton.addEventListener('click', remove);

  init().catch((error) => showStatus(`Settings error · ${error.message || error}`, true));
})();
