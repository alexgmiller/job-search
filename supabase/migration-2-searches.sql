-- Migration 2: role tabs + scraper support.
-- Run in the Supabase SQL editor (schema.sql must have been run first).

-- One row per role tab. The desktop app reads these for its tab bar and
-- can add new ones; the scraper reads them to know what to search for.
create table if not exists searches (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  keywords text[] not null default '{}',   -- title must contain one of these
  locations text[] not null default '{}',  -- empty = anywhere; 'remote' matches remote
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table searches enable row level security;

create policy "anon can read searches"
  on searches for select to anon using (true);

-- The desktop app adds new role tabs with the anon key.
create policy "anon can add searches"
  on searches for insert to anon with check (true);

create policy "anon can update searches"
  on searches for update to anon using (true) with check (true);

-- Which role tab a listing belongs to.
alter table job_listings add column if not exists search_id uuid references searches(id);

-- Dedupe: the scraper upserts on url, so re-running it never creates
-- duplicates. (Unique index ignores NULL urls, e.g. hand-added test rows.)
create unique index if not exists job_listings_url_key on job_listings (url);

-- Starter tabs — edit keywords/locations in the Table Editor or the app.
insert into searches (label, keywords, locations) values
  ('IT Support',  array['it support','help desk','service desk','desktop support','it technician','support specialist'], array[]::text[]),
  ('Software Eng', array['software engineer','software developer','frontend','backend','full stack','web developer'], array[]::text[]),
  ('Intern / New Grad', array['intern','internship','new grad','university grad','early career'], array[]::text[]);
