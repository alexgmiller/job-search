const listEl = document.getElementById('list');
const errorEl = document.getElementById('error');
const refreshBtn = document.getElementById('refresh');
const viewsEl = document.getElementById('views');
const tabsEl = document.getElementById('tabs');
const addFormEl = document.getElementById('add-form');
const locFilterEl = document.getElementById('loc-filter');
const addDeleteBtn = document.getElementById('add-delete');
const addSaveBtn = document.getElementById('add-save');

const STATUSES = ['applied', 'interviewing', 'offer', 'rejected'];
const VIEWS = [
  { key: 'new', label: 'New' },
  { key: 'seen', label: 'Seen' },
  { key: 'progress', label: 'In Progress' },
  { key: 'dismissed', label: 'Dismissed' },
];

let searches = [];
let all = []; // every listing (renderer splits into views)
let activeView = 'new';
let activeTab = 'all'; // 'all' | a search id
let locationFilter = '';
let editingSearchId = null;
// Region keys currently toggled on in the filter row; empty = no region filter.
const activeRegions = new Set();

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}

function clearError() {
  errorEl.style.display = 'none';
}

// ---------- view membership ----------

function viewOf(l) {
  if (l.status) return 'progress';
  if (l.dismissed_at) return 'dismissed';
  if (l.seen) return 'seen';
  return 'new';
}

function inView(view) {
  const listings = all.filter((l) => viewOf(l) === view);
  if (view === 'progress') {
    return listings.sort((a, b) =>
      (b.applied_at ?? '').localeCompare(a.applied_at ?? '')
    );
  }
  if (view === 'new' || view === 'seen') {
    // Best fit first; unscored listings fall back to date order at the end.
    return listings.sort((a, b) => {
      const af = a.fit_score ?? -1;
      const bf = b.fit_score ?? -1;
      if (af !== bf) return bf - af;
      return (b.found_at ?? '').localeCompare(a.found_at ?? '');
    });
  }
  return listings;
}

// ---------- views + tabs ----------

function renderViews() {
  viewsEl.replaceChildren();
  for (const v of VIEWS) {
    const btn = document.createElement('button');
    btn.className = 'view' + (activeView === v.key ? ' active' : '');
    btn.textContent = `${v.label} (${inView(v.key).length})`;
    btn.addEventListener('click', () => {
      activeView = v.key;
      closeForm();
      rerender();
    });
    viewsEl.appendChild(btn);
  }
}

// Region chips inside the tab editor; selections become `searches.locations`
// entries, which the scraper turns into API location queries.
const REGION_KEYS = Object.keys(window.JobLocations.REGION_LABELS);
const formRegions = new Set();
const addRegionChipsEl = document.getElementById('add-region-chips');
const regionChipEls = {};
for (const [key, label] of Object.entries(window.JobLocations.REGION_LABELS)) {
  const chip = document.createElement('button');
  chip.className = 'region-chip';
  chip.textContent = label;
  chip.addEventListener('click', (e) => {
    e.preventDefault();
    if (formRegions.has(key)) formRegions.delete(key);
    else formRegions.add(key);
    chip.classList.toggle('on', formRegions.has(key));
  });
  regionChipEls[key] = chip;
  addRegionChipsEl.appendChild(chip);
}

function setFormRegions(locations = []) {
  formRegions.clear();
  for (const l of locations) if (REGION_KEYS.includes(l)) formRegions.add(l);
  for (const [key, chip] of Object.entries(regionChipEls)) {
    chip.classList.toggle('on', formRegions.has(key));
  }
}

function openForm(search) {
  editingSearchId = search ? search.id : null;
  document.getElementById('add-label').value = search?.label ?? '';
  document.getElementById('add-keywords').value = (search?.keywords ?? []).join(', ');
  setFormRegions(search?.locations ?? []);
  // Free-text locations are anything that isn't a known region key.
  document.getElementById('add-locations').value = (search?.locations ?? [])
    .filter((l) => !REGION_KEYS.includes(l))
    .join(', ');
  addDeleteBtn.style.display = search ? 'inline-block' : 'none';
  addSaveBtn.textContent = search ? 'Save changes' : 'Add role';
  addFormEl.style.display = 'block';
}

