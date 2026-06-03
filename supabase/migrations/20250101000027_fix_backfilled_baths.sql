-- ============================================================
-- 027: Stage B fix — correct mis-stored baths from migration 026
-- ============================================================
-- Migration 026 backfilled two listings' baths using
--   substring(property_data->>'baths' from '^\s*-?\d+(\.\d+)?')
-- but Postgres substring(text FROM pattern) returns only the FIRST
-- capturing group, not the whole match. So the (\.\d+) group captured
-- the fractional part alone: "3.5" → ".5" → 0.5, and "5" → NULL.
--
-- This fix re-derives baths from the source microsite property_data
-- using regexp_match with a NON-capturing group, which returns the whole
-- matched number. Additive, no DROPs, idempotent (re-running yields the
-- same correct values). 026 is left untouched as the historical record.
--
-- Affected (linked) listings:
--   2410-prosperity        → 3.5
--   4941-shores-57402083   → 5
-- ============================================================

update public.listings l
set baths = (regexp_match(m.property_data->>'baths', '-?\d+(?:\.\d+)?'))[1]::numeric
from public.microsites m
where m.slug in ('4941-shores-57402083', '2410-prosperity')
  and l.id = m.listing_id
  and m.listing_id is not null;
