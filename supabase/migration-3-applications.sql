-- Migration 3: application tracking, notes, and tab management.
-- Run in the Supabase SQL editor (after schema.sql and migration-2).

-- status is NULL until you apply; seen stays an independent flag so
-- dismissing and applying remain distinct actions.
alter table job_listings
  add column if not exists status text
    check (status in ('applied','interviewing','offer','rejected')),
  add column if not exists applied_at timestamptz,
  add column if not exists notes text;

-- Deleting a role tab keeps its listings (they fall back to the All tab).
alter table job_listings drop constraint if exists job_listings_search_id_fkey;
alter table job_listings
  add constraint job_listings_search_id_fkey
  foreign key (search_id) references searches (id) on delete set null;

-- The desktop app can now delete tabs. (Updates were already allowed.)
create policy "anon can delete searches"
  on searches for delete to anon using (true);
