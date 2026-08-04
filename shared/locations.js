// Location parsing + matching, shared by the scraper and the desktop app.
//
// Job-board location strings are messy and inconsistent:
//   "San Francisco, CA • New York, NY • United States"
//   "Remote - United States"          (remote, US)
//   "Remote, United Kingdom"          (remote, NOT US)
//   "San Francisco Bay Area or Los Angeles Area"
//   "Menlo Park, CA; New York, NY"
//   "US", "Seattle", "N/A"
//
// A substring test can't tell "Remote - United States" from
// "Remote - Ontario, Canada", so we parse each string into parts and match
// parts against named regions.

const SEPARATORS = /\s*(?:[;•|]|\bor\b|\band\b|\/)\s*/i;

const REMOTE_RE =
  /\b(remote|work from home|wfh|anywhere|distributed|virtual|telecommute)\b/i;

// Countries we recognise; anything matching a non-US entry is excluded from
// US-scoped regions even when the listing says "remote".
const COUNTRIES = {
  us: ['united states', 'usa', 'u.s.', 'u.s.a.', 'us', 'america', 'remote us', 'us remote'],
  ca: ['canada', 'can', 'ontario', 'quebec', 'british columbia'],
  uk: ['united kingdom', 'uk', 'england', 'scotland', 'wales', 'great britain'],
  ie: ['ireland'],
  in: ['india'],
  sg: ['singapore'],
  cn: ['china'],
  jp: ['japan'],
  au: ['australia'],
  de: ['germany'],
  fr: ['france'],
  nl: ['netherlands'],
  pl: ['poland'],
  si: ['slovenia'],
  es: ['spain'],
  br: ['brazil'],
  mx: ['mexico'],
  il: ['israel'],
  kr: ['south korea'],
  ph: ['philippines'],
  pt: ['portugal'],
  se: ['sweden'],
  ch: ['switzerland'],
  ar: ['argentina'],
  co: ['colombia'],
  za: ['south africa'],
  ae: ['united arab emirates', 'uae'],
  nz: ['new zealand'],
  it: ['italy'],
};

// Well-known non-US cities that appear without a country.
const FOREIGN_CITIES = new Set([
  'toronto', 'vancouver', 'montreal', 'ottawa', 'waterloo', 'calgary',
  'london', 'dublin', 'bangalore', 'bengaluru', 'hyderabad', 'mumbai',
  'delhi', 'pune', 'chennai', 'gurgaon', 'noida', 'singapore', 'beijing',
  'shanghai', 'shenzhen', 'hong kong', 'tokyo', 'seoul', 'sydney',
  'melbourne', 'berlin', 'munich', 'paris', 'amsterdam', 'warsaw',
  'krakow', 'ljubljana', 'madrid', 'barcelona', 'lisbon', 'stockholm',
  'zurich', 'tel aviv', 'sao paulo', 'mexico city', 'buenos aires',
  'bogota', 'cape town', 'dubai', 'auckland', 'milan', 'rome', 'manila',
  'taipei', 'edinburgh', 'manchester', 'belfast', 'cork', 'oslo',
  'copenhagen', 'helsinki', 'prague', 'budapest', 'bucharest', 'sofia',
  'vilnius', 'tallinn', 'riga', 'athens', 'istanbul', 'cairo', 'nairobi',
  'lagos', 'accra',
]);

const US_STATES = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california',
  co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia',
  hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa',
  ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland',
  ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi',
  mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada',
  nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york',
  nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma',
  or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina',
  sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont',
  va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin',
  wy: 'wyoming', dc: 'district of columbia',
};
const STATE_NAME_TO_ABBR = Object.fromEntries(
  Object.entries(US_STATES).map(([a, n]) => [n, a])
);

