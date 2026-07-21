# Job Search

A personal job-listing system on Supabase: a scraper finds listings on a
schedule, a desktop app shows unseen ones with native notifications.

## Scraper — `scraper/`

Node script that pulls open roles from Greenhouse/Lever boards
([scraper/companies.json](scraper/companies.json) — edit freely) and,
when `RAPIDAPI_KEY` is set, Indeed/LinkedIn/Glassdoor via the JSearch
API. Matches titles/locations against the `searches` table (the role
tabs), inserts with the service-role key. Dedupe is a unique index on
`url`, so re-runs are always safe and dismissed listings never return.

Runs every 3 hours via GitHub Actions
([.github/workflows/scrape.yml](.github/workflows/scrape.yml)). Repo
secrets needed: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
optionally `RAPIDAPI_KEY`.

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

- **Views**: New (untouched listings) / Seen (reviewed, might apply) /
  In Progress (applications, with status pipeline Applied → Interviewing
  → Offer/Rejected and per-listing notes) / Dismissed (not interested,
  restorable). 👁 parks a listing in Seen, ✓ applies, ✕ dismisses.
- **Tabs** come from the `searches` table and filter within each view;
  add with **+**, edit or delete via the ✎ on the active tab (deleting
  a tab keeps its listings in All).
- **Location box** filters the visible list by substring, any view/tab.

Requires migrations 1–4 in `supabase/` to have been run.

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
