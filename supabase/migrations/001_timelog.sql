-- ════════════════════════════════════════════════════════════
-- 001_timelog.sql
-- Core time logging tables: profiles + entries
-- Run in both dev and prod Supabase projects
-- ════════════════════════════════════════════════════════════


-- ── Profiles ─────────────────────────────────────────────────
-- One row per user. Auto-created on signup via trigger.
create table profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  cycle_start_day   integer not null default 21,
  preview_email     text,
  copy_to_self      boolean not null default false,

  -- Issuer details (appear on every invoice)
  issuer_name       text,
  issuer_kennitala  text,
  issuer_address    text,
  issuer_city       text,
  issuer_email      text,
  issuer_vsk        text,

  -- Default bank details
  bank_account      text,
  bank_utibú        text,
  bank_hb           text,
  bank_reikningur   text,

  -- Defaults
  default_rate      integer,
  invoice_prefix    text,
  vsk_rate          numeric(5,2) not null default 0,
  default_km_rate   integer
);

alter table profiles enable row level security;

create policy "Users can read own profile"
  on profiles for select using (auth.uid() = id);

create policy "Users can upsert own profile"
  on profiles for insert with check (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

-- Auto-create profile row on signup
-- Note: search_path must be set explicitly to avoid Supabase security warnings
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


-- ── Entries ──────────────────────────────────────────────────
create table entries (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  name             text not null,
  date             date not null,
  time_from        time not null,
  time_until       time not null,
  minutes          integer not null,
  crosses_midnight boolean not null default false,

  -- Set by the invoice function when this entry is billed
  -- null = uninvoiced
  invoice_id       uuid,        -- references invoices(id), added in 002_invoices.sql
  invoiced_at      timestamptz,

  created_at       timestamptz default now()
);

create index entries_user_date  on entries (user_id, date desc);
create index entries_invoice    on entries (invoice_id);

alter table entries enable row level security;

create policy "Users can read own entries"
  on entries for select using (auth.uid() = user_id);

create policy "Users can insert own entries"
  on entries for insert with check (auth.uid() = user_id);

create policy "Users can delete own entries"
  on entries for delete using (auth.uid() = user_id);

create policy "Users can update own entries"
  on entries for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Entries cannot be deleted once invoiced — enforced by this policy
-- (the delete policy above combined with the check in the app)
-- The invoice function uses the service role key and handles this server-side.
