// Extract salary from the descriptions of listings already in the table.
//
//   node backfill-salary.js --dry-run   # report what it would write
//   node backfill-salary.js             # write rows that have no salary yet
//   node backfill-salary.js --all       # re-parse every row, overwriting
//
// Scope worth knowing before you run it: this can only read what's stored,
// and what's stored is the description. Rows that came from Adzuna carry no
// description-level salary for the most part — Adzuna returns pay as a
// structured field, which the scraper only started keeping now. So the
// backfill reaches the Greenhouse/Lever-style postings that write pay into
// the text, and everything else picks up a salary the next time it's found.

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { parseSalaryText, formatSalary, annualize } = require('../shared/salary');

for (const file of ['.env', '../.env']) {
  const p = path.join(__dirname, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in scraper/.env');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const ALL = process.argv.includes('--all');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchAll() {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('job_listings')
      .select('id, role, company, description, salary_min')
      .order('found_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      if (/salary|PGRST204|does not exist/i.test(error.message)) {
        throw new Error('No salary columns — run supabase/migration-9-salary.sql first.');
      }
      throw new Error(error.message);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  const rows = await fetchAll();
  const candidates = rows.filter((r) => r.description && (ALL || r.salary_min == null));
  console.log(
    `${rows.length} listings; ${candidates.length} to examine` +
      (ALL ? ' (--all: re-parsing everything).' : ' (no salary yet).')
  );

  const found = [];
  for (const r of candidates) {
    const salary = parseSalaryText(r.description);
    if (salary) found.push({ ...r, salary });
  }
  console.log(`${found.length} have a salary written into the description.\n`);

  const byPeriod = { year: 0, hour: 0 };
  for (const f of found) byPeriod[f.salary.period]++;
  console.log(`By period: ${byPeriod.year} annual, ${byPeriod.hour} hourly.`);

  const ranked = [...found].sort((a, b) => annualize(a.salary).min - annualize(b.salary).min);
  console.log('\nLowest:');
  for (const f of ranked.slice(0, 5)) {
    console.log(`  ${formatSalary(f.salary).padEnd(15)} ${f.role} — ${f.company}`);
  }
  console.log('Highest:');
  for (const f of ranked.slice(-5)) {
    console.log(`  ${formatSalary(f.salary).padEnd(15)} ${f.role} — ${f.company}`);
  }

  if (DRY_RUN) {
    console.log('\nDry run — nothing written.');
    return;
  }

  let written = 0;
  for (const f of found) {
    const { error } = await supabase
      .from('job_listings')
      .update({
        salary_min: f.salary.min,
        salary_max: f.salary.max,
        salary_period: f.salary.period,
        salary_source: f.salary.source,
      })
      .eq('id', f.id);
    if (error) {
      console.warn(`  failed ${f.id}: ${error.message}`);
      continue;
    }
    written++;
    if (written % 100 === 0) console.log(`  ${written}/${found.length}…`);
  }
  console.log(`\nWrote salary to ${written} listings.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
