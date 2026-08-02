const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  shell,
} = require('electron');
const fs = require('fs');
const path = require('path');

const SMOKE_TEST = process.argv.includes('--smoke-test');

const APP_NAME = 'Shortlist';
app.setName(APP_NAME);

// Tiny .env loader — the only config is the Supabase URL/key and poll
// interval. Checked in order:
//   1. userData/.env  — where a packaged install keeps its config, since
//      app.asar is read-only and shouldn't carry secrets
//   2. __dirname/.env — the dev checkout
// The first file that exists wins; later files don't override values that
// are already set.
// Built from appData (plain %APPDATA%) plus the app name rather than from
// getPath('userData'): in a packaged build that can still resolve to the
// default "Electron" folder at module-load time, which sent the installed
// app looking for its config in the wrong directory.
const CONFIG_DIR = path.join(app.getPath('appData'), APP_NAME);

const ENV_PATHS = [
  path.join(CONFIG_DIR, '.env'),
  path.join(app.getPath('userData'), '.env'),
  path.join(__dirname, '.env'),
];
let loadedEnvFrom = null;

// Appends one line per env-load attempt to CONFIG_DIR/startup.log — the
// installed build has intermittently failed to see its config on launch
// while the same exe launched by hand works, and this records exactly what
// each process observed. Cheap enough to leave on permanently.
function diag(line) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.appendFileSync(
      path.join(CONFIG_DIR, 'startup.log'),
      `${new Date().toISOString()} ${line}\n`
    );
  } catch {
    /* diagnostics must never break the app */
  }
}

function loadEnvFiles(reason) {
  const seen = [];
  for (const p of ENV_PATHS) {
    let exists = false;
    let readError = '';
    let keys = [];
    try {
      exists = fs.existsSync(p);
      if (exists) {
        for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
          const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
          if (!m) continue;
          keys.push(m[1]);
          if (!(m[1] in process.env)) process.env[m[1]] = m[2];
        }
        loadedEnvFrom = loadedEnvFrom ?? p;
      }
    } catch (e) {
      readError = e.message;
    }
    seen.push(`${p} exists=${exists} keys=[${keys.join(',')}]${readError ? ' ERR=' + readError : ''}`);
  }
  diag(
    `loadEnv(${reason}) pid=${process.pid} packaged=${app.isPackaged} ` +
      `url=${(process.env.SUPABASE_URL ?? '').length}ch key=${(process.env.SUPABASE_ANON_KEY ?? '').length}ch ` +
      `argv=[${process.argv.slice(1).join(' ')}] cwd=${process.cwd()} :: ${seen.join(' | ')}`
  );
}
loadEnvFiles('module-load');

const { createClient } = require('@supabase/supabase-js');

// .env supplies the default; the settings screen can override it per-user.
const ENV_POLL_MINUTES = Math.max(1, Number(process.env.POLL_MINUTES) || 5);

const SETTING_DEFAULTS = {
  accent: 'red',
  theme: 'system',
  notifications: true,
  pollMinutes: ENV_POLL_MINUTES,
  openAtLogin: false,
};

function getSettings() {
  const saved = loadSettings();
  const out = { ...SETTING_DEFAULTS };
  for (const k of Object.keys(SETTING_DEFAULTS)) {
    if (saved[k] !== undefined) out[k] = saved[k];
  }
  out.pollMinutes = Math.min(180, Math.max(1, Number(out.pollMinutes) || ENV_POLL_MINUTES));
  // The OS is the source of truth for launch-at-login, not our own file.
  try {
    out.openAtLogin = app.getLoginItemSettings().openAtLogin;
  } catch {
    /* unsupported platform — fall back to the stored value */
  }
  return out;
}

let pollTimer = null;

function schedulePoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, getSettings().pollMinutes * 60 * 1000);
}

// Lazily constructed and retried: the first launch after an install has
// occasionally started with an environment where the initial config read
// misfired, and a client built once at module load stayed null until the
// app was relaunched. getSupabase re-reads the env files on each attempt
// until construction succeeds.
let supabaseClient = null;

function getSupabase() {
  if (supabaseClient) return supabaseClient;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) loadEnvFiles('retry');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  supabaseClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseClient;
}

