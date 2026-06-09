-- ============================================================
-- 032: bundle.social — agent_social_connections
-- ============================================================
-- Stage 1 of the bundle.social posting integration: per-agent social
-- connection state. Each agent maps to exactly ONE bundle "team"; the
-- agent connects their own Instagram through bundle's hosted portal.
-- This table records that team id and the resulting connection status so
-- the app can render "Connect" vs "Connected (@handle)" without calling
-- bundle on every page load.
--
-- Design decisions:
--   • Dedicated table, NOT columns on agents — connection has its own
--     lifecycle (none → pending → connected/error) distinct from the
--     agent profile, and keeps the bundle integration self-contained.
--   • One row per agent: agent_id is UNIQUE (1:1). The server upserts on
--     agent_id, so a retried connect never creates a second bundle team.
--   • bundle_team_id is the id returned by POST /api/v1/team/. Nullable
--     only transiently — set on first connect; once set it is reused.
--   • connection_status is a controlled vocabulary; a CHECK constraint
--     enforces the four allowed values (this column drives UI state, so a
--     bad value would mis-render — worth a DB guard here even though most
--     project enums live in app code).
--   • connected_username / connected_at populated from bundle's
--     social-account record once an Instagram account is connected.
--   • updated_at present but no trigger — application code sets it on
--     write (matches project convention; no shared handle_updated_at()).
--   • RLS policies mirror public.agent_voice_profiles (migration 015) and
--     public.generated_content (migration 025) EXACTLY: self-access scoped
--     by agent_id = auth.uid(), admin via the existing public.is_admin().
--   • Additive only — no DROPs. gen_random_uuid() PK (project convention).
-- ============================================================

create table public.agent_social_connections (
  id                 uuid primary key default gen_random_uuid(),
  agent_id           uuid not null unique references public.agents(id) on delete cascade,

  bundle_team_id     text,
  connection_status  text not null default 'none'
                     check (connection_status in ('none', 'pending', 'connected', 'error')),
  connected_username text,
  connected_at       timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.agent_social_connections is
  'Per-agent bundle.social connection state (Stage 1). One row per agent (agent_id unique); records the agent''s bundle team id and Instagram connection status. Written by the api/social-connect and api/social-status service-role endpoints.';

create index idx_agent_social_connections_agent
  on public.agent_social_connections(agent_id);

alter table public.agent_social_connections enable row level security;

create policy "Agents can view own social connection"
  on public.agent_social_connections for select
  using (agent_id = auth.uid());

create policy "Agents can insert own social connection"
  on public.agent_social_connections for insert
  with check (agent_id = auth.uid());

create policy "Agents can update own social connection"
  on public.agent_social_connections for update
  using (agent_id = auth.uid());

create policy "Agents can delete own social connection"
  on public.agent_social_connections for delete
  using (agent_id = auth.uid());

create policy "Admins can manage all social connections"
  on public.agent_social_connections for all
  using (public.is_admin());
