-- ============================================================
-- 049: Beta access reminder flags
-- ============================================================
-- The daily /api/beta-reminders cron emails a beta agent at 14 days out,
-- 3 days out, and on the expiry day. These flags ensure each reminder
-- ships at most once per agent, and that when an agent crosses multiple
-- thresholds (e.g. cron missed a day) we send only the MOST URGENT
-- reminder and mark the less-urgent ones as already handled.
--
-- This migration is EMAILS ONLY — it touches no entitlement logic.
-- Access enforcement is unchanged (migrations 045 + 046).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-run.
-- ============================================================

alter table public.agents
  add column if not exists beta_notified_14d     boolean not null default false,
  add column if not exists beta_notified_3d      boolean not null default false,
  add column if not exists beta_notified_expiry  boolean not null default false;