const SACRAMENTO_CITIES = new Set([
  'sacramento', 'west sacramento', 'roseville', 'folsom', 'rancho cordova',
  'elk grove', 'citrus heights', 'rocklin', 'lincoln', 'davis', 'woodland',
  'carmichael', 'fair oaks', 'orangevale', 'antelope', 'north highlands',
  'arden-arcade', 'natomas', 'el dorado hills', 'granite bay', 'loomis',
  'auburn', 'placerville', 'galt', 'yuba city', 'vacaville',
]);

const BAY_AREA_CITIES = new Set([
  'san francisco', 'sf', 'oakland', 'san jose', 'palo alto', 'mountain view',
  'sunnyvale', 'santa clara', 'berkeley', 'menlo park', 'redwood city',
  'south san francisco', 'san mateo', 'foster city', 'cupertino',
  'burlingame', 'emeryville', 'alameda', 'fremont', 'hayward', 'milpitas',
  'campbell', 'los gatos', 'san carlos', 'belmont', 'daly city',
  'walnut creek', 'concord', 'richmond', 'san rafael', 'novato',
  'pleasanton', 'dublin ca', 'livermore', 'san bruno', 'brisbane',
  'santa cruz', 'sausalito', 'marin', 'napa', 'petaluma', 'santa rosa',
  'vallejo', 'fairfield',
]);

const OTHER_CA_CITIES = new Set([
  'los angeles', 'la', 'san diego', 'irvine', 'santa monica', 'pasadena',
  'long beach', 'anaheim', 'burbank', 'culver city', 'el segundo',
  'costa mesa', 'newport beach', 'carlsbad', 'san luis obispo', 'fresno',
  'bakersfield', 'stockton', 'modesto', 'riverside', 'san bernardino',
  'ontario ca', 'torrance', 'glendale', 'santa barbara', 'ventura',
  'thousand oaks', 'chico', 'redding', 'salinas', 'monterey', 'oxnard',
  'palm springs', 'temecula', 'santa ana', 'huntington beach',
]);

// Metro phrases that appear instead of a city name.
const METRO_PHRASES = [
  [/\b(bay area|silicon valley|sf bay)\b/i, 'bay-area'],
  [/\bsacramento\b/i, 'sacramento'],
  [/\b(los angeles area|la area|greater los angeles|socal|southern california)\b/i, 'ca-other'],
  [/\b(northern california|norcal)\b/i, 'ca-other'],
];

