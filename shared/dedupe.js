// Duplicate detection for profile entries.
//
// Re-importing an updated resume is the main way duplicates appear, and they
// do real damage: scoring weights terms by how rare they are, so a repeated
// skills chunk makes those terms look more central to the profile than they
// are and quietly skews which jobs rank highest.
//
// Term overlap is enough here — resume entries are short and concrete, so
// this needs no model call. The tokenizer is the scorer's, so "similar"
// means the same thing to dedupe as it does to ranking.

const scoring = (() => {
  if (typeof window !== 'undefined' && window.JobScoring) return window.JobScoring;
  if (typeof require === 'function') {
    try {
      return require('./scoring');
    } catch {
      /* fall through to the local tokenizer below */
    }
  }
  return null;
})();

// Mirrors scoring.terms() closely enough to stand in if that module is
// unavailable (e.g. a renderer that only loaded this file).
function fallbackTerms(text) {
  const out = new Set();
  for (const m of (text ?? '').toLowerCase().matchAll(/[a-z][a-z0-9+#.]{2,}/g)) {
    out.add(m[0].replace(/\.+$/, ''));
  }
  return out;
}

function chunkTerms(chunk) {
  const text = `${chunk?.title ?? ''} ${chunk?.content ?? ''}`;
  return scoring ? scoring.terms(text) : fallbackTerms(text);
}

function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Overlap between two entries.
 *  jaccard     — symmetric: how much the two look like each other overall.
 *  containment — asymmetric: how much of the *smaller* entry the larger one
 *                already covers. This is what catches a short new chunk
 *                that's wholly a subset of an existing longer one.
 */
function similarity(a, b) {
  const A = chunkTerms(a);
  const B = chunkTerms(b);
  if (!A.size || !B.size) return { jaccard: 0, containment: 0, shared: [] };
  const shared = [];
  for (const t of A) if (B.has(t)) shared.push(t);
  const inter = shared.length;
  const union = A.size + B.size - inter;
  return {
    jaccard: union ? inter / union : 0,
    containment: inter / Math.min(A.size, B.size),
    shared,
  };
}

/** Same entry re-added verbatim — safe to refuse outright. */
function isExactDuplicate(a, b) {
  if (!a || !b) return false;
  if ((a.kind ?? '') !== (b.kind ?? '')) return false;
  const sameTitle = normalize(a.title) === normalize(b.title);
  const sameContent = normalize(a.content) === normalize(b.content);
  return (sameTitle && sameContent) || (sameTitle && normalize(a.title).length > 0 && sameContent);
}

// Tuned against real resume entries: distinct roles at the same employer sit
// well below these, while a re-imported entry lands far above.
const THRESHOLDS = { jaccard: 0.45, containment: 0.6 };

function isSimilar(a, b, t = THRESHOLDS) {
  const s = similarity(a, b);
  return s.jaccard >= t.jaccard || s.containment >= t.containment;
}

/**
 * Best existing match for a candidate entry, or null.
 * Same-kind entries are compared first; a skill chunk resembling an
 * experience chunk is usually a coincidence of shared tool names.
 */
function findSimilar(candidate, existing, t = THRESHOLDS) {
  let best = null;
  for (const other of existing ?? []) {
    if (candidate.id && other.id === candidate.id) continue;
    const exact = isExactDuplicate(candidate, other);
    const s = similarity(candidate, other);
    const sameKind = (candidate.kind ?? '') === (other.kind ?? '');
    const hit = exact || (sameKind && (s.jaccard >= t.jaccard || s.containment >= t.containment));
    if (!hit) continue;
    const score = exact ? 1 : Math.max(s.jaccard, s.containment);
    if (!best || score > best.score) best = { match: other, score, exact, ...s };
  }
  return best;
}

/** All overlapping pairs within one set, strongest first. */
function findDuplicatePairs(chunks, t = THRESHOLDS) {
  const pairs = [];
  const list = chunks ?? [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const exact = isExactDuplicate(a, b);
      const s = similarity(a, b);
      const sameKind = (a.kind ?? '') === (b.kind ?? '');
      if (!exact && !(sameKind && (s.jaccard >= t.jaccard || s.containment >= t.containment))) continue;
      pairs.push({ a, b, exact, score: exact ? 1 : Math.max(s.jaccard, s.containment), ...s });
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}

// Module-specific name — see the note in locations.js on why a shared `API`
// binding breaks these files when they load as <script> tags.
const DEDUPE_API = {
  similarity,
  isExactDuplicate,
  isSimilar,
  findSimilar,
  findDuplicatePairs,
  chunkTerms,
  THRESHOLDS,
};
if (typeof module !== 'undefined' && module.exports) module.exports = DEDUPE_API;
if (typeof window !== 'undefined') window.JobDedupe = DEDUPE_API;
