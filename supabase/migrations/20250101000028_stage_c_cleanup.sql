-- ============================================================
-- 028: Stage C cleanup — remove junk/stale/curated-out properties
-- ============================================================
-- DESTRUCTIVE but tightly scoped: deletes 4 named microsites and 3
-- listings by exact slug / id (no wildcards). Re-verified read-only
-- immediately before authoring — every target's attached data is shown
-- below. Microsites are deleted BEFORE listings so the
-- microsites.listing_id → listings ON DELETE CASCADE never fires
-- unexpectedly (each microsite is already gone before its listing is
-- removed). Microsite deletes are additionally scoped to the owning
-- agent (637bb62a) as a safety guard against same-named slugs.
--
-- DOES NOT touch: bookings, booking_media, the Locust demo
-- (microsite 2410-luxury / listing 6310407f — 12 leads, 12 chat
-- conversations, 3 comps, 1 generated_content) or Shores
-- (microsite 4941-shores-57402083 / listing 792d4070). Prior migrations
-- are not edited.
--
-- ── Microsites deleted (all verified: 0 leads, 0 chat_settings,
--    0 chat_conversations, 0 chat_messages, 0 comps) ──
--   your-listing      (id f5e4d83a…) listing_id NULL  — empty placeholder
--   3124-patton       (id ccdc375c…) listing_id NULL  — real photos but no
--                                                        listing link; curated out
--   2410-foxtrail     (id 2dabbfa4…) listing_id 08ab7829…
--   2410-prosperity   (id 2d90bb13…) listing_id b2e7f096…
--   (leads.microsite_id → microsites is ON DELETE SET NULL, but there are
--    no leads on any of these anyway; chat_* and comps cascade, all zero.)
--
-- ── Listings deleted (verified leads_by_listing = 0 for all) ──
--   08ab7829-c8e1-4afa-8820-171f6d7a82c9  2410 Foxtrail Dr. 4/2/2500
--                                         (was linked from 2410-foxtrail)
--                                         generated_content cascade: 0
--   0ec50715-a70c-444a-9a61-035312903453  2410 Foxtrail Dr. 2/1/1500
--                                         (stale standalone, no microsite)
--                                         generated_content cascade: 2  ← known/expected
--   b2e7f096-6fa8-4ef1-a558-08c47f9b9844  2410 Prosperity Dr 4/3.5/3,840
--                                         (was linked from 2410-prosperity)
--                                         generated_content cascade: 0
-- ============================================================

-- ── 1. Delete the 4 microsites first (by exact slug, agent-scoped) ──
delete from public.microsites
where agent_id = '637bb62a-1479-45c4-a8c2-cd3957402083'
  and slug in ('your-listing', '3124-patton', '2410-foxtrail', '2410-prosperity');

-- ── 2. Delete the 3 listings by exact id ──
--    (0ec50715 cascade-deletes its 2 generated_content rows — expected.)
delete from public.listings
where id in (
  '08ab7829-c8e1-4afa-8820-171f6d7a82c9',
  '0ec50715-a70c-444a-9a61-035312903453',
  'b2e7f096-6fa8-4ef1-a558-08c47f9b9844'
);