function closeForm() {
  addFormEl.style.display = 'none';
  editingSearchId = null;
}

function renderTabs() {
  tabsEl.replaceChildren();
  const viewListings = inView(activeView);

  const makeTab = (id, label, opts = {}) => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (activeTab === id ? ' active' : '');
    btn.textContent = label;
    if (opts.editable && activeTab === id) {
      const pencil = document.createElement('span');
      pencil.className = 'tab-edit';
      pencil.textContent = '✎';
      pencil.title = 'Edit this tab';
      pencil.addEventListener('click', (e) => {
        e.stopPropagation();
        openForm(searches.find((s) => s.id === id));
      });
      btn.appendChild(pencil);
    }
    btn.addEventListener('click', () => {
      activeTab = id;
      closeForm();
      rerender();
    });
    tabsEl.appendChild(btn);
  };

  makeTab('all', `All (${viewListings.length})`);
  for (const s of searches) {
    const count = viewListings.filter((l) => l.search_id === s.id).length;
    makeTab(s.id, `${s.label} (${count})`, { editable: true });
  }

  const plus = document.createElement('button');
  plus.className = 'tab';
  plus.textContent = '+';
  plus.title = 'Add a role tab';
  plus.addEventListener('click', () => {
    if (addFormEl.style.display === 'block' && editingSearchId === null) {
      closeForm();
    } else {
      openForm(null);
    }
  });
  tabsEl.appendChild(plus);
}

// ---------- cards ----------

function visibleListings() {
  let listings = inView(activeView);
  if (activeTab !== 'all') {
    listings = listings.filter((l) => l.search_id === activeTab);
  }
  // Region chips use the shared parser (handles multi-location strings and
  // remote-but-wrong-country); the text box is a plain substring on top.
  if (activeRegions.size) {
    const targets = [...activeRegions];
    listings = listings.filter((l) =>
      window.JobLocations.matchesLocation(l.location, targets)
    );
  }
  if (locationFilter) {
    const f = locationFilter.toLowerCase();
    listings = listings.filter((l) => (l.location ?? '').toLowerCase().includes(f));
  }
  return listings;
}

// Update a listing locally + remotely; on failure, re-show the truth.
function mutate(l, localPatch, remoteCall, failMsg) {
  Object.assign(l, localPatch);
  rerender();
  remoteCall().catch(() => showError(failMsg));
}

function makeCardBody(l) {
  const body = document.createElement('div');
  body.className = 'card-body';

  const role = document.createElement('div');
  role.className = 'role';
  role.textContent = l.role;

  const company = document.createElement('div');
  company.className = 'company';
  company.textContent = l.company;

  const meta = document.createElement('div');
  meta.className = 'meta';
  const date = activeView === 'progress' ? l.applied_at : l.found_at;
  meta.textContent = [l.location, date ? new Date(date).toLocaleDateString() : null]
    .filter(Boolean)
    .join(' · ');

  body.append(role, company, meta);
  return body;
}

function fitBadge(l) {
  if (l.fit_score == null) return null;
  const badge = document.createElement('span');
  badge.className =
    'fit-badge ' +
    (l.fit_score >= 75 ? 'fit-high' : l.fit_score >= 50 ? 'fit-mid' : 'fit-low');
  badge.textContent = l.fit_score;
  badge.title = l.fit_reason ?? '';
  return badge;
}

function tailorButton(l) {
  const btn = document.createElement('button');
  btn.className = 'tailor-btn';
  btn.textContent = '📄 Tailor';
  btn.title = 'Generate a resume tailored to this listing from your profile';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openTailorModal(l);
  });
  return btn;
}

function seenButton(l) {
  const btn = document.createElement('button');
  btn.className = 'seen-btn';
  btn.textContent = '👁 Seen';
  btn.title = 'Reviewed — keep in the Seen list to maybe apply later';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    mutate(l, { seen: true }, () => window.api.markSeen(l.id),
      'Could not mark as seen — refresh and retry.');
  });
  return btn;
}

