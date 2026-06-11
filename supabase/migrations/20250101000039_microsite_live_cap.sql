-- ============================================================
-- 039: Per-tier live-microsite cap (live-cap step 2) — RLS layer
-- ============================================================
-- Third enforcement layer for the per-tier LIVE-microsite cap
-- (Solo/starter 4, Team/pro 8, Brokerage/elite 16). ONLY these three tiers
-- are capped; any other tier (custom / enterprise / none) has NO cap and is
-- never auto-blocked. Mirrors the JS rule in shared/micrositeAccess.js:
--   • caps:          MICROSITE_CAP { starter:4, pro:8, elite:16 }  (else → no cap)
--   • live predicate: MICROSITE_LIVE_SQL = "published = true and retired_at is null"
--   • rule:          withinMicrositeCap → cap is null OR liveCount < cap
-- and the endpoint gate in api/publish-microsite.js (step 5b).
-- JS↔RLS parity is hand-synced: when you change a cap number or the live
-- predicate in shared/micrositeAccess.js, change the CASE / predicate here
-- to match.
--
-- ── Scope: NEW-create only ─────────────────────────────────────────────
-- This function backs the INSERT policy "Agents can insert entitled
-- microsites" (migration 031). The cap therefore fires ONLY on INSERT — a
-- brand-new microsite. Re-publish / edit of a microsite the agent already
-- owns is an owner-only UPDATE ("Agents can update entitled microsites",
-- migration 031) that does NOT call this function, so re-publish is fully
-- exempt from the cap — never counted, never blocked.
--
-- ── How this migration changes the function ────────────────────────────
-- Confirmed against migration 031: that migration defined
-- agent_can_write_microsite(jsonb) as an OR of branches (beta / existing /
-- booking+subscription) and wired it into the INSERT policy. We keep that
-- entitlement expression byte-for-byte and AND a cap clause onto it. Same
-- signature (jsonb → boolean), so CREATE OR REPLACE updates the body in
-- place; the INSERT/UPDATE policies from 031 keep referencing it with no
-- drop, no policy gap, no data touched. Additive only — no DROPs.
--
-- security definer + locked search_path are preserved from 031/014/010, so
-- the inner counts on public.microsites do NOT re-enter that table's RLS
-- (no recursion). Owner-scoping (auth.uid()) is preserved in every branch.
-- ============================================================

create or replace function public.agent_can_write_microsite(p_property_data jsonb)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    -- ── Entitlement (unchanged from migration 031) ──────────────────────
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
    -- ONLY starter/pro/elite are capped. The CASE returns the cap for those
    -- three and NULL for every other tier (custom / enterprise / null / no
    -- subscription) — exactly mirroring micrositeCapForTier() returning null
    -- in the JS module. The clause "cap IS NULL OR live_count < cap" means a
    -- no-cap tier is NEVER blocked; a capped tier is blocked at/over its cap.
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
          and mc.retired_at is null     -- ┘ (keep identical to the JS predicate)
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

-- No policy changes: the INSERT policy "Agents can insert entitled
-- microsites" and the owner-only UPDATE policy "Agents can update entitled
-- microsites" from migration 031 already reference this function (INSERT)
-- and bypass it (UPDATE), respectively. Replacing the body above is
-- sufficient to add the cap to new-create while leaving re-publish exempt.
