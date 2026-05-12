-- ============================================================
-- 007: Add sort_order to booking_media for agent photo ordering
-- ============================================================

-- 1. Add sort_order column (nullable int, default null = unset)
ALTER TABLE public.booking_media
  ADD COLUMN IF NOT EXISTS sort_order integer;

-- 2. Backfill existing rows with sequential order based on created_at
--    so existing media isn't treated as unordered
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY booking_id ORDER BY created_at ASC) - 1 AS rn
  FROM public.booking_media
)
UPDATE public.booking_media bm
SET sort_order = ranked.rn
FROM ranked
WHERE bm.id = ranked.id;

-- 3. Add index for efficient ordering queries
CREATE INDEX IF NOT EXISTS booking_media_sort_order_idx
  ON public.booking_media (booking_id, sort_order ASC NULLS LAST);
