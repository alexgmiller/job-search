-- Migration 6: structured fields on profile entries.
-- Run after migration-5.
--
-- `fields` holds the per-kind structured data the editor collects (job
-- title, company, dates, bullets, …). `title` and `content` remain the
-- flattened text derived from those fields, so fit scoring and resume
-- tailoring keep reading a single consistent text blob and need no changes.
-- Entries created before this migration simply have an empty `fields` and
-- still work; the editor backfills them from title/content on first edit.

alter table profile_chunks
  add column if not exists fields jsonb not null default '{}'::jsonb;
