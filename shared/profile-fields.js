// Per-kind field definitions for profile entries, plus the functions that
// flatten those fields back into the `title` / `content` text that fit
// scoring and resume tailoring consume. Keeping the flattening here means
// the editor, the scorer, and the tailor never disagree about what an entry
// "says".

const FIELD_SCHEMAS = {
  experience: [
    { key: 'role', label: 'Job title', type: 'text', required: true, placeholder: 'IT Support Intern' },
    { key: 'company', label: 'Company', type: 'text', required: true, placeholder: 'Acme Corporation' },
    { key: 'location', label: 'Location', type: 'text', placeholder: 'Sacramento, CA' },
    { key: 'start', label: 'Start', type: 'month' },
    { key: 'end', label: 'End', type: 'month', present: true },
    {
      key: 'bullets',
      label: 'What you did',
      type: 'textarea',
      full: true,
      placeholder: 'One per line:\nResolved 200+ help desk tickets via ServiceNow\nImaged Windows workstations with SCCM',
      hint: 'Name the actual tools and technologies — those terms drive fit scoring.',
    },
  ],
  education: [
    { key: 'degree', label: 'Degree / program', type: 'text', required: true, placeholder: 'B.S. Computer Science' },
    { key: 'school', label: 'School', type: 'text', required: true, placeholder: 'Sacramento State University' },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'start', label: 'Start', type: 'month' },
    { key: 'end', label: 'End / expected', type: 'month', present: true },
    { key: 'gpa', label: 'GPA (optional)', type: 'text', placeholder: '3.7' },
    {
      key: 'coursework',
      label: 'Relevant coursework / notes',
      type: 'textarea',
      full: true,
      placeholder: 'Data Structures, Operating Systems, Databases, Networking',
    },
  ],
  project: [
    { key: 'name', label: 'Project name', type: 'text', required: true },
    { key: 'role', label: 'Your role', type: 'text', placeholder: 'Solo developer' },
    { key: 'tech', label: 'Tech used', type: 'text', full: true, placeholder: 'React, Node.js, Supabase, GitHub Actions' },
    { key: 'start', label: 'Start', type: 'month' },
    { key: 'end', label: 'End', type: 'month', present: true },
    { key: 'url', label: 'Link (optional)', type: 'text', full: true, placeholder: 'https://github.com/…' },
    { key: 'bullets', label: 'What it does / what you built', type: 'textarea', full: true },
  ],
  certification: [
    { key: 'name', label: 'Certification', type: 'text', required: true, placeholder: 'CompTIA A+' },
    { key: 'issuer', label: 'Issuer', type: 'text', placeholder: 'CompTIA' },
    { key: 'issued', label: 'Issued', type: 'month' },
    { key: 'expires', label: 'Expires (optional)', type: 'month' },
    { key: 'credential', label: 'Credential ID (optional)', type: 'text', full: true },
  ],
  skill: [
    { key: 'category', label: 'Category', type: 'text', required: true, placeholder: 'Tools & Platforms' },
    {
      key: 'items',
      label: 'Skills',
      type: 'textarea',
      full: true,
      required: true,
      placeholder: 'Windows, Active Directory, Office 365, ServiceNow, SCCM',
      hint: 'Comma-separated. Keep exact product names — they are matched against postings.',
    },
  ],
  other: [
    { key: 'label', label: 'Title', type: 'text', required: true },
    { key: 'notes', label: 'Details', type: 'textarea', full: true, required: true },
  ],
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// '2025-06' -> 'June 2025'. Anything unrecognised passes through as typed.
function formatMonth(value) {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!m) return value.trim();
  const idx = Number(m[2]) - 1;
  return idx >= 0 && idx < 12 ? `${MONTHS[idx]} ${m[1]}` : value.trim();
}

function dateRange(fields) {
  const start = formatMonth(fields.start);
  const end = fields.present ? 'Present' : formatMonth(fields.end);
  if (start && end) return `${start} - ${end}`;
  return start || end || '';
}

/** Human-readable one-line label for an entry. */
function deriveTitle(kind, f = {}) {
  const range = dateRange(f);
  const withRange = (base) => (base && range ? `${base}, ${range}` : base || range || '');
  switch (kind) {
    case 'experience':
      return withRange([f.role, f.company].filter(Boolean).join(' — '));
    case 'education':
      return withRange([f.degree, f.school].filter(Boolean).join(' — '));
    case 'project':
      return withRange([f.name, f.role].filter(Boolean).join(' — '));
    case 'certification': {
      const base = [f.name, f.issuer].filter(Boolean).join(' — ');
      const issued = formatMonth(f.issued);
      return issued ? `${base}, ${issued}` : base;
    }
    case 'skill':
      return f.category || 'Skills';
    default:
      return f.label || '';
  }
}

/**
 * Flatten the fields into the searchable text body. Everything that could
 * be a matchable keyword (tools, coursework, location) must appear here —
 * this is what the fit scorer and the resume tailor actually read.
 */
function deriveContent(kind, f = {}) {
  const parts = [];
  const push = (v) => {
    if (v && String(v).trim()) parts.push(String(v).trim());
  };
  switch (kind) {
    case 'experience':
      push(f.location);
      push(f.bullets);
      break;
    case 'education':
      push(f.location);
      push(f.gpa ? `GPA ${f.gpa}` : '');
      push(f.coursework);
      break;
    case 'project':
      push(f.tech);
      push(f.url);
      push(f.bullets);
      break;
    case 'certification':
      push(f.credential ? `Credential ID ${f.credential}` : '');
      push(f.expires ? `Expires ${formatMonth(f.expires)}` : '');
      // A cert with no other detail still needs body text to be scoreable.
      if (!parts.length) push([f.name, f.issuer].filter(Boolean).join(' — '));
      break;
    case 'skill':
      push(f.items);
      break;
    default:
      push(f.notes);
  }
  return parts.join('\n');
}

/**
 * Entries created before structured fields existed only have title/content.
 * Put those values into the most sensible slots so nothing is lost when the
 * user opens the editor for the first time.
 */
function fieldsFromLegacy(kind, title = '', content = '') {
  const schema = FIELD_SCHEMAS[kind] ?? FIELD_SCHEMAS.other;
  const firstText = schema.find((f) => f.type === 'text');
  const firstArea = schema.find((f) => f.type === 'textarea');
  const out = {};
  if (firstText) out[firstText.key] = title;
  if (firstArea) out[firstArea.key] = content;
  return out;
}

function isEmptyFields(fields) {
  if (!fields || typeof fields !== 'object') return true;
  return !Object.values(fields).some((v) => v !== '' && v !== false && v != null);
}

const API = {
  FIELD_SCHEMAS,
  deriveTitle,
  deriveContent,
  fieldsFromLegacy,
  isEmptyFields,
  formatMonth,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.ProfileFields = API;