let win = null;
let tray = null;
let quitting = false;

// Window mode, geometry and preferences persist across restarts. Kept in
// CONFIG_DIR for the same reason as .env, so the dev and installed builds
// genuinely share one location.
const settingsPath = path.join(CONFIG_DIR, 'settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return { mode: 'full', widgetBounds: null };
  }
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2));
  } catch {
    // Settings are a convenience; a failed write shouldn't break the app.
  }
  return next;
}

// Theme is 'system' | 'light' | 'dark'. Setting nativeTheme.themeSource
// makes Chromium report the chosen scheme to prefers-color-scheme, so the
// renderer's existing media queries do the work — no duplicate CSS.
const THEMES = ['system', 'light', 'dark'];

// Matches --bg in the stylesheet, so the window doesn't flash a different
// colour before the page paints.
function windowBg() {
  return nativeTheme.shouldUseDarkColors ? '#201e1d' : '#f3f2f2';
}

function applyTheme(value) {
  const theme = THEMES.includes(value) ? value : 'system';
  nativeTheme.themeSource = theme;
  if (win && !win.isDestroyed()) win.setBackgroundColor(windowBg());
  return theme;
}

// The most recent poll result. The first poll can finish before the renderer
// has registered its 'listings' listener — and a mode switch rebuilds the
// window entirely — so the payload is replayed on every did-finish-load.
// Without this the window can sit empty until the next poll, minutes later.
let lastListings = null;

// Ids already shown to the user, so background polls only notify about
// genuinely new rows. Seeded (without notifying) on the first poll.
const knownIds = new Set();
let firstPoll = true;

async function fetchListings() {
  if (!getSupabase()) {
    // Name the exact file to create — "copy .env.example" is useless advice
    // inside an installed build, where there is no checkout to copy from.
    throw new Error(
      `Missing SUPABASE_URL / SUPABASE_ANON_KEY. Create ${path.join(CONFIG_DIR, '.env')}`
    );
  }
  // Everything the four views need in one query; the renderer splits it.
  // Newest 500 keeps the payload bounded once dismissed rows pile up.
  const { data, error } = await getSupabase()
    .from('job_listings')
    .select('id, company, role, location, url, found_at, seen, search_id, status, applied_at, notes, dismissed_at, fit_score, fit_reason, fit_parts')
    .order('found_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// PostgREST reports an unknown column as PGRST204 / "column ... does not
// exist"; used to degrade gracefully when migration-6 hasn't been run.
function isMissingFieldsColumn(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase();
  return text.includes('fields') || text.includes('pgrst204');
}

async function fetchProfile() {
  if (!getSupabase()) return [];
  const { data, error } = await getSupabase()
    .from('profile_chunks')
    .select('id, kind, title, content, fields')
    .order('created_at', { ascending: true });
  if (!error) return data ?? [];
  // Fall back when migration-6 (fields) hasn't run yet; still tolerate
  // migration-5 being absent entirely.
  const legacy = await getSupabase()
    .from('profile_chunks')
    .select('id, kind, title, content')
    .order('created_at', { ascending: true });
  if (legacy.error) return [];
  return (legacy.data ?? []).map((c) => ({ ...c, fields: {} }));
}

// ---------- resume import ----------

async function extractResumeText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(filePath)) });
    try {
      const { text } = await parser.getText();
      // Strip the "-- 1 of 3 --" page separators pdf-parse injects.
      return (text ?? '').replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '');
    } finally {
      await parser.destroy();
    }
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const { value } = await mammoth.extractRawText({ path: filePath });
    return value ?? '';
  }
  if (ext === '.txt' || ext === '.md') return fs.readFileSync(filePath, 'utf8');
  throw new Error(`Unsupported file type: ${ext} (use PDF, DOCX, TXT, or MD)`);
}

const KIND_ENUM = [
  'experience',
  'education',
  'skill',
  'project',
  'certification',
  'other',
];

const IMPORT_SCHEMA = {
  type: 'object',
  properties: {
    chunks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: KIND_ENUM },
          title: { type: 'string', description: 'Short label, e.g. "IT Support Intern — Acme, 2025"' },
          content: { type: 'string', description: 'The details for this entry' },
        },
        required: ['kind', 'title', 'content'],
        additionalProperties: false,
      },
    },
  },
  required: ['chunks'],
  additionalProperties: false,
};

