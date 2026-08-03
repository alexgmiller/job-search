// Modernist widget renderer.
//
// One state machine, one render pass: `mode` selects a screen, each screen
// builds header → content → footer into #app. Screens swap instantly; the
// design deliberately has no transitions (a 340px always-on-top panel should
// not feel like a phone).

const app = document.getElementById('app');

// ---------- state ----------
const VIEWS = [
  { key: 'new', label: 'New' },
  { key: 'seen', label: 'Kept' },
  { key: 'progress', label: 'Progress' },
  { key: 'dismissed', label: 'Out' },
];
const VIEW_TITLE = {
  new: 'By fit',
  seen: 'Kept',
  progress: 'In progress',
  dismissed: 'Out',
};
const STATUSES = ['applied', 'interviewing', 'offer', 'rejected'];
const STAGES = ['Applied', 'Interviewing', 'Offer', 'Rejected'];
const KINDS = ['experience', 'education', 'skill', 'project', 'certification', 'other'];

const state = {
  mode: 'list', // list | triage | detail | tailor | profile | import | tabs
  activeView: 'new',
  activeTab: 'all',
  openRowId: null,
  triageIndex: 0,
  detailListing: null,
  listings: [],
  searches: [],
  profile: [],
  locationFilter: '',
  activeRegions: new Set(),
  editingSearchId: null,
  theme: 'system',
  settings: { accent: 'red', theme: 'system', notifications: true, pollMinutes: 5, openAtLogin: false, followUpDays: 10 },
  toast: null, // { label, undoFn }
  followUpsOnly: false,
  searchQuery: '',
  searchResults: [],
  searchBusy: false,
  muted: [],
  importResult: null, // { fileName, method, rows: [{kind,title,content,on}] }
  tailor: null, // { listing, step, text, error }
  error: '',
  loaded: false,
};

