-- ============================================================
-- 013: Booking-side credit tracking
-- ============================================================
-- Adds two columns to bookings so we can audit when a subscription
-- credit replaced a transactional charge:
--   credit_consumed    — true if this booking burned a credit
--   credit_ledger_id   — fk to the credit_ledger row that was
--                        decremented; nullable, set null on delete so
--                        purging a ledger row does not orphan bookings.
--
-- Writes are made by the server-mediated booking endpoint
-- (api/create-booking.js) using the service-role key. The endpoint
-- does the conditional ledger decrement before the booking insert.

-- DEV-RESET BLOCK (REMOVE ONCE LOCKED) ─────────────────────────────────
-- Drops the columns so this migration can be re-run cleanly while
-- iterating. Once the credit-aware booking flow is in production,
-- delete this block and rely on the `add column if not exists` lines
-- below.
alter table public.bookings drop column if exists credit_consumed;
alter table public.bookings drop column if exists credit_ledger_id;
-- END DEV-RESET BLOCK ─────────────────────────────────────────────────

alter table public.bookings
  add column if not exists credit_consumed boolean not null default false;

alter table public.bookings
  add column if not exists credit_ledger_id uuid
    references public.credit_ledger(id) on delete set null;

create index if not exists bookings_credit_ledger_id_idx
  on public.bookings (credit_ledger_id)
  where credit_ledger_id is not null;