function applyButton(l) {
  const btn = document.createElement('button');
  btn.className = 'apply-btn';
  btn.textContent = 'Applied ✓';
  btn.title = 'Mark as applied (moves to In Progress)';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    mutate(
      l,
      { status: 'applied', applied_at: new Date().toISOString(), seen: true, dismissed_at: null },
      () => window.api.markApplied(l.id),
      'Could not mark as applied — refresh and retry.'
    );
  });
  return btn;
}

function dismissButton(l) {
  const btn = document.createElement('button');
  btn.className = 'dismiss';
  btn.textContent = '✕';
  btn.title = 'Dismiss — not interested (recoverable in Dismissed)';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    mutate(
      l,
      { seen: true, dismissed_at: new Date().toISOString() },
      () => window.api.dismiss(l.id),
      'Could not dismiss — refresh and retry.'
    );
  });
  return btn;
}

function restoreButton(l) {
  const btn = document.createElement('button');
  btn.className = 'restore-btn';
  btn.textContent = '↩ Restore';
  btn.title = 'Move back to the Seen list';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    mutate(l, { seen: true, dismissed_at: null }, () => window.api.restore(l.id),
      'Could not restore — refresh and retry.');
  });
  return btn;
}

function makeCard(l) {
  const wrap = document.createElement('div');
  wrap.className = 'card-wrap';

  const card = document.createElement('div');
  card.className = 'card';
  card.append(makeCardBody(l));
  const badge = fitBadge(l);
  if (badge) card.append(badge);
  card.addEventListener('click', () => {
    if (l.url) window.api.openUrl(l.url);
  });

  if (activeView === 'new') {
    card.append(tailorButton(l), seenButton(l), applyButton(l), dismissButton(l));
  } else if (activeView === 'seen') {
    card.append(tailorButton(l), applyButton(l), dismissButton(l));
  } else if (activeView === 'dismissed') {
    card.append(restoreButton(l));
  } else {
    // In Progress: status pipeline + notes
    const status = document.createElement('select');
    status.className = 'status-select';
    for (const s of STATUSES) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s[0].toUpperCase() + s.slice(1);
      if (l.status === s) opt.selected = true;
      status.appendChild(opt);
    }
    status.addEventListener('click', (e) => e.stopPropagation());
    status.addEventListener('change', () => {
      l.status = status.value;
      window.api.setStatus(l.id, status.value).catch(() =>
        showError('Could not update status — refresh and retry.')
      );
      renderViews();
    });

    const notesBtn = document.createElement('button');
    notesBtn.className = 'notes-btn';
    notesBtn.textContent = l.notes ? 'Notes •' : 'Notes';

    let notesArea = null;
    notesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (notesArea) {
        notesArea.remove();
        notesArea = null;
        return;
      }
      notesArea = document.createElement('textarea');
      notesArea.className = 'notes-area';
      notesArea.placeholder = 'Notes — comp info, contacts, why you’re interested…';
      notesArea.value = l.notes ?? '';
      notesArea.addEventListener('blur', () => {
        const text = notesArea.value.trim();
        if (text === (l.notes ?? '')) return;
        l.notes = text || null;
        notesBtn.textContent = l.notes ? 'Notes •' : 'Notes';
        window.api.setNotes(l.id, text).catch(() =>
          showError('Could not save notes — they may be lost on refresh.')
        );
      });
      wrap.append(notesArea);
      notesArea.focus();
    });

    card.append(status, notesBtn, tailorButton(l));
  }

  wrap.append(card);
  return wrap;
}

const EMPTY_TEXT = {
  new: 'No new listings. The scraper runs every 3 hours.',
  seen: 'Nothing marked seen — use 👁 on a new listing to park it here.',
  progress: 'Nothing applied to yet — hit "Applied ✓" on a listing.',
  dismissed: 'Nothing dismissed.',
};

function renderList() {
  listEl.replaceChildren();
  const listings = visibleListings();

  if (!listings.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = locationFilter
      ? 'Nothing here matches the location filter.'
      : EMPTY_TEXT[activeView];
    listEl.appendChild(empty);
    return;
  }

  for (const l of listings) listEl.appendChild(makeCard(l));
}

