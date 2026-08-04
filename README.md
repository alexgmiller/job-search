# Job Search

A personal job-listing system on Supabase: a scraper finds listings on a
schedule, a desktop app shows unseen ones with native notifications.

## Scraper — `scraper/`

Node script that pulls open roles from 26 Greenhouse/Lever boards
([scraper/companies.json](scraper/companies.json) — edit freely) plus
Remotive (free, no key), and — when their free keys are set — USAJobs,
Adzuna, and JSearch. Matches titles/locations against the `searches`
table (the role tabs), inserts with the service-role key. Dedupe is a
unique index on `url`, so re-runs are safe and dismissed listings never
return.

**Location matching** lives in [shared/locations.js](shared/locations.js)
and is used by both the scraper and the app. It parses messy board
strings — `San Francisco, CA • New York, NY • United States`,
`Remote - Ontario, Canada`, `San Francisco Bay Area or Los Angeles Area` —
into parts, then matches named regions: `sacramento`, `bay-area`,
`california`, `us-remote`, `us`. Crucially it distinguishes
`Remote - United States` from `Remote, United Kingdom`, which a substring
test cannot. Put region keys in a search's `locations` array (the tab
editor has chips for them); free-text entries still work as substrings.

Runs every 3 hours via GitHub Actions
([.github/workflows/scrape.yml](.github/workflows/scrape.yml)). Repo
secrets needed: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
optionally `RAPIDAPI_KEY` (Indeed/LinkedIn source). New listings are
fit-scored against `profile_chunks` by [shared/scoring.js](shared/scoring.js) —
free, no API key; skipped silently when the profile is empty.

Scoring weights each profile term by how *rare* it is across the listings
being scored, so distinctive skills (servicenow, sccm, "active directory")
dominate and filler words ("help", "office", "service") count for almost
nothing. Scores are calibrated against the corpus, so they read as "how
good is this compared to everything else out there".

Keyword overlap alone can't tell a Staff Engineer role from an entry-level
one — both use the same technology words — so scores are also weighted by
seniority (title keywords plus any stated years-of-experience bar). Measured
on 679 real listings: junior avg 47, mid 26, senior 17, staff 8.

Which roles *suit you* is a preference, not a property of the listing, so
**Settings → Scoring** exposes it: pick a target (entry / mid / senior / no
preference) and how hard location fit pulls the score down. Every scored row
stores the breakdown its score was built from — term overlap, title level,
years required, location grade — and term overlap doesn't depend on who
you're targeting, so the app re-ranks everything it has loaded from those
numbers alone. No re-scrape, nothing written back, instantly reversible. A
preview under the chips shows what the choice does to your actual list.

The scraper writes `fit_score` using the `entry` default; the app always
re-derives what it displays, so the two never disagree. Rows scored before
the breakdown existed keep their stored score.

To score listings that were found before you filled in your profile:

```sh
cd scraper
node backfill-scores.js --dry-run   # preview scores, write nothing
node backfill-scores.js             # write fit_score / fit_reason
node backfill-scores.js --all       # re-score everything, not just unscored
```

Local test (uses `scraper/.env`, see `.env.example` there):

```sh
cd scraper
npm install
npm run dry-run   # prints matches, inserts nothing
```

Note: Greenhouse/Lever boards skew heavily toward software roles. For
IT support / help desk coverage, the JSearch source matters — grab a
free key at rapidapi.com (subscribe to the JSearch API, free tier).

## Desktop app (current) — `desktop/`

Electron app for Windows and macOS. Shows unseen listings in per-role
tabs (click to open the posting, ✕ to dismiss, "Applied ✓" to start
tracking an application), polls Supabase every few minutes in the
background, and fires a native OS notification when new listings appear.
Closing the window minimizes to the tray so notifications keep working.

- **Detail view**: clicking a listing opens it in-app rather than launching
  a browser — full description, fit score with its reasoning, and every
  action (Open posting, 👁 Seen, Applied ✓, Dismiss, Restore, status
  pipeline, notes) plus **📄 Tailor resume** rendered inline. This is what
  makes widget mode usable, since list cards there are too narrow for
  per-card buttons.
- **Undo**: every keep/apply/dismiss/restore (and bulk action) offers a
  7-second Undo toast that restores the exact prior state.
- **Bulk dismiss**: the ✕ on a band header clears the whole band (confirm
  above 50 rows; Undo works on the lot).
- **Search**: the magnifier in the header searches role/company/location
  across the *entire* table server-side, not just the 500 newest the list
  holds.
- **Follow-ups**: In Progress footer shows "Follow-ups due · N" — apps
  still at "applied" after N days (Settings, default 10). Toggle to see
  only those; move a listing to interviewing/rejected to clear it.
- **Mute companies**: "Mute <company>" on a listing's detail screen hides
  its listings and stops the scraper collecting them (migration-8 table
  `muted_companies`); manage the list in Settings.
- **Views**: New (untouched listings) / Seen (reviewed, might apply) /
  In Progress (applications, with status pipeline Applied → Interviewing
  → Offer/Rejected and per-listing notes) / Dismissed (not interested,
  restorable). 👁 parks a listing in Seen, ✓ applies, ✕ dismisses.
