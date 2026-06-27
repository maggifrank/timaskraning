# Time.log

Mobile-first time logging app for tracking billable hours. Built with vanilla ES modules, no build step, hosted on Netlify, backed by Supabase. Part of a two-app system — invoicing lives in a separate repo (`reikn.log`) that shares the same Supabase project.

---

## What it does

- Log work entries with a description, date, client, and start/end time using 24h dropdowns
- Handles shifts that cross midnight correctly
- Edit or delete uninvoiced entries — invoiced entries are locked
- History grouped by payment cycle, split into **Uninvoiced** and **Invoiced** sections
- Remembers your last used client across sessions
- Configurable payment cycle start day (default: 21st – 20th)
- Configurable draft preview email and copy-to-self for invoice notifications
- Multi-user with full data isolation via Supabase RLS
- Two environments (`dev` and `prod`) auto-detected by hostname — yellow **dev** badge in header

---

## Project structure

```
timelog/
  index.html                    — app shell, loads CSS + JS only
  styles/
    main.css                    — full design system and component styles
  src/
    supabase.js                 — single Supabase client, fill in your keys here
    auth.js                     — auth state, session, login/reset UI
    router.js                   — path-based client-side router
    utils.js                    — pure helpers: duration, dates, cycles, formatting
    main.js                     — bootstrapper, wires auth + routing + pages
    components/
      toast.js                  — showToast(msg, type)
      spinner.js                — setLoading(btn, loading, label)
    pages/
      log.js                    — time entry form (home page, /)
      history.js                — invoiced vs uninvoiced periods (/history)
      settings.js               — cycle day, preview email, copy-to-self (/settings)
  netlify/
    functions/
      send-invoices.js          — stub only (full implementation in reikn.log repo)
      send-staging.js           — stub only (full implementation in reikn.log repo)
  netlify.toml                  — SPA redirect rule, dev port 8888
  package.json
  supabase/
    migrations/
      001_timelog.sql           — profiles + entries tables
      003_entries_client.sql    — adds client_id to entries (run after 002_invoices.sql)
```

---

## Architecture

This app and the invoices app (`reikn.log`) share **one Supabase project per environment**. Each repo owns its own schema — this repo creates `profiles` and `entries`, the invoices repo extends the same database with `clients`, `invoices`, and `invoice_entries`.

```
timelog.franklin.is   →   dev / prod Supabase project   ←   invoices.franklin.is
owns: profiles, entries          (shared DB)                  owns: clients, invoices, invoice_entries
```

When the invoices app sends a real invoice, it writes `invoice_id` and `invoiced_at` back to `entries`. The timelog app reads these to determine which entries are locked.

The Netlify scheduled functions (22nd and 25th) live entirely in the invoices repo.

---

## Security

The anon key is intentionally in `src/supabase.js` — this is the Supabase-recommended pattern for client-side apps. It cannot be hidden in a static site without a server.

**What protects the data:**
- Supabase RLS enforces per-user data isolation at the database level — the anon key alone grants nothing beyond what policies allow
- Public signups are disabled — accounts are created manually in the Supabase dashboard
- Cloudflare IP geoblocking restricts access to Icelandic IPs, minimising exposure of the anon key
- The service role key (which bypasses RLS) never appears in this repo — it lives only in Netlify environment variables in the invoices repo
- Invoiced entries have no client-side delete path — the UI hides the button and the invoices function uses the service role key server-side

Keep this repo **private** or ensure Cloudflare geoblocking is active before making it public.

---

## Setup

### 1. Supabase

Create **two** Supabase projects — one for dev/test, one for production.

In each project, run the migrations in this order:

```
001_timelog.sql           — creates profiles + entries
(002_invoices.sql)        — run this from the invoices repo first
003_entries_client.sql    — adds client_id to entries
```

Note: `003_entries_client.sql` depends on the `clients` table created by `002_invoices.sql` in the invoices repo. Run that first.

**Disable public signups:** Authentication → Settings → turn off Enable Signups. Create accounts manually from the dashboard.

**Fix the trigger search path** if user creation fails with a database error:
```sql
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists handle_new_user();

create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
```

**Set the Site URL and redirect URLs:** Authentication → URL Configuration:
- Site URL: your production domain
- Redirect URLs: add your test Netlify URL and `http://localhost:8888`

### 2. Configure credentials

Open `src/supabase.js` and fill in:

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

const TEST_HOST = 'test--timaskraning.netlify.app'; // ← your Netlify test site hostname
```

Keys are under **Settings → API** in each Supabase project.

### 3. Local development

```bash
npm install
netlify dev
```

Opens on `http://localhost:8888`.

### 4. Deploy to Netlify

Connect the repo to Netlify — no build command needed. The `[[redirects]]` rule in `netlify.toml` handles SPA routing automatically.

---

## Payment cycle

Configured per user under **Settings** (default: start day 21).

A cycle runs from the configured start day in one month to the day before it in the next — e.g. with start day 21: **21 May – 20 Jun**.

- **History** — entries grouped by cycle, split into Uninvoiced and Invoiced sections
- **Settings** — preview email (where draft invoices land on the 22nd) and copy-to-self toggle

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
| `bank_account`, `bank_utibú`, `bank_hb`, `bank_reikningur` | text | Default bank details, set in invoices app |
| `default_rate` | integer | ISK per hour fallback |
| `invoice_prefix` | text | Default invoice prefix |

### `entries`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `user_id` | uuid | References `auth.users` |
| `client_id` | uuid | References `clients(id)` |
| `name` | text | Description |
| `date` | date | Work date |
| `time_from` | time | Start time |
| `time_until` | time | End time |
| `minutes` | integer | Pre-calculated duration |
| `crosses_midnight` | boolean | True if shift spans midnight |
| `invoice_id` | uuid | Set by invoices app when billed |
| `invoiced_at` | timestamptz | Set by invoices app when billed |
| `created_at` | timestamptz | Auto-set |

`clients`, `invoices`, and `invoice_entries` are defined and owned by the invoices repo.
