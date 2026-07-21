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

// JSearch aggregates Indeed/LinkedIn/Glassdoor. One request per search per
// location keeps well inside the free tier at a few runs per day.
async function fetchJSearch(search) {
  const locations = search.locations.length ? search.locations : [''];
  const results = [];
  for (const loc of locations) {
    const query = [search.keywords[0] ?? search.label, loc].filter(Boolean).join(' in ');
    const url =
      'https://jsearch.p.rapidapi.com/search?query=' +
      encodeURIComponent(query) +
      '&num_pages=1&date_posted=3days';
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

// ---------- matching ----------

function matchesSearch(listing, search) {
  const title = listing.role.toLowerCase();
  if (!search.keywords.some((k) => title.includes(k.toLowerCase()))) return false;

  if (search.locations.length === 0) return true;
  const loc = (listing.location ?? '').toLowerCase();
  return search.locations.some((l) => {
    const want = l.toLowerCase();
    if (want === 'remote') return loc.includes('remote');
    return loc.includes(want);
  });
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

  if (RAPIDAPI_KEY) {
    for (const s of searches) {
      try {
        const jobs = await fetchJSearch(s);
        console.log(`JSearch "${s.label}": ${jobs.length} results`);
        listings.push(...jobs);
      } catch (e) {
        console.warn(`skipping JSearch "${s.label}": ${e.message}`);
      }
    }
  } else {
    console.log('RAPIDAPI_KEY not set — skipping Indeed/LinkedIn (JSearch).');
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

// ---------- AI fit scoring (only the newly inserted listings) ----------

const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', description: 'Fit score from 0 to 100' },
    reason: { type: 'string', description: 'One sentence explaining the score' },
  },
  required: ['score', 'reason'],
  additionalProperties: false,
};

const MAX_SCORED_PER_RUN = 25;

async function scoreListings(listings) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY not set — skipping fit scoring.');
    return;
  }
  const { data: chunks, error } = await supabase
    .from('profile_chunks')
    .select('kind, title, content');
  if (error || !chunks?.length) {
    console.log('No profile chunks found — skipping fit scoring.');
    return;
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic();

  const profile = chunks
    .map((c) => `[${c.kind}] ${c.title}\n${c.content}`)
    .join('\n\n');

  const toScore = listings.slice(0, MAX_SCORED_PER_RUN);
  if (listings.length > toScore.length) {
    console.log(`Scoring capped at ${MAX_SCORED_PER_RUN}; ${listings.length - toScore.length} left unscored this run.`);
  }

  let scored = 0;
  for (const l of toScore) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 1024,
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: SCORE_SCHEMA },
        },
        system:
          'You score how well a job listing fits a candidate, as a number from 0 (no fit) to 100 (ideal fit). ' +
          'Consider required skills vs the candidate profile, seniority level, and role type. ' +
          'Be honest: a role requiring 8 years of experience scores low for an early-career candidate.',
        messages: [
          {
            role: 'user',
            content:
              `CANDIDATE PROFILE:\n${profile}\n\n` +
              `JOB LISTING:\n${l.role} at ${l.company}` +
              (l.location ? ` (${l.location})` : '') +
              (l.description ? `\n\n${l.description}` : '\n\n(no description available — score from the title alone)'),
          },
        ],
      });
      const text = response.content.find((b) => b.type === 'text')?.text;
      const { score, reason } = JSON.parse(text);
      const { error: uErr } = await supabase
        .from('job_listings')
        .update({ fit_score: score, fit_reason: reason })
        .eq('id', l.id);
      if (uErr) throw new Error(uErr.message);
      scored++;
    } catch (e) {
      console.warn(`scoring "${l.role} at ${l.company}" failed: ${e.message}`);
    }
  }
  console.log(`${scored}/${toScore.length} new listings fit-scored.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
