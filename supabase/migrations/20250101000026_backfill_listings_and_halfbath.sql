-- ============================================================
-- 026: Stage B — half-bath fix + listings backfill
-- ============================================================
-- Two additive, idempotent changes. NO DROPs.
--
-- (1) HALF-BATH FIX: public.listings.baths integer → numeric, so
--     fractional baths ("3.5") survive. Non-destructive widening via a
--     USING cast (every existing integer is a valid numeric). Verified
--     read-only beforehand that NOTHING depends on the column's type:
--       • indexes on listings: only listings_pkey(id) and
--         idx_listings_agent(agent_id) — neither references baths;
--       • baths is is_generated = NEVER, no default, no generation expr;
--       • no views / materialized views depend on public.listings.
--     This ALTER runs BEFORE the backfill inserts so fractional baths
--     (e.g. 2410 Prosperity = 3.5) store correctly.
--
-- (2) BACKFILL: link published microsites that still have listing_id IS
--     NULL to a public.listings row, mirroring the Stage A helper
--     (api/_lib/listingFromMicrosite.js):
--       beds  → leading-integer ::int   (parseInt equivalent)
--       baths → leading-decimal ::numeric (parseFloat equivalent; .5 kept)
--       address/city/price/sqft/neighborhood/description/hero_img
--             → text passthrough (blank → NULL)
--       features → jsonb (coalesce to '[]')
--       status   → 'Live'
--       agent_id → the microsite's agent_id
--     Every microsite UPDATE is guarded on listing_id IS NULL, so this
--     migration is safe to re-run and will not touch already-linked rows
--     (e.g. 2410-luxury / 2410 Locust, linked by Stage A).
--
--     Actions (decided by the Stage B survey):
--       • CREATE + LINK : 4941-shores-57402083, 2410-prosperity  (agent 637bb62a)
--       • LINK ONLY     : 2410-foxtrail → existing listing
--                         08ab7829-c8e1-4afa-8820-171f6d7a82c9 (4/2/2500);
--                         no new listing (would duplicate the standalone
--                         Foxtrail listing).
--       • SKIP entirely : your-listing (empty property_data),
--                         2410-luxury-39504f1e (other agent / distinct),
--                         3124-patton (no beds/baths/sqft).
-- ============================================================

-- ── (1) Half-bath fix — must precede the inserts ──
alter table public.listings
  alter column baths type numeric using baths::numeric;

-- ── (2a) CREATE + LINK : 4941-shores-57402083 ──
with src as (
  select id as microsite_id, agent_id, property_data as pd
  from public.microsites
  where slug = '4941-shores-57402083' and listing_id is null
),
ins as (
  insert into public.listings
    (agent_id, address, city, price, beds, baths, sqft,
     neighborhood, description, features, hero_img, status)
  select
    agent_id,
    nullif(trim(pd->>'address'), ''),
    nullif(trim(pd->>'city'), ''),
    nullif(trim(pd->>'price'), ''),
    nullif(substring(pd->>'beds'  from '^\s*-?\d+'),          '')::int,
    nullif(substring(pd->>'baths' from '^\s*-?\d+(\.\d+)?'),  '')::numeric,
    nullif(trim(pd->>'sqft'), ''),
    nullif(trim(pd->>'neighborhood'), ''),
    nullif(trim(pd->>'description'), ''),
    coalesce(pd->'features', '[]'::jsonb),
    nullif(trim(pd->>'hero_img'), ''),
    'Live'
  from src
  returning id
)
update public.microsites m
set listing_id = ins.id
from ins
where m.slug = '4941-shores-57402083' and m.listing_id is null;

-- ── (2b) CREATE + LINK : 2410-prosperity (baths 3.5 survives) ──
with src as (
  select id as microsite_id, agent_id, property_data as pd
  from public.microsites
  where slug = '2410-prosperity' and listing_id is null
),
ins as (
  insert into public.listings
    (agent_id, address, city, price, beds, baths, sqft,
     neighborhood, description, features, hero_img, status)
  select
    agent_id,
    nullif(trim(pd->>'address'), ''),
    nullif(trim(pd->>'city'), ''),
    nullif(trim(pd->>'price'), ''),
    nullif(substring(pd->>'beds'  from '^\s*-?\d+'),          '')::int,
    nullif(substring(pd->>'baths' from '^\s*-?\d+(\.\d+)?'),  '')::numeric,
    nullif(trim(pd->>'sqft'), ''),
    nullif(trim(pd->>'neighborhood'), ''),
    nullif(trim(pd->>'description'), ''),
    coalesce(pd->'features', '[]'::jsonb),
    nullif(trim(pd->>'hero_img'), ''),
    'Live'
  from src
  returning id
)
update public.microsites m
set listing_id = ins.id
from ins
where m.slug = '2410-prosperity' and m.listing_id is null;

-- ── (2c) LINK ONLY : 2410-foxtrail → existing Foxtrail listing (no insert) ──
update public.microsites
set listing_id = '08ab7829-c8e1-4afa-8820-171f6d7a82c9'
where slug = '2410-foxtrail' and listing_id is null;
