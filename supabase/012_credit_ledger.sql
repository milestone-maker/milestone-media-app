-- ============================================================
-- 012: Shoot credit ledger (subscription credits)
-- ============================================================
-- Tracks one row per agent per billing period. The webhook grants new
-- rows on subscription renewal and (on upgrades) modifies the current
-- row in place. Downgrades wait until the next renewal — the current
-- row is left alone. Booking-time credit consumption (Chunk B) will
-- increment credits_consumed against this same table.
--
-- The webhook runs with the service-role key and bypasses RLS, so
-- writes are only ever made by trusted server code. Agents and admins
-- have read access; nobody else can read, insert, update, or delete
-- via RLS-bound API keys.
--
-- DEV-RESET BLOCK (REMOVE ONCE LOCKED) ─────────────────────────────────
-- Drops the table and its policies so this migration can be re-run
-- cleanly while iterating. Once the credit system is in production,
-- delete this block and rely on `create table if not exists` + the
-- idempotent policy drops below.
drop table if exists public.credit_ledger cascade;
-- END DEV-RESET BLOCK ─────────────────────────────────────────────────

-- ── Table ────────────────────────────────────────────────────────────
create table if not exists public.credit_ledger (
  id                uuid primary key default uuid_generate_v4(),
  agent_id          uuid not null references public.agents(id) on delete cascade,
  period_start      timestamptz not null,
  period_end        timestamptz not null,
  tier_in_effect    text not null
                    check (tier_in_effect in ('starter', 'pro', 'elite', 'teams')),
  credits_granted   integer not null check (credits_granted >= 0),
  credits_consumed  integer not null default 0 check (credits_consumed >= 0),
  rollover_in       integer not null default 0 check (rollover_in >= 0),
  created_at        timestamptz not null default now(),

  -- One ledger row per agent per period. The webhook uses this to make
  -- renewal grants idempotent — re-delivered invoice.payment_succeeded
  -- events hit the unique constraint and the webhook swallows the error.
  constraint credit_ledger_agent_period_uniq unique (agent_id, period_start)
);

-- Fast lookup of an agent's current period
create index if not exists credit_ledger_agent_period_end_idx
  on public.credit_ledger (agent_id, period_end);

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.credit_ledger enable row level security;

-- Drop any policies of these names first so this migration is idempotent
drop policy if exists "Agents can view own credit rows" on public.credit_ledger;
drop policy if exists "Admins can view all credit rows" on public.credit_ledger;

create policy "Agents can view own credit rows"
  on public.credit_ledger
  for select
  using (agent_id = auth.uid());

create policy "Admins can view all credit rows"
  on public.credit_ledger
  for select
  using (public.is_admin());

-- No INSERT / UPDATE / DELETE policies are defined. The Stripe webhook
-- runs with the service-role key and bypasses RLS; that is the only
-- writer. Direct mutations from anon / authenticated clients are blocked
-- by the absence of permissive policies.
