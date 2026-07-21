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
  return view === 'progress'
    ? listings.sort((a, b) => (b.applied_at ?? '').localeCompare(a.applied_at ?? ''))
    : listings;
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

function openForm(search) {
  editingSearchId = search ? search.id : null;
  document.getElementById('add-label').value = search?.label ?? '';
  document.getElementById('add-keywords').value = (search?.keywords ?? []).join(', ');
  document.getElementById('add-locations').value = (search?.locations ?? []).join(', ');
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
  card.addEventListener('click', () => {
    if (l.url) window.api.openUrl(l.url);
  });

  if (activeView === 'new') {
    card.append(seenButton(l), applyButton(l), dismissButton(l));
  } else if (activeView === 'seen') {
    card.append(applyButton(l), dismissButton(l));
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

    card.append(status, notesBtn);
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
  const locations = toList('add-locations');

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

document.getElementById('quit').addEventListener('click', () => window.api.quit());
