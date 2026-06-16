-- ============================================================
-- 045: Beta access expiry — additive column
-- ============================================================
-- Adds agents.beta_expires_at, an optional cutoff for the is_beta flag.
-- The rule everywhere (mirrored in shared/micrositeAccess.js, api/_lib/
-- entitlement.js, and the RLS function amended in migration 046) is:
--
--   beta grants access ONLY IF
--     is_beta = true AND (beta_expires_at IS NULL OR beta_expires_at > now())
--
-- "No date set" = never expires. Every existing beta row (including the
-- manually-granted demo account) gets NULL on this column, so behavior is
-- unchanged for them until a date is set. When beta is set but expired,
-- the beta branch denies and execution falls through to the existing-
-- microsite and Stripe checks below it (intended).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-run.
-- ============================================================

alter table public.agents
  add column if not exists beta_expires_at timestamptz;
