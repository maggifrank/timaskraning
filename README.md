# Logger

Mobile-first time and kilometre logging app for tracking billable hours and driven distances. Built with vanilla ES modules, no build step, hosted on Netlify, backed by Supabase. Part of a two-app system — invoicing lives in a separate repo (`reikn.log`) that shares the same Supabase project.

---

## What it does

- Log work entries with a description, date, client, and start/end time using 24h dropdowns
- Log driven kilometres with from/to locations, date, client, and optional round trip toggle
- Quick-add a client by name directly from the log form — billing details completed later in the invoices app
- Handles shifts that cross midnight correctly
- Edit or delete uninvoiced time and km entries — invoiced entries are locked
- History grouped by payment cycle with collapsible **Hours** and **Kilometres** subsections per cycle
- Uninvoiced and invoiced cycles shown separately
- Remembers your last used client across sessions (localStorage)
- Configurable payment cycle start day (default: 21st of month)
- Configurable default km rate in settings
- Multi-user with full data isolation via Supabase RLS
- Two environments (`dev` and `prod`) auto-detected by hostname — yellow **dev** badge in header

---

## Project structure

```
logger/
  index.html                    — app shell
  styles/
    main.css                    — full design system and component styles
  src/
    supabase.js                 — Supabase client, fill in your keys here
    auth.js                     — auth state, session, login/forgot password UI
    router.js                   — path-based client-side router
    utils.js                    — pure helpers: duration, dates, cycles, formatting
    main.js                     — bootstrapper, wires auth + routing + pages
    components/
      toast.js                  — showToast(msg, type), auto-dismisses after 3s, click to dismiss
      spinner.js                — setLoading(btn, loading, label)
    pages/
      log.js                    — time entry form with quick-add client (/)
      km.js                     — km entry form and history (/km)
      history.js                — combined time + km history by cycle (/history)
      settings.js               — cycle day, km rate, preview email, copy-to-self (/settings)
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
      004_km_entries.sql        — km_entries table + RLS + km_rate columns
```

---

## Architecture

This app and the invoices app (`reikn.log`) share **one Supabase project per environment**. Each repo owns its own schema — this repo creates `profiles`, `entries`, and `km_entries`. The invoices repo extends the same database with `clients`, `invoices`, and `invoice_entries`.

```
logger.franklin.is    →   dev / prod Supabase project   ←   invoices.franklin.is
owns: profiles, entries,         (shared DB)                  owns: clients, invoices,
      km_entries                                               invoice_entries
```

When the invoices app sends a real invoice, it writes `invoice_id` and `invoiced_at` back to both `entries` and `km_entries`. The logger app reads these to lock the entries — hiding edit/delete buttons and blocking DB-level changes.

---

## Security

The anon key is intentionally in `src/supabase.js` — this is the Supabase-recommended pattern for client-side apps. It cannot be hidden in a static site without a server.

**What protects the data:**
- Supabase RLS enforces per-user data isolation — the anon key alone grants nothing beyond what policies allow
- Public signups are disabled — accounts are created manually in the Supabase dashboard
- Cloudflare IP geoblocking restricts access to Icelandic IPs
- The service role key never appears in this repo — it lives only in Netlify env vars in the invoices repo
- Invoiced entries are locked at both the UI level (buttons hidden) and DB level

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
004_km_entries.sql        — km_entries table, km_rate columns on profiles + clients
```

**Disable public signups:** Authentication → Settings → disable "Enable Signups". Create accounts manually.

**Set Auth URLs:** Authentication → URL Configuration:
- Site URL: your production domain
- Redirect URLs: add test Netlify URL, `http://localhost:8888`, and your invoices URLs

### 2. Configure credentials

Open `src/supabase.js`:

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

### 3. Local development

```powershell
npm install
netlify dev
```

Opens on `http://localhost:8888`. Note: two Netlify Dev instances can't run simultaneously due to internal port conflicts. Use the deployed test site for the invoices app while developing locally.

### 4. Deploy to Netlify

Connect the repo — no build command needed. `SECRETS_SCAN_OMIT_KEYS = "SUPABASE_URL"` in `netlify.toml` prevents build failures due to the intentionally public Supabase URL in source.

---

## Payment cycle

Configured per user under **Settings** (default: start day 21).

A cycle runs from the start day in one month to the day before it in the next — e.g. with start day 21: **21 May – 20 Jun**.

History groups entries by cycle with collapsible Hours and Kilometres subsections. The current cycle is expanded by default; older and invoiced cycles are collapsed.

---

## KM logging

Log driven kilometres under the **KM** tab:
- Enter from/to locations, date, kilometres, and optionally select a client
- Tap **↩ Round trip** to double the km automatically
- Add optional notes

KM entries appear in History under the **🚗 Kilometres** subsection per cycle, alongside the **⏱ Hours** subsection. Both are collapsible independently.

On the invoice, KM entries appear as separate line items (`Vörunr. 3`) after the time entries. The rate used is the client's km rate override if set, otherwise the default km rate from Settings.

---

## Quick-add client

Tap **+ New** next to the client dropdown to create a client by name only. Billing details must be completed in the invoices app before the client can be invoiced. Incomplete clients show an amber badge in the invoices app.

---

## Password reset

Enter your email on the login screen and tap **Forgot password?**. Supabase sends a reset email. Clicking the link redirects back to the app where you can set a new password.

Ensure all your site URLs are added to **Supabase → Authentication → URL Configuration → Redirect URLs**.

---

## RLS policies

### `profiles`
- SELECT, INSERT, UPDATE: `auth.uid() = id`

### `entries`
- SELECT, INSERT, UPDATE, DELETE: `auth.uid() = user_id`

### `km_entries`
- SELECT, INSERT, UPDATE, DELETE: `auth.uid() = user_id`

---

## Database schema

### `profiles`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | References `auth.users` |
| `cycle_start_day` | integer | Default 21 |
| `preview_email` | text | Draft invoice recipient |
| `copy_to_self` | boolean | CC on real invoice sends |
| `issuer_name`, `issuer_kennitala`, `issuer_address`, `issuer_city`, `issuer_email`, `issuer_vsk` | text | Set in invoices app |
| `bank_account`, `bank_utibú`, `bank_hb`, `bank_reikningur` | text | Default bank details |
| `default_rate` | integer | ISK per hour fallback |
| `invoice_prefix` | text | Default invoice prefix |
| `vsk_rate` | numeric(5,2) | VAT rate, default 0 |
| `default_km_rate` | integer | ISK per km fallback |

### `entries`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `user_id` | uuid | References `auth.users` |
| `client_id` | uuid | References `clients(id)` |
| `name` | text | Description |
| `date` | date | Work date |
| `time_from`, `time_until` | time | Start/end time |
| `minutes` | integer | Pre-calculated duration |
| `crosses_midnight` | boolean | True if shift spans midnight |
| `invoice_id` | uuid | Set when invoiced — locks the entry |
| `invoiced_at` | timestamptz | Set when invoiced |

### `km_entries`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `user_id` | uuid | References `auth.users` |
| `client_id` | uuid | References `clients(id)` |
| `date` | date | Trip date |
| `from_location` | text | Starting point |
| `to_location` | text | Destination |
| `kilometres` | numeric(8,1) | Total km (already doubled if round trip) |
| `is_round_trip` | boolean | Display flag |
| `notes` | text | Optional |
| `invoice_id` | uuid | Set when invoiced — locks the entry |
| `invoiced_at` | timestamptz | Set when invoiced |
