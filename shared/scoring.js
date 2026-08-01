// Keyword fit scoring, shared by the scraper and the backfill script.
//
// A plain "share of profile terms found" score is dominated by filler words:
// "help", "office", "service" and "projects" appear in nearly every posting,
// so a generic engineering role can outscore a real help-desk role. This
// scorer weights each term by inverse document frequency over the corpus of
// listings being scored, so terms that are rare across postings — servicenow,
// sccm, powershell, "active directory" — carry most of the weight, and
// ubiquitous words carry almost none. No API, no cost.

const STOPWORDS = new Set(
  ('the and for with you your our are will this that have has can from not ' +
    'all any been being able about into over under more most other some such ' +
    'than then them they their there these those what when where which while ' +
    'who whom why how each every both few very via per etc a an of in on at ' +
    'to by is it as be we or if do does did its was were also may might must ' +
    'should would could us new job work team role company experience years ' +
    'ability strong plus bonus required requirements responsibilities skills ' +
    'including preferred qualifications benefits salary equal opportunity ' +
    'position candidate candidates applicants employer employment hire hiring ' +
    'please apply application looking join build building help helping make ' +
    'making use using used work working works across within while during ' +
    'well like just also more than other our their they them it is are was').split(' ')
);

// Unigrams plus adjacent bigrams, so multi-word skills ("active directory",
// "help desk", "service desk") are matched as single distinctive units.
function terms(text) {
  const words = [];
  for (const m of (text ?? '').toLowerCase().matchAll(/[a-z][a-z0-9+#.]{1,}/g)) {
    words.push(m[0].replace(/\.+$/, ''));
  }
  const out = new Set();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w);
    if (i + 1 < words.length) {
      const a = words[i];
      const b = words[i + 1];
      // Keep a bigram when at least one half is meaningful.
      if (a.length >= 2 && b.length >= 2 && !(STOPWORDS.has(a) && STOPWORDS.has(b))) {
        out.add(`${a} ${b}`);
      }
    }
  }
  return out;
}

function listingText(l) {
  return `${l.role ?? ''} ${l.description ?? ''}`;
}

// ---------- seniority ----------
// Keyword overlap can't tell a Staff Engineer role from an entry-level one:
// both use the same technology words. Without this, a listing requiring ten
// years of experience ranks identically to a new-grad posting.

const SENIORITY_PATTERNS = [
  ['executive', /\b(vp|vice president|chief|cto|cio|head of|director|principal|distinguished|fellow)\b/i],
  ['staff', /\b(staff|staff\+|architect|manager|lead engineer|tech lead|team lead)\b/i],
  ['senior', /\b(senior|sr\.?|iii|iv)\b/i],
  ['junior', /\b(intern|internship|new ?grad|university ?grad|entry[- ]level|associate|apprentice|trainee|junior|jr\.?|early career|student)\b/i],
];

/** Coarse level for a listing title: junior | mid | senior | staff | executive. */
function seniorityOf(title = '') {
  for (const [level, re] of SENIORITY_PATTERNS) {
    if (level !== 'junior' && re.test(title)) return level;
  }
  if (SENIORITY_PATTERNS[3][1].test(title)) return 'junior';
  return 'mid';
}

