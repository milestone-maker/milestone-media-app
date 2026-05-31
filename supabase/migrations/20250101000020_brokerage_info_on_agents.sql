-- ============================================================
-- 020: Stage 3 — brokerage info moves to the agents table
-- ============================================================
-- Stage 1 (migration 018) parked brokerage_about / brokerage_url on
-- agent_voice_profiles. That table is 1:many per agent and has a wall
-- of NOT NULL columns with no defaults, so there's no safe way for a
-- lightweight profile editor to create/seed a row just to hold two
-- optional brokerage fields. It also risks colliding with the Phase 5c
-- content-automation rows.
--
-- Resolution: the two brokerage fields live on public.agents, which is
-- 1:1 with auth.users, always exists for a signed-in agent, and has no
-- NOT NULL wall. The EditProfileModal (which already writes agents) owns
-- the editing UI; /api/microsite-chat reads brokerage_about from here.
--
-- Design decisions:
--   • Both columns nullable — brokerage info is optional.
--   • add column if not exists → safe to re-run.
--   • The unused columns on agent_voice_profiles are dropped here since
--     no code reads them anymore after the chat endpoint was repointed.
-- ============================================================

-- ── 1. agents: brokerage_about / brokerage_url ─────────────────────
alter table public.agents
  add column if not exists brokerage_about text;

alter table public.agents
  add column if not exists brokerage_url text;

-- ── 2. Drop the now-unused columns from agent_voice_profiles ───────
-- Added in migration 018; superseded by the agents columns above.
alter table public.agent_voice_profiles
  drop column if exists brokerage_about;

alter table public.agent_voice_profiles
  drop column if exists brokerage_url;
