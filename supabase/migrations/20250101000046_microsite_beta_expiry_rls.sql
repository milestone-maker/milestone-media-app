-- ============================================================
-- 046: Microsite RLS — beta expiry enforcement
-- ============================================================
-- Amends the beta sub-condition of the unified microsite write rule to
-- match the canonical JS module (shared/micrositeAccess.js, see migration
-- 045's column comment). The rule everywhere is now:
--
--   beta grants access ONLY IF
--     is_beta = true AND (beta_expires_at IS NULL OR beta_expires_at > now())
--
-- "No date set" = never expires. The demo account convention (and every
-- existing is_beta row — currently zero in this DB but the contract holds)
-- carries NULL on beta_expires_at and is unaffected. When beta is set but
-- expired, the beta branch fails and execution falls through to the
-- existing-microsite and Stripe/booking branches below it — that fall-
-- through is intentional. An expired beta is NOT an outright deny.
--
-- ── Why CREATE OR REPLACE FUNCTION and not ALTER POLICY ────────────────
-- The beta sub-condition is NOT inline in the policy USING expression in
-- this codebase; it lives inside the SECURITY DEFINER function
-- public.agent_can_write_microsite(jsonb) which the INSERT policy calls
-- (see migrations 031, 039, 043). The non-destructive way to amend it is
-- CREATE OR REPLACE FUNCTION — this preserves the function's OID,
-- security context, dependent policies, and grants, with NO DROP.
--
-- ── The ONLY change vs migration 043 ───────────────────────────────────
--   beta branch WHERE:
--     before:  ag.id = auth.uid() and ag.is_beta = true
--     after:   ag.id = auth.uid() and ag.is_beta = true
--              and (ag.beta_expires_at is null or ag.beta_expires_at > now())
-- Everything else (existing-microsite branch, subscription branch, booking
-- branch, live-microsite cap CASE) is byte-for-byte identical to 043.
-- ============================================================

create or replace function public.agent_can_write_microsite(p_property_data jsonb)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    -- ── Entitlement ──────────────────────────────────────────────────────
    (
      -- (2) beta agents have full microsite access (treated like admin),
      -- subject to the optional beta_expires_at cutoff. NULL = never expires.
      exists (
        select 1 from public.agents ag
        where ag.id = auth.uid()
          and ag.is_beta = true
          and (ag.beta_expires_at is null or ag.beta_expires_at > now())
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
-- from migration 031 already references this function and continues to do so
-- (CREATE OR REPLACE preserves the function OID; the policy binding is intact).
