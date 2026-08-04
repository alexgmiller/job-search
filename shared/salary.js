// Salary extraction, shared by the scraper, the backfill script and the app.
//
// Two very different inputs produce one shape:
//
//   * Structured fields from a source that returns them (Adzuna, USAJobs).
//     Adzuna returns a figure for *every* job, but most are its own model's
//     guess (salary_is_predicted), which arrives as a single point estimate
//     rather than a range. Passing that off as the posted salary would be
//     inventing a number the employer never stated, so the estimate is kept
//     but flagged, and the UI shows it differently.
//
//   * Free text in the description, which is all Greenhouse/Lever give. Only
//     about 9% of postings state a number at all, and the ones that do sit in
//     text full of decoys — "$124 trillion of assets", "$5.8B valuation",
//     "401(k) match up to $5,000". Precision matters more than recall here: a
//     wrong salary is worse than a blank one, because a blank is obviously
//     unknown and a wrong number silently distorts filtering.
//
// Output: { min, max, period: 'year'|'hour', source: 'posted'|'estimated' }
// with min/max in whole units of that period, or null when nothing is found.

// Plausible bands. Anything outside is a decoy, not a wage.
const BOUNDS = {
  hour: { lo: 7, hi: 400 },
  year: { lo: 12000, hi: 900000 },
};

// A number this close to a salary needs company nearby to be believed.
const CONTEXT = /(salary|salaries|pay|paid|compensation|comp\b|wage|rate|stipend|earn|base|range|per hour|hourly|per year|annually|annualized salary|\/hr|\/yr)/i;

// Words that mark a figure as company scale, not personal income.
const MAGNITUDE = /\b(trillion|billion|million|valuation|funding|raised|revenue|arr\b|bookings|assets under|market cap)\b/i;

