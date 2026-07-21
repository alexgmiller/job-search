const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  ipcMain,
  nativeImage,
  shell,
} = require('electron');
const fs = require('fs');
const path = require('path');

const SMOKE_TEST = process.argv.includes('--smoke-test');

// Tiny .env loader — the only config is the Supabase URL/key and poll interval.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const POLL_MINUTES = Math.max(1, Number(process.env.POLL_MINUTES) || 5);

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

let win = null;
let tray = null;
let quitting = false;

// Ids already shown to the user, so background polls only notify about
// genuinely new rows. Seeded (without notifying) on the first poll.
const knownIds = new Set();
let firstPoll = true;

async function fetchUnseen() {
  if (!supabase) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_ANON_KEY — copy .env.example to .env.');
  }
  const { data, error } = await supabase
    .from('job_listings')
    .select('id, company, role, location, url, found_at, seen, search_id')
    .eq('seen', false)
    .order('found_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchApplied() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('job_listings')
    .select('id, company, role, location, url, found_at, search_id, status, applied_at, notes')
    .not('status', 'is', null)
    .order('applied_at', { ascending: false });
  // Tolerate migration-3 not having run yet: no Applied tab data.
  if (error) return [];
  return data ?? [];
}

async function fetchSearches() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('searches')
    .select('id, label')
    .eq('enabled', true)
    .order('created_at', { ascending: true });
  // Tolerate the table not existing yet (migration-2 not run): no tabs.
  if (error) return [];
  return data ?? [];
}

function notifyNew(fresh) {
  if (!Notification.isSupported()) return;
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
    const listings = await fetchUnseen();
    const fresh = listings.filter((l) => !knownIds.has(l.id));
    for (const l of listings) knownIds.add(l.id);
    if (!firstPoll && fresh.length > 0) notifyNew(fresh);
    firstPoll = false;
    win?.webContents.send('listings', listings);
    return listings;
  } catch (e) {
    win?.webContents.send('load-error', e.message);
    return null;
  }
}

function trayIcon() {
  // 16x16 solid blue square built in memory (BGRA) — avoids shipping an asset.
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = 0xd6; // B
    buf[i * 4 + 1] = 0x8a; // G
    buf[i * 4 + 2] = 0x2f; // R
    buf[i * 4 + 3] = 0xff; // A
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (!SMOKE_TEST) win.show();
  });
  // Closing the window keeps the app alive in the tray so background
  // polling and notifications continue.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    createWindow();

    tray = new Tray(trayIcon());
    tray.setToolTip('Job Search');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open', click: showWindow },
        { label: `Checking every ${POLL_MINUTES} min`, enabled: false },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ])
    );
    tray.on('click', showWindow);

    ipcMain.handle('refresh', () => poll());
    ipcMain.handle('get-searches', () => fetchSearches());
    ipcMain.handle('get-applied', () => fetchApplied());
    ipcMain.handle('add-search', async (_e, { label, keywords, locations }) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { error } = await supabase
        .from('searches')
        .insert({ label, keywords, locations });
      if (error) throw new Error(error.message);
      return fetchSearches();
    });
    ipcMain.handle('update-search', async (_e, { id, label, keywords, locations }) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { error } = await supabase
        .from('searches')
        .update({ label, keywords, locations })
        .eq('id', id);
      if (error) throw new Error(error.message);
      return fetchSearches();
    });
    ipcMain.handle('delete-search', async (_e, id) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { error } = await supabase.from('searches').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return fetchSearches();
    });
    ipcMain.handle('mark-applied', async (_e, id) => {
      if (!supabase) throw new Error('Supabase not configured');
      // Applying also marks seen so it leaves the unseen list, but the row
      // stays trackable in the Applied tab.
      const { error } = await supabase
        .from('job_listings')
        .update({ status: 'applied', applied_at: new Date().toISOString(), seen: true })
        .eq('id', id);
      if (error) throw new Error(error.message);
    });
    ipcMain.handle('set-status', async (_e, { id, status }) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { error } = await supabase
        .from('job_listings')
        .update({ status })
        .eq('id', id);
      if (error) throw new Error(error.message);
    });
    ipcMain.handle('set-notes', async (_e, { id, notes }) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { error } = await supabase
        .from('job_listings')
        .update({ notes: notes || null })
        .eq('id', id);
      if (error) throw new Error(error.message);
    });
    ipcMain.handle('mark-seen', async (_e, id) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { error } = await supabase
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
    setInterval(poll, POLL_MINUTES * 60 * 1000);

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
