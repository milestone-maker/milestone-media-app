-- ============================================================
-- 036: bundle.social Stage 3b — social_posts.platform
-- ============================================================
-- Stage 3b (smart scheduling) is platform-aware: recommended posting windows
-- differ per network. This records which network a tracking row targeted so
-- (a) per-platform analytics later can group by it and (b) the recommended-slot
-- engine has a column to key against. Today every post is Instagram, so the
-- column defaults to 'instagram' and existing rows take that default.
--
-- Design decisions:
--   • DEFAULT 'instagram' NOT NULL: every shipped post so far is Instagram, so
--     the default is correct for historical rows and we avoid a nullable column
--     the app would have to defend against. api/social-post.js sets it
--     explicitly going forward.
--   • CHECK ('instagram','facebook','threads'): a controlled vocabulary that
--     drives engine + (later) analytics behavior, matching the status /
--     connection_status CHECK pattern (migrations 034 / 032). facebook and
--     threads are listed now as forward hooks even though no slots exist yet.
--   • Additive only — no DROPs. No index (low-cardinality, small table; the
--     existing (agent_id, created_at desc) index already serves the listing).
-- ============================================================

alter table public.social_posts
  add column if not exists platform text not null default 'instagram'
    check (platform in ('instagram', 'facebook', 'threads'));

comment on column public.social_posts.platform is
  'Social network this carousel attempt targeted. Default ''instagram'' (every shipped post to date). Controlled vocabulary (instagram/facebook/threads) — facebook/threads are forward hooks for Stage 3b smart scheduling + later per-platform analytics. Added in migration 036.';
