-- ============================================================
-- 011: Add Stripe subscription billing columns to public.agents
-- ============================================================
-- Adds the columns the subscription billing system needs to track each
-- agent's Stripe customer record, current subscription, tier, status,
-- billing period, and renewal timestamp. Nothing else on the agents
-- table changes. No other table is touched.
--
-- The webhook handler (api/stripe-webhook.js) looks agents up by
-- stripe_customer_id and stripe_subscription_id on every event, so both
-- get unique partial indexes to keep that lookup cheap.
--
-- DEV-RESET BLOCK (REMOVE ONCE LOCKED) ─────────────────────────────────
-- The block immediately below drops the new columns if they already
-- exist, so this migration can be re-run cleanly while we iterate on
-- the schema. Once the subscription billing system is in production
-- and we don't want to allow a destructive re-run, delete the entire
-- DEV-RESET BLOCK and rely solely on ADD COLUMN IF NOT EXISTS below.
alter table public.agents drop column if exists stripe_customer_id;
alter table public.agents drop column if exists stripe_subscription_id;
alter table public.agents drop column if exists subscription_tier;
alter table public.agents drop column if exists subscription_status;
alter table public.agents drop column if exists billing_period;
alter table public.agents drop column if exists current_period_end;
alter table public.agents drop column if exists founding_member;
alter table public.agents drop column if exists subscription_started_at;
-- END DEV-RESET BLOCK ─────────────────────────────────────────────────

-- ── New columns ───────────────────────────────────────────────────────
alter table public.agents
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_tier      text,
  add column if not exists subscription_status    text,
  add column if not exists billing_period         text,
  add column if not exists current_period_end     timestamptz,
  add column if not exists founding_member        boolean not null default false,
  add column if not exists subscription_started_at timestamptz;

-- ── Check constraints ────────────────────────────────────────────────
-- subscription_tier: only the four tiers from pricing.json
alter table public.agents
  drop constraint if exists agents_subscription_tier_check;
alter table public.agents
  add constraint agents_subscription_tier_check
  check (subscription_tier is null or subscription_tier in ('starter', 'pro', 'elite', 'teams'));

-- subscription_status: standard Stripe subscription statuses
alter table public.agents
  drop constraint if exists agents_subscription_status_check;
alter table public.agents
  add constraint agents_subscription_status_check
  check (subscription_status is null or subscription_status in (
    'trialing',
    'active',
    'past_due',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'unpaid',
    'paused'
  ));

-- billing_period: only monthly or annual
alter table public.agents
  drop constraint if exists agents_billing_period_check;
alter table public.agents
  add constraint agents_billing_period_check
  check (billing_period is null or billing_period in ('monthly', 'annual'));

-- ── Uniqueness via partial unique indexes ────────────────────────────
-- Both Stripe IDs should be unique when present, but null is fine
-- (most agents won't have started a subscription yet).
create unique index if not exists agents_stripe_customer_id_key
  on public.agents (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists agents_stripe_subscription_id_key
  on public.agents (stripe_subscription_id)
  where stripe_subscription_id is not null;
