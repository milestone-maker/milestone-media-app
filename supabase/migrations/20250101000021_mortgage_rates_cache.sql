-- ============================================================
-- 021: Stage 4 — mortgage rates cache (shared, national figure)
-- ============================================================
-- Backs /api/refresh-mortgage-rates and (in a later sub-step) the
-- microsite chat system prompt. One row per weekly Freddie Mac PMMS
-- survey, pulled from the St. Louis Fed FRED API. The figure is a
-- single national value shared across ALL microsites — it is NOT
-- per-microsite, so this table has no microsite_id.
--
-- Design decisions (follow migration 020's additive philosophy):
--   • gen_random_uuid() everywhere (consistent with recent migrations).
--   • create table IF NOT EXISTS → safe to re-run.
--   • Append-only: one row per survey week. The unique constraint on
--     as_of_date makes re-inserts of the same survey week idempotent
--     (the refresh job select-by-date first, but the constraint is the
--     hard guarantee).
--   • NO DROPs, no destructive statements. Brand-new isolated table;
--     invisible to the app until the chat endpoint reads it later.
--   • Written by the service-role client only (the cron/refresh
--     endpoint). RLS is enabled as defense-in-depth; anon may SELECT
--     the (non-sensitive, public) rate figure for completeness, but
--     the chat endpoint reads it via the service-role client anyway.
-- ============================================================

-- ── mortgage_rates ──────────────────────────────────────────────────
create table if not exists public.mortgage_rates (
  id          uuid primary key default gen_random_uuid(),
  as_of_date  date not null,
  rate_30yr   numeric not null,
  rate_15yr   numeric not null,
  source      text not null default 'Freddie Mac PMMS via FRED',
  fetched_at  timestamptz not null default now()
);

-- One row per survey week → idempotent weekly refresh.
create unique index if not exists uq_mortgage_rates_as_of_date
  on public.mortgage_rates (as_of_date);

alter table public.mortgage_rates enable row level security;

-- The national rate figure is public information; allow anon SELECT.
-- (Writes are service-role only — no insert/update/delete policy.)
drop policy if exists "Public can view mortgage rates" on public.mortgage_rates;
create policy "Public can view mortgage rates"
  on public.mortgage_rates for select
  using (true);
