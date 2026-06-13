-- ============================================================
-- 042: Microsite "sold" foundation (sold-pages step 1)
-- ============================================================
-- A SOLD listing is different from a WITHDRAWN (retired) one: a sold property
-- should keep a public, INDEXABLE page (a "Sold" page is good SEO and a proof
-- point for the agent), whereas retiring takes the page down (404 + noindex).
-- Today the single "Mark sold / take down" action only sets published=false +
-- retired_at, which collapses sold and withdrawn into the same un-indexed
-- take-down with no sale data. This migration adds the two columns a sold page
-- needs, additively.
--
-- ── THE STATE MODEL (precedence: withdrawn > sold > live) ──────────────
--   WITHDRAWN  retired_at IS NOT NULL                         → 404 + noindex
--   SOLD       sold_at IS NOT NULL (and not withdrawn)        → public SOLD page, indexable
--   LIVE       published = true (and neither above)           → normal page
--   DRAFT      otherwise (unpublished)                        → 404 + noindex
-- A SOLD row KEEPS published = true (it stays publicly served, just marked sold).
--
-- ── Interaction with the live-cap "LIVE" definition ───────────────────
-- The canonical STRICTLY-live predicate becomes:
--   published = true AND retired_at IS NULL AND sold_at IS NULL
-- (mirrored in shared/micrositeAccess.js isMicrositeLive / MICROSITE_LIVE_SQL).
-- So marking a listing sold FREES the agent's live-cap slot, same as retiring —
-- but unlike retiring, the page stays up and indexable. Sitemap and the FB/
-- Content URL resolvers intentionally key off (published=true AND retired_at IS
-- NULL), so they CONTINUE to include sold pages.
--
-- Design decisions:
--   • Both columns nullable + additive: existing rows stay sold_at = NULL →
--     every currently-live microsite is unaffected, no backfill.
--   • sold_price is TEXT to match how list price is stored in property_data
--     (free-form, e.g. "1,500,450"). NULL = undisclosed → the sold page omits
--     price rather than implying the list price was the sale price.
--   • add column if not exists → safe to re-run. Additive only — no DROPs.
-- ============================================================

-- ── 1. Sold markers ──────────────────────────────────────────────────
alter table public.microsites
  add column if not exists sold_at timestamptz;

alter table public.microsites
  add column if not exists sold_price text;

comment on column public.microsites.sold_at is
  'When the listing was marked sold. NULL = not sold. A SOLD microsite keeps published=true and is served as a public, indexable "Sold" page (see api/render-microsite.js); it is NOT strictly LIVE (frees a live-cap slot). Distinct from retired_at, which takes the page down (404 + noindex). Added in sold-pages step 1 (migration 042).';

comment on column public.microsites.sold_price is
  'Optional sale price for the sold page, stored as free-form TEXT to match list price (e.g. "1,500,450"). NULL = undisclosed → the sold page omits price. Added in sold-pages step 1 (migration 042).';
