-- ════════════════════════════════════════════════════════════
-- 005_invoice_protection.sql
-- Closes two gaps left by 001_timelog.sql / 004_km_entries.sql:
--
-- 1. The update/delete policies on entries and km_entries never
--    checked invoice_id, so an authenticated user could edit or
--    delete a row after it had been invoiced (only the UI hid the
--    buttons — the API had no guard).
-- 2. Even with that fixed, users still had column-level UPDATE
--    rights on invoice_id/invoiced_at, letting them un-invoice (or
--    fake-invoice) their own rows directly. Column privileges are
--    layered on top of RLS to stop that regardless of policy.
--
-- Run after 004_km_entries.sql.
-- ════════════════════════════════════════════════════════════

-- ── entries ──────────────────────────────────────────────────
drop policy if exists "Users can update own entries" on entries;
drop policy if exists "Users can delete own entries" on entries;

create policy "Users can update own uninvoiced entries"
  on entries for update
  using (auth.uid() = user_id and invoice_id is null)
  with check (auth.uid() = user_id);

create policy "Users can delete own uninvoiced entries"
  on entries for delete
  using (auth.uid() = user_id and invoice_id is null);

revoke update on entries from authenticated;
grant update (name, date, time_from, time_until, minutes, crosses_midnight, client_id)
  on entries to authenticated;

-- ── km_entries ───────────────────────────────────────────────
drop policy if exists "Users can update own km entries" on km_entries;
drop policy if exists "Users can delete own km entries" on km_entries;

create policy "Users can update own uninvoiced km entries"
  on km_entries for update
  using (auth.uid() = user_id and invoice_id is null)
  with check (auth.uid() = user_id);

create policy "Users can delete own uninvoiced km entries"
  on km_entries for delete
  using (auth.uid() = user_id and invoice_id is null);

revoke update on km_entries from authenticated;
grant update (client_id, date, from_location, to_location, kilometres, is_round_trip, notes)
  on km_entries to authenticated;

-- invoice_id / invoiced_at remain writable only by the service role
-- (the invoice function in the separate invoices repo), which bypasses
-- RLS and column grants entirely.
