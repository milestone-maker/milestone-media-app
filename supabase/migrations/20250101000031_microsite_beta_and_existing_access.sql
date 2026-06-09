-- ============================================================
-- 031: Microsite access — beta flag + existing-microsite exemption
-- ============================================================
-- Third enforcement layer (RLS) for the unified microsite write/access
-- condition. MIRRORS the canonical JS rule in shared/micrositeAccess.js
-- (imported by both api/_lib/entitlement.js and the editor UI). When you
-- change the rule there, change the SQL here to match; scripts/test-
-- entitlement.mjs asserts JS↔RLS parity.
--
-- ── THE UNIFIED CONDITION ──────────────────────────────────────────────
-- An agent may write/access a microsite for a booking when ANY of:
--   (1) role = 'admin'      — handled by the separate "Admins can ..."
--                             policies (added in 004), NOT this function.
--   (2) is_beta = true,
--   (3) an existing microsite row for this booking is owned by the agent,
--   (4) Pro/Elite subscription with status in {trialing, active, past_due},
--   (5) (selected_package = 'luxury' OR microsite add-on in selected_addons)
--       AND invoice_paid = true.
-- Ownership (agent_id = auth.uid()) is always required. Paths 1–4 do NOT
-- require invoice_paid; only path 5 does.
--
-- This migration is additive:
--   • agents.is_beta defaults false, so NOTHING changes for any existing
--     agent until the flag is explicitly set.
--   • the function gains the beta + existing-microsite branches.
--   • policy split: INSERT stays gated by agent_can_write_microsite (a
--     brand-new row must qualify via beta/sub/package — the existing-
--     microsite branch is naturally false at first insert); UPDATE is
--     relaxed to owner-only so the owner can always edit/re-publish a
--     microsite they already own (path 3), regardless of package.
--
-- NOTE (shared preview+prod DB): this repo pushes to a single Supabase
-- project shared by preview and prod. The default-false column means the
-- push is behavior-neutral until is_beta is set on a specific agent.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION +
-- DROP POLICY IF EXISTS before each CREATE. Safe to re-run.
-- ============================================================

-- ── 1. Additive beta flag ────────────────────────────────────────
alter table public.agents
  add column if not exists is_beta boolean not null default false;

-- ── 2. Helper function — add beta (2) + existing-microsite (3) branches ──
-- Preserves the security context from migrations 010/014: security definer
-- + locked search_path. security definer runs as the function owner (a
-- table-owning role), so the inner SELECT on public.microsites does NOT
-- re-enter this table's RLS policies — no recursion. Owner-scoping
-- (auth.uid()) is preserved in every branch.
--
-- CASCADE drop first: Postgres requires it to drop a function still
-- referenced by policy expressions. The dependent policies are recreated
-- in section 3 below.
drop function if exists public.agent_can_write_microsite(jsonb) cascade;

create or replace function public.agent_can_write_microsite(p_property_data jsonb)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    -- (2) beta agents have full microsite access (treated like admin).
    exists (
      select 1 from public.agents ag
      where ag.id = auth.uid() and ag.is_beta = true
    )
    or
    -- (3) the calling agent already owns a microsite for this booking —
    -- it stays editable/re-publishable regardless of package or invoice.
    exists (
      select 1 from public.microsites m
      where m.agent_id = auth.uid()
        and nullif(p_property_data->>'booking_id', '') is not null
        and (m.property_data->>'booking_id') = (p_property_data->>'booking_id')
    )
    or
    -- (4)/(5) booking-level + subscription paths (unchanged from 014).
    exists (
      select 1
      from public.bookings b
      where b.id = nullif(p_property_data->>'booking_id', '')::uuid
        and b.agent_id = auth.uid()
        and (
          -- (4) Pro/Elite active/grace subscription — no invoice required.
          exists (
            select 1
            from public.agents ag
            where ag.id = auth.uid()
              and ag.subscription_tier in ('pro', 'elite')
              and ag.subscription_status in ('trialing', 'active', 'past_due')
          )
          or
          -- (5) luxury package OR microsite add-on, AND invoice paid.
          (
            b.invoice_paid = true
            and (
              lower(coalesce(b.selected_package, '')) = 'luxury'
              or (
                b.selected_addons is not null
                and (
                  -- addon as object: {id: "microsite", qty: N}
                  exists (
                    select 1
                    from jsonb_array_elements(b.selected_addons) a
                    where a->>'id' = 'microsite'
                  )
                  or
                  -- addon as bare string: "microsite"
                  exists (
                    select 1
                    from jsonb_array_elements(b.selected_addons) a
                    where a = '"microsite"'::jsonb
                  )
                )
              )
            )
          )
        )
    );
$$;

-- ── 3. Recreate policies — INSERT gated, UPDATE owner-only ────────
-- (The CASCADE above dropped these along with the old function.)
drop policy if exists "Agents can insert entitled microsites" on public.microsites;
drop policy if exists "Agents can update entitled microsites" on public.microsites;

-- INSERT: a new microsite must satisfy the full entitlement rule.
create policy "Agents can insert entitled microsites"
  on public.microsites
  for insert
  with check (
    agent_id = auth.uid()
    and public.agent_can_write_microsite(property_data)
  );

-- UPDATE: owner-only. Once a microsite exists, its owner can always edit
-- and re-publish it (path 3) — encoded directly here rather than via the
-- helper, so a later package/subscription change can't lock an agent out
-- of editing a microsite they already own. Cross-owner edits remain
-- impossible: both USING and WITH CHECK require agent_id = auth.uid().
create policy "Agents can update entitled microsites"
  on public.microsites
  for update
  using (agent_id = auth.uid())
  with check (agent_id = auth.uid());