function rerender() {
  renderViews();
  renderTabs();
  renderList();
}

function render(listings) {
  all = listings;
  if (activeTab !== 'all' && !searches.some((s) => s.id === activeTab)) {
    activeTab = 'all';
  }
  clearError();
  rerender();
}

// ---------- wiring ----------

window.api.onListings(render);
window.api.onError(showError);

window.api.getSearches().then((s) => {
  searches = s;
  rerender();
});

// Region filter chips, built from the shared region list.
const regionChipsEl = document.getElementById('region-chips');
for (const [key, label] of Object.entries(window.JobLocations.REGION_LABELS)) {
  const chip = document.createElement('button');
  chip.className = 'region-chip';
  chip.textContent = label;
  chip.title = `Show only listings in ${label}`;
  chip.addEventListener('click', () => {
    if (activeRegions.has(key)) activeRegions.delete(key);
    else activeRegions.add(key);
    chip.classList.toggle('on', activeRegions.has(key));
    renderList();
  });
  regionChipsEl.appendChild(chip);
}

locFilterEl.addEventListener('input', () => {
  locationFilter = locFilterEl.value.trim();
  renderList();
});

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  searches = await window.api.getSearches();
  await window.api.refresh();
  refreshBtn.disabled = false;
});

document.getElementById('add-cancel').addEventListener('click', closeForm);

addDeleteBtn.addEventListener('click', async () => {
  if (!editingSearchId) return;
  const label = searches.find((s) => s.id === editingSearchId)?.label;
  if (!confirm(`Delete the "${label}" tab? Its listings stay under All.`)) return;
  try {
    searches = await window.api.deleteSearch(editingSearchId);
    closeForm();
    activeTab = 'all';
    clearError();
    rerender();
  } catch (e) {
    showError(`Could not delete tab: ${e.message}`);
  }
});

addSaveBtn.addEventListener('click', async () => {
  const label = document.getElementById('add-label').value.trim();
  const toList = (id) =>
    document.getElementById(id).value.split(',').map((s) => s.trim()).filter(Boolean);
  const keywords = toList('add-keywords');
  const locations = [...formRegions, ...toList('add-locations')];

  if (!label || !keywords.length) {
    showError('A tab needs a name and at least one keyword.');
    return;
  }
  try {
    searches = editingSearchId
      ? await window.api.updateSearch({ id: editingSearchId, label, keywords, locations })
      : await window.api.addSearch({ label, keywords, locations });
    closeForm();
    clearError();
    rerender();
  } catch (e) {
    showError(`Could not save tab: ${e.message}`);
  }
});

// ---------- tailor resume modal ----------

const tailorModal = document.getElementById('tailor-modal');
const tailorTitle = document.getElementById('tailor-title');
const tailorStatus = document.getElementById('tailor-status');
const tailorContent = document.getElementById('tailor-content');
let tailorText = '';
let tailorFileName = 'resume.md';

