-- ============================================================
-- 055: incidents — auto-remediation registry (Stage 0)
-- ============================================================
-- Long-lived registry of detected failures. Each row is a
-- deduped incident that a later stage will run through a per-
-- kind executor after human approval. Stage 0 populates this
-- table but performs no remediation: the presence of a row is
-- observation only.
--
-- Design decisions:
--   * dedupe is enforced by UNIQUE (kind, dedupe_key). The
--     handler that writes a row chooses the dedupe granularity
--     per kind (per-event, per-tracking-row, per-file, hour-
--     bucketed, etc.), so a single failure never floods the
--     table.
--   * agent_id is a convenience FK ON DELETE SET NULL — a
--     deleted agent must not orphan or block incident history.
--   * status is a controlled vocabulary that maps directly to
--     the future Slack approval UI:
--       detected -> approved -> running -> fixed / failed / noop.
--   * payload is a jsonb blob carrying everything a future
--     executor will need to re-invoke the failing handler.
--   * RLS enabled. Only admins get read/update policies;
--     service-role writes bypass RLS (all three failure-path
--     writers use the service-role client).
--   * Additive only, gen_random_uuid() PK — project convention.
-- ============================================================

create table if not exists public.incidents (
  id            uuid primary key default gen_random_uuid(),

  source        text not null
                check (source in ('handler','sentry','webhook','cron','manual')),
  kind          text not null,
  severity      text not null default 'medium'
                check (severity in ('low','medium','high')),

  subject_type  text,
  subject_id    text,
  dedupe_key    text not null,

  agent_id      uuid references public.agents(id) on delete set null,

  status        text not null default 'detected'
                check (status in ('detected','approved','running','fixed','failed','noop')),
  approver      text,
  payload       jsonb not null default '{}'::jsonb,
  error_message text,
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  resolved_at   timestamptz,

  constraint incidents_kind_dedupe_uniq unique (kind, dedupe_key)
);

comment on table public.incidents is
  'Detected production failures for later executor-driven remediation. Written by the failure paths in api/stripe-webhook.js, api/social-post.js, api/publish-microsite.js. Unique (kind, dedupe_key) collapses repeat detections of the same failure.';

create index if not exists idx_incidents_status_created
  on public.incidents (status, created_at desc);

create index if not exists idx_incidents_agent
  on public.incidents (agent_id, created_at desc);

alter table public.incidents enable row level security;

drop policy if exists "Admins can read incidents"   on public.incidents;
drop policy if exists "Admins can update incidents" on public.incidents;

create policy "Admins can read incidents"
  on public.incidents for select
  using (public.is_admin());

create policy "Admins can update incidents"
  on public.incidents for update
  using (public.is_admin());
