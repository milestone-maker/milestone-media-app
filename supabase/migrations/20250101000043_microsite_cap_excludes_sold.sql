-- ============================================================
-- 043: Live-cap function excludes SOLD (sold-pages step 2a — RLS parity)
-- ============================================================
-- Sold-pages step 1 (migration 042) added microsites.sold_at and updated the
-- canonical LIVE predicate in shared/micrositeAccess.js + the endpoint cap
-- counter (api/publish-microsite.js) to:
--   published = true AND retired_at IS NULL AND sold_at IS NULL
-- so a SOLD listing (which keeps published = true and stays publicly served)
-- FREES the agent's live-cap slot, just like a retired one.
--
-- The third enforcement layer — the RLS function agent_can_write_microsite()
-- from migration 039 — still counted live microsites with only
-- `published = true AND retired_at IS NULL`, so a sold listing would still
-- consume a slot at the DB layer (blocking a new publish the JS layer allows).
-- This migration restores three-layer parity by CREATE OR REPLACE-ing the
-- function with `and mc.sold_at is null` added to its live-count subquery.
--
-- Everything else is byte-for-byte identical to migration 039 (entitlement OR
-- expression + the cap CASE numbers 4/8/16). Same signature (jsonb → boolean),
-- security definer + locked search_path preserved, so the INSERT/UPDATE
-- policies from migration 031 keep referencing it with no drop, no policy gap,
-- no data touched. Additive — CREATE OR REPLACE only, NO DROP.
--
-- ── The ONLY change vs 039 ─────────────────────────────────────────────
--   live-count subquery WHERE:
--     before:  mc.published = true AND mc.retired_at is null
--     after:   mc.published = true AND mc.retired_at is null AND mc.sold_at is null
-- ============================================================

create or replace function public.agent_can_write_microsite(p_property_data jsonb)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    -- ── Entitlement (unchanged from migrations 031/039) ─────────────────
    (
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
      )
    )
    and
    -- ── Per-tier live-microsite cap (NEW-create only; this is INSERT) ────
    -- ONLY starter/pro/elite are capped; every other tier → NULL → no cap.
    (
      coalesce(
        (
          select case ag2.subscription_tier
            when 'starter' then 4
            when 'pro'     then 8
            when 'elite'   then 16
            else null       -- not one of the three capped tiers → no cap
          end
          from public.agents ag2
          where ag2.id = auth.uid()
        ),
        null                -- no agent row → no cap (entitlement gates elsewhere)
      ) is null
      or
      (
        select count(*)
        from public.microsites mc
        where mc.agent_id = auth.uid()
          and mc.published = true       -- ┐ MICROSITE_LIVE_SQL
          and mc.retired_at is null     -- │ (keep identical to the JS predicate)
          and mc.sold_at is null        -- ┘ added in 043: sold frees a slot
      )
      <
      (
        select case ag3.subscription_tier
          when 'starter' then 4
          when 'pro'     then 8
          when 'elite'   then 16
          else null
        end
        from public.agents ag3
        where ag3.id = auth.uid()
      )
    );
$$;

-- No policy changes: the INSERT policy "Agents can insert entitled microsites"
-- and the owner-only UPDATE policy from migration 031 already reference (INSERT)
-- / bypass (UPDATE) this function. Replacing the body is sufficient.
