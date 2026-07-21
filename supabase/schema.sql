-- Shared schema for the desktop app, the scheduled backend job, and this
-- mobile app. Run once in the Supabase SQL editor.

create table if not exists job_listings (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  role text not null,
  location text,
  url text,
  found_at timestamptz not null default now(),
  seen boolean not null default false
);

-- Device push tokens written by the mobile app, read by the backend job
-- when it finds new listings. NOT needed for the desktop (Electron) app,
-- which polls Supabase itself — only create this if/when the iOS app ships.
create table if not exists push_tokens (
  token text primary key,
  platform text,
  updated_at timestamptz not null default now()
);

-- Personal single-user setup: the anon key is the only credential, so RLS
-- just scopes what the anon role can do (read/mark-seen listings, register
-- tokens). Inserting listings stays server-side (service role bypasses RLS).
alter table job_listings enable row level security;
alter table push_tokens enable row level security;

create policy "anon can read listings"
  on job_listings for select to anon using (true);

create policy "anon can mark listings seen"
  on job_listings for update to anon using (true) with check (true);

create policy "anon can register push tokens"
  on push_tokens for insert to anon with check (true);

create policy "anon can update own token row"
  on push_tokens for update to anon using (true) with check (true);

-- Upsert with onConflict requires select on the conflict target.
create policy "anon can read push tokens"
  on push_tokens for select to anon using (true);
