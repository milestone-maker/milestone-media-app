-- ============================================================
-- 035: bundle.social Stage 3a — social_posts.scheduled_for
-- ============================================================
-- Stage 3a (manual scheduling) lets an agent pick a future date/time for a
-- carousel post instead of posting immediately. This adds the single column
-- needed to record the intended publish time on the tracking row written by
-- api/social-post.js.
--
-- Design decisions:
--   • scheduled_for is the effective postDate handed to bundle (status
--     "SCHEDULED" for both immediate and future posts — bundle has no
--     "publish now" status, so immediate = SCHEDULED at now + small buffer).
--     For an immediate post this is ≈ now + buffer; for a scheduled post it
--     is the agent's chosen future time. Always stored in UTC (timestamptz).
--   • Nullable + additive: no shipped code reads it yet, and existing rows
--     (written before this column) simply stay null. No backfill — historical
--     rows have no meaningful scheduled time.
--   • add column if not exists → safe to re-run. No RLS change: the existing
--     social_posts policies (migration 034, owner by agent_id = auth.uid()
--     plus admin via is_admin()) already cover this column.
--   • Additive only — no DROPs.
-- ============================================================

alter table public.social_posts
  add column if not exists scheduled_for timestamptz;

comment on column public.social_posts.scheduled_for is
  'Effective postDate handed to bundle.social for this attempt (UTC). ~now+buffer for an immediate post, or the agent-chosen future time for a scheduled post. Nullable; set by api/social-post.js. Added in Stage 3a (migration 035).';
