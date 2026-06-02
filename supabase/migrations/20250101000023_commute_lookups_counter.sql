-- ============================================================
-- 023: Stage 4 commute — per-conversation commute-lookup counter
-- ============================================================
-- The microsite chat's commute tool (get_commute) makes a live Google
-- Routes API call per lookup. To bound cost/abuse, each conversation is
-- capped at a fixed number of commute lookups; this column tracks how
-- many actual Google calls a conversation has made. Incremented by the
-- chat endpoint only when a real lookup fires (cap-blocked attempts do
-- not increment).
--
-- Design decisions (follow migration 020's additive philosophy):
--   • add column if not exists → safe to re-run.
--   • NOT NULL default 0 — existing conversations start at zero with no
--     backfill needed (the default fills them in place).
--   • Additive only. No DROPs, no destructive statements.
-- ============================================================

alter table public.microsite_chat_conversations
  add column if not exists commute_lookups int not null default 0;