const IMPORT_SYSTEM = `You split a resume into structured profile chunks.

Rules:
- One chunk per distinct job, degree, project, or certification.
- For skills, group into a few themed chunks (e.g. "IT / Systems",
  "Programming Languages", "Tools & Platforms") rather than one giant blob
  or one chunk per word. List the individual skills inside "content",
  comma-separated, keeping the exact tool and technology names — these
  terms are matched against job postings, so preserve them verbatim.
- Copy content from the resume. Do not invent, embellish, or add skills
  that are not written there.
- Skip contact details, addresses, and section headers themselves.
- "title" is a short human label; "content" holds the detail (bullets,
  descriptions, skill lists).`;

// Free fallback when no API key is set: split on ALL-CAPS / Title-Case
// section headers and keep each section as one chunk.
function heuristicChunks(text) {
  const KINDS = [
    [/^(work\s+)?experience|employment|professional/i, 'experience'],
    [/^education|academic/i, 'education'],
    [/^(technical\s+)?skills|competencies|proficienc/i, 'skill'],
    [/^projects?/i, 'project'],
    [/^certification|licen[cs]e/i, 'certification'],
  ];
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let current = null;

  const isHeader = (line) => {
    const t = line.trim();
    if (!t || t.length > 40) return false;
    // A header is short, has no sentence punctuation, and is ALL CAPS
    // (or matches a known section name).
    if (/[.;:,]$/.test(t)) return false;
    const alpha = t.replace(/[^A-Za-z]/g, '');
    if (alpha.length < 3) return false;
    return alpha === alpha.toUpperCase() || KINDS.some(([re]) => re.test(t));
  };

  for (const line of lines) {
    if (isHeader(line)) {
      if (current?.content.trim()) chunks.push(current);
      const label = line.trim();
      const kind = KINDS.find(([re]) => re.test(label))?.[1] ?? 'other';
      current = { kind, title: label, content: '' };
    } else if (current && line.trim()) {
      current.content += line.trim() + '\n';
    }
  }
  if (current?.content.trim()) chunks.push(current);
  return chunks
    .map((c) => ({ ...c, content: c.content.trim() }))
    .filter((c) => c.content.length > 10);
}

async function parseResume(filePath) {
  const text = (await extractResumeText(filePath)).trim();
  if (!text) throw new Error('No text found in that file (is the PDF a scan?)');

  if (!process.env.ANTHROPIC_API_KEY) {
    const chunks = heuristicChunks(text);
    if (!chunks.length) {
      throw new Error(
        'Could not detect resume sections. Add an ANTHROPIC_API_KEY to desktop/.env for smarter parsing, or add chunks manually.'
      );
    }
    return { chunks, method: 'headings' };
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 8000,
    system: IMPORT_SYSTEM,
    output_config: { format: { type: 'json_schema', schema: IMPORT_SCHEMA } },
    messages: [{ role: 'user', content: `RESUME:\n\n${text.slice(0, 40000)}` }],
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to parse this file.');
  }
  const raw = response.content.find((b) => b.type === 'text')?.text ?? '{}';
  const parsed = JSON.parse(raw);
  const chunks = (parsed.chunks ?? []).filter(
    (c) => c && KIND_ENUM.includes(c.kind) && c.title && c.content
  );
  if (!chunks.length) throw new Error('No profile entries found in that file.');
  return { chunks, method: 'ai' };
}

const TAILOR_SYSTEM = `You write tailored resumes. You are given a candidate's
profile (chunks of real experience, education, skills, projects) and one job
listing. Produce a one-page resume in Markdown, tailored to that job:

- Select and order the most relevant profile content for this role; lead with
  what matches the job's requirements.
- Rephrase for impact and use the job posting's terminology where honest.
- NEVER invent employers, titles, dates, degrees, certifications, tools, or
  accomplishments not present in the profile. Reframing is fine; fabricating
  is not.
- Structure: name/contact placeholder line, a 2-3 sentence summary written
  for this specific role, then sections (Experience, Projects, Skills,
  Education) ordered by relevance.
- If the job asks for something important the profile cannot support, add a
  final "Gaps to address" note listing it (outside the resume proper).`;