// ---------- icons (Lucide, inline) ----------
const ICON_PATHS = {
  eye: [['path', { d: 'M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0' }], ['circle', { cx: 12, cy: 12, r: 3 }]],
  file: [['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }], ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }], ['path', { d: 'M16 13H8' }], ['path', { d: 'M16 17H8' }]],
  note: [['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }], ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }], ['path', { d: 'M12 12H8' }]],
  play: [['polygon', { points: '6 3 20 12 6 21 6 3', fill: 'currentColor' }]],
  undo: [['path', { d: 'M9 14 4 9l5-5' }], ['path', { d: 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11' }]],
  pencil: [['path', { d: 'M12 20h9' }], ['path', { d: 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z' }]],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  x: [['path', { d: 'M18 6 6 18' }], ['path', { d: 'm6 6 12 12' }]],
  ext: [['path', { d: 'M7 7h10v10' }], ['path', { d: 'M7 17 17 7' }]],
  left: [['path', { d: 'm12 19-7-7 7-7' }], ['path', { d: 'M19 12H5' }]],
  plus: [['path', { d: 'M5 12h14' }], ['path', { d: 'M12 5v14' }]],
  trash: [['path', { d: 'M3 6h18' }], ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }], ['path', { d: 'M10 11v6' }], ['path', { d: 'M14 11v6' }]],
  sun: [['circle', { cx: 12, cy: 12, r: 4 }], ['path', { d: 'M12 2v2' }], ['path', { d: 'M12 20v2' }], ['path', { d: 'm4.93 4.93 1.41 1.41' }], ['path', { d: 'm17.66 17.66 1.41 1.41' }], ['path', { d: 'M2 12h2' }], ['path', { d: 'M20 12h2' }], ['path', { d: 'm6.34 17.66-1.41 1.41' }], ['path', { d: 'm19.07 4.93-1.41 1.41' }]],
  moon: [['path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' }]],
  monitor: [['rect', { x: 2, y: 3, width: 20, height: 14, rx: 2 }], ['path', { d: 'M8 21h8' }], ['path', { d: 'M12 17v4' }]],
  sliders: [['path', { d: 'M20 7h-9' }], ['path', { d: 'M14 17H5' }], ['circle', { cx: 17, cy: 17, r: 3 }], ['circle', { cx: 7, cy: 7, r: 3 }]],
  search: [['circle', { cx: 11, cy: 11, r: 8 }], ['path', { d: 'm21 21-4.3-4.3' }]],
  bell: [['path', { d: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9' }], ['path', { d: 'M10.3 21a1.94 1.94 0 0 0 3.4 0' }]],
  mute: [['path', { d: 'm2 2 20 20' }], ['path', { d: 'M18.89 13.23A7.12 7.12 0 0 0 19 12v-2' }], ['path', { d: 'M9.5 4.5A5 5 0 0 1 17 8v2c0 .3 0 .6.05.88' }], ['path', { d: 'M5 10v2a7 7 0 0 0 12 5' }]],
};

// Accent options. Each has a light and dark pair — [--acc, --acc7] — because
// the same hue needs different weight on a light vs dark ground.
const ACCENTS = {
  red:    { label: 'Red',    light: ['#ec3013', '#ae1800'], dark: ['#ff563c', '#ff9783'] },
  amber:  { label: 'Amber',  light: ['#b26a00', '#7d4a00'], dark: ['#e0a03a', '#f0c98a'] },
  green:  { label: 'Green',  light: ['#127a45', '#0b5330'], dark: ['#3fbf7f', '#8ad9b0'] },
  teal:   { label: 'Teal',   light: ['#0f6f78', '#084a51'], dark: ['#3fbecb', '#8adbe4'] },
  blue:   { label: 'Blue',   light: ['#1d5fd0', '#123f8f'], dark: ['#5b95ea', '#9dbdf5'] },
  violet: { label: 'Violet', light: ['#6b3fc4', '#4a2a8a'], dark: ['#9b7ae8', '#c3adf3'] },
  slate:  { label: 'Slate',  light: ['#3f4a5a', '#28303c'], dark: ['#8fa1bb', '#b9c6d8'] },
};

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

// Accent lives in CSS custom properties on :root, so every rule that already
// references var(--acc) picks it up with no further plumbing.
function applyAccent() {
  const a = ACCENTS[state.settings.accent] ?? ACCENTS.red;
  const [acc, acc7] = prefersDark.matches ? a.dark : a.light;
  document.documentElement.style.setProperty('--acc', acc);
  document.documentElement.style.setProperty('--acc7', acc7);
}
// Re-apply when the effective scheme flips (OS change, or our theme toggle).
prefersDark.addEventListener('change', applyAccent);
const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(name, size = 11) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.flexShrink = '0';
  for (const [tag, attrs] of ICON_PATHS[name] ?? []) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

// ---------- tiny DOM helpers ----------
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function btn(label, className, { iconName, onClick, title, disabled } = {}) {
  const b = el('button', className);
  if (iconName) b.append(icon(iconName));
  if (label) b.append(el('span', null, label));
  if (title) b.title = title;
  if (disabled) b.disabled = true;
  if (onClick) {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(e);
    });
  }
  return b;
}

function iconBtn(name, { onClick, title } = {}) {
  const b = el('button', 'btn-ico');
  b.append(icon(name));
  if (title) b.title = title;
  if (onClick) {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(e);
    });
  }
  return b;
}

function backLink(label, onClick) {
  const b = el('button', 'back');
  b.append(icon('left'), el('span', null, label));
  b.addEventListener('click', onClick);
  return b;
}

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : '');

function sourceOf(url = '') {
  if (/usajobs/.test(url)) return 'USAJobs';
  if (/adzuna/.test(url)) return 'Adzuna';
  if (/remotive/.test(url)) return 'Remotive';
  if (/lever\.co/.test(url)) return 'Lever';
  if (/greenhouse/.test(url)) return 'Greenhouse';
  return 'Board';
}

// ---------- derived data ----------
function viewOf(l) {
  if (l.status) return 'progress';
  if (l.dismissed_at) return 'dismissed';
  if (l.seen) return 'seen';
  return 'new';
}

function inView(view) {
  let rows = state.listings.filter((l) => viewOf(l) === view);
  if (state.activeTab !== 'all') rows = rows.filter((l) => l.search_id === state.activeTab);
  if (state.activeRegions.size) {
    const targets = [...state.activeRegions];
    rows = rows.filter((l) => window.JobLocations.matchesLocation(l.location, targets));
  }
  if (state.locationFilter) {
    const f = state.locationFilter.toLowerCase();
    rows = rows.filter((l) => (l.location ?? '').toLowerCase().includes(f));
  }
  if (view === 'progress') {
    if (state.followUpsOnly) rows = rows.filter(followUpDue);
    return rows.sort((a, b) => (b.applied_at ?? '').localeCompare(a.applied_at ?? ''));
  }
  return rows.sort((a, b) => (b.fit_score ?? -1) - (a.fit_score ?? -1));
}

// An application needs a follow-up when it's still sitting at "applied"
// with no movement for followUpDays. Moving it to interviewing/rejected
// (ghosted counts as rejected) clears it.
function followUpDue(l) {
  if (l.status !== 'applied' || !l.applied_at) return false;
  const days = state.settings.followUpDays ?? 10;
  return Date.now() - new Date(l.applied_at).getTime() > days * 864e5;
}

// Counts ignore the tab/region filters so the strip reads as a global tally.
function viewCount(view) {
  return state.listings.filter((l) => viewOf(l) === view).length;
}

const scoreClass = (n) => (n >= 75 ? 'hi' : n >= 50 ? '' : 'lo');

// The score breakdown; falls back to the composite when fit_parts is absent
// (listings scored before migration-7).
function partsOf(l) {
  const p = l.fit_parts;
  if (p && typeof p === 'object') return p;
  const composite = l.fit_score ?? 0;
  return { skills: composite, seniority: null, location: null, terms: [] };
}

// Group a view's rows into the labelled bands the design calls for.
function bandsFor(view, rows) {
  if (view === 'new') {
    return [
      { label: 'Strong · 75+', strong: true, rows: rows.filter((r) => (r.fit_score ?? 0) >= 75) },
      { label: 'Worth a look · 50–74', rows: rows.filter((r) => (r.fit_score ?? 0) >= 50 && (r.fit_score ?? 0) < 75) },
      { label: 'Long shot · under 50', rows: rows.filter((r) => (r.fit_score ?? 0) < 50) },
    ].filter((b) => b.rows.length);
  }
  if (view === 'seen') return [{ label: 'Kept for later', rows }];
  if (view === 'dismissed') return [{ label: 'Dismissed', rows }];
  // In progress: bands are pipeline stages, furthest stage styled strong.
  const order = ['offer', 'interviewing', 'applied', 'rejected'];
  const present = order.filter((s) => rows.some((r) => r.status === s));
  return present.map((s, i) => ({
    label: s,
    strong: i === 0,
    rows: rows.filter((r) => r.status === s),
  }));
}

// ---------- mutations ----------
// Optimistic: patch locally, render, then persist. On failure surface the
// message; the next poll re-syncs from the server.
// ---------- undo toast ----------
// Every lifecycle mutation offers a few seconds of undo — mis-clicks are
// cheap in the triage deck, so recovery has to be cheap too.
let toastTimer = null;

function showToast(label, undoFn) {
  state.toast = { label, undoFn };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = null;
    render();
  }, 7000);
  render();
}

function clearToast() {
  clearTimeout(toastTimer);
  state.toast = null;
}

function applyLocal(listing, patch) {
  Object.assign(listing, patch);
  const stored = state.listings.find((x) => x.id === listing.id);
  if (stored && stored !== listing) Object.assign(stored, patch);
}

function mutate(listing, patch, call, failMsg, undoLabel) {
  // Capture the prior values of exactly the fields being changed, so undo
  // restores the listing to whatever state it was in — not a guessed one.
  const prev = {};
  for (const k of Object.keys(patch)) prev[k] = listing[k] ?? null;

  applyLocal(listing, patch);
  render();
  call().catch(() => {
    state.error = failMsg;
    render();
  });

  if (undoLabel) {
    showToast(undoLabel, () => {
      applyLocal(listing, prev);
      clearToast();
      render();
      window.api.updateListings([listing.id], prev).catch(() => {
        state.error = 'Undo failed — refresh to re-sync.';
        render();
      });
    });
  }
}

const actKeep = (l) =>
  mutate(l, { seen: true }, () => window.api.markSeen(l.id), 'Could not keep.', 'Kept');
const actApply = (l) =>
  mutate(
    l,
    { status: 'applied', applied_at: new Date().toISOString(), seen: true, dismissed_at: null },
    () => window.api.markApplied(l.id),
    'Could not mark applied.',
    'Marked applied'
  );
const actDismiss = (l) =>
  mutate(
    l,
    { seen: true, dismissed_at: new Date().toISOString() },
    () => window.api.dismiss(l.id),
    'Could not dismiss.',
    'Dismissed'
  );
const actRestore = (l) =>
  mutate(l, { seen: true, dismissed_at: null }, () => window.api.restore(l.id), 'Could not restore.', 'Restored');

// Bulk dismiss for a whole band. Same optimistic pattern, one server call.
function bulkDismiss(rows, label) {
  if (!rows.length) return;
  const now = new Date().toISOString();
  const prev = rows.map((r) => ({ id: r.id, listing: r, seen: r.seen, dismissed_at: r.dismissed_at }));
  for (const r of rows) applyLocal(r, { seen: true, dismissed_at: now });
  render();
  window.api.updateListings(rows.map((r) => r.id), { seen: true, dismissed_at: now }).catch(() => {
    state.error = 'Bulk dismiss failed — refresh to re-sync.';
    render();
  });
  showToast(`Dismissed ${rows.length} (${label})`, () => {
    // Prior states can differ per row (seen flags), so restore per group.
    const groups = new Map();
    for (const p of prev) {
      applyLocal(p.listing, { seen: p.seen, dismissed_at: p.dismissed_at });
      const key = JSON.stringify([p.seen, p.dismissed_at]);
      if (!groups.has(key)) groups.set(key, { patch: { seen: p.seen, dismissed_at: p.dismissed_at }, ids: [] });
      groups.get(key).ids.push(p.id);
    }
    clearToast();
    render();
    for (const g of groups.values()) {
      window.api.updateListings(g.ids, g.patch).catch(() => {
        state.error = 'Undo failed — refresh to re-sync.';
        render();
      });
    }
  });
}

// Mute a company: stop the scraper collecting it, and clear what's already
// in the triage views. Undo reverses both.
function muteCompanyFlow(company) {
  if (!company) return;
  if (!confirm(`Mute ${company}? Its listings are hidden and the scraper stops collecting them.`)) return;

  const affected = state.listings.filter(
    (l) => l.company === company && (viewOf(l) === 'new' || viewOf(l) === 'seen')
  );
  const now = new Date().toISOString();
  const prev = affected.map((r) => ({ listing: r, seen: r.seen, dismissed_at: r.dismissed_at }));
  for (const r of affected) applyLocal(r, { seen: true, dismissed_at: now });

  window.api
    .muteCompany(company)
    .then((m) => {
      state.muted = m;
      render();
    })
    .catch((e) => {
      state.error = e.message;
      render();
    });
  if (affected.length) {
    window.api.updateListings(affected.map((r) => r.id), { seen: true, dismissed_at: now });
  }

  go('list');
  showToast(`Muted ${company}${affected.length ? ` · ${affected.length} hidden` : ''}`, () => {
    for (const p of prev) applyLocal(p.listing, { seen: p.seen, dismissed_at: p.dismissed_at });
    const groups = new Map();
    for (const p of prev) {
      const key = JSON.stringify([p.seen, p.dismissed_at]);
      if (!groups.has(key)) groups.set(key, { patch: { seen: p.seen, dismissed_at: p.dismissed_at }, ids: [] });
      groups.get(key).ids.push(p.listing.id);
    }
    for (const g of groups.values()) window.api.updateListings(g.ids, g.patch).catch(() => {});
    const entry = state.muted.find((m) => m.name.toLowerCase() === company.toLowerCase());
    if (entry) {
      window.api.unmuteCompany(entry.id).then((m) => {
        state.muted = m;
        render();
      });
    }
    clearToast();
    render();
  });
}

function go(mode, patch = {}) {
  Object.assign(state, patch, { mode });
  render();
}

function openDetail(l) {
  state.detailListing = l;
  // Remember where the user came from, so Back returns to search results
  // rather than dumping them on the list.
  state.detailReturn = state.mode === 'search' ? 'search' : 'list';
  state.mode = 'detail';
  render();
  window.api
    .getListing(l.id)
    .then((full) => {
      if (full && state.detailListing?.id === full.id) {
        state.detailListing = { ...state.detailListing, ...full };
        if (state.mode === 'detail') render();
      }
    })
    .catch(() => {});
}

// ---------- shared pieces ----------
function scoreBars(l, { thick } = {}) {
  const p = partsOf(l);
  const tone = (l.fit_score ?? 0) >= 75 ? 'var(--acc)' : 'var(--ink)';
  const wrap = el('div', thick ? 'bars d-bars' : 'bars');
  const rows = [
    ['Skills', p.skills],
    ['Seniority', p.seniority],
    ['Location', p.location],
  ];
  for (const [label, value] of rows) {
    if (value == null) continue;
    const row = el('div', 'bar-row');
    row.append(el('span', 'bar-label', label));
    const bar = el('div', 'bar');
    bar.style.background = `linear-gradient(to right, ${tone} ${value}%, var(--rule) ${value}%)`;
    row.append(bar, el('span', 'bar-val', String(value)));
    wrap.append(row);
  }
  return wrap.children.length ? wrap : null;
}

function termTags(l) {
  const terms = partsOf(l).terms ?? [];
  if (!terms.length) return null;
  const wrap = el('div', 'tags');
  for (const t of terms.slice(0, 6)) wrap.append(el('span', 'tag', t));
  return wrap;
}

function errorBar() {
  if (!state.error) return null;
  const bar = el('div', 'err', state.error);
  bar.addEventListener('click', () => {
    state.error = '';
    render();
  });
  return bar;
}

// ---------- screen: list ----------
function screenList() {
  const screen = el('div', 'screen');
  const view = state.activeView;
  const rows = inView(view);

  // Header
  const hdr = el('div', 'hdr');
  const title = el('div', 'hdr-title');
  title.append(el('span', null, VIEW_TITLE[view]));
  title.append(el('span', 'hdr-count', state.loaded ? String(rows.length) : '·'));
  const actions = el('div', 'hdr-actions');
  actions.append(
    btn('Profile', 'btn', {
      onClick: () => {
        window.api.getProfile().then((p) => go('profile', { profile: p }));
      },
    }),
    btn('Refresh', 'btn btn-acc', {
      onClick: async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        state.searches = await window.api.getSearches();
        await window.api.refresh();
        b.disabled = false;
      },
    })
  );
  // Theme cycles system → light → dark. The icon shows the current choice,
  // so it doubles as an indicator.
  const THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' };
  const THEME_NEXT = { system: 'light', light: 'dark', dark: 'system' };
  const themeBtn = btn('', 'btn', {
    iconName: THEME_ICON[state.theme] ?? 'monitor',
    title: `Theme: ${state.theme} — click for ${THEME_NEXT[state.theme] ?? 'light'}`,
    onClick: () => {
      const next = THEME_NEXT[state.theme] ?? 'light';
      window.api.setTheme(next).then((applied) => {
        state.theme = applied;
        render();
      });
    },
  });

  const winBtns = el('div', 'hdr-actions');
  winBtns.id = 'win-btns';
  winBtns.append(
    btn('', 'btn', { iconName: 'ext', title: 'Full window', onClick: () => window.api.setMode('full') }),
    btn('', 'btn', { iconName: 'x', title: 'Hide to tray', onClick: () => window.api.minimize() })
  );
  const searchBtn = btn('', 'btn', {
    iconName: 'search',
    title: 'Search all listings',
    onClick: () => go('search'),
  });

  const settingsBtn = btn('', 'btn', {
    iconName: 'sliders',
    title: 'Settings',
    onClick: () =>
      Promise.all([window.api.getSettings(), window.api.getMuted?.() ?? []]).then(([s, m]) =>
        go('settings', { settings: s, muted: m })
      ),
  });

  const chrome = el('div', 'hdr-actions');
  chrome.id = 'chrome-btns';
  chrome.append(searchBtn, settingsBtn, themeBtn, winBtns);

  const right = el('div', 'hdr-actions');
  right.append(actions, chrome);
  hdr.append(title, right);
  screen.append(hdr);

  // View strip
  const strip = el('div', 'strip');
  for (const v of VIEWS) {
    const cell = el('button', 'strip-cell' + (v.key === view ? ' on' : ''), `${v.label} ${viewCount(v.key)}`);
    cell.addEventListener('click', () => {
      state.activeView = v.key;
      state.openRowId = null;
      state.followUpsOnly = false;
      render();
    });
    strip.append(cell);
  }
  screen.append(strip);

  // Role tabs
  // The scrolling strip and the + live side by side: tabs overflow inside
  // .tabs-scroll while + stays pinned and always reachable. The wheel maps
  // to horizontal scroll, since the scrollbar is hidden and a mouse has no
  // other way to reach off-screen tabs.
  const tabs = el('div', 'tabs');
  const tabStrip = el('div', 'tabs-scroll');
  const mkTab = (id, label) => {
    const t = el('button', 'tab' + (state.activeTab === id ? ' on' : ''), label);
    t.addEventListener('click', () => {
      state.activeTab = id;
      state.openRowId = null;
      render();
    });
    return t;
  };
  tabStrip.append(mkTab('all', `All · ${rows.length}`));
  for (const s of state.searches) {
    const n = state.listings.filter((l) => viewOf(l) === view && l.search_id === s.id).length;
    tabStrip.append(mkTab(s.id, `${s.label} · ${n}`));
  }
  tabStrip.addEventListener('wheel', (e) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (delta) {
      e.preventDefault();
      tabStrip.scrollLeft += delta;
    }
  }, { passive: false });
  tabs.append(tabStrip);

  const add = el('button', 'tab-add');
  add.append(icon('plus'));
  add.title = 'New tab';
  add.addEventListener('click', () => go('tabs', { editingSearchId: null }));
  tabs.append(add);
  screen.append(tabs);

  // Keep the active tab in view when it would otherwise sit off-screen.
  setTimeout(() => {
    tabStrip.querySelector('.tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, 0);

  const err = errorBar();
  if (err) screen.append(err);

  // Body
  const body = el('div', 'scroll');
  if (!state.loaded) {
    // Distinct from the empty state — "no listings" and "not fetched yet"
    // look identical otherwise, and the first fetch happens after paint.
    body.append(el('div', 'empty', 'Loading listings…'));
  } else if (!rows.length) {
    body.append(el('div', 'empty', emptyText(view)));
  } else {
    for (const band of bandsFor(view, rows)) {
      const head = el('div', 'band' + (band.strong ? ' strong' : ''));
      const right = el('span', 'band-right');
      right.append(el('span', null, String(band.rows.length)));
      // Bulk dismiss for triage-able views; the undo toast is the safety net.
      if (view === 'new' || view === 'seen') {
        const clear = el('button', 'band-x');
        clear.append(icon('x', 9));
        clear.title = `Dismiss all ${band.rows.length} in “${band.label}”`;
        clear.addEventListener('click', (e) => {
          e.stopPropagation();
          if (band.rows.length > 50 && !confirm(`Dismiss all ${band.rows.length} listings in “${band.label}”?`)) return;
          bulkDismiss([...band.rows], band.label);
        });
        right.append(clear);
      }
      head.append(el('span', null, band.label), right);
      body.append(head);
      for (const l of band.rows) body.append(listRow(l, view));
    }
  }
  screen.append(body);

  // Footer
  const foot = el('div', 'foot');
  if (view === 'progress') {
    // The design handoff specifies this footer for In Progress: an outline
    // "Follow-ups due" toggle instead of the triage button.
    const due = state.listings.filter((l) => viewOf(l) === 'progress' && followUpDue(l)).length;
    foot.append(
      btn(
        state.followUpsOnly ? `Showing follow-ups · ${due}` : `Follow-ups due · ${due}`,
        'btn btn-lg' + (state.followUpsOnly ? ' btn-acc' : ''),
        {
          iconName: 'bell',
          disabled: !due && !state.followUpsOnly,
          onClick: () => {
            state.followUpsOnly = !state.followUpsOnly;
            render();
          },
        }
      ),
      btn('Filters', 'btn', { onClick: () => go('tabs', { editingSearchId: 'filters' }) })
    );
  } else {
    const queue = inView('new');
    foot.append(
      btn(`Triage queue · ${queue.length}`, 'btn btn-lg' + (view === 'new' ? ' btn-acc' : ''), {
        iconName: 'play',
        disabled: !queue.length,
        onClick: () => go('triage', { triageIndex: 0 }),
      }),
      btn('Filters', 'btn', { onClick: () => go('tabs', { editingSearchId: 'filters' }) })
    );
  }
  screen.append(foot);
  return screen;
}

function emptyText(view) {
  return {
    new: 'No new listings. The scraper runs every 3 hours.',
    seen: 'Nothing kept — use Keep on a new listing to park it here.',
    progress: 'Nothing applied to yet.',
    dismissed: 'Nothing dismissed.',
  }[view];
}

function listRow(l, view) {
  const wrap = el('div');
  const open = state.openRowId === l.id;
  const row = el('div', 'row' + (open ? ' open' : ''));

  const score = el('div', `row-score ${scoreClass(l.fit_score ?? 0)}`, l.fit_score == null ? '–' : String(l.fit_score));
  const text = el('div', 'row-text');
  const sub = el('div', 'row-sub');
  if (view === 'progress' && followUpDue(l)) sub.append(el('span', 'row-due', 'Follow up'));
  sub.append(document.createTextNode([l.company, l.location].filter(Boolean).join(' · ')));
  text.append(el('div', 'row-role', l.role), sub);

  const acts = el('div', 'row-acts');
  if (view === 'dismissed') {
    acts.append(iconBtn('undo', { title: 'Restore', onClick: () => actRestore(l) }));
  } else if (view === 'progress') {
    acts.append(iconBtn('pencil', { title: 'Open', onClick: () => openDetail(l) }));
  } else {
    acts.append(
      iconBtn('check', { title: 'Applied', onClick: () => actApply(l) }),
      iconBtn('x', { title: 'Dismiss', onClick: () => actDismiss(l) })
    );
  }

  row.append(score, text, acts);
  row.addEventListener('click', () => {
    state.openRowId = open ? null : l.id;
    render();
  });
  wrap.append(row);

  if (open) wrap.append(expandedRow(l, view));
  return wrap;
}

function expandedRow(l, view) {
  const exp = el('div', 'exp');

  if (view === 'progress') {
    const pipe = el('div', 'pipe');
    for (const stage of STAGES) {
      const on = (l.status ?? '').toLowerCase() === stage.toLowerCase();
      const cell = el('button', 'pipe-cell' + (on ? ' on' : ''), stage);
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = stage.toLowerCase();
        l.status = next;
        const stored = state.listings.find((x) => x.id === l.id);
        if (stored) stored.status = next;
        window.api.setStatus(l.id, next).catch(() => {
          state.error = 'Could not update status.';
          render();
        });
        render();
      });
      pipe.append(cell);
    }
    exp.append(pipe);
    if (l.notes) exp.append(el('div', 'terms', l.notes));
    const acts = el('div', 'exp-acts');
    acts.append(
      btn('Details', 'btn btn-sm', { onClick: () => openDetail(l) }),
      btn('Tailor', 'btn btn-sm', { iconName: 'file', onClick: () => startTailor(l) })
    );
    exp.append(acts);
    return exp;
  }

  const bars = scoreBars(l);
  if (bars) exp.append(bars);
  const terms = partsOf(l).terms ?? [];
  if (terms.length) exp.append(el('div', 'terms', terms.join(' · ')));

  const acts = el('div', 'exp-acts');
  acts.append(btn('Details', 'btn btn-sm', { onClick: () => openDetail(l) }));
  if (view === 'new') acts.append(btn('Keep', 'btn btn-sm', { iconName: 'eye', onClick: () => actKeep(l) }));
  if (view === 'dismissed') {
    acts.append(btn('Restore', 'btn btn-sm', { iconName: 'undo', onClick: () => actRestore(l) }));
  } else {
    acts.append(btn('Applied', 'btn btn-sm btn-acc', { iconName: 'check', onClick: () => actApply(l) }));
  }
  exp.append(acts);
  return exp;
}

// ---------- screen: listing detail ----------
function screenDetail() {
  const l = state.detailListing;
  const screen = el('div', 'screen');

  const hdr = el('div', 'hdr');
  hdr.append(
    backLink(
      state.detailReturn === 'search' ? 'Search' : VIEW_TITLE[state.activeView],
      () => go(state.detailReturn === 'search' ? 'search' : 'list')
    ),
    el('div', 'hdr-right', sourceOf(l.url))
  );
  screen.append(hdr);

  const body = el('div', 'scroll pad');
  const head = el('div', 'd-head');
  const left = el('div');
  left.append(el('div', 'd-role', l.role), el('div', 'd-company', l.company));
  const tab = state.searches.find((s) => s.id === l.search_id)?.label;
  left.append(
    el('div', 'd-meta', [l.location, l.found_at ? `found ${fmtDate(l.found_at)}` : null, tab].filter(Boolean).join(' · '))
  );
  const right = el('div');
  right.append(
    el('div', `d-score ${scoreClass(l.fit_score ?? 0)}`, l.fit_score == null ? '–' : String(l.fit_score)),
    el('div', 'd-fit', 'Fit')
  );
  head.append(left, right);
  body.append(head);

  const bars = scoreBars(l, { thick: true });
  if (bars) body.append(bars);
  const tags = termTags(l);
  if (tags) body.append(tags);

  body.append(el('div', 'desc', l.description ?? 'Loading description…'));

  // Mute lives in the scrolling body, not the pinned action grid — it's a
  // rare action and shouldn't compete with Keep/Applied/Out.
  const muteBtn = el('button', 'detail-mute');
  muteBtn.append(icon('mute', 10), el('span', null, `Mute ${l.company}`));
  muteBtn.title = 'Hide this company everywhere and stop collecting its listings';
  muteBtn.addEventListener('click', () => muteCompanyFlow(l.company));
  body.append(muteBtn);
  screen.append(body);

  const foot = el('div', 'foot foot-grid');
  const top = el('div', 'grid2');
  top.append(
    btn('Open posting', 'btn btn-lg btn-acc', {
      iconName: 'ext',
      disabled: !l.url,
      onClick: () => l.url && window.api.openUrl(l.url),
    }),
    btn('Tailor resume', 'btn btn-lg', { iconName: 'file', onClick: () => startTailor(l) })
  );
  const bottom = el('div', 'grid3');
  const view = viewOf(l);
  bottom.append(
    btn('Keep', 'btn btn-lg', { iconName: 'eye', onClick: () => { actKeep(l); go('list'); } }),
    btn('Applied', 'btn btn-lg', { iconName: 'check', onClick: () => { actApply(l); go('list'); } }),
    view === 'dismissed'
      ? btn('Restore', 'btn btn-lg', { iconName: 'undo', onClick: () => { actRestore(l); go('list'); } })
      : btn('Out', 'btn btn-lg', { iconName: 'x', onClick: () => { actDismiss(l); go('list'); } })
  );
  foot.append(top, bottom);
  screen.append(foot);
  return screen;
}

// ---------- screen: tailor ----------
function startTailor(listing) {
  state.tailor = { listing, step: 1, text: '', error: '' };
  go('tailor');
  window.api
    .tailorResume(listing.id)
    .then((text) => {
      if (state.tailor?.listing.id === listing.id) {
        state.tailor.text = text;
        state.tailor.step = 3;
        render();
      }
    })
    .catch((e) => {
      if (state.tailor?.listing.id === listing.id) {
        state.tailor.error = e.message;
        render();
      }
    });
  // Second step lights up once the request is in flight.
  setTimeout(() => {
    if (state.tailor && !state.tailor.text && state.tailor.step < 2) {
      state.tailor.step = 2;
      render();
    }
  }, 700);
}

function screenTailor() {
  const t = state.tailor;
  const screen = el('div', 'screen');

  const hdr = el('div', 'hdr');
  hdr.append(backLink('Listing', () => go('detail')), el('div', 'hdr-right', 'Claude Haiku · ~2¢'));
  screen.append(hdr);

  const body = el('div', 'scroll pad');
  body.append(el('div', 'hdr-title', 'Tailored resume'));
  body.append(
    el('div', 'sub-line', `${t.listing.role} — ${t.listing.company} · ${state.profile.length || '—'} profile entries`)
  );

  const prog = el('div', 'progress');
  ['Profile read', 'Listing parsed', 'Draft written'].forEach((label, i) => {
    prog.append(el('div', 'pipe-cell' + (t.step > i ? ' on' : ''), label));
  });
  body.append(prog);

  if (t.error) body.append(el('div', 'panel', `Failed: ${t.error}`));
  else if (t.text) body.append(el('div', 'panel', t.text));
  else body.append(el('div', 'panel', 'Generating… this can take a minute.'));
  screen.append(body);

  const foot = el('div', 'foot');
  foot.append(
    btn('Copy', 'btn btn-acc', {
      disabled: !t.text,
      onClick: () => navigator.clipboard.writeText(t.text),
    }),
    btn('Save…', 'btn', {
      disabled: !t.text,
      onClick: () => {
        const name =
          `resume-${t.listing.company}-${t.listing.role}`
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '') + '.md';
        window.api.saveText(t.text, name);
      },
    }),
    btn('Close', 'btn', { onClick: () => go('detail') })
  );
  screen.append(foot);
  return screen;
}

// ---------- screen: profile ----------
function screenProfile() {
  const screen = el('div', 'screen');
  const hdr = el('div', 'hdr');
  hdr.append(backLink('List', () => go('list')), el('div', 'hdr-right', `${state.profile.length} entries`));
  screen.append(hdr);

  const body = el('div', 'scroll');
  const top = el('div', 'pad');
  top.append(el('div', 'hdr-title', 'Profile'));
  top.append(el('div', 'sub-line', 'Fit scoring and the resume tailor only know what is written here.'));
  const grid = el('div', 'grid2');
  grid.style.marginTop = '10px';
  grid.append(
    btn('Add entry', 'btn btn-lg btn-acc', { iconName: 'plus', onClick: () => addChunkPrompt() }),
    btn('Import resume', 'btn btn-lg', { iconName: 'file', onClick: () => runImport() })
  );
  top.append(grid);
  body.append(top);

  for (const c of state.profile) {
    const row = el('div', 'chunk');
    row.append(el('span', 'tag tag-quiet', c.kind), el('span', 'chunk-title', c.title));
    row.append(iconBtn('pencil', { title: 'Edit', onClick: () => editChunkPrompt(c) }));
    const bodyText = el('div', 'chunk-body');
    bodyText.append(el('div', 'chunk-text', c.content));
    row.append(bodyText);
    body.append(row);
  }
  if (!state.profile.length) body.append(el('div', 'empty', 'No profile entries yet. Import a resume to fill this in.'));
  screen.append(body);

  const foot = el('div', 'foot');
  foot.append(el('div', 'foot-note', 'Stored in profile_chunks'));
  screen.append(foot);
  return screen;
}

// Minimal add/edit using the structured field schema already in the app.
function addChunkPrompt() {
  const kind = 'experience';
  const PF = window.ProfileFields;
  const fields = {};
  const title = prompt('Title (e.g. IT Support Intern — Acme, 2025)');
  if (!title) return;
  const content = prompt('Details — responsibilities, tools, outcomes');
  if (!content) return;
  fields.role = title;
  fields.bullets = content;
  window.api
    .addChunk({ kind, title, content, fields: PF ? fields : undefined })
    .then((p) => {
      state.profile = p;
      render();
    })
    .catch((e) => {
      state.error = e.message;
      render();
    });
}

function editChunkPrompt(c) {
  const title = prompt('Title', c.title);
  if (title == null) return;
  const content = prompt('Details', c.content);
  if (content == null) return;
  window.api
    .updateChunk({ id: c.id, kind: c.kind, title, content })
    .then((p) => {
      state.profile = p;
      render();
    })
    .catch((e) => {
      state.error = e.message;
      render();
    });
}

// ---------- screen: resume import review ----------
function runImport() {
  window.api
    .importResume()
    .then((result) => {
      if (!result) return;
      state.importResult = {
        fileName: result.fileName,
        method: result.method,
        rows: result.chunks.map((c) => ({ ...c, on: c.kind !== 'other' })),
      };
      go('import');
    })
    .catch((e) => {
      state.error = `Import failed: ${e.message}`;
      render();
    });
}

function screenImport() {
  const imp = state.importResult;
  const screen = el('div', 'screen');
  const hdr = el('div', 'hdr');
  hdr.append(
    backLink('Profile', () => go('profile')),
    el('div', 'hdr-right', imp.method === 'ai' ? 'Claude Haiku · ~1¢' : 'Headings · free')
  );
  screen.append(hdr);

  const body = el('div', 'scroll');
  const top = el('div', 'pad');
  top.append(el('div', 'hdr-title', 'Review import'));
  top.append(
    el('div', 'sub-line', `${imp.fileName} · ${imp.rows.length} entries found. Nothing is saved until you confirm.`)
  );
  body.append(top);

  imp.rows.forEach((r, i) => {
    const row = el('div', 'imp-row' + (r.on ? '' : ' off'));
    const box = el('span', 'box');
    box.append(icon('check', 9));
    const right = el('div');
    const head = el('div');
    head.style.display = 'flex';
    head.style.gap = '7px';
    head.style.alignItems = 'center';
    head.append(el('span', 'tag tag-quiet', r.kind), el('span', 'chunk-title', r.title));
    right.append(head, el('div', 'chunk-text', r.content));
    row.append(box, right);
    row.addEventListener('click', () => {
      imp.rows[i].on = !imp.rows[i].on;
      render();
    });
    body.append(row);
  });
  screen.append(body);

  const picked = imp.rows.filter((r) => r.on);
  const foot = el('div', 'foot');
  foot.append(
    btn('Cancel', 'btn', { onClick: () => go('profile') }),
    btn(`Add ${picked.length} to profile`, 'btn btn-acc', {
      disabled: !picked.length,
      onClick: () => {
        window.api
          .addChunks(picked.map(({ kind, title, content }) => ({ kind, title, content })))
          .then((p) => go('profile', { profile: p, importResult: null }))
          .catch((e) => {
            state.error = e.message;
            render();
          });
      },
    })
  );
  screen.append(foot);
  return screen;
}

// ---------- screen: tab editor / filters ----------
function screenTabs() {
  const editing = state.searches.find((s) => s.id === state.editingSearchId);
  const filtersOnly = state.editingSearchId === 'filters';
  const screen = el('div', 'screen');

  const hdr = el('div', 'hdr');
  hdr.append(backLink('List', () => go('list')), el('div', 'hdr-right', filtersOnly ? 'View filters' : 'Searches table'));
  screen.append(hdr);

  const body = el('div', 'scroll pad');
  body.append(el('div', 'hdr-title', filtersOnly ? 'Filters' : editing ? 'Edit tab' : 'New tab'));

  const REGIONS = window.JobLocations.REGION_LABELS;

  if (filtersOnly) {
    body.append(el('div', 'sub-line', 'Narrow the visible list. These do not change what the scraper collects.'));
    const f = el('div', 'field');
    f.style.marginTop = '10px';
    f.append(el('label', 'f-label', 'Regions'));
    const chips = el('div', 'chips');
    for (const [key, label] of Object.entries(REGIONS)) {
      const chip = el('button', 'chip' + (state.activeRegions.has(key) ? ' on' : ''), label);
      chip.addEventListener('click', () => {
        if (state.activeRegions.has(key)) state.activeRegions.delete(key);
        else state.activeRegions.add(key);
        render();
      });
      chips.append(chip);
    }
    f.append(chips);
    body.append(f);

    const f2 = el('div', 'field');
    f2.append(el('label', 'f-label', 'Text'));
    const input = el('input', 'f-input');
    input.value = state.locationFilter;
    input.placeholder = 'City, state or company';
    input.addEventListener('input', () => {
      state.locationFilter = input.value.trim();
    });
    f2.append(input);
    body.append(f2);
    screen.append(body);

    const foot = el('div', 'foot');
    foot.append(
      btn('Clear', 'btn', {
        onClick: () => {
          state.activeRegions.clear();
          state.locationFilter = '';
          render();
        },
      }),
      btn('Done', 'btn btn-acc', { onClick: () => go('list') })
    );
    screen.append(foot);
    return screen;
  }

  body.append(el('div', 'sub-line', 'Keywords match the job title; regions decide which locations count.'));

  const mkField = (label, value, placeholder) => {
    const f = el('div', 'field');
    f.append(el('label', 'f-label', label));
    const input = el('input', 'f-input');
    input.value = value ?? '';
    if (placeholder) input.placeholder = placeholder;
    f.append(input);
    body.append(f);
    return input;
  };

  const wrapTop = el('div');
  wrapTop.style.marginTop = '10px';
  body.append(wrapTop);
  const nameInput = mkField('Tab name', editing?.label, 'Data Analyst');
  const kwInput = mkField('Keywords', (editing?.keywords ?? []).join(', '), 'data analyst, analytics');

  const regionKeys = Object.keys(REGIONS);
  const chosen = new Set((editing?.locations ?? []).filter((l) => regionKeys.includes(l)));
  const rf = el('div', 'field');
  rf.append(el('label', 'f-label', 'Regions'));
  const chips = el('div', 'chips');
  for (const [key, label] of Object.entries(REGIONS)) {
    const chip = el('button', 'chip' + (chosen.has(key) ? ' on' : ''), label);
    chip.addEventListener('click', () => {
      if (chosen.has(key)) chosen.delete(key);
      else chosen.add(key);
      chip.classList.toggle('on', chosen.has(key));
    });
    chips.append(chip);
  }
  rf.append(chips);
  body.append(rf);

  const extraInput = mkField(
    'Extra locations',
    (editing?.locations ?? []).filter((l) => !regionKeys.includes(l)).join(', '),
    'blank + no regions = anywhere'
  );

  if (editing) {
    const n = state.listings.filter((l) => l.search_id === editing.id).length;
    body.append(el('div', 'note', `${n} listings carry this tab. Deleting the tab keeps them under All.`));
  }
  screen.append(body);

  const collect = () => ({
    label: nameInput.value.trim(),
    keywords: kwInput.value.split(',').map((s) => s.trim()).filter(Boolean),
    locations: [...chosen, ...extraInput.value.split(',').map((s) => s.trim()).filter(Boolean)],
  });

  const foot = el('div', 'foot');
  if (editing) {
    foot.append(
      btn('Delete', 'btn btn-danger', {
        iconName: 'trash',
        onClick: () => {
          if (!confirm(`Delete the "${editing.label}" tab?`)) return;
          window.api.deleteSearch(editing.id).then((s) => {
            state.activeTab = 'all';
            go('list', { searches: s });
          });
        },
      })
    );
  }
  const spacer = el('div');
  spacer.style.flex = '1';
  foot.append(spacer);
  foot.append(
    btn('Cancel', 'btn', { onClick: () => go('list') }),
    btn('Save', 'btn btn-acc', {
      onClick: () => {
        const payload = collect();
        if (!payload.label || !payload.keywords.length) {
          state.error = 'A tab needs a name and at least one keyword.';
          render();
          return;
        }
        const call = editing
          ? window.api.updateSearch({ id: editing.id, ...payload })
          : window.api.addSearch(payload);
        call
          .then((s) => go('list', { searches: s }))
          .catch((e) => {
            state.error = e.message;
            render();
          });
      },
    })
  );
  screen.append(foot);
  return screen;
}

// ---------- screen: search ----------
// Server-side, so it covers the whole table — the renderer only holds the
// newest 500 listings, which is exactly when search matters.
let searchDebounce = null;

function runSearch(q) {
  state.searchQuery = q;
  clearTimeout(searchDebounce);
  if (q.trim().length < 2) {
    state.searchResults = [];
    state.searchBusy = false;
    render();
    return;
  }
  state.searchBusy = true;
  searchDebounce = setTimeout(() => {
    const asked = q;
    window.api
      .searchListings(q)
      .then((rows) => {
        if (state.searchQuery !== asked) return; // stale response
        state.searchResults = rows;
        state.searchBusy = false;
        render();
      })
      .catch((e) => {
        state.searchBusy = false;
        state.error = e.message;
        render();
      });
  }, 300);
}

function screenSearch() {
  const screen = el('div', 'screen');

  const hdr = el('div', 'hdr');
  hdr.append(
    backLink('List', () => go('list')),
    el('div', 'hdr-right',
      state.searchBusy ? 'Searching…' : state.searchQuery.trim().length >= 2 ? `${state.searchResults.length} results` : 'All listings')
  );
  screen.append(hdr);

  const bar = el('div', 'pad search-bar');
  const input = el('input', 'f-input');
  input.type = 'text';
  input.placeholder = 'Role, company or location…';
  input.value = state.searchQuery;
  input.addEventListener('input', () => runSearch(input.value));
  bar.append(input);
  screen.append(bar);

  const body = el('div', 'scroll');
  if (state.searchQuery.trim().length < 2) {
    body.append(el('div', 'empty', 'Type at least two characters. Searches every stored listing, not just the newest 500.'));
  } else if (!state.searchBusy && !state.searchResults.length) {
    body.append(el('div', 'empty', `Nothing matches “${state.searchQuery.trim()}”.`));
  } else {
    for (const l of state.searchResults) {
      const row = el('div', 'row');
      row.append(el('div', `row-score ${scoreClass(l.fit_score ?? 0)}`, l.fit_score == null ? '–' : String(l.fit_score)));
      const text = el('div', 'row-text');
      const stateLabel = { new: '', seen: 'Kept', progress: l.status ?? '', dismissed: 'Dismissed' }[viewOf(l)];
      text.append(
        el('div', 'row-role', l.role),
        el('div', 'row-sub', [l.company, l.location, stateLabel].filter(Boolean).join(' · '))
      );
      row.append(text, el('div'));
      row.addEventListener('click', () => openDetail(l));
      body.append(row);
    }
  }
  screen.append(body);

  const foot = el('div', 'foot');
  foot.append(el('div', 'foot-note', 'Search covers role, company and location'));
  screen.append(foot);

  // Focus after mount.
  setTimeout(() => input.focus(), 0);
  return screen;
}

// ---------- screen: settings ----------
function settingRow(label, hint, control) {
  const row = el('div', 'set-row');
  const left = el('div');
  left.append(el('div', 'set-label', label));
  if (hint) left.append(el('div', 'note', hint));
  row.append(left, control);
  return row;
}

function toggle(value, onChange) {
  const b = el('button', 'chip' + (value ? ' on' : ''), value ? 'On' : 'Off');
  b.addEventListener('click', () => onChange(!value));
  return b;
}

function saveSetting(key, value) {
  return window.api
    .setSetting(key, value)
    .then((s) => {
      state.settings = { ...state.settings, ...s };
      if (key === 'theme') state.theme = s.theme;
      applyAccent();
      render();
    })
    .catch((e) => {
      state.error = e.message;
      render();
    });
}

function screenSettings() {
  const s = state.settings;
  const screen = el('div', 'screen');

  const hdr = el('div', 'hdr');
  hdr.append(
    backLink('List', () => go('list')),
    el('div', 'hdr-right', s.version ? `v${s.version}` : 'Settings')
  );
  screen.append(hdr);

  const body = el('div', 'scroll pad');
  body.append(el('div', 'hdr-title', 'Settings'));

  // --- appearance ---
  body.append(el('div', 'set-head', 'Appearance'));

  const swatches = el('div', 'chips');
  for (const [key, a] of Object.entries(ACCENTS)) {
    const chip = el('button', 'chip swatch' + (s.accent === key ? ' on' : ''));
    const dot = el('span', 'dot');
    dot.style.background = prefersDark.matches ? a.dark[0] : a.light[0];
    chip.append(dot, el('span', null, a.label));
    chip.addEventListener('click', () => saveSetting('accent', key));
    swatches.append(chip);
  }
  body.append(settingRow('Accent colour', 'Used for scores, active states and primary buttons.', el('div')));
  body.append(swatches);

  const themeChips = el('div', 'chips');
  for (const t of ['system', 'light', 'dark']) {
    const chip = el('button', 'chip' + (s.theme === t ? ' on' : ''), t);
    chip.addEventListener('click', () => saveSetting('theme', t));
    themeChips.append(chip);
  }
  body.append(settingRow('Theme', 'System follows Windows.', el('div')));
  body.append(themeChips);

  // --- behaviour ---
  body.append(el('div', 'set-head', 'Behaviour'));
  body.append(
    settingRow(
      'Desktop notifications',
      'Notify when a poll finds listings you have not seen.',
      toggle(s.notifications, (v) => saveSetting('notifications', v))
    )
  );
  body.append(
    settingRow(
      'Start at login',
      'Launch Shortlist when you sign in to Windows.',
      toggle(s.openAtLogin, (v) => saveSetting('openAtLogin', v))
    )
  );

  const minutes = el('input', 'f-input set-num');
  minutes.type = 'number';
  minutes.min = '1';
  minutes.max = '180';
  minutes.value = String(s.pollMinutes ?? 5);
  const commit = () => {
    const v = Number(minutes.value);
    if (v && v !== s.pollMinutes) saveSetting('pollMinutes', v);
  };
  minutes.addEventListener('change', commit);
  minutes.addEventListener('blur', commit);
  body.append(settingRow('Check every (minutes)', 'How often to poll Supabase for new listings.', minutes));

  const followUp = el('input', 'f-input set-num');
  followUp.type = 'number';
  followUp.min = '1';
  followUp.max = '60';
  followUp.value = String(s.followUpDays ?? 10);
  const commitFollowUp = () => {
    const v = Number(followUp.value);
    if (v && v !== s.followUpDays) saveSetting('followUpDays', v);
  };
  followUp.addEventListener('change', commitFollowUp);
  followUp.addEventListener('blur', commitFollowUp);
  body.append(
    settingRow(
      'Follow up after (days)',
      'Applications still at “applied” after this long are flagged in In Progress.',
      followUp
    )
  );

  // --- muted companies ---
  body.append(el('div', 'set-head', 'Muted companies'));
  if (!state.muted.length) {
    body.append(el('div', 'note', 'None. Mute a company from a listing’s detail screen.'));
  } else {
    for (const m of state.muted) {
      const row = el('div', 'set-row');
      row.append(el('div', 'set-label', m.name));
      const un = el('button', 'chip', 'Unmute');
      un.addEventListener('click', () => {
        window.api
          .unmuteCompany(m.id)
          .then((list) => {
            state.muted = list;
            render();
          })
          .catch((e) => {
            state.error = e.message;
            render();
          });
      });
      row.append(un);
      body.append(row);
    }
  }

  // --- window ---
  body.append(el('div', 'set-head', 'Window'));
  const modeChips = el('div', 'chips');
  for (const [key, label] of [['widget', 'Widget'], ['full', 'Full window']]) {
    const chip = el('button', 'chip' + (document.body.classList.contains(key) ? ' on' : ''), label);
    chip.addEventListener('click', () => window.api.setMode(key));
    modeChips.append(chip);
  }
  body.append(settingRow('Layout', 'Widget is the compact always-on-top panel.', el('div')));
  body.append(modeChips);

  // --- about ---
  body.append(el('div', 'set-head', 'About'));
  const about = el('div', 'note');
  about.append(
    el('div', null, `${state.listings.length} listings loaded · ${state.profile.length} profile entries`),
    el('div', null, `Config: ${s.configPath ?? '—'}`),
    el('div', null, `Data: ${s.userDataPath ?? '—'}`),
    el('div', null, s.packaged ? 'Installed build' : 'Development build')
  );
  body.append(about);
  screen.append(body);

  const foot = el('div', 'foot');
  foot.append(
    btn('Profile', 'btn', {
      onClick: () => window.api.getProfile().then((p) => go('profile', { profile: p })),
    }),
    btn('Done', 'btn btn-acc', { onClick: () => go('list') })
  );
  screen.append(foot);
  return screen;
}

// ---------- screen: triage deck ----------
function triageQueue() {
  return inView('new');
}

function screenTriage() {
  const queue = triageQueue();
  const screen = el('div', 'screen');
  const l = queue[state.triageIndex];

  // Always 12 segments — a fixed-width progress bar, not one tick per card.
  const ticks = el('div', 'ticks');
  const TICKS = 12;
  const filled = queue.length ? Math.round(((state.triageIndex + 1) / queue.length) * TICKS) : 0;
  for (let i = 0; i < TICKS; i++) ticks.append(el('div', 'tick' + (i < filled ? ' on' : '')));
  screen.append(ticks);

  const hdr = el('div', 'hdr');
  hdr.append(
    backLink('List', () => go('list')),
    el('div', 'hdr-right', queue.length ? `${state.triageIndex + 1} / ${queue.length}` : '0 / 0')
  );
  screen.append(hdr);

  if (!l) {
    const done = el('div', 'scroll pad');
    done.append(el('div', 'empty', 'Queue clear. Nothing left to triage.'));
    screen.append(done);
    const foot = el('div', 'foot');
    foot.append(btn('Back to list', 'btn btn-lg btn-acc', { onClick: () => go('list') }));
    screen.append(foot);
    return screen;
  }

  const body = el('div', 'scroll pad');
  const head = el('div', 'd-head');
  const left = el('div');
  left.append(el('div', 't-role', l.role), el('div', 't-company', l.company));
  const right = el('div');
  right.append(
    el('div', `d-score t-score ${scoreClass(l.fit_score ?? 0)}`, l.fit_score == null ? '–' : String(l.fit_score)),
    el('div', 'd-fit', 'Fit')
  );
  head.append(left, right);
  body.append(head);

  const bars = scoreBars(l, { thick: true });
  if (bars) body.append(bars);
  const tags = termTags(l);
  if (tags) body.append(tags);

  const tab = state.searches.find((s) => s.id === l.search_id)?.label;
  body.append(
    el(
      'div',
      'd-meta',
      [l.location, l.found_at ? `found ${fmtDate(l.found_at)}` : null, sourceOf(l.url)].filter(Boolean).join(' · ')
    )
  );
  const snippet = (l.description ?? '').slice(0, 320);
  body.append(el('div', 'desc', snippet || 'No description captured for this listing.'));
  screen.append(body);

  const foot = el('div', 'foot foot-grid');
  const verbs = el('div', 'grid3');
  verbs.append(
    btn('Skip', 'btn btn-lg', { iconName: 'x', onClick: () => triageAct('skip') }),
    btn('Keep', 'btn btn-lg', { iconName: 'eye', onClick: () => triageAct('keep') }),
    btn('Apply', 'btn btn-lg btn-acc', { iconName: 'check', onClick: () => triageAct('apply') })
  );
  const hint = el('div', 'foot-note');
  hint.append(el('span', null, 'D skip · S keep · A apply · J/K move'));
  const open = el('button', 'foot-note');
  open.style.width = 'auto';
  open.append(el('span', null, 'Open ↗'));
  open.addEventListener('click', () => l.url && window.api.openUrl(l.url));
  hint.append(open);
  foot.append(verbs, hint);
  screen.append(foot);
  return screen;
}

function triageAct(verb) {
  const queue = triageQueue();
  const l = queue[state.triageIndex];
  if (!l) return;
  if (verb === 'keep') actKeep(l);
  else if (verb === 'apply') actApply(l);
  else if (verb === 'skip') actDismiss(l);
  // The acted-on card leaves the queue, so the index already points at the
  // next card; clamp when the tail is reached.
  const remaining = triageQueue();
  if (state.triageIndex >= remaining.length) state.triageIndex = Math.max(0, remaining.length - 1);
  render();
}

document.addEventListener('keydown', (e) => {
  if (state.mode !== 'triage') return;
  if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'd') triageAct('skip');
  else if (k === 's') triageAct('keep');
  else if (k === 'a') triageAct('apply');
  else if (k === 'j') {
    state.triageIndex = Math.min(state.triageIndex + 1, Math.max(0, triageQueue().length - 1));
    render();
  } else if (k === 'k') {
    state.triageIndex = Math.max(0, state.triageIndex - 1);
    render();
  } else if (e.key === 'Escape') go('list');
});

