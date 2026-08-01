-- Migration 7: store the fit-score breakdown.
-- Run after migration-6.
--
-- The widget shows the score as three bars (skills / seniority / location)
-- plus the matched terms, rather than a bare number. Computing that in the
-- renderer would mean shipping the profile and the whole corpus to it, so
-- the scorer persists its breakdown alongside the composite instead.
--
-- Shape: { skills, seniority, location, terms[], level, years }
-- location is null when the scorer couldn't resolve the location matcher.

alter table job_listings
  add column if not exists fit_parts jsonb;
