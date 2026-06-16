-- ============================================================
-- 047: Beta invite tokens
-- ============================================================
-- Admin-issued shareable invite links that grant the recipient a
-- time-limited beta. Redemption flips agents.is_beta = true and stamps
-- agents.beta_expires_at = now() + beta_duration_days (see migrations
-- 045/046 for the entitlement layer that consumes those columns).
--
-- Two distinct expiries on this table:
--   • invite_expires_at — the LINK's own expiry (how long the invite
--     itself is redeemable). Default = 30 days from creation.
--   • beta_duration_days — how long the beta lasts ONCE accepted.
--     Default = 90 days. Applied at accept time as
--     beta_expires_at = now() + beta_duration_days.
--
-- RLS:
--   • admins read/write the whole table via the existing role='admin'
--     check (mirrors the pattern used in api/* admin endpoints — the
--     route gate is enforced at the API layer, but RLS denies any
--     direct client read/write so a non-admin agent can't enumerate
--     tokens by hitting Supabase directly).
--   • the public accept flow does NOT read this table from the browser
--     — it goes through the service-role api/beta-invite-lookup.js and
--     api/beta-invite-accept.js endpoints, which bypass RLS. So this
--     table needs no anon SELECT policy.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS +
-- DROP POLICY IF EXISTS before each CREATE POLICY. Safe to re-run.
-- ============================================================

create table if not exists public.beta_invites (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  email text,
  beta_duration_days int not null default 90,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invite_expires_at timestamptz not null default (now() + interval '30 days'),
  created_by uuid references public.agents(id),
  accepted_by uuid references public.agents(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Fast lookup by token (the public accept path). Also unique above,
-- but an explicit index covers ordered scans / EXPLAIN clarity.
create index if not exists beta_invites_token_idx
  on public.beta_invites (token);

create index if not exists beta_invites_status_created_at_idx
  on public.beta_invites (status, created_at desc);

alter table public.beta_invites enable row level security;

-- Admins manage everything. Non-admins get nothing (the public accept
-- path uses the service-role endpoints, not direct client access).
drop policy if exists "Admins can read beta invites" on public.beta_invites;
drop policy if exists "Admins can write beta invites" on public.beta_invites;

create policy "Admins can read beta invites"
  on public.beta_invites
  for select
  using (
    exists (
      select 1 from public.agents ag
      where ag.id = auth.uid() and ag.role = 'admin'
    )
  );

create policy "Admins can write beta invites"
  on public.beta_invites
  for all
  using (
    exists (
      select 1 from public.agents ag
      where ag.id = auth.uid() and ag.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.agents ag
      where ag.id = auth.uid() and ag.role = 'admin'
    )
  );