// Largest "N years" requirement stated anywhere in the posting.
function yearsRequired(text = '') {
  let max = 0;
  for (const m of text.matchAll(/(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?year/gi)) {
    const n = Number(m[1]);
    if (n > max && n <= 30) max = n;
  }
  return max;
}

// Multipliers for an early-career candidate. Change these (or pass your own
// via buildScorer's `seniorityWeights`) if you're targeting senior roles.
const EARLY_CAREER_WEIGHTS = {
  junior: 1.25,
  mid: 1.0,
  senior: 0.5,
  staff: 0.28,
  executive: 0.15,
};

function seniorityFactor(listing, weights) {
  const level = seniorityOf(listing.role ?? '');
  let factor = weights[level] ?? 1;
  // An explicit years-of-experience bar is a stronger signal than the title.
  const years = yearsRequired(listingText(listing));
  if (years >= 8) factor *= 0.4;
  else if (years >= 5) factor *= 0.6;
  else if (years >= 3) factor *= 0.85;
  return { factor, level, years };
}

/**
 * Build a scorer from the user's profile chunks and the corpus of listings
 * that will be scored. The corpus is only used to measure how common each
 * term is; nothing about it is stored.
 *
 * @param {Array<{title?:string, content?:string}>} profileChunks
 * @param {Array<{role?:string, description?:string}>} corpus
 * @returns {null | ((listing) => {score:number, reason:string})}
 */
function buildScorer(profileChunks, corpus, options = {}) {
  const weights = options.seniorityWeights ?? EARLY_CAREER_WEIGHTS;
  const profileTerms = terms(
    (profileChunks ?? []).map((c) => `${c.title ?? ''} ${c.content ?? ''}`).join(' ')
  );
  if (!profileTerms.size) return null;

  const listings = corpus ?? [];
  // Document frequency of each profile term across the corpus.
  const docs = listings.map((l) => terms(listingText(l)));
  const N = Math.max(docs.length, 1);
  const df = new Map();
  for (const t of profileTerms) df.set(t, 0);
  for (const d of docs) {
    for (const t of profileTerms) if (d.has(t)) df.set(t, df.get(t) + 1);
  }

  // idf: common-everywhere terms approach 0, rare terms score high.
  const weight = new Map();
  let total = 0;
  for (const t of profileTerms) {
    const w = Math.log((N + 1) / (df.get(t) + 1));
    weight.set(t, w);
    total += w;
  }
  if (total <= 0) return null;

  // Sources differ wildly in how much text they return — a Greenhouse post
  // carries ~6k characters while an Adzuna snippet carries a few hundred.
  // Without length normalisation the verbose source always wins, because a
  // longer document trips more profile terms regardless of actual fit. This
  // is the BM25 length-normalisation term (b=0.75), applied with tf=1 since
  // we only track term presence.
  const B = 0.75;
  const K1 = 1.2;
  const avgLen =
    docs.length > 0
      ? docs.reduce((sum, d) => sum + Math.max(d.size, 1), 0) / docs.length
      : 1;

  function rawHit(jobTerms) {
    const len = Math.max(jobTerms.size, 1);
    const norm = (K1 + 1) / (1 + K1 * (1 - B + (B * len) / avgLen));
    let hit = 0;
    const matched = [];
    for (const t of profileTerms) {
      if (jobTerms.has(t)) {
        const w = weight.get(t) * norm;
        hit += w;
        matched.push([t, weight.get(t)]);
      }
    }
    return { hit, matched };
  }

  // Absolute overlap is always a small fraction of a full profile, so a fixed
  // multiplier would pin every listing near zero. Calibrate against the
  // corpus instead: the 95th-percentile listing scores ~100, making the badge
  // a relative "how good is this compared to what's out there" signal.
  // Calibrate on seniority-adjusted hits so the adjustment doesn't just
  // squash the whole distribution downward.
  const hits = docs
    .map((d, i) => rawHit(d).hit * seniorityFactor(listings[i], weights).factor)
    .sort((a, b) => a - b);
  const p99 = hits.length ? hits[Math.min(hits.length - 1, Math.floor(hits.length * 0.99))] : 0;
  const scale = p99 > 0 ? p99 : total;

  return function score(listing) {
    const jobTerms = terms(listingText(listing));
    const { hit, matched } = rawHit(jobTerms);
    const { factor, level, years } = seniorityFactor(listing, weights);
    const value = Math.max(0, Math.min(100, Math.round(((hit * factor) / scale) * 100)));
    matched.sort((a, b) => b[1] - a[1]);
    const top = matched.slice(0, 6).map(([t]) => t);

    const notes = [];
    if (matched.length) notes.push(`Matched ${matched.length} terms: ${top.join(', ')}`);
    else notes.push('No profile terms found');
    if (factor < 1) {
      const why = [];
      if (weights[level] < 1) why.push(`${level}-level role`);
      if (years >= 3) why.push(`${years}+ yrs experience`);
      notes.push(`downweighted (${why.join(', ')})`);
    } else if (factor > 1) {
      notes.push('boosted (early-career role)');
    }
    return { score: value, reason: notes.join(' — ') };
  };
}

const API = {
  terms,
  buildScorer,
  STOPWORDS,
  seniorityOf,
  yearsRequired,
  EARLY_CAREER_WEIGHTS,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.JobScoring = API;
