-- ============================================================
-- 037: bundle.social Stage 3c — social_posts.canceled_at
-- ============================================================
-- Stage 3c lets an agent cancel a still-upcoming scheduled post. Cancellation
-- is recorded as a timestamp here rather than a new status value, so we do NOT
-- have to touch the existing status CHECK (migration 034) and we keep full
-- history: a canceled row stays status 'submitted' with its bundle_post_id,
-- plus a non-null canceled_at marking when the agent pulled it.
--
-- Design decisions:
--   • Nullable + additive: null means "not canceled" (every existing row).
--     No backfill — historical rows were never canceled.
--   • NO constraint changes, NO DROPs. The status vocabulary is untouched;
--     canceled-ness is a separate, orthogonal fact (a submitted post can be
--     canceled; a failed/pending one cannot).
--   • Set by api/social-cancel.js ONLY after bundle confirms the delete, so a
--     non-null canceled_at always means bundle actually dropped the post.
--   • add column if not exists → safe to re-run. No RLS change: the existing
--     social_posts policies (migration 034) already cover this column.
-- ============================================================

alter table public.social_posts
  add column if not exists canceled_at timestamptz;

comment on column public.social_posts.canceled_at is
  'When the agent canceled this scheduled post (UTC). Null = not canceled. Set by api/social-cancel.js only after bundle.social confirms the delete; the row keeps status ''submitted'' + bundle_post_id for history. Added in Stage 3c (migration 037).';
