-- ============================================================
-- 054: webhook_events — Stage 0 auto-remediation observation
-- ============================================================
-- Records every webhook event we successfully verify, keyed by the
-- provider's event id. Purpose in Stage 0 is OBSERVATION only —
-- the row is written for every verified Stripe event, but the
-- handler still processes every delivery (no dedupe gate yet).
-- A later stage will flip stripe-webhook.js to skip processing when
-- ON CONFLICT hits, at which point this table becomes the safe
-- replay boundary for billing-side remediation.
--
-- Design decisions:
--   * event_id is the natural PRIMARY KEY. Stripe redelivery of the
--     same event.id is absorbed via ON CONFLICT DO NOTHING.
--   * source is a text CHECK, scoped to 'stripe' today. Adding
--     'bundle' / 'sentry' later is an ALTER of the CHECK only.
--   * processed_at is nullable and set by the handler AFTER the
--     work succeeds. Absence indicates a mid-flight failure worth
--     investigating.
--   * RLS enabled; no anon/authenticated policies (service-role
--     writes bypass RLS). Admins can read for triage.
--   * Additive only. No DROPs. Safe to re-run
--     (create table if not exists + drop policy if exists).
-- ============================================================

create table if not exists public.webhook_events (
  event_id     text primary key,
  source       text not null default 'stripe'
               check (source in ('stripe')),
  event_type   text not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);

comment on table public.webhook_events is
  'Per-event observation log for Stripe webhooks. Written by api/stripe-webhook.js right after signature verification; processed_at set on success. Idempotency keyed by event_id — a later stage will use this as the dedupe guard.';

create index if not exists idx_webhook_events_received
  on public.webhook_events (received_at desc);

alter table public.webhook_events enable row level security;

drop policy if exists "Admins can read webhook events" on public.webhook_events;
create policy "Admins can read webhook events"
  on public.webhook_events for select
  using (public.is_admin());
