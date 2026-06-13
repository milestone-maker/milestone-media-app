-- ============================================================
-- 044: White-label Gap 2 — opt-in toggle for brand colors on listing pages
-- ============================================================
-- Adds the per-agent on/off switch that governs whether the agent's brand color
-- tokens (brand_bg_color / brand_text_color / brand_muted_color /
-- brand_accent_color from migration 030) override the selected THEME catalog
-- colors on their published listing pages (/p/{slug}).
--
-- Default FALSE preserves today's behavior exactly: every existing and unbranded
-- agent keeps the Milestone template colors. The published listing page reads
-- this flag (and the color tokens) from the property_data SNAPSHOT that
-- publish-microsite.js writes — the agents table is not anon-readable — so
-- NOTHING reads this column on the public path until a republish snapshots it
-- and the render override ships. Additive + default false → safe on the shared
-- DB. add column if not exists → safe to re-run. No RLS change: the existing
-- agents policies (owner select/update, admin) already cover this column.
-- ============================================================

alter table public.agents
  add column if not exists use_brand_colors boolean not null default false;
