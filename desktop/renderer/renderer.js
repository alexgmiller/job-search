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
  for (const c of chunks) {
    const div = document.createElement('div');
    div.className = 'chunk';

    const head = document.createElement('div');
    head.className = 'chunk-head';

    const kind = document.createElement('span');
    kind.className = 'chunk-kind';
    kind.textContent = c.kind;

    const title = document.createElement('span');
    title.className = 'chunk-title';
    title.textContent = c.title;

    const del = document.createElement('button');
    del.className = 'dismiss';
    del.textContent = '✕';
    del.title = 'Delete this chunk';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete "${c.title}" from your profile?`)) return;
      try {
        renderChunks(await window.api.deleteChunk(c.id));
      } catch (e) {
        showError(`Could not delete: ${e.message}`);
      }
    });

    head.append(kind, title, del);

    const content = document.createElement('div');
    content.className = 'chunk-content';
    content.textContent = c.content;

    div.append(head, content);
    chunkListEl.appendChild(div);
  }
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
