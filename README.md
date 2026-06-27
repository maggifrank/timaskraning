# Time.log

Mobile-first time logging app for tracking billable hours. Built with vanilla ES modules, no build step, hosted on Netlify, backed by Supabase. Part of a two-app system — invoicing lives in a separate repo (`reikn.log`) that shares the same Supabase project.

---

## What it does

- Log work entries with a description, date, client, and start/end time using 24h dropdowns
- Quick-add a client by name directly from the log form — billing details completed later in the invoices app
- Handles shifts that cross midnight correctly
- Edit or delete uninvoiced entries — invoiced entries are locked (no buttons shown, blocked at DB level)
- Deleting an entry also cleans up any draft invoice snapshots referencing it
- History grouped by payment cycle, split into **Uninvoiced** and **Invoiced** sections
- Remembers your last used client across sessions (localStorage)
- Configurable payment cycle start day (default: 21st of month)
- Multi-user with full data isolation via Supabase RLS
- Two environments (`dev` and `prod`) auto-detected by hostname — yellow **dev** badge in header

---

## Project structure

```
timelog/
  index.html                    — app shell
  styles/
    main.css                    — full design system and component styles
  src/
    supabase.js                 — Supabase client, fill in your keys here
    auth.js                     — auth state, session, login/reset UI
    router.js                   — path-based client-side router
    utils.js                    — pure helpers: duration, dates, cycles, formatting
    main.js                     — bootstrapper, wires auth + routing + pages
    components/
      toast.js                  — showToast(msg, type), auto-dismisses after 3s, click to dismiss
      spinner.js                — setLoading(btn, loading, label)
    pages/
      log.js                    — time entry form with quick-add client (/)
      history.js                — invoiced vs uninvoiced periods (/history)
      settings.js               — cycle day, preview email, copy-to-self (/settings)
  netlify/
    functions/
      send-invoices.js          — stub only (full implementation in reikn.log repo)
      send-staging.js           — stub only (full implementation in reikn.log repo)
  netlify.toml                  — SPA redirect, dev port 8888, secrets scan omit
  package.json
  supabase/
    migrations/
      001_timelog.sql           — profiles + entries tables + RLS + trigger
      003_entries_client.sql    — adds client_id to entries (run after 002_invoices.sql)
```

---

## Architecture

This app and the invoices app (`reikn.log`) share **one Supabase project per environment**. Each repo owns its own schema — this repo creates `profiles` and `entries`, the invoices repo extends the same database with `clients`, `invoices`, and `invoice_entries`.

```
timelog.franklin.is   →   dev / prod Supabase project   ←   invoices.franklin.is
owns: profiles, entries          (shared DB)                  owns: clients, invoices, invoice_entries
```

When the invoices app sends a real invoice, it writes `invoice_id` and `invoiced_at` back to `entries`. The timelog app reads these to lock the entries — hiding edit/delete buttons and blocking DB-level changes.

The Netlify scheduled functions (22nd and 25th) live entirely in the invoices repo.

---

## Security

The anon key is intentionally in `src/supabase.js` — this is the Supabase-recommended pattern for client-side apps. It cannot be hidden in a static site without a server.

**What protects the data:**
- Supabase RLS enforces per-user data isolation — the anon key alone grants nothing beyond what policies allow
- Public signups are disabled — accounts are created manually in the Supabase dashboard
- Cloudflare IP geoblocking restricts access to Icelandic IPs, minimising anon key exposure
- The service role key (which bypasses RLS) never appears in this repo — it lives only in Netlify env vars in the invoices repo
- Invoiced entries are locked at both the UI level (buttons hidden) and DB level (foreign key constraint prevents deletion while referenced by invoice_entries)

Keep this repo **private** or ensure Cloudflare geoblocking is active before making it public.

---

## Setup

### 1. Supabase

Create **two** Supabase projects — one for dev/test, one for production.

Run migrations in this order in each project:

```
001_timelog.sql           — profiles + entries + RLS + trigger
002_invoices.sql          — from the invoices repo (clients, invoices, invoice_entries)
003_entries_client.sql    — adds client_id FK to entries (depends on clients table)
```

**Disable public signups:** Authentication → Settings → disable "Enable Signups". Create accounts manually from the dashboard.

**Set Auth URLs:** Authentication → URL Configuration:
- Site URL: your production domain (e.g. `https://timelog.franklin.is`)
- Redirect URLs: add test Netlify URL and `http://localhost:8888`

### 2. Configure credentials

Open `src/supabase.js` and fill in your keys:

```js
const ENV_CONFIG = {
  dev: {
    url:     'YOUR_DEV_SUPABASE_URL',
    anonKey: 'YOUR_DEV_SUPABASE_ANON_KEY',
  },
  prod: {
    url:     'YOUR_PROD_SUPABASE_URL',
    anonKey: 'YOUR_PROD_SUPABASE_ANON_KEY',
  },
};

const TEST_HOST = 'test--timaskraning.netlify.app'; // ← your test Netlify subdomain
```

Keys are under **Settings → API** in each Supabase project.

### 3. Local development

```powershell
npm install
netlify dev
```

Opens on `http://localhost:8888`. Note: two Netlify Dev instances can't run simultaneously on the same machine due to port conflicts on Netlify's internal port. Use the deployed test site for the invoices app while developing timelog locally, or vice versa.

### 4. Deploy to Netlify

Connect the repo — no build command needed. The `[[redirects]]` rule in `netlify.toml` handles SPA routing. `SECRETS_SCAN_OMIT_KEYS = "SUPABASE_URL"` prevents the build from failing due to the intentionally public Supabase URL in source.

---

## Payment cycle

Configured per user under **Settings** (default: start day 21).

A cycle runs from the start day in one month to the day before it in the next — e.g. with start day 21: **21 May – 20 Jun**.

History groups entries by cycle. The current cycle is expanded by default; older uninvoiced and all invoiced cycles are collapsed.

---

## Quick-add client

Tap **+ New** next to the client dropdown to create a client by name only. The client appears immediately in the dropdown and is selected. Billing details (email, rate, bank details) must be completed in the invoices app before the client can be invoiced. Incomplete clients show an amber badge in the invoices app and are blocked from invoice generation.

---

## RLS policies

### `profiles`
- SELECT, INSERT, UPDATE: `auth.uid() = id`

### `entries`
- SELECT, INSERT, UPDATE, DELETE: `auth.uid() = user_id`
- Note: DELETE is allowed by RLS but blocked at the application level for invoiced entries, and at the DB level by the foreign key from `invoice_entries`

---

## Database schema

### `profiles`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | References `auth.users` |
| `cycle_start_day` | integer | Default 21 |
| `preview_email` | text | Draft invoice recipient (22nd) |
| `copy_to_self` | boolean | CC on real invoice sends |
| `issuer_name`, `issuer_kennitala`, `issuer_address`, `issuer_city`, `issuer_email`, `issuer_vsk` | text | Set in invoices app settings |
| `bank_account`, `bank_utibú`, `bank_hb`, `bank_reikningur` | text | Default bank details |
| `default_rate` | integer | ISK per hour fallback |
| `invoice_prefix` | text | Default invoice prefix |

### `entries`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `user_id` | uuid | References `auth.users` |
| `client_id` | uuid | References `clients(id)`, added by 003 |
| `name` | text | Description |
| `date` | date | Work date |
| `time_from` | time | Start time |
| `time_until` | time | End time |
| `minutes` | integer | Pre-calculated duration |
| `crosses_midnight` | boolean | True if shift spans midnight |
| `invoice_id` | uuid | Set by invoices app when billed — locks the entry |
| `invoiced_at` | timestamptz | Set by invoices app when billed |
| `created_at` | timestamptz | Auto-set |

`clients`, `invoices`, and `invoice_entries` are defined and owned by the invoices repo.
