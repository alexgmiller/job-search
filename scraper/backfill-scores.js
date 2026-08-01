// One-off: fit-score existing listings that were inserted before scoring
// existed (fit_score IS NULL). Uses the same free keyword-overlap scorer as
// the scraper, so results are consistent with newly-found listings.
//
// Usage:
//   node backfill-scores.js --dry-run   preview scores, write nothing
//   node backfill-scores.js             write fit_score / fit_reason
//   node backfill-scores.js --all       re-score every listing, not just unscored
//
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in scraper/.env (writes
// bypass RLS). Safe to re-run: it only touches fit_score / fit_reason.

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const RESCORE_ALL = process.argv.includes('--all');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in scraper/.env');
  process.exit(1);
}
if (SUPABASE_SERVICE_ROLE_KEY === 'your-secret-key') {
  console.error(
    'SUPABASE_SERVICE_ROLE_KEY is still the placeholder — paste your Supabase\n' +
      'Secret key into scraper/.env (Settings -> API keys -> Secret).'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { buildScorer } = require('../shared/scoring');

// Supabase caps a single select; page through so large tables are covered.
async function fetchAllListings({ unscoredOnly }) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('job_listings')
      .select('id, company, role, description, fit_score')
      .order('found_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (unscoredOnly) q = q.is('fit_score', null);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  const { data: chunks, error: cErr } = await supabase
    .from('profile_chunks')
    .select('kind, title, content');
  if (cErr) throw new Error(`loading profile: ${cErr.message}`);
  if (!chunks?.length) {
    throw new Error(
      'Your profile is empty — nothing to score against.\n' +
        'Open the app, click Profile, and add chunks (or Import resume…) first.'
    );
  }

  console.log(`Profile: ${chunks.length} chunks.`);

  // Rarity weighting needs the whole table as its corpus, even when only the
  // unscored subset is being written.
  const corpus = await fetchAllListings({ unscoredOnly: false });
  const listings = RESCORE_ALL ? corpus : corpus.filter((l) => l.fit_score === null);
  console.log(
    `Corpus: ${corpus.length} listings. ${listings.length} to score` +
      (RESCORE_ALL ? ' (--all: re-scoring everything).' : ' (unscored only).')
  );
  if (!listings.length) return;

  const { data: searchRows } = await supabase.from('searches').select('locations');
  const locationTargets = [
    ...new Set((searchRows ?? []).flatMap((s) => s.locations ?? [])),
  ];

  const scorer = buildScorer(chunks, corpus, { locationTargets });
  if (!scorer) throw new Error('Profile has no usable terms to score with.');
  const scored = listings.map((l) => ({ ...l, ...scorer(l) }));

  const withDesc = scored.filter((s) => s.description).length;
  console.log(
    `${withDesc}/${scored.length} have a stored description; the rest are ` +
      'scored on title alone (they predate description capture).'
  );

  const top = [...scored].sort((a, b) => b.score - a.score);
  console.log('\nHighest scoring:');
  for (const s of top.slice(0, 10)) {
    console.log(`  ${String(s.score).padStart(3)}  ${s.role} — ${s.company}`);
  }
  const buckets = { '75+': 0, '50-74': 0, '25-49': 0, '0-24': 0 };
  for (const s of scored) {
    if (s.score >= 75) buckets['75+']++;
    else if (s.score >= 50) buckets['50-74']++;
    else if (s.score >= 25) buckets['25-49']++;
    else buckets['0-24']++;
  }
  console.log('\nDistribution:', JSON.stringify(buckets));

  if (DRY_RUN) {
    console.log('\nDry run — nothing written.');
    return;
  }

  let written = 0;
  let partsUnsupported = false;
  for (const s of scored) {
    const patch = { fit_score: s.score, fit_reason: s.reason };
    if (!partsUnsupported) patch.fit_parts = s.parts;
    let { error } = await supabase.from('job_listings').update(patch).eq('id', s.id);
    if (error && /fit_parts|PGRST204/i.test(error.message ?? '')) {
      partsUnsupported = true;
      console.warn('  fit_parts column missing — run migration-7; writing scores only.');
      ({ error } = await supabase
        .from('job_listings')
        .update({ fit_score: s.score, fit_reason: s.reason })
        .eq('id', s.id));
    }
    if (error) console.warn(`  failed ${s.role}: ${error.message}`);
    else written++;
    if (written % 100 === 0) console.log(`  …${written}/${scored.length}`);
  }
  console.log(`\n${written} listings scored.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
