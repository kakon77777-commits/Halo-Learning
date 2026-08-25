(function () {
  'use strict';

  const STORAGE_KEY = 'haloSettings';
  const INJECT_FILES = [
    'src/shared/dictionary-provider.js',
    'src/shared/semantic-annotations.js',
    'src/shared/projection.js',
    'src/shared/settings.js',
    'src/content.js'
  ];
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

  const get = (id) => document.getElementById(id);
  const controls = {
    density: get('density'),
    densityValue: get('densityValue'),
    languageMode: get('languageMode'),
    labelPosition: get('labelPosition'),
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
  }

  function readSettings() {
    const channels = {};
    for (const channel of Object.keys(CHANNEL_CONTROLS)) channels[channel] = controls[channel].checked;
    return HaloProfileControls.mergeUiSettings(currentSettings || HaloSettings.DEFAULT_SETTINGS, {
      channels,
      density: Number(controls.density.value) / 100,
      languageMode: controls.languageMode.value,
      labelPosition: controls.labelPosition.value
    }, HaloSettings.normalizeSettings);
  }

  async function persistSettings() {
    const settings = readSettings();
    await chrome.storage.local.set({ [STORAGE_KEY]: settings });
    currentSettings = settings;
    return settings;
  }

  async function currentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !Number.isInteger(tab.id)) throw new Error('No active browser tab');
    return tab;
  }

  async function inject(tabId) {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['src/content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: INJECT_FILES });
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
      showStatus(`Marked ${marked} / ${semantic} semantic tokens · 已標記`, false);
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
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const settings = HaloSettings.normalizeSettings(stored[STORAGE_KEY]);
    renderSettings(settings);
    showStatus('Ready · 就緒', false);
  }

  controls.density.addEventListener('input', () => {
    controls.densityValue.value = `${controls.density.value}%`;
  });
  const persistedControls = [
    ...Object.keys(CHANNEL_CONTROLS).map((channel) => controls[channel]),
    controls.density,
    controls.languageMode,
    controls.labelPosition
  ];
  for (const control of persistedControls) {
    control.addEventListener('change', () => { persistSettings().catch(() => {}); });
  }
  controls.applyButton.addEventListener('click', apply);
  controls.removeButton.addEventListener('click', remove);

  init().catch((error) => showStatus(`Settings error · ${error.message || error}`, true));
})();
