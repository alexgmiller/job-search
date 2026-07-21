const listEl = document.getElementById('list');
const errorEl = document.getElementById('error');
const refreshBtn = document.getElementById('refresh');
const tabsEl = document.getElementById('tabs');
const addFormEl = document.getElementById('add-form');
const locFilterEl = document.getElementById('loc-filter');
const addDeleteBtn = document.getElementById('add-delete');
const addSaveBtn = document.getElementById('add-save');

const STATUSES = ['applied', 'interviewing', 'offer', 'rejected'];

let searches = [];
let allListings = []; // unseen
let appliedListings = [];
let activeTab = 'all'; // 'all' | 'applied' | a search id
let locationFilter = '';
let editingSearchId = null; // null = form adds; otherwise form edits this tab

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}

function clearError() {
  errorEl.style.display = 'none';
}

// ---------- tabs ----------

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

  const makeTab = (id, label, opts = {}) => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (activeTab === id ? ' active' : '');
    btn.textContent = label;
    // Active role tabs get a pencil to edit keywords/locations or delete.
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
      renderTabs();
      renderList();
    });
    tabsEl.appendChild(btn);
  };

  makeTab('all', `All (${allListings.length})`);
  for (const s of searches) {
    const count = allListings.filter((l) => l.search_id === s.id).length;
    makeTab(s.id, `${s.label} (${count})`, { editable: true });
  }
  makeTab('applied', `Applied (${appliedListings.length})`);

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

// ---------- listings ----------

function visibleListings() {
  let listings;
  if (activeTab === 'applied') listings = appliedListings;
  else if (activeTab === 'all') listings = allListings;
  else listings = allListings.filter((l) => l.search_id === activeTab);

  if (locationFilter) {
    const f = locationFilter.toLowerCase();
    listings = listings.filter((l) => (l.location ?? '').toLowerCase().includes(f));
  }
  return listings;
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
  const date = activeTab === 'applied' ? l.applied_at : l.found_at;
  meta.textContent = [
    l.location,
    date ? new Date(date).toLocaleDateString() : null,
  ]
    .filter(Boolean)
    .join(' · ');

  body.append(role, company, meta);
  return body;
}

function makeUnseenCard(l) {
  const card = document.createElement('div');
  card.className = 'card';
  card.append(makeCardBody(l));

  const applyBtn = document.createElement('button');
  applyBtn.className = 'apply-btn';
  applyBtn.textContent = 'Applied ✓';
  applyBtn.title = 'Mark as applied (moves to the Applied tab)';
  applyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    allListings = allListings.filter((x) => x.id !== l.id);
    renderTabs();
    renderList();
    try {
      await window.api.markApplied(l.id);
      appliedListings = await window.api.getApplied();
      renderTabs();
      if (activeTab === 'applied') renderList();
    } catch {
      showError('Could not mark as applied — refresh and retry.');
    }
  });

  const dismiss = document.createElement('button');
  dismiss.className = 'dismiss';
  dismiss.textContent = '✕';
  dismiss.title = 'Dismiss (mark seen)';
  dismiss.addEventListener('click', async (e) => {
    e.stopPropagation();
    allListings = allListings.filter((x) => x.id !== l.id);
    renderTabs();
    renderList();
    try {
      await window.api.markSeen(l.id);
    } catch {
      showError('Could not mark listing as seen — refresh and retry.');
    }
  });

  card.addEventListener('click', () => {
    if (l.url) window.api.openUrl(l.url);
  });

  card.append(applyBtn, dismiss);
  return card;
}

function makeAppliedCard(l) {
  const wrap = document.createElement('div');
  wrap.className = 'card-wrap';

  const card = document.createElement('div');
  card.className = 'card';
  card.append(makeCardBody(l));

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
  status.addEventListener('change', async () => {
    l.status = status.value;
    try {
      await window.api.setStatus(l.id, status.value);
    } catch {
      showError('Could not update status — refresh and retry.');
    }
  });

  const notesBtn = document.createElement('button');
  notesBtn.className = 'notes-btn';
  notesBtn.textContent = l.notes ? 'Notes •' : 'Notes';

  card.addEventListener('click', () => {
    if (l.url) window.api.openUrl(l.url);
  });

  card.append(status, notesBtn);
  wrap.append(card);

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
    notesArea.addEventListener('blur', async () => {
      const text = notesArea.value.trim();
      if (text === (l.notes ?? '')) return;
      l.notes = text || null;
      notesBtn.textContent = l.notes ? 'Notes •' : 'Notes';
      try {
        await window.api.setNotes(l.id, text);
      } catch {
        showError('Could not save notes — they may be lost on refresh.');
      }
    });
    wrap.append(notesArea);
    notesArea.focus();
  });

  return wrap;
}

function renderList() {
  listEl.replaceChildren();
  const listings = visibleListings();

  if (!listings.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent =
      activeTab === 'applied'
        ? 'Nothing applied to yet — hit "Applied ✓" on a listing.'
        : locationFilter
          ? 'No unseen listings match this location filter.'
          : 'No unseen listings in this tab.';
    listEl.appendChild(empty);
    return;
  }

  for (const l of listings) {
    listEl.appendChild(activeTab === 'applied' ? makeAppliedCard(l) : makeUnseenCard(l));
  }
}

function render(listings) {
  allListings = listings;
  if (
    activeTab !== 'all' &&
    activeTab !== 'applied' &&
    !searches.some((s) => s.id === activeTab)
  ) {
    activeTab = 'all';
  }
  clearError();
  renderTabs();
  renderList();
}

// ---------- wiring ----------

window.api.onListings(render);
window.api.onError(showError);

Promise.all([window.api.getSearches(), window.api.getApplied()]).then(
  ([s, a]) => {
    searches = s;
    appliedListings = a;
    renderTabs();
  }
);

locFilterEl.addEventListener('input', () => {
  locationFilter = locFilterEl.value.trim();
  renderList();
});

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  [searches, appliedListings] = await Promise.all([
    window.api.getSearches(),
    window.api.getApplied(),
  ]);
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
    renderTabs();
    renderList();
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
    renderTabs();
  } catch (e) {
    showError(`Could not save tab: ${e.message}`);
  }
});

document.getElementById('quit').addEventListener('click', () => window.api.quit());
