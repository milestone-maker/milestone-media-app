-- ============================================================
-- 041: generated_content — (agent_id, platform, created_at) index
-- ============================================================
-- Facebook Stage 2 anti-repetition memory. api/content-generate.js now resolves
-- an agent's recent Facebook opening hooks with:
--
--   select hook_line from generated_content
--   where agent_id = $1 and platform = 'facebook'
--   order by created_at desc limit 12
--
-- The existing index idx_generated_content_agent_listing_created is
-- (agent_id, listing_id, created_at desc) — it leads with agent_id but places
-- listing_id (not platform) before created_at, so it cannot serve this
-- agent-wide, platform-filtered, recency-ordered scan without an extra sort.
-- This additive composite index matches the lookup exactly: equality on
-- (agent_id, platform) then a backward scan on created_at returns the newest
-- rows directly.
--
-- Design decisions:
--   • Additive only — no DROPs. The existing per-listing index stays (it serves
--     the History list, a different query).
--   • Column order (agent_id, platform, created_at desc) mirrors the WHERE +
--     ORDER BY so the planner can both seek and order from the index.
-- ============================================================

create index if not exists idx_generated_content_agent_platform_created
  on public.generated_content (agent_id, platform, created_at desc);
