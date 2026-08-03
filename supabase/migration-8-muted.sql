-- Migration 8: company mute list.
-- Run after migration-7.
--
-- Companies the user never wants to see again (staffing agencies, employers
-- they've ruled out). The desktop app adds/removes rows; the scraper drops
-- their listings before matching, so they never reach job_listings at all.

create table if not exists muted_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table muted_companies enable row level security;

create policy "anon can read muted" on muted_companies for select to anon using (true);
create policy "anon can add muted" on muted_companies for insert to anon with check (true);
create policy "anon can delete muted" on muted_companies for delete to anon using (true);
