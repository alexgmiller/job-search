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
      // Both halves must be meaningful. Allowing one stopword half produced
      // noise like "java and" / "aimed at", which scored *and* surfaced as
      // "matched terms" in the UI; real skills ("active directory", "help
      // desk", "service desk") have two content words.
      if (a.length >= 3 && b.length >= 3 && !STOPWORDS.has(a) && !STOPWORDS.has(b)) {
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

// Multipliers for an early-career candidate.
const EARLY_CAREER_WEIGHTS = {
  junior: 1.25,
  mid: 1.0,
  senior: 0.5,
  staff: 0.28,
  executive: 0.15,
};

// Who you're aiming at. The multipliers say which titles get boosted or
// discounted; yearsTolerance says how many years of required experience is
// unremarkable for that target, past which the posting is discounted further.
// `entry` reproduces the original hardcoded behaviour exactly, so leaving the
// setting alone changes nothing.
const TARGET_PRESETS = {
  entry: {
    label: 'Entry-level',
    hint: 'Interns, associates and junior roles rank highest.',
    weights: EARLY_CAREER_WEIGHTS,
    yearsTolerance: 2,
  },
  mid: {
    label: 'Mid-level',
    hint: 'Plain “Engineer” / “Analyst” titles rank highest; interns drop.',
    weights: { junior: 0.85, mid: 1.25, senior: 0.95, staff: 0.5, executive: 0.25 },
    yearsTolerance: 5,
  },
  senior: {
    label: 'Senior',
    hint: 'Senior, lead and staff titles rank highest; junior roles drop.',
    weights: { junior: 0.3, mid: 0.85, senior: 1.25, staff: 1.1, executive: 0.55 },
    yearsTolerance: 9,
  },
  any: {
    label: 'No preference',
    hint: 'Rank on skills overlap alone — title and years are ignored.',
    weights: { junior: 1, mid: 1, senior: 1, staff: 1, executive: 1 },
    yearsTolerance: 99,
  },
};

const DEFAULT_PREFS = { target: 'entry', locationWeight: 0 };

// An explicit years-of-experience bar is a stronger signal than the title,
// but "8+ years" only disqualifies you relative to what you're aiming at.
// With the entry tolerance of 2 these thresholds land on 3/5/8 years, which
// is what the scorer used before the target became configurable.
function yearsFactor(years, tolerance) {
  const over = (years ?? 0) - tolerance;
  if (over >= 6) return 0.4;
  if (over >= 3) return 0.6;
  if (over >= 1) return 0.85;
  return 1;
}

/** Normalise a loose prefs object into the numbers the scorer needs. */
function resolvePrefs(prefs) {
  const p = prefs ?? {};
  const preset = TARGET_PRESETS[p.target] ?? TARGET_PRESETS[DEFAULT_PREFS.target];
  const weights = p.seniorityWeights ?? preset.weights;
  const raw = Number(p.locationWeight);
  return {
    weights,
    maxWeight: Math.max(...Object.values(weights)),
    yearsTolerance: p.yearsTolerance ?? preset.yearsTolerance,
    locationWeight: Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : DEFAULT_PREFS.locationWeight)),
  };
}

// How much a listing's location grade moves its score. At weight 0 (the
// default) location is reported but doesn't move the number at all, which is
// reasonable because the scraper already filters by region; at weight 1 a
// listing scoring 65 on location keeps only 65% of its score.
function locationMultiplier(location, locationWeight) {
  if (!locationWeight) return 1;
  const loc = typeof location === 'number' ? location : 100;
  return 1 - locationWeight + locationWeight * (loc / 100);
}

const clamp100 = (n) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Re-derive a listing's score from the breakdown already stored on it, under
 * a different set of preferences. Term overlap (`parts.skills`) doesn't
 * depend on who you're targeting — only the multipliers applied to it do — so
 * the app can re-rank everything it has loaded without re-reading a single
 * job description.
 *
 * @returns {null | {score:number, seniority:number}} null when the listing
 *   predates the stored breakdown and there's nothing to recompute from.
 */
function rescoreFromParts(parts, prefs) {
  if (!parts || typeof parts !== 'object' || typeof parts.skills !== 'number') return null;
  if (!parts.level) return null;
  const p = resolvePrefs(prefs);
  const factor = (p.weights[parts.level] ?? 1) * yearsFactor(parts.years, p.yearsTolerance);
  const skills = typeof parts.skillsRaw === 'number' ? parts.skillsRaw : parts.skills;
  return {
    score: clamp100(skills * factor * locationMultiplier(parts.location, p.locationWeight)),
    seniority: clamp100((factor / p.maxWeight) * 100),
  };
}

