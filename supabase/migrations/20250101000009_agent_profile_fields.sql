-- ============================================================
-- 009: Add business_address to agents for full profile editing
-- ============================================================
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS business_address text;