// Descriptions arrive as HTML-derived text, and the entity that matters most
// is &mdash; — it's how most Greenhouse postings separate the two halves of a
// pay range, so leaving it encoded loses the upper bound of nearly every
// range in the corpus.
function decode(text) {
  return String(text ?? '')
    .replace(/&nbsp;?/gi, ' ')
    .replace(/&(mdash|ndash|horbar);?/gi, '-')
    .replace(/&#(8212|8211|8210|8722);?/g, '-')
    .replace(/&#8203;/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/[–—−‐‑‒]/g, '-')
    .replace(/\s+/g, ' ');
}

// "206 ,000" and "165, 000" both appear in real postings.
function toNumber(digits, suffix) {
  let n = Number(digits.replace(/[,\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  if (/^k$/i.test(suffix)) n *= 1000;
  return n;
}

// Money tokens: $ then digits, with optional thousands separators, decimals
// and a k suffix. M/B are captured too, purely so they can be rejected.
const MONEY = /\$\s?(\d[\d,\s]*(?:\.\d+)?)\s*([kKmMbB])?/g;

// A full range in one match. Real postings write the upper bound every which
// way — "$40 - $50", "$195,000 - 255,000", "$26.19/hr to $32.30/hr",
// "$41.73 USD to $61.35 USD", "$60k-80k" — and only the *first* value
// reliably carries a "$", so the second must be allowed without one.
const NUM = String.raw`\d[\d,\s]*(?:\.\d+)?`;
const UNIT = String.raw`(?:\s*(?:USD|usd))?(?:\s*\/?\s*(?:per\s+)?(?:hr|hour|hourly|yr|year|annum))?(?:\s*(?:USD|usd))?`;
const RANGE = new RegExp(
  String.raw`\$\s?(${NUM})\s*([kK])?${UNIT}\s*(?:-|to\b|through\b)\s*\$?\s?(${NUM})\s*([kK])?${UNIT}`,
  'gi'
);

function periodNear(text, at, value) {
  const window = text.slice(Math.max(0, at - 70), at + 70);
  if (/(per hour|hourly|an hour|\/\s?hr|\/\s?hour|hr\.|\bhour\b)/i.test(window)) return 'hour';
  if (/(per year|per annum|annually|annual|\/\s?yr|\/\s?year|\byear\b|yearly)/i.test(window)) return 'year';
  // No explicit period: magnitude is unambiguous at these scales.
  if (value >= BOUNDS.year.lo) return 'year';
  if (value <= BOUNDS.hour.hi) return 'hour';
  return null;
}

const inBounds = (n, period) => n >= BOUNDS[period].lo && n <= BOUNDS[period].hi;

/**
 * Pull a salary out of free text. Returns null unless a figure is both
 * plausible and stated in a salary context.
 */
function parseSalaryText(raw) {
  const text = decode(raw);
  if (!text || !/\$\s?\d/.test(text)) return null;

  // Ranges first. Two plausible figures joined by a separator, with a "$" on
  // the first, is strong enough evidence on its own that the salary keyword
  // is allowed to sit further away than a lone number would need it to.
  for (const m of text.matchAll(RANGE)) {
    const lo = toNumber(m[1], m[2] ?? '');
    let hi = toNumber(m[3], m[4] ?? '');
    if (lo == null || hi == null) continue;
    // "$60k-80k": a bare upper bound inherits the k of the lower one.
    if (m[2] && !m[4] && hi < lo) hi *= 1000;
    if (hi < lo) continue;

    const around = text.slice(Math.max(0, m.index - 180), m.index + m[0].length + 60);
    if (MAGNITUDE.test(around) || !CONTEXT.test(around)) continue;

    const period = periodNear(text, m.index, lo);
    if (!period || !inBounds(lo, period) || !inBounds(hi, period)) continue;
    return { min: lo, max: hi, period, source: 'posted' };
  }

  const hits = [];
  for (const m of text.matchAll(MONEY)) {
    const at = m.index;
    const suffix = m[2] ?? '';
    // M/B suffixes are company-scale by construction.
    if (/^[mMbB]$/.test(suffix)) continue;
    const value = toNumber(m[1], suffix);
    if (value == null) continue;

    const around = text.slice(Math.max(0, at - 90), at + 90);
    if (MAGNITUDE.test(around)) continue;

    const period = periodNear(text, at, value);
    if (!period || !inBounds(value, period)) continue;
    // A bare number in a salary band still needs to be *about* pay. The
    // period suffix ("/hr", "per year") counts as its own context.
    if (!CONTEXT.test(around)) continue;

    hits.push({ value, period, at, end: at + m[0].length });
  }
  if (!hits.length) return null;

  // Pair adjacent hits into a range when they're joined by a separator and
  // share a period: "$40 - $50 / per hour", "$196,000 to $220,000".
  for (let i = 0; i + 1 < hits.length; i++) {
    const a = hits[i];
    const b = hits[i + 1];
    if (a.period !== b.period) continue;
    const between = text.slice(a.end, b.at);
    if (!/^\s*(-|to|through|up to|and)\s*(usd)?\s*$/i.test(between)) continue;
    if (b.value < a.value) continue;
    return { min: a.value, max: b.value, period: a.period, source: 'posted' };
  }

  // No range — a single stated figure is still a real data point.
  const first = hits[0];
  return { min: first.value, max: first.value, period: first.period, source: 'posted' };
}

/**
 * Normalise a source's own salary fields. `predicted` marks a figure the
 * source modelled rather than read off the posting.
 */
function fromFields({ min, max, period, predicted }) {
  const lo = Number(min);
  const hi = Number(max);
  const a = Number.isFinite(lo) && lo > 0 ? lo : null;
  const b = Number.isFinite(hi) && hi > 0 ? hi : null;
  if (a == null && b == null) return null;

  const value = a ?? b;
  const p = period === 'hour' || period === 'year' ? period : value < BOUNDS.year.lo ? 'hour' : 'year';
  if (!inBounds(value, p)) return null;

  return {
    min: a ?? b,
    max: b ?? a,
    period: p,
    source: predicted ? 'estimated' : 'posted',
  };
}

/**
 * Best available salary for a listing: what the source stated beats what it
 * guessed, and either beats nothing. Text is only consulted when the source
 * gave us nothing better, since a number written in the posting is the
 * employer's own and a model's guess is not.
 */
function bestSalary({ fields, text }) {
  const structured = fields ? fromFields(fields) : null;
  if (structured?.source === 'posted') return structured;
  const parsed = text ? parseSalaryText(text) : null;
  return parsed ?? structured ?? null;
}

// Annualised for comparison, so a filter can rank hourly and salaried roles
// against each other. 2080 = 40h × 52w, the usual convention.
const HOURS_PER_YEAR = 2080;
function annualize(salary) {
  if (!salary) return null;
  const mult = salary.period === 'hour' ? HOURS_PER_YEAR : 1;
  return { min: Math.round(salary.min * mult), max: Math.round(salary.max * mult) };
}

const compact = (n) =>
  n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n % 1 === 0 ? n : n.toFixed(2)}`;

/** Short display form, e.g. "$80k–$85k", "$19–$24/hr", "~$95k". */
function formatSalary(salary) {
  if (!salary) return '';
  const unit = salary.period === 'hour' ? '/hr' : '';
  const tilde = salary.source === 'estimated' ? '~' : '';
  if (salary.min === salary.max) return `${tilde}${compact(salary.min)}${unit}`;
  return `${tilde}${compact(salary.min)}–${compact(salary.max)}${unit}`;
}

// Module-specific name — see the note in locations.js on why a shared `API`
// binding breaks these files when they load as <script> tags.
const SALARY_API = {
  parseSalaryText,
  fromFields,
  bestSalary,
  annualize,
  formatSalary,
  BOUNDS,
  HOURS_PER_YEAR,
};
if (typeof module !== 'undefined' && module.exports) module.exports = SALARY_API;
if (typeof window !== 'undefined') window.JobSalary = SALARY_API;