async function openTailorModal(l) {
  tailorTitle.textContent = `Resume for: ${l.role} — ${l.company}`;
  tailorStatus.textContent =
    'Generating tailored resume… this can take a minute or two.';
  tailorStatus.style.display = 'block';
  tailorContent.style.display = 'none';
  tailorText = '';
  tailorFileName = `resume-${l.company}-${l.role}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') + '.md';
  tailorModal.style.display = 'flex';
  try {
    tailorText = await window.api.tailorResume(l.id);
    tailorContent.textContent = tailorText;
    tailorStatus.style.display = 'none';
    tailorContent.style.display = 'block';
  } catch (e) {
    tailorStatus.textContent = `Failed: ${e.message}`;
  }
}

document.getElementById('tailor-close').addEventListener('click', () => {
  tailorModal.style.display = 'none';
});

document.getElementById('tailor-copy').addEventListener('click', async () => {
  if (!tailorText) return;
  await navigator.clipboard.writeText(tailorText);
  tailorStatus.textContent = 'Copied to clipboard.';
  tailorStatus.style.display = 'block';
});

document.getElementById('tailor-save').addEventListener('click', async () => {
  if (!tailorText) return;
  const path = await window.api.saveText(tailorText, tailorFileName);
  if (path) {
    tailorStatus.textContent = `Saved to ${path}`;
    tailorStatus.style.display = 'block';
  }
});

// ---------- profile panel ----------

const profileBtn = document.getElementById('profile-btn');
const profilePanel = document.getElementById('profile-panel');
const chunkListEl = document.getElementById('chunk-list');
let profileOpen = false;

function renderChunks(chunks) {
  chunkListEl.replaceChildren();
  if (!chunks.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent =
      'No profile yet. Add chunks of your experience, education, and skills above — fit scoring and resume tailoring use only what you put here.';
    chunkListEl.appendChild(empty);
    return;
  }
  for (const c of chunks) chunkListEl.appendChild(makeChunkRow(c));
}

// A chunk renders read-only until you hit ✎, then swaps to inline fields.
function makeChunkRow(c) {
  const div = document.createElement('div');
  div.className = 'chunk';

  function renderRead() {
    div.replaceChildren();

    const head = document.createElement('div');
    head.className = 'chunk-head';

    const kind = document.createElement('span');
    kind.className = 'chunk-kind';
    kind.textContent = c.kind;

    const title = document.createElement('span');
    title.className = 'chunk-title';
    title.textContent = c.title;

    const edit = document.createElement('button');
    edit.className = 'chunk-edit';
    edit.textContent = '✎';
    edit.title = 'Edit this entry';
    edit.addEventListener('click', renderEdit);

    const del = document.createElement('button');
    del.className = 'dismiss';
    del.textContent = '✕';
    del.title = 'Delete this entry';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete "${c.title}" from your profile?`)) return;
      try {
        renderChunks(await window.api.deleteChunk(c.id));
      } catch (e) {
        showError(`Could not delete: ${e.message}`);
      }
    });

    head.append(kind, title, edit, del);

    const content = document.createElement('div');
    content.className = 'chunk-content';
    content.textContent = c.content;
    // Double-clicking the text is a second, more discoverable way in.
    content.title = 'Double-click to edit';
    content.addEventListener('dblclick', renderEdit);

    div.append(head, content);
  }

  function renderEdit() {
    div.replaceChildren();

    const row = document.createElement('div');
    row.className = 'chunk-edit-row';

    const kindSel = document.createElement('select');
    kindSel.className = 'imp-kind';
    for (const k of KINDS) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      if (k === c.kind) opt.selected = true;
      kindSel.appendChild(opt);
    }

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = c.title;

    row.append(kindSel, titleInput);

    const contentArea = document.createElement('textarea');
    contentArea.value = c.content;

    const actions = document.createElement('div');
    actions.className = 'chunk-actions';

    const cancel = document.createElement('button');
    cancel.className = 'chunk-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', renderRead);

    const save = document.createElement('button');
    save.className = 'chunk-save-btn';
    save.textContent = 'Save';
    save.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      const content = contentArea.value.trim();
      if (!title || !content) {
        showError('A profile entry needs a title and content.');
        return;
      }
      save.disabled = true;
      try {
        const updated = { id: c.id, kind: kindSel.value, title, content };
        const fresh = await window.api.updateChunk(updated);
        clearError();
        renderChunks(fresh); // rebuild the list so ordering stays server-truth
      } catch (e) {
        save.disabled = false;
        showError(`Could not save: ${e.message}`);
      }
    });

    actions.append(cancel, save);
    div.append(row, contentArea, actions);
    titleInput.focus();
  }

  renderRead();
  return div;
}

function setProfileOpen(open) {
  profileOpen = open;
  profileBtn.classList.toggle('active', open);
  profilePanel.style.display = open ? 'block' : 'none';
  for (const el of [viewsEl, tabsEl, listEl]) {
    el.style.display = open ? 'none' : '';
  }
  document.getElementById('filter-row').style.display = open ? 'none' : '';
  addFormEl.style.display = 'none';
  if (open) {
    window.api.getProfile().then(renderChunks);
  }
}

