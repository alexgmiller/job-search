const listEl = document.getElementById('list');
const errorEl = document.getElementById('error');
const refreshBtn = document.getElementById('refresh');
const tabsEl = document.getElementById('tabs');
const addFormEl = document.getElementById('add-form');

let searches = [];
let allListings = [];
let activeTab = 'all'; // 'all' or a search id

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}

function clearError() {
  errorEl.style.display = 'none';
}

function renderTabs() {
  tabsEl.replaceChildren();

  const makeTab = (id, label) => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (activeTab === id ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      activeTab = id;
      addFormEl.style.display = 'none';
      renderTabs();
      renderList();
    });
    tabsEl.appendChild(btn);
  };

  makeTab('all', `All (${allListings.length})`);
  for (const s of searches) {
    const count = allListings.filter((l) => l.search_id === s.id).length;
    makeTab(s.id, `${s.label} (${count})`);
  }

  const plus = document.createElement('button');
  plus.className = 'tab';
  plus.textContent = '+';
  plus.title = 'Add a role tab';
  plus.addEventListener('click', () => {
    addFormEl.style.display =
      addFormEl.style.display === 'block' ? 'none' : 'block';
  });
  tabsEl.appendChild(plus);
}

function render(listings) {
  allListings = listings;
  // If the active tab was deleted/disabled remotely, fall back to All.
  if (activeTab !== 'all' && !searches.some((s) => s.id === activeTab)) {
    activeTab = 'all';
  }
  clearError();
  renderTabs();
  renderList();
}

function renderList() {
  listEl.replaceChildren();
  const listings =
    activeTab === 'all'
      ? allListings
      : allListings.filter((l) => l.search_id === activeTab);

  if (!listings.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No unseen listings in this tab.';
    listEl.appendChild(empty);
    return;
  }

  for (const l of listings) {
    const card = document.createElement('div');
    card.className = 'card';

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
    meta.textContent = [l.location, new Date(l.found_at).toLocaleDateString()]
      .filter(Boolean)
      .join(' · ');

    body.append(role, company, meta);

    const dismiss = document.createElement('button');
    dismiss.className = 'dismiss';
    dismiss.textContent = '✕';
    dismiss.title = 'Mark seen';
    dismiss.addEventListener('click', async (e) => {
      e.stopPropagation();
      // Optimistic: drop it locally (updates tab counts too).
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

    card.append(body, dismiss);
    listEl.appendChild(card);
  }
}

window.api.onListings(render);
window.api.onError(showError);

// Tabs come from the `searches` table; empty if migration-2 hasn't run yet.
window.api.getSearches().then((s) => {
  searches = s;
  renderTabs();
});

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  searches = await window.api.getSearches();
  await window.api.refresh();
  refreshBtn.disabled = false;
});

document.getElementById('add-cancel').addEventListener('click', () => {
  addFormEl.style.display = 'none';
});

document.getElementById('add-save').addEventListener('click', async () => {
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
    searches = await window.api.addSearch({ label, keywords, locations });
    addFormEl.style.display = 'none';
    for (const id of ['add-label', 'add-keywords', 'add-locations']) {
      document.getElementById(id).value = '';
    }
    clearError();
    renderTabs();
  } catch (e) {
    showError(`Could not add role: ${e.message}`);
  }
});

document.getElementById('quit').addEventListener('click', () => window.api.quit());