async function tailorResume(listingId) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'No ANTHROPIC_API_KEY in desktop/.env — get one at console.anthropic.com and restart the app.'
    );
  }
  if (!getSupabase()) throw new Error('Supabase not configured');

  const [{ data: listing, error: lErr }, chunks] = await Promise.all([
    getSupabase()
      .from('job_listings')
      .select('company, role, location, description')
      .eq('id', listingId)
      .single(),
    fetchProfile(),
  ]);
  if (lErr) throw new Error(lErr.message);
  if (!chunks.length) {
    throw new Error('Your profile is empty — add experience/skills chunks via the Profile button first.');
  }

  const profile = chunks
    .map((c) => `[${c.kind}] ${c.title}\n${c.content}`)
    .join('\n\n');

  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic();
  // Haiku 4.5: a few cents per resume; thinking uses the budget_tokens form
  // (adaptive is not supported on Haiku).
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 16000,
    thinking: { type: 'enabled', budget_tokens: 4000 },
    system: TAILOR_SYSTEM,
    messages: [
      {
        role: 'user',
        content:
          `CANDIDATE PROFILE:\n${profile}\n\n` +
          `JOB LISTING:\n${listing.role} at ${listing.company}` +
          (listing.location ? ` (${listing.location})` : '') +
          (listing.description
            ? `\n\n${listing.description}`
            : '\n\n(no description stored — tailor from the title; note this limitation in the Gaps section)'),
      },
    ],
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined this request — try again.');
  }
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

async function fetchSearches() {
  if (!getSupabase()) return [];
  const { data, error } = await getSupabase()
    .from('searches')
    .select('id, label')
    .eq('enabled', true)
    .order('created_at', { ascending: true });
  // Tolerate the table not existing yet (migration-2 not run): no tabs.
  if (error) return [];
  return data ?? [];
}

function notifyNew(fresh) {
  if (!Notification.isSupported() || !getSettings().notifications) return;
  const title =
    fresh.length === 1 ? 'New job listing' : `${fresh.length} new job listings`;
  const body = fresh
    .slice(0, 3)
    .map((l) => `${l.role} — ${l.company}`)
    .join('\n');
  const n = new Notification({ title, body });
  n.on('click', () => showWindow());
  n.show();
}

async function poll() {
  try {
    const listings = await fetchListings();
    const fresh = listings.filter((l) => !l.seen && !knownIds.has(l.id));
    for (const l of listings) knownIds.add(l.id);
    if (!firstPoll && fresh.length > 0) notifyNew(fresh);
    firstPoll = false;
    lastListings = listings;
    win?.webContents.send('listings', listings);
    return listings;
  } catch (e) {
    win?.webContents.send('load-error', e.message);
    return null;
  }
}

// build/ holds the generated marks; regenerate with `npx electron
// build/make-icons.js` after editing build/logo.svg.
const iconPath = (size) => path.join(__dirname, 'build', `icon-${size}.png`);

// The mark is three rectangles, so it's cheaper to rasterise it in memory at
// whatever the current accent is than to ship a PNG set per colour. Geometry
// matches build/logo.svg, expressed in its 256-unit design space.
const LOGO_BARS = [
  [40, 36, 176, 40],
  [40, 108, 132, 40],
  [40, 180, 88, 40],
];

// Light-mode ramp step per accent, mirroring ACCENTS in renderer.js. Icons
// sit on OS chrome rather than our own background, so one tone serves both
// light and dark shells.
const ACCENT_HEX = {
  red: '#ec3013',
  amber: '#b26a00',
  green: '#127a45',
  teal: '#0f6f78',
  blue: '#1d5fd0',
  violet: '#6b3fc4',
  slate: '#3f4a5a',
};

