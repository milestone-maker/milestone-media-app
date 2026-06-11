-- ============================================================
-- 038: Microsite retirement foundation (live-cap step 1)
-- ============================================================
-- Foundation for the per-tier "live microsite" cap (Solo 4 / Team 8 /
-- Brokerage 16). A cap on CONCURRENT live microsites needs two things a
-- microsite can't express today:
--   1. an explicit "retired / taken down / sold" marker that is distinct
--      from merely un-publishing, so the count of live sites is exact, and
--   2. a fast per-agent count, because step 2 counts an agent's live
--      microsites on every publish.
--
-- ── THE CANONICAL "LIVE" DEFINITION ────────────────────────────────────
-- A microsite is LIVE when:  published = true AND retired_at IS NULL.
-- This SQL predicate is the third-layer mirror of the JS helper
-- isMicrositeLive() / MICROSITE_LIVE_SQL in shared/micrositeAccess.js.
-- Keep the two in sync.
--
-- Design decisions:
--   • retired_at nullable + additive: existing rows stay null → every
--     currently-published microsite remains LIVE with no backfill. Setting
--     retired_at (via /api/retire-microsite) is what frees a slot.
--   • Retiring NEVER deletes: the row, its slug, and property_data survive
--     so the owner can re-publish/edit via the existing publish path. The
--     publish endpoint clears retired_at (sets it back to NULL) on every
--     (re)publish, so a re-published microsite becomes LIVE again and is
--     counted against the cap — consistent with the LIVE definition.
--     /api/retire-microsite is the only writer that SETS retired_at.
--   • agent_id index: the report noted microsites had no agent_id index;
--     step 2 counts live microsites per agent on every publish, so add one.
--   • add column / create index if not exists → safe to re-run. Additive
--     only — no DROPs.
-- ============================================================

-- ── 1. Retirement marker ─────────────────────────────────────────────
alter table public.microsites
  add column if not exists retired_at timestamptz;

comment on column public.microsites.retired_at is
  'When the microsite was retired ("mark sold / take down"). NULL = not retired. A microsite is LIVE when published = true AND retired_at IS NULL. Set by /api/retire-microsite; never cleared (re-publish restores LIVE via published = true). Added in live-cap step 1 (migration 038).';

-- ── 2. Per-agent index (live-microsite count on every publish) ───────
create index if not exists microsites_agent_id_idx
  on public.microsites (agent_id);
