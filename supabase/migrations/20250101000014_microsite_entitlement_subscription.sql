-- ============================================================
-- 014: Microsite entitlement — subscription path
-- ============================================================
-- Extends the defense-in-depth RLS helper from migration 010 so that
-- agents on an active Pro or Elite subscription are entitled to write a
-- microsite for any of their own paid bookings, not just bookings that
-- include a Luxury package or microsite add-on.
--
-- Mirror of the policy in api/_lib/entitlement.js:
--   • Booking ownership + invoice_paid are still required.
--   • AND ONE OF:
--       - selected_package = 'luxury'
--       - microsite in selected_addons
--       - calling agent has subscription_tier in ('pro','elite')
--         AND subscription_status in ('trialing','active','past_due')
--
-- The existing row-level policies (added in 010) call this helper by
-- name, so replacing the helper with CREATE OR REPLACE updates the
-- gate atomically — no policy churn required.
--
-- Starter subscribers are deliberately excluded: their tier covers
-- Essential shoots only, and microsite publishing is a Pro+ perk.
--
-- DEV-RESET BLOCK (REMOVE ONCE LOCKED) ─────────────────────────────────
-- Drops the helper so this migration can be re-run cleanly during
-- iteration. Once locked, delete this block — the create-or-replace
-- below is already idempotent on its own.
drop function if exists public.agent_can_write_microsite(jsonb) cascade;
-- END DEV-RESET BLOCK ─────────────────────────────────────────────────

create or replace function public.agent_can_write_microsite(p_property_data jsonb)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.bookings b
    where b.id = nullif(p_property_data->>'booking_id', '')::uuid
      and b.agent_id = auth.uid()
      and b.invoice_paid = true
      and (
        lower(coalesce(b.selected_package, '')) = 'luxury'
        or (
          b.selected_addons is not null
          and (
            -- microsite addon stored as an object: {id: "microsite", qty: N}
            exists (
              select 1
              from jsonb_array_elements(b.selected_addons) a
              where a->>'id' = 'microsite'
            )
            or
            -- microsite addon stored as a bare string: "microsite"
            exists (
              select 1
              from jsonb_array_elements(b.selected_addons) a
              where a = '"microsite"'::jsonb
            )
          )
        )
        or
        -- Pro/Elite subscription includes microsite publishing.
        exists (
          select 1
          from public.agents ag
          where ag.id = auth.uid()
            and ag.subscription_tier in ('pro', 'elite')
            and ag.subscription_status in ('trialing', 'active', 'past_due')
        )
      )
  );
$$;

-- The cascade above dropped the policies that depended on the helper
-- (Postgres requires CASCADE to drop a function referenced by policy
-- expressions). Recreate them here, matching the definitions from
-- migration 010. Idempotent in case 014 is re-run after a partial apply.

drop policy if exists "Agents can insert entitled microsites" on public.microsites;
drop policy if exists "Agents can update entitled microsites" on public.microsites;

create policy "Agents can insert entitled microsites"
  on public.microsites
  for insert
  with check (
    agent_id = auth.uid()
    and public.agent_can_write_microsite(property_data)
  );

create policy "Agents can update entitled microsites"
  on public.microsites
  for update
  using (agent_id = auth.uid())
  with check (
    agent_id = auth.uid()
    and public.agent_can_write_microsite(property_data)
  );