function makeLogoImage(size, hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  // Supersample, then box-average, so small sizes get antialiased edges
  // instead of the staircase a direct rasterisation would give.
  const SS = 4;
  const big = size * SS;
  const coverage = new Float32Array(size * size);
  for (let by = 0; by < big; by++) {
    const y = ((by + 0.5) * 256) / big;
    for (let bx = 0; bx < big; bx++) {
      const x = ((bx + 0.5) * 256) / big;
      let inside = false;
      for (const [bxr, byr, bw, bh] of LOGO_BARS) {
        if (x >= bxr && x < bxr + bw && y >= byr && y < byr + bh) {
          inside = true;
          break;
        }
      }
      if (inside) coverage[Math.floor(by / SS) * size + Math.floor(bx / SS)] += 1;
    }
  }

  // BGRA, premultiplied — matters on the antialiased edges.
  const buf = Buffer.alloc(size * size * 4);
  const max = SS * SS;
  for (let i = 0; i < size * size; i++) {
    const a = Math.round((255 * coverage[i]) / max);
    buf[i * 4 + 0] = Math.round((b * a) / 255);
    buf[i * 4 + 1] = Math.round((g * a) / 255);
    buf[i * 4 + 2] = Math.round((r * a) / 255);
    buf[i * 4 + 3] = a;
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function accentHex() {
  return ACCENT_HEX[getSettings().accent] ?? ACCENT_HEX.red;
}

function trayIcon() {
  return makeLogoImage(16, accentHex());
}

function appIcon() {
  return makeLogoImage(256, accentHex());
}

// Repaint the window and tray marks to match the chosen accent.
function applyAccentIcons() {
  const hex = accentHex();
  if (win && !win.isDestroyed()) win.setIcon(makeLogoImage(256, hex));
  if (tray && !tray.isDestroyed()) tray.setImage(makeLogoImage(16, hex));
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

function createWindow(mode = loadSettings().mode ?? 'full') {
  const widget = mode === 'widget';
  const saved = loadSettings().widgetBounds;

  win = new BrowserWindow({
    width: widget ? (saved?.width ?? 340) : 560,
    height: widget ? (saved?.height ?? 460) : 680,
    x: widget ? saved?.x : undefined,
    y: widget ? saved?.y : undefined,
    show: false,
    title: APP_NAME,
    icon: appIcon(),
    // Match the stylesheet's --bg so the window doesn't flash white before
    // the page paints (very visible in dark mode).
    backgroundColor: windowBg(),
    frame: !widget,
    alwaysOnTop: widget,
    skipTaskbar: widget,
    resizable: true,
    minWidth: widget ? 260 : 420,
    minHeight: 320,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // The renderer reads ?mode= to switch to the compact widget layout.
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
    query: { mode },
  });
  win.once('ready-to-show', () => {
    if (!SMOKE_TEST) win.show();
  });

  // Replay the latest poll to a freshly-loaded renderer, and kick off a
  // fetch if none has landed yet, so the list is never blank on open.
  win.webContents.on('did-finish-load', () => {
    if (lastListings) win.webContents.send('listings', lastListings);
    else poll();
  });

  if (widget) {
    const remember = () => saveSettings({ widgetBounds: win.getBounds() });
    win.on('moved', remember);
    win.on('resized', remember);
  }

  // Closing the window keeps the app alive in the tray so background
  // polling and notifications continue.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

// Frameless/always-on-top can't be toggled on a live window — rebuild it.
function setMode(mode) {
  if (win && !win.isDestroyed() && loadSettings().mode === 'widget') {
    saveSettings({ widgetBounds: win.getBounds() });
  }
  saveSettings({ mode });
  const old = win;
  createWindow(mode);
  if (old && !old.isDestroyed()) old.destroy();
  buildTrayMenu();
}

function isAutoLaunchEnabled() {
  return app.getLoginItemSettings({
    path: process.execPath,
    args: [app.getAppPath()],
  }).openAtLogin;
}

function setAutoLaunch(enabled) {
  // Unpackaged dev runs launch electron.exe with the app dir as its argument.
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: [app.getAppPath()],
  });
  buildTrayMenu();
}

function buildTrayMenu() {
  if (!tray) return;
  const { mode } = loadSettings();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: showWindow },
      { type: 'separator' },
      {
        label: 'Widget mode (small, always on top)',
        type: 'radio',
        checked: mode === 'widget',
        click: () => setMode('widget'),
      },
      {
        label: 'Full window',
        type: 'radio',
        checked: mode !== 'widget',
        click: () => setMode('full'),
      },
      { type: 'separator' },
      {
        label: 'Start automatically at login',
        type: 'checkbox',
        checked: isAutoLaunchEnabled(),
        click: (item) => setAutoLaunch(item.checked),
      },
      { label: `Checking every ${getSettings().pollMinutes} min`, enabled: false },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ])
  );
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    // Apply the saved theme before the window exists so its background
    // colour is right on the very first paint.
    applyTheme(loadSettings().theme ?? 'system');
    createWindow();

    tray = new Tray(trayIcon());
    tray.setToolTip(APP_NAME);
    buildTrayMenu();
    tray.on('click', showWindow);

    ipcMain.handle('refresh', () => poll());
    ipcMain.handle('set-mode', (_e, mode) => setMode(mode));
    ipcMain.handle('get-settings', () => ({
      ...getSettings(),
      version: app.getVersion(),
      configPath: loadedEnvFrom ?? '(no .env found)',
      userDataPath: app.getPath('userData'),
      packaged: app.isPackaged,
    }));
    ipcMain.handle('set-setting', (_e, { key, value }) => {
      if (!(key in SETTING_DEFAULTS)) throw new Error(`Unknown setting: ${key}`);
      if (key === 'theme') applyTheme(value);
      if (key === 'openAtLogin') {
        try {
          // Manages the real OS entry; the stored copy is only a mirror.
          app.setLoginItemSettings({ openAtLogin: !!value, args: [] });
        } catch {
          /* unsupported platform */
        }
      }
      if (key === 'pollMinutes') {
        value = Math.min(180, Math.max(1, Number(value) || ENV_POLL_MINUTES));
      }
      saveSettings({ [key]: value });
      if (key === 'pollMinutes') {
        schedulePoll();
        buildTrayMenu();
      }
      if (key === 'accent') applyAccentIcons();
      return getSettings();
    });
    ipcMain.handle('get-theme', () => loadSettings().theme ?? 'system');
    ipcMain.handle('set-theme', (_e, value) => {
      const theme = applyTheme(value);
      saveSettings({ theme });
      return theme;
    });
    ipcMain.handle('minimize', () => win?.hide());
    ipcMain.handle('get-searches', () => fetchSearches());
    // Descriptions are up to 6k chars, so they're fetched per listing when
    // the detail view opens rather than on every poll.
    ipcMain.handle('get-listing', async (_e, id) => {
      if (!getSupabase()) throw new Error('Supabase not configured');
      const { data, error } = await getSupabase()
        .from('job_listings')
        .select(
          'id, company, role, location, url, found_at, seen, search_id, status, applied_at, notes, dismissed_at, fit_score, fit_reason, fit_parts, description'
        )
        .eq('id', id)
        .single();
      if (error) throw new Error(error.message);
      return data;
    });
    ipcMain.handle('add-search', async (_e, { label, keywords, locations }) => {
      if (!getSupabase()) throw new Error('Supabase not configured');
      const { error } = await getSupabase()
        .from('searches')
        .insert({ label, keywords, locations });
      if (error) throw new Error(error.message);
      return fetchSearches();
    });
    ipcMain.handle('update-search', async (_e, { id, label, keywords, locations }) => {
      if (!getSupabase()) throw new Error('Supabase not configured');
      const { error } = await getSupabase()
        .from('searches')
        .update({ label, keywords, locations })
        .eq('id', id);
      if (error) throw new Error(error.message);
      return fetchSearches();
    });
    ipcMain.handle('delete-search', async (_e, id) => {
      if (!getSupabase()) throw new Error('Supabase not configured');
      const { error } = await getSupabase().from('searches').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return fetchSearches();
    });
    ipcMain.handle('mark-applied', async (_e, id) => {
      if (!getSupabase()) throw new Error('Supabase not configured');
      // Applying moves the row to In Progress regardless of where it was.
      const { error } = await getSupabase()
        .from('job_listings')
        .update({
          status: 'applied',
          applied_at: new Date().toISOString(),
          seen: true,
          dismissed_at: null,
        })
        .eq('id', id);
      if (error) throw new Error(error.message);
    });
    ipcMain.handle('dismiss', async (_e, id) => {
      if (!getSupabase()) throw new Error('Supabase not configured');
      const { error } = await getSupabase()
        .from('job_listings')
        .update({ seen: true, dismissed_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new Error(error.message);
    });
    ipcMain.handle('restore', async (_e, id) => {
      if (!getSupabase()) throw new Error('Supabase not configured');
      // Restored rows land in Seen, not New — you've clearly looked at them.
      const { error } = await getSupabase()
        .from('job_listings')
        .update({ seen: true, dismissed_at: null })
        .eq('id', id);
      if (error) throw new Error(error.message);
    });
    ipcMain.handle('set-status', async (_e, { id, status }) => {
      if (!getSupabase()) throw new Error('Supabase not configured');
      const { error } = await getSupabase()
        .from('job_listings')
        .update({ status })
        .eq('id', id);
      if (error) throw new Error(error.message);
    });
    ipcMain.handle('get-profile', () => fetchProfile());
    ipcMain.handle('add-chunk', async (_e, { kind, title, content, fields }) => {
      if (!getSupabase()) throw new Error('Supabase not configured');
      const base = { kind, title, content };
      let { error } = await getSupabase()
        .from('profile_chunks')
        .insert(fields ? { ...base, fields } : base);
      // Structured fields need migration-6; fall back so the editor still
      // works (title/content are derived and self-sufficient) without it.
      if (error && isMissingFieldsColumn(error)) {
        ({ error } = await getSupabase().from('profile_chunks').insert(base));
      }
      if (error) throw new Error(error.message);
      return fetchProfile();
    });
    ipcMain.handle('import-resume', async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: 'Import resume',
        properties: ['openFile'],
        filters: [
          { name: 'Resume', extensions: ['pdf', 'docx', 'txt', 'md'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      if (canceled || !filePaths?.length) return null;
      const result = await parseResume(filePaths[0]);
      return { ...result, fileName: path.basename(filePaths[0]) };
    });
    ipcMain.handle('add-chunks', async (_e, chunks) => {
      if (!getSupabase()) throw new Error('Supabase not configured');
      if (!chunks?.length) return fetchProfile();
      const { error } = await getSupabase().from('profile_chunks').insert(
        chunks.map(({ kind, title, content }) => ({ kind, title, content }))
      );
      if (error) throw new Error(error.message);
      return fetchProfile();
    });
    ipcMain.handle('update-chunk', async (_e, { id, kind, title, content, fields }) => {
      if (!getSupabase()) throw new Error('Supabase not configured');
      const base = { kind, title, content };
      let { error } = await getSupabase()
        .from('profile_chunks')
        .update(fields ? { ...base, fields } : base)
        .eq('id', id);
      if (error && isMissingFieldsColumn(error)) {
        ({ error } = await getSupabase().from('profile_chunks').update(base).eq('id', id));
      }
      if (error) throw new Error(error.message);
      return fetchProfile();
    });
    ipcMain.handle('delete-chunk', async (_e, id) => {
      if (!getSupabase()) throw new Error('Supabase not configured');
      const { error } = await getSupabase().from('profile_chunks').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return fetchProfile();
    });
    ipcMain.handle('tailor-resume', (_e, id) => tailorResume(id));
    ipcMain.handle('save-text', async (_e, { content, defaultName }) => {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: defaultName,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (canceled || !filePath) return null;
      fs.writeFileSync(filePath, content, 'utf8');
      return filePath;
    });
    ipcMain.handle('set-notes', async (_e, { id, notes }) => {
      if (!getSupabase()) throw new Error('Supabase not configured');
      const { error } = await getSupabase()
        .from('job_listings')
        .update({ notes: notes || null })
        .eq('id', id);
      if (error) throw new Error(error.message);
    });
    ipcMain.handle('mark-seen', async (_e, id) => {
      if (!getSupabase()) throw new Error('Supabase not configured');
      const { error } = await getSupabase()
        .from('job_listings')
        .update({ seen: true })
        .eq('id', id);
      if (error) throw new Error(error.message);
    });
    ipcMain.handle('open-url', (_e, url) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    });
    ipcMain.handle('quit', () => app.quit());

    await poll();
    schedulePoll();

    if (SMOKE_TEST) {
      console.log('SMOKE OK');
      app.quit();
    }
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  // Keep running when all windows are "closed" (hidden) — that's the point.
  app.on('window-all-closed', () => {});
}