profileBtn.addEventListener('click', () => setProfileOpen(!profileOpen));

// ---------- resume import (review before saving) ----------

const KINDS = ['experience', 'education', 'skill', 'project', 'certification', 'other'];
const importReview = document.getElementById('import-review');
const importStatus = document.getElementById('import-status');
const importList = document.getElementById('import-list');
const importActions = document.getElementById('import-actions');

function renderImportRows(chunks) {
  importList.replaceChildren();
  for (const c of chunks) {
    const row = document.createElement('div');
    row.className = 'imp';

    const check = document.createElement('input');
    check.type = 'checkbox';
    // Contact-header junk is usually the only 'other' — leave it unchecked.
    check.checked = c.kind !== 'other';

    const fields = document.createElement('div');
    fields.className = 'imp-fields';

    const top = document.createElement('div');
    top.className = 'imp-row';

    const kind = document.createElement('select');
    kind.className = 'imp-kind';
    for (const k of KINDS) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      if (k === c.kind) opt.selected = true;
      kind.appendChild(opt);
    }

    const title = document.createElement('input');
    title.type = 'text';
    title.value = c.title;

    top.append(kind, title);

    const content = document.createElement('textarea');
    content.value = c.content;

    fields.append(top, content);
    row.append(check, fields);
    importList.appendChild(row);

    row._read = () => ({
      selected: check.checked,
      kind: kind.value,
      title: title.value.trim(),
      content: content.value.trim(),
    });
  }
}

document.getElementById('import-btn').addEventListener('click', async () => {
  importReview.style.display = 'block';
  importActions.style.display = 'none';
  importList.replaceChildren();
  importStatus.textContent = 'Choose a file…';
  try {
    const result = await window.api.importResume();
    if (!result) {
      importReview.style.display = 'none';
      return;
    }
    importStatus.textContent =
      `Found ${result.chunks.length} entries in ${result.fileName}` +
      (result.method === 'headings'
        ? ' (parsed by section headings — no API key set).'
        : '.') +
      ' Review and edit below, then add the ones you want.';
    renderImportRows(result.chunks);
    importActions.style.display = 'flex';
  } catch (e) {
    importStatus.textContent = `Import failed: ${e.message}`;
  }
});

document.getElementById('import-cancel').addEventListener('click', () => {
  importReview.style.display = 'none';
  importList.replaceChildren();
});

document.getElementById('import-save').addEventListener('click', async () => {
  const picked = [...importList.children]
    .map((row) => row._read())
    .filter((c) => c.selected && c.title && c.content)
    .map(({ kind, title, content }) => ({ kind, title, content }));
  if (!picked.length) {
    importStatus.textContent = 'Nothing selected.';
    return;
  }
  try {
    renderChunks(await window.api.addChunks(picked));
    importReview.style.display = 'none';
    importList.replaceChildren();
    clearError();
  } catch (e) {
    importStatus.textContent = `Could not save: ${e.message}`;
  }
});

document.getElementById('chunk-save').addEventListener('click', async () => {
  const kind = document.getElementById('chunk-kind').value;
  const title = document.getElementById('chunk-title').value.trim();
  const content = document.getElementById('chunk-content').value.trim();
  if (!title || !content) {
    showError('A profile chunk needs a title and content.');
    return;
  }
  try {
    renderChunks(await window.api.addChunk({ kind, title, content }));
    document.getElementById('chunk-title').value = '';
    document.getElementById('chunk-content').value = '';
    clearError();
  } catch (e) {
    showError(`Could not save chunk: ${e.message}`);
  }
});

// ---------- window mode ----------

const isWidget = new URLSearchParams(location.search).get('mode') === 'widget';
if (isWidget) document.body.classList.add('widget');

document.getElementById('widget-btn').addEventListener('click', () =>
  window.api.setMode('widget')
);
document.getElementById('expand-btn').addEventListener('click', () =>
  window.api.setMode('full')
);
document.getElementById('hide-btn').addEventListener('click', () =>
  window.api.minimize()
);

document.getElementById('quit').addEventListener('click', () => window.api.quit());
