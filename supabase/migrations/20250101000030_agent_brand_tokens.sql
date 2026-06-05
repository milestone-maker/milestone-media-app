-- ============================================================
-- 030: Stage 6b — per-agent brand color/font tokens
-- ============================================================
-- Adds the agent-chosen brand tokens used by the carousel composer
-- (Style B). Maps to DEFAULT_BRAND_TOKENS in
-- src/views/Content/carouselCompose.js:
--   brand_bg_color      → bgColor
--   brand_text_color    → textColor
--   brand_muted_color   → mutedColor
--   brand_accent_color  → accentColor
--   brand_font_headline → fontHeadline
--   brand_font_body     → fontBody
--
-- logoUrl reuses the existing agents.agency_logo_url column — NOT added here.
--
-- Additive + nullable: null means "use the Milestone default", so existing
-- agents are unaffected. add column if not exists → safe to re-run. No RLS
-- change — the existing agents policies (owner select/update, admin) already
-- cover these columns.
-- ============================================================

alter table public.agents
  add column if not exists brand_bg_color      text,
  add column if not exists brand_text_color    text,
  add column if not exists brand_muted_color   text,
  add column if not exists brand_accent_color  text,
  add column if not exists brand_font_headline text,
  add column if not exists brand_font_body     text;