// The location matcher lives in a sibling module. Resolved lazily so this
// file still loads in a plain <script> context where require() is absent.
function resolveLocations() {
  if (typeof window !== 'undefined' && window.JobLocations) return window.JobLocations;
  if (typeof require === 'function') {
    try {
      return require('./locations');
    } catch {
      /* not available — location sub-score falls back to null */
    }
  }
  return null;
}

// Graded location fit: a hit on a specific metro beats a statewide or
// nationwide-remote hit, which beats no match at all. Returns null when
// there's nothing to compare against.
function locationScore(listing, targets) {
  if (!targets?.length) return 100;
  const L = resolveLocations();
  if (!L) return null;
  const TIER = {
    sacramento: 100,
    'bay-area': 100,
    california: 90,
    'us-remote': 80,
    us: 65,
  };
  let best = 12;
  for (const t of targets) {
    if (!L.matchesLocation(listing.location, [t])) continue;
    best = Math.max(best, TIER[t] ?? 95); // free-text targets are specific
  }
  return best;
}

function seniorityFactor(listing, prefs) {
  const level = seniorityOf(listing.role ?? '');
  const years = yearsRequired(listingText(listing));
  const factor = (prefs.weights[level] ?? 1) * yearsFactor(years, prefs.yearsTolerance);
  return { factor, level, years };
}

/**
 * Build a scorer from the user's profile chunks and the corpus of listings
 * that will be scored. The corpus is only used to measure how common each
 * term is; nothing about it is stored.
 *
 * @param {Array<{title?:string, content?:string}>} profileChunks
 * @param {Array<{role?:string, description?:string}>} corpus
 * @param {{locationTargets?:string[], target?:string, locationWeight?:number,
 *   seniorityWeights?:object}} options
 * @returns {null | ((listing) => {score:number, reason:string})}
 */
function buildScorer(profileChunks, corpus, options = {}) {
  const prefs = resolvePrefs(options);
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
    .map((d, i) => {
      const l = listings[i];
      return (
        rawHit(d).hit *
        seniorityFactor(l, prefs).factor *
        locationMultiplier(locationScore(l, options.locationTargets), prefs.locationWeight)
      );
    })
    .sort((a, b) => a - b);
  const p99 = hits.length ? hits[Math.min(hits.length - 1, Math.floor(hits.length * 0.99))] : 0;
  const scale = p99 > 0 ? p99 : total;

  return function score(listing) {
    const jobTerms = terms(listingText(listing));
    const { hit, matched } = rawHit(jobTerms);
    const { factor, level, years } = seniorityFactor(listing, prefs);
    const location = locationScore(listing, options.locationTargets);
    const locMul = locationMultiplier(location, prefs.locationWeight);
    const value = clamp100(((hit * factor * locMul) / scale) * 100);
    matched.sort((a, b) => b[1] - a[1]);
    const top = matched.slice(0, 6).map(([t]) => t);

    const notes = [];
    if (matched.length) notes.push(`Matched ${matched.length} terms: ${top.join(', ')}`);
    else notes.push('No profile terms found');
    if (factor < 1) {
      const why = [];
      if (prefs.weights[level] < 1) why.push(`${level}-level role`);
      if (years > prefs.yearsTolerance) why.push(`${years}+ yrs experience`);
      notes.push(`downweighted (${why.join(', ')})`);
    } else if (factor > 1) {
      notes.push(`boosted (${level}-level role)`);
    }

    // The composite alone doesn't say *why* a listing ranks where it does.
    // These three are what the UI breaks the score into. `level` and `years`
    // ride along so the app can re-derive the composite under a different
    // target without re-reading the description — see rescoreFromParts.
    const parts = {
      // Term overlap before the seniority multiplier is applied.
      skills: clamp100((hit / scale) * 100),
      // The same number uncapped, purely so rescoreFromParts stays exact for
      // the handful of listings that overshoot the calibration ceiling —
      // capping first and multiplying later would lose their headroom.
      skillsRaw: Math.round((hit / scale) * 1000) / 10,
      // Seniority suitability: the multiplier as a share of the best case.
      seniority: clamp100((factor / prefs.maxWeight) * 100),
      location,
      terms: top,
      level,
      years,
    };

    return { score: value, reason: notes.join(' — '), parts };
  };
}

// Module-specific name — see the note in locations.js on why a shared `API`
// binding breaks these files when they load as <script> tags.
const SCORING_API = {
  terms,
  buildScorer,
  STOPWORDS,
  seniorityOf,
  yearsRequired,
  yearsFactor,
  locationScore,
  locationMultiplier,
  rescoreFromParts,
  resolvePrefs,
  TARGET_PRESETS,
  DEFAULT_PREFS,
  EARLY_CAREER_WEIGHTS,
};
if (typeof module !== 'undefined' && module.exports) module.exports = SCORING_API;
if (typeof window !== 'undefined') window.JobScoring = SCORING_API;