function normalize(s) {
  return (s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[().]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split a raw location string into parsed parts.
 * Each part: { raw, remote, city, state, country }
 *   state   — two-letter US abbreviation, or null
 *   country — two-letter code ('us', 'uk', …), or null when unstated
 */
function parseLocation(raw) {
  const text = normalize(raw);
  if (!text || text === 'n/a' || text === 'na' || text === 'multiple locations') {
    return [];
  }

  return text
    .split(SEPARATORS)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const remote = REMOTE_RE.test(part);
      // Drop remote words and leftover dashes so the geography is left.
      let rest = part
        .replace(REMOTE_RE, ' ')
        .replace(/[-–—]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      let country = null;
      let state = null;

      const tokens = rest.split(',').map((t) => t.trim()).filter(Boolean);

      // Country can be any token (usually the last).
      for (let i = tokens.length - 1; i >= 0; i--) {
        const hit = Object.entries(COUNTRIES).find(([, names]) =>
          names.includes(tokens[i])
        );
        if (hit) {
          country = hit[0];
          tokens.splice(i, 1);
          break;
        }
      }

      // State: abbreviation or full name.
      for (let i = tokens.length - 1; i >= 0; i--) {
        const t = tokens[i];
        if (US_STATES[t]) {
          state = t;
          tokens.splice(i, 1);
          break;
        }
        if (STATE_NAME_TO_ABBR[t]) {
          state = STATE_NAME_TO_ABBR[t];
          tokens.splice(i, 1);
          break;
        }
      }

      const city = tokens.join(' ').replace(/\s+/g, ' ').trim() || null;
      if (state && !country) country = 'us';
      // A well-known foreign city implies a non-US country. Substring test
      // catches leftovers like "toronto can" after alias stripping.
      if (city && !country) {
        for (const f of FOREIGN_CITIES) {
          if (city === f || city.includes(f)) {
            country = 'foreign';
            break;
          }
        }
      }

      return { raw: part, remote, city, state, country };
    });
}

function isUS(part) {
  // Unstated country counts as US-possible; explicit foreign does not.
  return part.country === null || part.country === 'us';
}

function cityIn(part, set) {
  if (!part.city) return false;
  if (set.has(part.city)) return true;
  // "san francisco bay area" style strings carry extra words.
  return [...set].some((c) => c.length > 4 && part.city.includes(c));
}

function metroOf(part) {
  const hits = [];
  for (const [re, key] of METRO_PHRASES) {
    if (re.test(part.raw)) hits.push(key);
  }
  return hits;
}

/** Does one parsed part satisfy a named region? */
function partMatchesRegion(part, region) {
  const metros = metroOf(part);
  switch (region) {
    case 'us-remote':
      // Explicitly remote in the US, or a nationwide "US" posting with no
      // city/state — those are effectively open to any US location.
      return (
        (part.remote && isUS(part)) ||
        (part.country === 'us' && !part.city && !part.state)
      );
    case 'sacramento':
      return (
        isUS(part) &&
        (cityIn(part, SACRAMENTO_CITIES) || metros.includes('sacramento'))
      );
    case 'bay-area':
      return (
        isUS(part) &&
        (cityIn(part, BAY_AREA_CITIES) || metros.includes('bay-area'))
      );
    case 'california':
      return (
        isUS(part) &&
        (part.state === 'ca' ||
          cityIn(part, SACRAMENTO_CITIES) ||
          cityIn(part, BAY_AREA_CITIES) ||
          cityIn(part, OTHER_CA_CITIES) ||
          metros.length > 0)
      );
    case 'us':
      return isUS(part) && (part.country === 'us' || part.state !== null);
    default:
      // Any other value is treated as a plain substring (city, state, …).
      return part.raw.includes(normalize(region));
  }
}

/**
 * True when a raw location string matches any of the given targets.
 * Targets are region keys ('us-remote', 'sacramento', 'bay-area',
 * 'california', 'us') or free-text substrings. Empty targets = match all.
 */
function matchesLocation(raw, targets) {
  if (!targets?.length) return true;
  const parts = parseLocation(raw);
  if (!parts.length) return false; // unknown location can't be confirmed
  return parts.some((part) => targets.some((t) => partMatchesRegion(part, t)));
}

const REGION_LABELS = {
  'us-remote': 'Remote (US)',
  sacramento: 'Sacramento metro',
  'bay-area': 'SF Bay Area',
  california: 'California',
  us: 'United States',
};

// How each region is expressed to location-aware job APIs.
const REGION_QUERIES = {
  sacramento: { where: 'Sacramento, CA', usajobs: 'Sacramento, California' },
  'bay-area': { where: 'San Francisco, CA', usajobs: 'San Francisco, California' },
  california: { where: 'California', usajobs: 'California' },
  us: { where: 'United States', usajobs: null },
  'us-remote': { where: null, usajobs: null, remoteOnly: true },
};

// Usable from Node (scraper, Electron main) and from a plain <script> tag
// in the renderer, so both sides share one matcher.
//
// The export name is module-specific on purpose. As <script> tags these files
// share one global lexical scope, so a generic `const API` in two of them is a
// redeclaration: the second script dies with a SyntaxError and its global is
// never set — silently, because nothing in the app reads the console.
const LOCATIONS_API = { parseLocation, matchesLocation, REGION_LABELS, REGION_QUERIES };
if (typeof module !== 'undefined' && module.exports) module.exports = LOCATIONS_API;
if (typeof window !== 'undefined') window.JobLocations = LOCATIONS_API;
