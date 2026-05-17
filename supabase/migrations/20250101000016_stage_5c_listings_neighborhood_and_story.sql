-- ============================================================
-- 016: Stage 5c — listings.neighborhood + listings.story_angle
-- ============================================================
-- Adds two nullable text columns to public.listings to support the
-- Instagram listing prompt templates introduced in Stage 5c.
--
--   neighborhood — sub-city locale (e.g., "Lakewood", "Bishop Arts").
--                  Distinct from `city`, which is the municipality.
--                  Prompt templates prefer neighborhood, fall back to city.
--
--   story_angle  — short creative angle the caption is built around
--                  (e.g., "a porch that catches the late afternoon light").
--                  Per-listing default; request body can override at
--                  generation time without persisting.
--
-- No backfill — both columns are nullable; existing rows stay null.
-- ============================================================

alter table public.listings
  add column if not exists neighborhood text,
  add column if not exists story_angle  text;

comment on column public.listings.neighborhood is
  'Sub-city locale used by Stage 5c content prompts (preferred over city when present).';

comment on column public.listings.story_angle is
  'Creative angle for Stage 5c content prompts; request body may override at generation time.';
