-- ============================================================
-- 024: Stage 5a — leads microsite-ownership RLS policies
-- ============================================================
-- The existing leads SELECT/UPDATE policies (schema.sql) scope an
-- agent's access by listing ownership:
--     listing_id in (select id from listings where agent_id = auth.uid())
--
-- Migration 019 made leads.listing_id NULLABLE and the chat endpoint
-- mirrors chat-captured leads into public.leads with listing_id = NULL
-- when the microsite has no linked listing. Those null-listing leads
-- are invisible AND un-updatable to the agent's anon client today,
-- because NULL never satisfies the listing-based predicate.
--
-- These two ADDITIVE permissive policies widen access along the one
-- ownership key every lead reliably carries: microsite_id. Postgres
-- OR's permissive policies together, so this only GRANTS an agent
-- access to leads on microsites they own — it never restricts the
-- existing listing-based access. No existing policy is altered or
-- dropped; no table or data changes.
-- ============================================================

create policy "Agents can view leads for own microsites"
  on public.leads for select
  using (
    microsite_id in (select id from public.microsites where agent_id = auth.uid())
  );

create policy "Agents can update leads for own microsites"
  on public.leads for update
  using (
    microsite_id in (select id from public.microsites where agent_id = auth.uid())
  );
