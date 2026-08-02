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
};
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
    return rows.sort((a, b) => (b.applied_at ?? '').localeCompare(a.applied_at ?? ''));
  }
  return rows.sort((a, b) => (b.fit_score ?? -1) - (a.fit_score ?? -1));
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
function mutate(listing, patch, call, failMsg) {
  Object.assign(listing, patch);
  const stored = state.listings.find((x) => x.id === listing.id);
  if (stored && stored !== listing) Object.assign(stored, patch);
  render();
  call().catch(() => {
    state.error = failMsg;
    render();
  });
}

const actKeep = (l) => mutate(l, { seen: true }, () => window.api.markSeen(l.id), 'Could not keep.');
const actApply = (l) =>
  mutate(
    l,
    { status: 'applied', applied_at: new Date().toISOString(), seen: true, dismissed_at: null },
    () => window.api.markApplied(l.id),
    'Could not mark applied.'
  );
const actDismiss = (l) =>
  mutate(l, { seen: true, dismissed_at: new Date().toISOString() }, () => window.api.dismiss(l.id), 'Could not dismiss.');
const actRestore = (l) =>
  mutate(l, { seen: true, dismissed_at: null }, () => window.api.restore(l.id), 'Could not restore.');

function go(mode, patch = {}) {
  Object.assign(state, patch, { mode });
  render();
}

function openDetail(l) {
  state.detailListing = l;
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
  title.append(el('span', 'hdr-count', String(rows.length)));
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
  const chrome = el('div', 'hdr-actions');
  chrome.id = 'chrome-btns';
  chrome.append(themeBtn, winBtns);

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
      render();
    });
    strip.append(cell);
  }
  screen.append(strip);

  // Role tabs
  const tabs = el('div', 'tabs');
  const mkTab = (id, label) => {
    const t = el('button', 'tab' + (state.activeTab === id ? ' on' : ''), label);
    t.addEventListener('click', () => {
      state.activeTab = id;
      state.openRowId = null;
      render();
    });
    return t;
  };
  tabs.append(mkTab('all', `All · ${rows.length}`));
  for (const s of state.searches) {
    const n = state.listings.filter((l) => viewOf(l) === view && l.search_id === s.id).length;
    tabs.append(mkTab(s.id, `${s.label} · ${n}`));
  }
  const add = el('button', 'tab-add');
  add.append(icon('plus'));
  add.title = 'New tab';
  add.addEventListener('click', () => go('tabs', { editingSearchId: null }));
  tabs.append(add);
  screen.append(tabs);

  const err = errorBar();
  if (err) screen.append(err);

  // Body
  const body = el('div', 'scroll');
  if (!rows.length) {
    body.append(el('div', 'empty', emptyText(view)));
  } else {
    for (const band of bandsFor(view, rows)) {
      const head = el('div', 'band' + (band.strong ? ' strong' : ''));
      head.append(el('span', null, band.label), el('span', null, String(band.rows.length)));
      body.append(head);
      for (const l of band.rows) body.append(listRow(l, view));
    }
  }
  screen.append(body);

  // Footer
  const foot = el('div', 'foot');
  const queue = inView('new');
  foot.append(
    btn(`Triage queue · ${queue.length}`, 'btn btn-lg' + (view === 'new' ? ' btn-acc' : ''), {
      iconName: 'play',
      disabled: !queue.length,
      onClick: () => go('triage', { triageIndex: 0 }),
    }),
    btn('Filters', 'btn', { onClick: () => go('tabs', { editingSearchId: 'filters' }) })
  );
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
  text.append(el('div', 'row-role', l.role), el('div', 'row-sub', [l.company, l.location].filter(Boolean).join(' · ')));

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
    backLink(VIEW_TITLE[state.activeView], () => go('list')),
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
  };
  const build = screens[state.mode] ?? screenList;
  app.replaceChildren(build());
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
window.api.getTheme?.().then((t) => {
  state.theme = t;
  render();
});

render();
