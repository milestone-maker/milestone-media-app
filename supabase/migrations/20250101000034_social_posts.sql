-- ============================================================
-- 034: bundle.social Stage 2c — social_posts (post-status tracking)
-- ============================================================
-- One row per attempt to publish a generated carousel to Instagram via
-- bundle.social. Written by api/social-post.js: a 'pending' row is created
-- when a post request passes ownership + connection checks, then updated to
-- 'submitted' (with bundle's post id) on success or 'failed' (with a safe
-- error message) on a bundle upload/post failure.
--
-- Design decisions:
--   • Lightweight tracking — enough to show history/status and (later) poll
--     bundle for publish state; NOT a full mirror of bundle's post object.
--   • agent_id / content_id are hard FKs (cascade): a tracking row is
--     meaningless once the owning agent or the generated content is gone.
--   • status is a controlled vocabulary with a CHECK (drives UI), matching
--     the agent_social_connections.connection_status pattern (migration 032).
--   • bundle_post_id nullable — only set once bundle accepts the post.
--   • image_urls jsonb — the ordered public URLs handed to bundle, retained
--     for debugging/retry; nullable.
--   • updated_at present, no trigger — app code sets it on write (project
--     convention; no shared handle_updated_at()).
--   • RLS mirrors public.agent_social_connections (032) /
--     public.generated_content (025) EXACTLY: self-access by
--     agent_id = auth.uid(), admin via public.is_admin().
--   • Additive only; gen_random_uuid() PK (project convention). Additive to
--     the shared/live DB; nothing existing reads it.
-- ============================================================

create table public.social_posts (
  id             uuid primary key default gen_random_uuid(),
  agent_id       uuid not null references public.agents(id) on delete cascade,
  content_id     uuid not null references public.generated_content(id) on delete cascade,

  bundle_post_id text,
  status         text not null default 'pending'
                 check (status in ('pending', 'submitted', 'failed')),
  image_urls     jsonb,
  error_message  text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.social_posts is
  'Per-attempt tracking of carousel → Instagram posts via bundle.social (Stage 2c). Written by api/social-post.js: pending → submitted (with bundle_post_id) or failed (with error_message).';

create index idx_social_posts_agent_created
  on public.social_posts (agent_id, created_at desc);

alter table public.social_posts enable row level security;

create policy "Agents can view own social posts"
  on public.social_posts for select
  using (agent_id = auth.uid());

create policy "Agents can insert own social posts"
  on public.social_posts for insert
  with check (agent_id = auth.uid());

create policy "Agents can update own social posts"
  on public.social_posts for update
  using (agent_id = auth.uid());

create policy "Agents can delete own social posts"
  on public.social_posts for delete
  using (agent_id = auth.uid());

create policy "Admins can manage all social posts"
  on public.social_posts for all
  using (public.is_admin());
