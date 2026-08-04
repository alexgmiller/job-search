-- Migration 9: store what a listing pays.
-- Run after migration-8.
--
-- Salary reaches us two ways and the difference matters to the reader:
--
--   * The employer stated it — either in a structured field the source
--     returns, or written into the description text.
--   * The source guessed it. Adzuna returns a figure for every job it has,
--     but most are its own model's estimate (salary_is_predicted), which
--     arrives as a single point rather than a range. Showing that as the
--     posted salary would present an invented number as fact, so it is
--     stored with salary_source = 'estimated' and displayed differently.
--
-- salary_min / salary_max are in whole units of salary_period, so an hourly
-- role stores 24.50 rather than 50960. Comparing across the two is the app's
-- job (2080 hours a year); storing a converted figure would lose which one
-- the employer actually quoted.

alter table job_listings
  add column if not exists salary_min numeric,
  add column if not exists salary_max numeric,
  add column if not exists salary_period text,   -- 'year' | 'hour'
  add column if not exists salary_source text;   -- 'posted' | 'estimated'

-- The list filters on "pays at least X", which needs the annualised low end
-- of rows that have one at all.
create index if not exists job_listings_salary_min_idx
  on job_listings (salary_min)
  where salary_min is not null;
