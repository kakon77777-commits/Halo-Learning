(function (root) {
  'use strict';

  const MAX_LIST = 100;
  const $ = (id) => document.getElementById(id);
  let repository = null;
  let service = null;
  let snapshot = null;

  function setStatus(message, error) {
    const output = $('operationStatus');
    output.textContent = message;
    output.dataset.state = error ? 'error' : 'ok';
  }

  function textElement(tag, value, className) {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    return element;
  }

  function clear(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }

  function dateOnly(value) {
    return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : '—';
  }

  async function currentProfile() {
    try {
      const stored = await chrome.storage.local.get('haloSettings');
      return HaloSettings.migrateSettings(stored && stored.haloSettings);
    } catch (_error) {
      return null;
    }
  }

  function sourceMap(data) {
    return new Map((data.sources || []).map((value) => [value.sourceId, value]));
  }

  function renderOverview(projection, usage, profile) {
    const overview = projection.overview;
    document.querySelector('[data-testid="overview-event-count"]').textContent = String(overview.eventCount);
    document.querySelector('[data-testid="overview-site-count"]').textContent = String(overview.siteCount);
    $('overviewActiveDays').textContent = String(overview.activeDays);
    $('overviewExplicit').textContent = String(overview.explicitLearningSignals);
    $('overviewSaved').textContent = String(overview.savedSentenceCount);
    $('overviewNotes').textContent = String(overview.noteCount);
    $('overviewLanguages').textContent = Object.entries(overview.languageCounts || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([language, count]) => `${language}: ${count}`).join(' · ') || '—';
    $('overviewProfile').textContent = profile ? `${profile.profileId}@${profile.profileRevision}` : '—';
    $('overviewDensity').textContent = profile && Number.isFinite(profile.density) ? String(profile.density) : '—';
    $('overviewBytes').textContent = formatBytes(usage.bytes);
    $('overviewRange').textContent = overview.oldestEventAt
      ? `${dateOnly(overview.oldestEventAt)} → ${dateOnly(overview.newestEventAt)}`
      : '—';
  }

  function renderActivity(projection) {
    const list = $('activityList');
    clear(list);
    for (const item of projection.activity.slice(0, MAX_LIST)) {
      const li = document.createElement('li');
      li.append(
        textElement('strong', item.eventType),
        document.createTextNode(` · ${item.domain || 'local'} · ${item.language} · ${item.timestamp}`)
      );
      list.append(li);
    }
    if (!list.children.length) list.append(textElement('li', 'No activity yet.'));
  }

  function renderSites(projection) {
    const sites = $('siteList');
    const sessions = $('sessionList');
    clear(sites); clear(sessions);
    for (const item of projection.sites.slice(0, MAX_LIST)) {
      sites.append(textElement('li', `${item.domain} · ${item.eventCount} events · ${item.languages.join(', ')}`));
    }
    for (const item of projection.sessions.slice(0, MAX_LIST)) {
      sessions.append(textElement('li', `${item.sessionId} · ${item.eventCount} events · ${dateOnly(item.firstAt)}`));
    }
    if (!sites.children.length) sites.append(textElement('li', 'No sites yet.'));
    if (!sessions.children.length) sessions.append(textElement('li', 'No sessions yet.'));
  }

  function fillSelect(select, values, firstLabel) {
    const current = select.value;
    clear(select);
    const all = document.createElement('option');
    all.value = '';
    all.textContent = firstLabel;
    select.append(all);
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.append(option);
    }
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }

  function renderEventFilters(data) {
    fillSelect($('eventTypeFilter'), HaloDogfoodContracts.EVENT_TYPES, 'All');
    const domains = [...new Set((data.sources || []).map((value) => value.domain))].sort();
    fillSelect($('eventDomainFilter'), domains, 'All');
    fillSelect($('deleteDomainSelect'), domains, 'Choose site');
  }

  function renderLearningEvents(data) {
    const list = $('learningEventList');
    clear(list);
    const type = $('eventTypeFilter').value;
    const domain = $('eventDomainFilter').value;
    const from = $('eventFromFilter').value;
    const to = $('eventToFilter').value;
    const sources = sourceMap(data);
    const values = [...(data.events || [])]
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || right.eventId.localeCompare(left.eventId))
      .filter((event) => !type || event.eventType === type)
      .filter((event) => !domain || (sources.get(event.sourceRef) && sources.get(event.sourceRef).domain === domain))
      .filter((event) => !from || event.timestamp >= `${from}T00:00:00.000Z`)
      .filter((event) => !to || event.timestamp <= `${to}T23:59:59.999Z`)
      .slice(0, MAX_LIST);
    for (const event of values) {
      const source = sources.get(event.sourceRef);
      const li = document.createElement('li');
      li.append(
        textElement('strong', event.eventType),
        document.createTextNode(` · ${source ? source.domain : 'local'} · ${event.language} · ${event.timestamp}`)
      );
      if (event.detail && event.detail.noteText) li.append(textElement('div', event.detail.noteText, 'card-meta'));
      list.append(li);
    }
    if (!list.children.length) list.append(textElement('li', 'No matching events.'));
  }

  function renderSaved(projection) {
    const container = $('savedSentenceList');
    clear(container);
    for (const item of projection.savedSentences.slice(0, MAX_LIST)) {
      const card = document.createElement('article');
      card.className = 'data-card';
      card.append(textElement('p', item.text || '(retained sentence unavailable)'));
      card.append(textElement('p', `${item.language} · saved ${item.savedAt}`, 'card-meta'));
      const button = textElement('button', 'Unsave', null);
      button.type = 'button';
      button.addEventListener('click', () => runAction('Unsave sentence', async () => {
        await service.unsaveSentence(item.sentenceId);
      }));
      card.append(button);
      container.append(card);
    }
    if (!container.children.length) container.append(textElement('p', 'No saved sentences.'));
  }

  function renderNotes(projection) {
    const container = $('dogfoodNoteList');
    clear(container);
    for (const item of projection.notes.slice(0, MAX_LIST)) {
      const card = document.createElement('article');
      card.className = 'data-card';
      card.setAttribute('data-note-card', '');
      card.append(textElement('p', item.text));
      card.append(textElement('p', `Created ${item.createdAt} · updated ${item.updatedAt}`, 'card-meta'));
      const label = textElement('label', 'Revise dogfood note');
      const textarea = document.createElement('textarea');
      textarea.value = item.text;
      textarea.maxLength = 4000;
      textarea.setAttribute('aria-label', 'Revise dogfood note');
      label.append(textarea);
      const actions = document.createElement('div');
      actions.className = 'action-grid';
      const revise = textElement('button', 'Revise', null);
      revise.type = 'button';
      revise.addEventListener('click', () => runAction('Revise note', async () => {
        const value = textarea.value.trim();
        if (!value) throw new Error('Note text is required');
        await service.reviseNote(item.latestEventId, value);
      }));
      const remove = textElement('button', 'Remove note', null);
      remove.type = 'button';
      remove.addEventListener('click', () => runAction('Remove note', async () => {
        await service.removeNote(item.latestEventId);
      }));
      actions.append(revise, remove);
      card.append(label, actions);
      container.append(card);
    }
    if (!container.children.length) container.append(textElement('p', 'No dogfood notes.'));
  }

  function renderPrivacy(preferences) {
    const enabled = preferences.captureEnabled !== false;
    $('captureEnabled').checked = enabled;
    $('captureStatus').textContent = enabled ? 'Active · 本機紀錄中' : 'Paused · 已暫停';
    const retention = preferences.retention || {};
    const term = (value) => value == null ? 'keep until explicit delete' : `${value} days`;
    $('retentionText').textContent = `Retention: passive ${term(retention.passiveDays)}; ordinary ${term(retention.ordinaryDays)}; explicit ${term(retention.explicitDays)}; notes ${term(retention.dogfoodNoteDays)}.`;
  }

  function renderSystem(schema, status) {
    $('systemStatus').textContent = [
      `Database: ${schema.databaseName}`,
      `Schema version: ${schema.databaseVersion}`,
      `Stores: ${schema.storeNames.join(', ')}`,
      `Projector: ${HaloDogfoodProjector.PROJECTOR_VERSION}`,
      `Capture mode: ${status.mode}`
    ].join('\n');
  }

  async function refresh() {
    const [data, preferences, usage, profile] = await Promise.all([
      repository.readReplayDataset(),
      repository.getSetting('dogfood.preferences'),
      repository.estimateUsage(),
      currentProfile()
    ]);
    const projection = HaloDogfoodProjector.project(data.events, data);
    snapshot = { data, projection, preferences, usage, profile };
    renderOverview(projection, usage, profile);
    renderActivity(projection);
    renderSites(projection);
    renderEventFilters(data);
    renderLearningEvents(data);
    renderSaved(projection);
    renderNotes(projection);
    renderPrivacy(preferences || HaloDogfoodStore.DEFAULT_PREFERENCES);
    renderSystem(repository.schemaStatus(), service.status());
    return snapshot;
  }

  async function runAction(label, action) {
    setStatus(`${label}…`);
    try {
      await action();
      await refresh();
      setStatus(`${label}: done`);
    } catch (error) {
      setStatus(`${label}: ${error && error.message ? error.message : 'failed'}`, true);
    }
  }

  function downloadText(filename, type, content) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function isoRange(from, to) {
    if (!from || !to) throw new Error('Both dates are required');
    return { from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` };
  }

  function bindEvents() {
    for (const id of ['eventTypeFilter', 'eventDomainFilter', 'eventFromFilter', 'eventToFilter']) {
      $(id).addEventListener('change', () => snapshot && renderLearningEvents(snapshot.data));
    }

    $('newNoteForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const value = $('newNoteText').value.trim();
      if (!value) return;
      runAction('Create note', async () => {
        await service.createStandaloneNote(value);
        $('newNoteText').value = '';
      });
    });

    $('captureEnabled').addEventListener('change', () => {
      const enabled = $('captureEnabled').checked;
      runAction(enabled ? 'Resume local capture' : 'Pause local capture', () => service.setCaptureEnabled(enabled));
    });

    $('exportJsonButton').addEventListener('click', () => runAction('Export JSON', async () => {
      const bundle = await service.exportBundle();
      downloadText(`halo-dogfood-${Date.now()}.json`, 'application/json', JSON.stringify(bundle, null, 2));
    }));
    $('exportJsonlButton').addEventListener('click', () => runAction('Export JSONL', async () => {
      const jsonl = await service.exportEventsJsonl();
      downloadText(`halo-dogfood-events-${Date.now()}.jsonl`, 'application/x-ndjson', jsonl);
    }));
    $('clearCacheButton').addEventListener('click', () => runAction('Clear analysis cache', async () => {
      const count = await service.clearAnalysisCache();
      setStatus(`Cleared ${count} cache entries`);
    }));

    $('deleteDomainButton').addEventListener('click', () => {
      const domain = $('deleteDomainSelect').value;
      if (!domain || !confirm(`Delete all local dogfood data for site ${domain}?`)) return;
      runAction(`Delete ${domain}`, () => service.deleteByScope({ kind: 'domain', domain }));
    });
    $('deleteDateButton').addEventListener('click', () => {
      let range;
      try { range = isoRange($('deleteFrom').value, $('deleteTo').value); } catch (error) { setStatus(error.message, true); return; }
      if (!confirm(`Delete local dogfood data from ${range.from} through ${range.to}?`)) return;
      runAction('Delete date range', () => service.deleteByScope({ kind: 'time-range', ...range }));
    });
    $('deleteAllButton').addEventListener('click', () => {
      if (!confirm('Delete all dogfood data from this browser profile?')) return;
      runAction('Delete all dogfood data', () => service.deleteByScope({ kind: 'all-dogfood' }));
    });

    $('replayButton').addEventListener('click', () => runAction('Replay', async () => {
      const result = await service.replay();
      $('replayStatus').textContent = result.report.success
        ? `PASS · ${result.report.sourceEventCount} events · ${result.report.projectionHash}`
        : 'FAILED';
    }));
  }

  async function boot() {
    try {
      repository = await HaloDogfoodStore.openHaloDogfoodStore({ indexedDB: root.indexedDB });
      service = HaloDogfoodDataService.createDogfoodDataService({
        repository,
        contracts: HaloDogfoodContracts,
        sourceModule: HaloDogfoodSource,
        projector: HaloDogfoodProjector,
        cryptoApi: root.crypto,
        getCurrentProfile: currentProfile
      });
      bindEvents();
      root.HaloDogfoodDashboard = Object.freeze({
        repository,
        service,
        refresh,
        snapshot: () => snapshot
      });
      await refresh();
      document.body.dataset.dashboardReady = 'true';
      setStatus('Ready');
    } catch (error) {
      document.body.dataset.dashboardReady = 'error';
      setStatus(`Dashboard unavailable: ${error && error.message ? error.message : 'unknown error'}`, true);
    }
  }

  document.addEventListener('DOMContentLoaded', boot, { once: true });
})(typeof globalThis !== 'undefined' ? globalThis : this);
