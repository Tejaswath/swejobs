# SweJobs Chrome Extension (Batch 3)

## What this does
- Captures job details from the active tab.
- Authenticates with Supabase using `supabase.auth.signInWithPassword`.
- Inserts applications directly into `public.applications` with RLS-protected user scope.
- Stores captured description in `applications.ats_job_description` (`max 4000` chars).
- Keeps `notes` for user-authored notes only.

## Build
From repo root:

```bash
npm run build:extension
```

This writes compiled scripts to:
- `extension/dist/popup.js`
- `extension/dist/background.js`
- `extension/dist/content.js`

## Load unpacked
1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked** and select `/Users/tejaswath/projects/swejobs/extension`.

## Configure once
Inside extension popup:
1. Enter `Supabase URL` (project URL).
2. Enter `Anon key` (publishable key).
3. Click **Save config**.
4. Sign in with your SweJobs account.

## Security notes
- Uses Supabase SDK auth methods (no custom raw password endpoint calls in extension code).
- Stores only session tokens in `chrome.storage.local`.
- Writes only to user-owned rows via existing RLS policies.
- Captured description excerpt is size-capped before insert.
