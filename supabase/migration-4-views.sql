-- Migration 4: distinguish "seen" (reviewed, might apply) from "dismissed"
-- (not interested). Run after migration-3.
--
-- View semantics in the desktop app:
--   New:         seen=false, no dismissed_at, no status
--   Seen:        seen=true,  no dismissed_at, no status
--   In Progress: status set (applied/interviewing/offer/rejected)
--   Dismissed:   dismissed_at set, no status

alter table job_listings add column if not exists dismissed_at timestamptz;

-- Backfill: before this migration the ✕ button meant "dismiss", so every
-- seen row without an application was a dismissal. The Seen view starts
-- empty; restore anything you still care about from the Dismissed view.
update job_listings
  set dismissed_at = now()
  where seen and status is null and dismissed_at is null;
