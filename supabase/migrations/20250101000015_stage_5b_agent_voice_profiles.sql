-- ============================================================
-- 015: Stage 5b — agent_voice_profiles
-- ============================================================
-- Creates the table that stores per-agent voice configuration
-- consumed by @milestone-maker/content-engine. Schema is locked in
-- docs/stage-5b-agent-voice-profile-schema.md.
--
-- Design decisions:
--   • Multiple voice profiles per agent (FK, not 1:1).
--   • Enum-style lists stored as plain text[]; validation lives in
--     application code, not as DB CHECK constraints.
--   • license_number nullable; Texas-specific requirement is enforced
--     in app code.
--   • framework_weights_inferred / _override as JSONB.
--   • updated_at column present but no trigger — application code
--     sets it on write. Matches project convention (no shared
--     handle_updated_at function exists today).
--   • RLS policies mirror the bookings table pattern. Admin uses the
--     existing public.is_admin() helper.
-- ============================================================

create table public.agent_voice_profiles (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references public.agents(id) on delete cascade,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),

  -- Identity
  display_name       text not null,
  full_name          text not null,
  brokerage_name     text not null,
  brokerage_tagline  text,
  license_number     text,
  headshot_url       text,

  -- Market focus
  primary_metro            text   not null,
  primary_neighborhoods    text[] not null,
  secondary_neighborhoods  text[],
  property_type_focus      text[] not null,

  -- Specialization and references
  specialization_tags  text[] not null,
  reference_accounts   jsonb  not null,

  -- Voice slots
  hook_lines        text[] not null,
  take_lines        text[] not null,
  cta_verbs         text[] not null,
  tone_descriptors  text[] not null,
  phrases_to_avoid  text[],

  -- Hashtag pools
  hashtag_pool_hyper_local      text[] not null,
  hashtag_pool_niche_feature    text[] not null,
  hashtag_pool_broad_industry   text[] not null,
  hashtag_pool_action           text[] not null,

  -- Framework weights
  framework_weights_inferred  jsonb not null default '{}'::jsonb,
  framework_weights_override  jsonb,

  -- Social handles
  social_instagram     text,
  social_facebook_url  text,
  social_threads       text,
  social_linkedin_url  text
);

comment on table public.agent_voice_profiles is
  'Per Stage 5b schema doc (docs/stage-5b-agent-voice-profile-schema.md). Stores agent voice configuration consumed by @milestone-maker/content-engine.';

create index idx_agent_voice_profiles_agent
  on public.agent_voice_profiles(agent_id);

alter table public.agent_voice_profiles enable row level security;

create policy "Agents can view own voice profiles"
  on public.agent_voice_profiles for select
  using (agent_id = auth.uid());

create policy "Agents can insert own voice profiles"
  on public.agent_voice_profiles for insert
  with check (agent_id = auth.uid());

create policy "Agents can update own voice profiles"
  on public.agent_voice_profiles for update
  using (agent_id = auth.uid());

create policy "Agents can delete own voice profiles"
  on public.agent_voice_profiles for delete
  using (agent_id = auth.uid());

create policy "Admins can manage all voice profiles"
  on public.agent_voice_profiles for all
  using (public.is_admin());
