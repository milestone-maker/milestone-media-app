-- ============================================================
-- 025: Content tab — generated_content
-- ============================================================
-- Persists each successful generation from /api/content-generate so an
-- agent can see a history of the captions/carousels produced for their
-- listings. Written by the endpoint's service-role client AFTER the model
-- output passes validation; the save is best-effort (a failed insert must
-- never deny the agent their generated content).
--
-- Design decisions:
--   • Additive only — no DROPs. gen_random_uuid() PK (project convention).
--   • agent_id / listing_id are hard FKs (cascade delete): history is
--     meaningless once the owning agent or listing is gone.
--   • voice_profile_id is a soft FK (on delete set null): a deleted voice
--     profile should not erase the historical content it produced.
--   • hashtags stored as text[] (matches the engine's hashtags[] output);
--     slides stored as jsonb and nullable (only the walkthrough_carousel
--     framework emits a slides array).
--   • license_number captured at generation time for the TREC compliance
--     line, denormalized so history reflects what was actually posted.
--   • created_at only — rows are immutable generation records; no
--     updated_at / trigger.
--   • RLS policies mirror public.agent_voice_profiles (migration 015)
--     exactly, scoped by agent_id = auth.uid(). Admin uses the existing
--     public.is_admin() helper.
-- ============================================================

create table public.generated_content (
  id                uuid primary key default gen_random_uuid(),
  agent_id          uuid not null references public.agents(id) on delete cascade,
  listing_id        uuid not null references public.listings(id) on delete cascade,
  voice_profile_id  uuid references public.agent_voice_profiles(id) on delete set null,

  platform          text not null default 'instagram',
  content_type      text not null default 'listing',
  framework_name    text not null,

  caption           text not null,
  hook_line         text,
  cta_line          text,
  hashtags          text[] not null default '{}',
  slides            jsonb,
  license_number    text,

  created_at        timestamptz not null default now()
);

comment on table public.generated_content is
  'History of successful /api/content-generate generations, one row per generated caption/carousel. Written by the endpoint service-role client after validation; best-effort save.';

-- Index for the per-agent, per-listing history list (newest first).
create index idx_generated_content_agent_listing_created
  on public.generated_content (agent_id, listing_id, created_at desc);

alter table public.generated_content enable row level security;

create policy "Agents can view own generated content"
  on public.generated_content for select
  using (agent_id = auth.uid());

create policy "Agents can insert own generated content"
  on public.generated_content for insert
  with check (agent_id = auth.uid());

create policy "Agents can update own generated content"
  on public.generated_content for update
  using (agent_id = auth.uid());

create policy "Agents can delete own generated content"
  on public.generated_content for delete
  using (agent_id = auth.uid());

create policy "Admins can manage all generated content"
  on public.generated_content for all
  using (public.is_admin());
