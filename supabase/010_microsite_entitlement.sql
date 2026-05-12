-- ============================================================
-- 010: Microsite entitlement — RLS defense-in-depth
-- ============================================================
-- The primary entitlement check lives in /api/publish-microsite.js,
-- which runs with the service-role key and bypasses RLS. This
-- migration adds a second, independent gate at the database level so
-- that even if a client somehow writes to public.microsites directly
-- with an anon or authenticated key, the row is rejected unless the
-- same conditions hold.
--
-- Entitlement, in plain English:
--   • admins can do anything (existing admin override policies handle this)
--   • an agent can INSERT/UPDATE a microsite only if:
--       - property_data->>'booking_id' references a real booking
--       - that booking's agent_id matches the agent
--       - that booking has invoice_paid = true
--       - that booking has selected_package = 'luxury' OR
--         has microsite in selected_addons (string "microsite"
--         or an object with id = 'microsite')
--
-- The public-view policy ("Public can view published microsites") is
-- left in place — visitors must still read /p/{slug} without auth.
--
-- NOTE: the bookings table columns referenced below
-- (selected_package, selected_addons, invoice_paid) were added in
-- production via the Supabase dashboard, not via tracked migrations.
-- If those columns are not present, this migration will fail with a
-- clear error and need to be paired with a column-add migration.
--
-- Idempotency: DROP POLICY IF EXISTS is used before each CREATE so
-- this file can be re-run safely. The helper is CREATE OR REPLACE.
-- ============================================================

-- ── Helper function ──────────────────────────────────────────────
-- Takes the property_data JSONB column of a microsite row and returns
-- whether the current authenticated agent is allowed to write it.
-- security definer + search_path = public, pg_temp follows the
-- recommended pattern for Postgres RLS helpers — locking the function's
-- name resolution so a malicious search_path can't redirect it.
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
      )
  );
$$;

-- ── Replace agent INSERT / UPDATE policies on microsites ──────────
-- The existing policies (added in 004_fix_microsites_rls.sql) only
-- check agent_id = auth.uid(). They're replaced here with policies
-- that also call the helper above.

drop policy if exists "Agents can insert own microsites" on public.microsites;
drop policy if exists "Agents can update own microsites" on public.microsites;
-- Also drop the names we use below in case of re-run
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

-- The other microsite policies stay as-is and are NOT modified:
--   • "Public can view published microsites"  — keeps /p/{slug} public
--   • "Agents can view own microsites"        — drafts are still readable
--   • "Agents can delete own microsites"      — ownership-only delete
--   • all four "Admins can ..." policies      — admin override unchanged
