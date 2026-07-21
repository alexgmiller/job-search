-- Migration 5: candidate profile + AI fit scoring + job descriptions.
-- Run after migration-4.

-- Chunks of the user's background. The desktop app edits these; the
-- scraper and the resume tailor read them.
create table if not exists profile_chunks (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('experience','education','skill','project','certification','other')),
  title text not null,
  content text not null,
  created_at timestamptz not null default now()
);

alter table profile_chunks enable row level security;

create policy "anon can read profile" on profile_chunks for select to anon using (true);
create policy "anon can add profile" on profile_chunks for insert to anon with check (true);
create policy "anon can update profile" on profile_chunks for update to anon using (true) with check (true);
create policy "anon can delete profile" on profile_chunks for delete to anon using (true);

-- description: captured by the scraper, used for scoring + resume tailoring.
-- fit_score / fit_reason: written by the scraper's scoring pass.
alter table job_listings
  add column if not exists description text,
  add column if not exists fit_score int,
  add column if not exists fit_reason text;
