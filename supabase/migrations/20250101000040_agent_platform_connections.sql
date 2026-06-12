-- ============================================================
-- 040: bundle.social — agent_platform_connections (multi-platform)
-- ============================================================
-- Facebook Stage 1 of 3 — multi-platform connection foundation.
--
-- The original public.agent_social_connections (migration 032) is ONE row
-- per agent (agent_id UNIQUE) and Instagram-only by construction: it holds a
-- single bundle_team_id + a single connection_status/username. To let an agent
-- connect MULTIPLE networks (Instagram + Facebook + later Threads) WITHOUT
-- dropping that table or its UNIQUE, this migration adds a NEW companion table
-- keyed by (agent_id, platform) and backfills the existing Instagram rows into
-- it. The legacy table is left fully in place (still read by api/social-post.js
-- this stage) — additive only, no DROPs.
--
-- Design decisions:
--   • New table, NOT an ALTER of agent_social_connections: dropping the
--     agent_id-UNIQUE there would be a destructive schema change and would
--     break the legacy 1:1 upsert path that the posting endpoint still relies
--     on. A parallel table is purely additive and reversible.
--   • One row per (agent_id, platform): UNIQUE (agent_id, platform) so the
--     connect endpoint can upsert a single network's state without touching
--     the others. An agent still maps to exactly ONE bundle "team"; that team
--     can hold several platform accounts, so bundle_team_id is the SAME value
--     across an agent's rows (denormalized per row so each platform row is
--     self-contained and the team id is reachable from any platform).
--   • platform CHECK ('instagram','facebook','threads') mirrors the
--     social_posts.platform vocabulary (migration 036) so the two never drift.
--   • connection_status CHECK ('none','pending','connected','error') is copied
--     verbatim from agent_social_connections (032) — same UI-driving states.
--   • RLS policies mirror agent_social_connections (032) EXACTLY: self-access
--     scoped by agent_id = auth.uid(), admin via the existing public.is_admin().
--   • updated_at present but no trigger — application code sets it on write
--     (matches project convention; no shared handle_updated_at()).
--   • Backfill copies each existing agent_social_connections row as
--     platform='instagram' (team id, status, username, timestamps preserved)
--     so already-connected agents see Instagram connected immediately. ON
--     CONFLICT DO NOTHING makes the backfill idempotent if re-run.
--   • Additive only — no DROPs. gen_random_uuid() PK (project convention).
-- ============================================================

create table if not exists public.agent_platform_connections (
  id                 uuid primary key default gen_random_uuid(),
  agent_id           uuid not null references public.agents(id) on delete cascade,

  platform           text not null
                     check (platform in ('instagram', 'facebook', 'threads')),

  bundle_team_id     text,
  connection_status  text not null default 'none'
                     check (connection_status in ('none', 'pending', 'connected', 'error')),
  connected_username text,
  connected_at       timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (agent_id, platform)
);

comment on table public.agent_platform_connections is
  'Per-agent, per-platform bundle.social connection state (Facebook Stage 1). One row per (agent_id, platform); records the agent''s bundle team id and that network''s connection status. Companion to the legacy 1:1 agent_social_connections (migration 032), which is retained and still read by api/social-post.js. Written by the api/social-connect and api/social-status service-role endpoints.';

create index if not exists idx_agent_platform_connections_agent
  on public.agent_platform_connections(agent_id);

alter table public.agent_platform_connections enable row level security;

create policy "Agents can view own platform connection"
  on public.agent_platform_connections for select
  using (agent_id = auth.uid());

create policy "Agents can insert own platform connection"
  on public.agent_platform_connections for insert
  with check (agent_id = auth.uid());

create policy "Agents can update own platform connection"
  on public.agent_platform_connections for update
  using (agent_id = auth.uid());

create policy "Agents can delete own platform connection"
  on public.agent_platform_connections for delete
  using (agent_id = auth.uid());

create policy "Admins can manage all platform connections"
  on public.agent_platform_connections for all
  using (public.is_admin());

-- ── Backfill: legacy Instagram rows → new per-platform table ──────────
-- Each existing agent_social_connections row becomes the agent's
-- platform='instagram' row, preserving team id, status, username, and
-- timestamps. Idempotent via ON CONFLICT (agent_id, platform) DO NOTHING.
insert into public.agent_platform_connections
  (agent_id, platform, bundle_team_id, connection_status,
   connected_username, connected_at, created_at, updated_at)
select
  agent_id,
  'instagram'        as platform,
  bundle_team_id,
  connection_status,
  connected_username,
  connected_at,
  created_at,
  updated_at
from public.agent_social_connections
on conflict (agent_id, platform) do nothing;
