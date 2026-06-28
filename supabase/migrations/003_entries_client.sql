-- ════════════════════════════════════════════════════════════
-- 003_entries_client.sql
-- Adds client_id to entries table.
-- Run AFTER 002_invoices.sql (which creates the clients table).
-- ════════════════════════════════════════════════════════════

alter table entries
  add column if not exists client_id uuid references clients(id);

create index if not exists entries_client on entries (client_id);