// ---------- render ----------
function render() {
  const screens = {
    list: screenList,
    detail: screenDetail,
    tailor: screenTailor,
    profile: screenProfile,
    import: screenImport,
    tabs: screenTabs,
    triage: screenTriage,
    settings: screenSettings,
    search: screenSearch,
  };
  const build = screens[state.mode] ?? screenList;
  app.replaceChildren(build());

  if (state.toast) {
    const t = el('div', 'toast');
    t.append(el('span', 'toast-label', state.toast.label));
    const undo = el('button', 'toast-undo', 'Undo');
    undo.addEventListener('click', () => state.toast?.undoFn());
    t.append(undo);
    app.append(t);
  }
}

// ---------- wiring ----------
window.api.onListings((listings) => {
  state.listings = listings;
  state.loaded = true;
  state.error = '';
  if (state.detailListing) {
    const fresh = listings.find((l) => l.id === state.detailListing.id);
    if (fresh) state.detailListing = { ...state.detailListing, ...fresh };
  }
  render();
});

window.api.onError((msg) => {
  state.error = msg;
  render();
});

if (new URLSearchParams(location.search).get('mode') === 'widget') {
  document.body.classList.add('widget');
} else {
  document.body.classList.add('full');
}

window.api.getSearches().then((s) => {
  state.searches = s;
  render();
});
window.api.getProfile().then((p) => {
  state.profile = p;
});
window.api.getSettings?.().then((s) => {
  state.settings = { ...state.settings, ...s };
  state.theme = s.theme ?? 'system';
  applyAccent();
  render();
});

render();
