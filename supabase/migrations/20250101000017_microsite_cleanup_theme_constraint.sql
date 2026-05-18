-- ============================================================
-- 017: Microsite cleanup — formalize theme constraint drift
-- ============================================================
-- The original migration set (003 microsites_upgrade through 014
-- microsite_entitlement_subscription) never touched microsites_theme_check.
-- The original constraint from schema.sql allowed only
-- ('Obsidian', 'Ivory', 'Slate', 'Blush'). At some point the live DB was
-- ALTER'd via the Supabase dashboard to allow the 14 themes the UI
-- catalog (src/lib/ui.jsx THEMES) actually offers. No migration captured
-- that change.
--
-- This migration backfills that drift into version control. The 14
-- theme names below are the exact set in src/lib/ui.jsx today and
-- match the live DB constraint as confirmed by:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.microsites'::regclass
--     AND conname = 'microsites_theme_check';
--
-- 'Blush' is intentionally NOT in the new set — it was removed from both
-- the live DB and the UI catalog as part of the same cleanup pass.
--
-- Idempotent: DROP IF EXISTS, then ADD. Safe to re-run. No-op against
-- current live state.
-- ============================================================

alter table public.microsites
  drop constraint if exists microsites_theme_check;

alter table public.microsites
  add constraint microsites_theme_check
  check (theme in (
    'Prestige', 'Dusk', 'Noir', 'Obsidian', 'Slate', 'Loft', 'Ember',
    'Maison', 'Classic', 'Ivory', 'Blanc', 'Coastal', 'Grove', 'Sage'
  ));
