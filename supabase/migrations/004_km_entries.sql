-- ════════════════════════════════════════════════════════════
-- 004_km_entries.sql
-- Driven kilometres tracking
-- Run after 003_entries_client.sql
-- ════════════════════════════════════════════════════════════

create table km_entries (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  client_id        uuid references clients(id) on delete set null,
  date             date not null,
  from_location    text not null,
  to_location      text not null,
  kilometres       numeric(8,1) not null,
  is_round_trip    boolean not null default false,
  notes            text,

  -- Set by invoice function when billed
  invoice_id       uuid,
  invoiced_at      timestamptz,

  created_at       timestamptz default now()
);

create index km_entries_user_date    on km_entries (user_id, date desc);
create index km_entries_client       on km_entries (client_id);
create index km_entries_invoice      on km_entries (invoice_id);

alter table km_entries enable row level security;

create policy "Users can read own km entries"
  on km_entries for select using (auth.uid() = user_id);

create policy "Users can insert own km entries"
  on km_entries for insert with check (auth.uid() = user_id);

create policy "Users can update own km entries"
  on km_entries for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own km entries"
  on km_entries for delete using (auth.uid() = user_id);

-- Add km_rate override to clients
alter table clients add column if not exists km_rate integer;

-- Add default km rate to profiles
alter table profiles add column if not exists default_km_rate integer;