- **Tabs** come from the `searches` table and filter within each view;
  add with **+**, edit or delete via the ✎ on the active tab (deleting
  a tab keeps its listings in All).
- **Location box** filters the visible list by substring, any view/tab.
- **Profile** (header button): chunks of your experience/education/skills
  stored in `profile_chunks`. **Import resume…** reads a PDF/DOCX/TXT/MD
  and splits it into chunks for review — you edit/deselect before anything
  is saved. With `ANTHROPIC_API_KEY` set it parses with Claude Haiku (one
  call per import); without one it falls back to free section-heading
  detection. The scraper **fit-scores** each new listing
  against your profile with free keyword matching — no API, badges are
  relative rather than absolute (hover for matched terms; New/Seen sort
  best-first). The **📄 Tailor** button generates a Markdown resume built
  only from your profile chunks via Claude Haiku (a few cents per click;
  needs `ANTHROPIC_API_KEY` in `desktop/.env`).

Profile entries are edited as structured fields (✎ on an entry, or
double-click its text): job title, company, location, start/end month with
a **Present** toggle, bullets — and a different field set per kind
(education, project, certification, skill). The structured values live in
`profile_chunks.fields`; `title` and `content` are derived from them by
[shared/profile-fields.js](shared/profile-fields.js), so fit scoring and
resume tailoring keep reading one consistent text body.

Requires migrations 1–6 in `supabase/` to have been run. (Without
migration-6 the editor still works — it just can't persist the structured
fields, only the derived text.)

```sh
cd desktop
npm install
cp .env.example .env   # fill in Supabase URL + anon key
npm start
```

Run it at login: drop a shortcut to `npm start` (or a small .cmd wrapping
`npx electron .`) into `shell:startup` on Windows, or add it to Login
Items on macOS. The `push_tokens` table and the push sections below are
NOT needed for the desktop app.

## Mobile app (parked until iOS is worth $99/yr) — repo root

Minimal Expo companion app. Reads unseen rows from the same table, opens
posting links, marks listings seen, and registers this device's Expo push
token so the scheduled backend job can notify about new listings.

## One-time setup

1. **Supabase** — run [supabase/schema.sql](supabase/schema.sql) in the SQL
   editor (skip tables that already exist from the desktop setup).
2. **Env** — copy `.env.example` to `.env`, fill in the project URL and anon
   key from Supabase → Settings → API.
3. **EAS project** — `npm i -g eas-cli` (or use `npx`), then `npx eas init`.
   This links the app to an EAS project and writes `extra.eas.projectId`
   into `app.json`. **Push tokens cannot be fetched without this id.**
4. **Apple Developer Program** — push notifications require a paid Apple
   Developer membership ($99/yr); free personal teams cannot use the push
   entitlement. Enroll at developer.apple.com before building.
5. **Register your iPhone, then build** — remote push does not work in
   Expo Go; you need a development build (EAS builds in the cloud, so no
   Mac needed):
   ```sh
   npx eas device:create   # opens a link on your iPhone to register it
   npx eas build --profile development --platform ios
   ```
   During the build, sign in with your Apple account when prompted — EAS
   creates the signing certificate, provisioning profile, and APNs push
   key automatically. Install the finished build from the QR code on the
   build page, then run `npx expo start` and connect. After this one-time
   build, day-to-day development works like Expo Go.

## Running

```sh
npm install
npx expo start
```

## How push notifications flow

```
mobile app ──registers──▶ push_tokens (Supabase)
backend job ──new rows──▶ reads push_tokens ──POST──▶ exp.host ──▶ FCM/APNs ──▶ phone
```

The app never polls in the background; the scheduled backend job is the only
thing that sends. Backend snippet (Node 18+, no SDK needed):

```js
// After inserting new job_listings rows:
const { data: tokens } = await supabase.from('push_tokens').select('token');

await fetch('https://exp.host/--/api/v2/push/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(
    tokens.map(({ token }) => ({
      to: token,
      title: 'New job listings',
      body: `${newListings.length} new listing(s) found`,
      channelId: 'default', // must match the channel the app creates
    }))
  ),
});
```

Check the response body: a per-token `status: "error"` with
`details.error === "DeviceNotRegistered"` means that token is dead —
delete the row so you stop sending to it.

## If Android is ever needed

Android delivery goes through Firebase Cloud Messaging: create a Firebase
project for package `com.alexgmiller.jobsearch`, generate a service-account
JSON key, and upload it via `npx eas credentials` → Android → Google
Service Account (FCM V1). The `channelId: 'default'` in the backend send
payload only matters on Android but is harmless on iOS.

## Testing push end-to-end

1. Launch the dev build on a **physical device**, accept the permission
   prompt, and grab the `ExponentPushToken[...]` (logged by
   `lib/notifications.ts`, or read it from the `push_tokens` table).
2. Paste it into https://expo.dev/notifications and send a test message.
3. Background the app first — foreground vs background delivery behave
   differently and both are worth checking.
