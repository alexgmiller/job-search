// Finds job listings from Greenhouse/Lever boards (companies.json) and,
// when RAPIDAPI_KEY is set, JSearch (Indeed/LinkedIn/Glassdoor). Matches
// them against the `searches` table (role tabs) and inserts new rows into
// `job_listings`. Dedupe is the unique index on url — re-runs are safe.
//
// Usage:  node index.js            insert new matches
//         node index.js --dry-run  print matches, insert nothing

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');

// .env loader for local runs; GitHub Actions passes real env vars instead.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const { createClient } = require('@supabase/supabase-js');
const { matchesLocation, REGION_QUERIES } = require('../shared/locations');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const companies = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'companies.json'), 'utf8')
);

// ---------- sources: each returns [{ company, role, location, url, description }] ----------

// Greenhouse/Lever descriptions arrive as (escaped) HTML; flatten to plain
// text bounded at 6k chars — plenty for fit scoring and resume tailoring.
function htmlToText(html) {
  if (!html) return null;
  const decoded = html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  const text = decoded
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  return text.slice(0, 6000) || null;
}

async function fetchGreenhouse({ name, slug }) {
  const res = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`
  );
  if (!res.ok) throw new Error(`greenhouse/${slug}: HTTP ${res.status}`);
  const { jobs } = await res.json();
  return jobs.map((j) => ({
    company: name,
    role: j.title,
    location: j.location?.name ?? null,
    url: j.absolute_url,
    description: htmlToText(j.content),
  }));
}

async function fetchLever({ name, slug }) {
  const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  if (!res.ok) throw new Error(`lever/${slug}: HTTP ${res.status}`);
  const jobs = await res.json();
  return jobs.map((j) => ({
    company: name,
    role: j.text,
    location: j.categories?.location ?? null,
    url: j.hostedUrl,
    description: (j.descriptionPlain ?? htmlToText(j.description))?.slice(0, 6000) || null,
  }));
}

// Turn a search's region keys into concrete place strings for APIs that
// take a location parameter. Remote-only regions yield no place.
function placesFor(search, field = 'where') {
  const places = [];
  let remoteOnly = false;
  for (const l of search.locations ?? []) {
    const q = REGION_QUERIES[l];
    if (q) {
      if (q[field]) places.push(q[field]);
      if (q.remoteOnly) remoteOnly = true;
    } else {
      places.push(l); // free-text city/state
    }
  }
  return { places, remoteOnly };
}

// JSearch aggregates Indeed/LinkedIn/Glassdoor. One request per search per
// location keeps well inside the free tier at a few runs per day.
async function fetchJSearch(search) {
  const { places, remoteOnly } = placesFor(search);
  const locations = places.length ? places : [''];
  const results = [];
  for (const loc of locations) {
    const query = [search.keywords[0] ?? search.label, loc].filter(Boolean).join(' in ');
    const url =
      'https://jsearch.p.rapidapi.com/search?query=' +
      encodeURIComponent(query) +
      '&num_pages=1&date_posted=3days' +
      (remoteOnly && !loc ? '&remote_jobs_only=true' : '');
    const res = await fetch(url, {
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
      },
    });
    if (!res.ok) throw new Error(`jsearch "${query}": HTTP ${res.status}`);
    const { data } = await res.json();
    for (const j of data ?? []) {
      results.push({
        company: j.employer_name ?? 'Unknown',
        role: j.job_title,
        location: j.job_is_remote
          ? 'Remote'
          : [j.job_city, j.job_state].filter(Boolean).join(', ') || null,
        url: j.job_apply_link,
        description: j.job_description?.slice(0, 6000) || null,
      });
    }
  }
  return results;
}

// Remotive: free, no key, remote-only listings.
async function fetchRemotive(search) {
  const results = [];
  for (const kw of search.keywords.slice(0, 3)) {
    const res = await fetch(
      'https://remotive.com/api/remote-jobs?limit=50&search=' + encodeURIComponent(kw)
    );
    if (!res.ok) throw new Error(`remotive "${kw}": HTTP ${res.status}`);
    const { jobs } = await res.json();
    for (const j of jobs ?? []) {
      results.push({
        company: j.company_name ?? 'Unknown',
        role: j.title,
        // Remotive states eligibility regions, e.g. "USA", "Americas".
        location: `Remote${j.candidate_required_location ? ` - ${j.candidate_required_location}` : ''}`,
        url: j.url,
        description: htmlToText(j.description),
      });
    }
  }
  return results;
}

// USAJobs: free federal API, real location search. Heavy in IT support.
// Needs USAJOBS_API_KEY + USAJOBS_EMAIL (free at developer.usajobs.gov).
async function fetchUSAJobs(search) {
  const { places } = placesFor(search, 'usajobs');
  const locations = places.length ? places : [''];
  const results = [];
  for (const kw of search.keywords.slice(0, 3)) {
    for (const loc of locations) {
      const url =
        'https://data.usajobs.gov/api/search?ResultsPerPage=50&Keyword=' +
        encodeURIComponent(kw) +
        (loc ? '&LocationName=' + encodeURIComponent(loc) : '');
      const res = await fetch(url, {
        headers: {
          Host: 'data.usajobs.gov',
          'User-Agent': process.env.USAJOBS_EMAIL,
          'Authorization-Key': process.env.USAJOBS_API_KEY,
        },
      });
      if (!res.ok) throw new Error(`usajobs "${kw}": HTTP ${res.status}`);
      const body = await res.json();
      for (const item of body.SearchResult?.SearchResultItems ?? []) {
        const d = item.MatchedObjectDescriptor ?? {};
        results.push({
          company: d.OrganizationName ?? 'US Government',
          role: d.PositionTitle,
          location: (d.PositionLocationDisplay ?? '').slice(0, 200) || null,
          url: d.PositionURI,
          description: (d.UserArea?.Details?.JobSummary ?? d.QualificationSummary ?? '')
            .slice(0, 6000) || null,
        });
      }
    }
  }
  return results;
}

// Adzuna: free-tier aggregator with true location + radius search.
// Needs ADZUNA_APP_ID + ADZUNA_APP_KEY (free at developer.adzuna.com).
async function fetchAdzuna(search) {
  const { places } = placesFor(search);
  const locations = places.length ? places : [''];
  const results = [];
  for (const kw of search.keywords.slice(0, 3)) {
    for (const loc of locations) {
      const url =
        'https://api.adzuna.com/v1/api/jobs/us/search/1' +
        `?app_id=${encodeURIComponent(process.env.ADZUNA_APP_ID)}` +
        `&app_key=${encodeURIComponent(process.env.ADZUNA_APP_KEY)}` +
        '&results_per_page=50&max_days_old=7&content-type=application/json' +
        '&what=' + encodeURIComponent(kw) +
        (loc ? '&where=' + encodeURIComponent(loc) + '&distance=40' : '');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`adzuna "${kw}": HTTP ${res.status}`);
      const body = await res.json();
      for (const j of body.results ?? []) {
        results.push({
          company: j.company?.display_name ?? 'Unknown',
          role: j.title,
          location: j.location?.display_name ?? null,
          url: j.redirect_url,
          description: (j.description ?? '').slice(0, 6000) || null,
        });
      }
    }
  }
  return results;
}

// ---------- matching ----------

function matchesSearch(listing, search) {
  const title = listing.role.toLowerCase();
  if (!search.keywords.some((k) => title.includes(k.toLowerCase()))) return false;
  // Region-aware: understands multi-location strings, metro names, and
  // remote-but-wrong-country listings. Empty locations = anywhere.
  return matchesLocation(listing.location, search.locations);
}

// ---------- main ----------

async function main() {
  const { data: searches, error: sErr } = await supabase
    .from('searches')
    .select('id, label, keywords, locations')
    .eq('enabled', true);
  if (sErr) throw new Error(`loading searches: ${sErr.message}`);
  if (!searches?.length) {
    console.log('No enabled searches — nothing to do.');
    return;
  }

  const listings = [];
  for (const c of companies) {
    try {
      const fetcher = c.source === 'lever' ? fetchLever : fetchGreenhouse;
      const jobs = await fetcher(c);
      console.log(`${c.name}: ${jobs.length} open roles`);
      listings.push(...jobs);
    } catch (e) {
      console.warn(`skipping ${c.name}: ${e.message}`);
    }
  }

  // Per-search sources. Each is skipped (with a note) when its key is
  // missing, so the scraper degrades gracefully instead of failing.
  const perSearch = [
    { name: 'Remotive', fn: fetchRemotive, ready: true },
    {
      name: 'USAJobs',
      fn: fetchUSAJobs,
      ready: !!(process.env.USAJOBS_API_KEY && process.env.USAJOBS_EMAIL),
      missing: 'USAJOBS_API_KEY + USAJOBS_EMAIL (free at developer.usajobs.gov)',
    },
    {
      name: 'Adzuna',
      fn: fetchAdzuna,
      ready: !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
      missing: 'ADZUNA_APP_ID + ADZUNA_APP_KEY (free at developer.adzuna.com)',
    },
    {
      name: 'JSearch',
      fn: fetchJSearch,
      ready: !!RAPIDAPI_KEY,
      missing: 'RAPIDAPI_KEY (JSearch on rapidapi.com)',
    },
  ];

  for (const src of perSearch) {
    if (!src.ready) {
      console.log(`${src.name} skipped — set ${src.missing}.`);
      continue;
    }
    for (const s of searches) {
      try {
        const jobs = await src.fn(s);
        console.log(`${src.name} "${s.label}": ${jobs.length} results`);
        listings.push(...jobs);
      } catch (e) {
        console.warn(`skipping ${src.name} "${s.label}": ${e.message}`);
      }
    }
  }

  // First matching search claims the listing; url dedupe handles the rest.
  const rows = [];
  const seenUrls = new Set();
  for (const l of listings) {
    if (!l.url || seenUrls.has(l.url)) continue;
    const search = searches.find((s) => matchesSearch(l, s));
    if (!search) continue;
    seenUrls.add(l.url);
    rows.push({ ...l, search_id: search.id });
  }

  console.log(`\n${listings.length} listings fetched, ${rows.length} match a search.`);

  if (DRY_RUN) {
    for (const r of rows) {
      const label = searches.find((s) => s.id === r.search_id)?.label;
      console.log(`[${label}] ${r.role} — ${r.company} (${r.location ?? 'n/a'})`);
    }
    console.log('\nDry run — nothing inserted.');
    return;
  }

  // ignoreDuplicates: existing urls are skipped, not updated — so a listing
  // you've already marked seen never comes back.
  const { data: inserted, error } = await supabase
    .from('job_listings')
    .upsert(rows, { onConflict: 'url', ignoreDuplicates: true })
    .select('id, company, role, location, description');
  if (error) throw new Error(`insert failed: ${error.message}`);
  console.log(`${inserted?.length ?? 0} new listings inserted.`);

  if (inserted?.length) await scoreListings(inserted);
}

// ---------- keyword fit scoring (free, no API) ----------
// Score = share of the profile's distinctive terms that appear in the job
// text. Coarser than an LLM (can't judge seniority), but free and good
// enough for relative ranking; badges are best read relative to each other.

const STOPWORDS = new Set(
  ('the and for with you your our are will this that have has can from not ' +
   'all any been being able about into over under more most other some such ' +
   'than then them they their there these those what when where which while ' +
   'who whom why how each every both few very via per etc a an of in on at ' +
   'to by is it as be we or if do does did its was were also may might must ' +
   'should would could us new job work team role company experience years ' +
   'ability strong plus bonus required requirements responsibilities skills ' +
   'including preferred qualifications benefits salary equal opportunity').split(' ')
);

function terms(text) {
  const out = new Set();
  for (const m of (text ?? '').toLowerCase().matchAll(/[a-z][a-z0-9+#.]{2,}/g)) {
    const t = m[0].replace(/\.+$/, '');
    if (t.length >= 3 && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

async function scoreListings(listings) {
  const { data: chunks, error } = await supabase
    .from('profile_chunks')
    .select('kind, title, content');
  if (error || !chunks?.length) {
    console.log('No profile chunks found — skipping fit scoring.');
    return;
  }

  const profileTerms = terms(chunks.map((c) => `${c.title} ${c.content}`).join(' '));
  if (!profileTerms.size) return;

  let scored = 0;
  for (const l of listings) {
    const jobTerms = terms(`${l.role} ${l.description ?? ''}`);
    const matched = [...profileTerms].filter((t) => jobTerms.has(t));
    const score = Math.min(100, Math.round((100 * matched.length) / profileTerms.size));
    const top = matched.slice(0, 8).join(', ');
    const reason = matched.length
      ? `Keyword match: ${matched.length} profile terms found (${top})`
      : 'No profile terms found in this listing';
    const { error: uErr } = await supabase
      .from('job_listings')
      .update({ fit_score: score, fit_reason: reason })
      .eq('id', l.id);
    if (uErr) console.warn(`scoring "${l.role}" failed: ${uErr.message}`);
    else scored++;
  }
  console.log(`${scored}/${listings.length} new listings keyword-scored.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
