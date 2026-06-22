-- ============================================================
-- 052: LinkedIn — platform vocabulary + sticky channel column
-- ============================================================
-- Adds 'linkedin' to the controlled platform vocabulary on the two tables
-- that gate connections + posts, and adds a nullable column to remember the
-- agent's last-picked LinkedIn channel (sticky default for the "Post as"
-- picker).
--
-- Why a channel id? bundle.social models LinkedIn as ONE social account per
-- connect (their /social-account/by-type returns a single object), but that
-- account carries a channels[] array — the personal profile plus each
-- admined company page. Posting to a specific target requires calling
-- POST /api/v1/social-account/set-channel { type:"LINKEDIN", teamId, channelId }
-- *before* /post/. The chosen channelId is sticky per agent so the picker
-- can preselect the agent's last target; it stays user-overridable per post.
--
-- Design decisions:
--   • CHECK is a NAMED constraint so this migration can drop+recreate it
--     idempotently. The original (migration 040) declared the CHECK inline,
--     which Postgres autonames as <table>_<column>_check. We drop that exact
--     name `IF EXISTS` and add a named constraint so future widenings are
--     trivial (drop the named one, add a new named one). Same pattern for
--     social_posts (migration 036).
--   • bundle_channel_id is nullable text (mirrors bundle_team_id's nullability
--     and type). It is meaningful ONLY for the linkedin row of an agent — IG
--     and FB rows leave it null. No CHECK enforcing that because the column is
--     optional everywhere; the application writes it only for linkedin.
--   • No backfill needed: existing rows are IG/FB; linkedin rows will be born
--     with the column null and populated on the first post that names a target.
--   • Additive only — no DROPs of columns or tables.
-- ============================================================

-- 1. Widen the platform CHECK on agent_platform_connections to allow 'linkedin'.
--    The original CHECK from migration 040 was declared inline; Postgres
--    auto-named it `agent_platform_connections_platform_check`.
alter table public.agent_platform_connections
  drop constraint if exists agent_platform_connections_platform_check;

alter table public.agent_platform_connections
  add constraint agent_platform_connections_platform_check
  check (platform in ('instagram', 'facebook', 'threads', 'linkedin'));

-- 2. Mirror the same widening on social_posts (migration 036 set the same
--    vocabulary inline so the two never drift).
alter table public.social_posts
  drop constraint if exists social_posts_platform_check;

alter table public.social_posts
  add constraint social_posts_platform_check
  check (platform in ('instagram', 'facebook', 'threads', 'linkedin'));

-- 3. Sticky LinkedIn channel id on the connection row.
alter table public.agent_platform_connections
  add column if not exists bundle_channel_id text;

comment on column public.agent_platform_connections.bundle_channel_id is
  'For platform=''linkedin'' rows: the bundle.social channel id (personal profile or admined company page) the agent last posted to. Used as the sticky default for the "Post as" picker; user-overridable per post. Null for IG/FB rows (bundle does not require a channel pre-selection for those). Added in migration 052.';
