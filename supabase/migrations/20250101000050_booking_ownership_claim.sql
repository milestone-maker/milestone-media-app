-- Booking ownership claim
-- Problem: staff can pre-create a booking on a client's behalf. The booking's
-- agent_id is set to the staff member's uid; client_email holds the contact's
-- email. When that contact later signs up, ownership-gated features fail.
-- Solution: when a user's email is verified (or auto-confirmed at signup),
-- transfer ownership of any matching unowned-or-staff-owned bookings to them.
-- Also: case-insensitive media RLS fallback and a one-time backfill.

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1: Claim function
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.claim_bookings_for_user(
  p_user_id uuid,
  p_email   text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if p_user_id is null or p_email is null or length(trim(p_email)) = 0 then
    return 0;
  end if;

  -- Transfer ownership where the booking is either unowned, or currently
  -- owned by a staff member (admin). Real-agent-owned bookings are never
  -- reassigned just because a contact email happens to match.
  update public.bookings b
     set agent_id = p_user_id
   where lower(b.client_email) = lower(p_email)
     and b.agent_id is distinct from p_user_id
     and (
       b.agent_id is null
       or exists (
         select 1
           from public.agents a
          where a.id = b.agent_id
            and a.role = 'admin'
       )
     );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.claim_bookings_for_user(uuid, text) from public;
-- Triggers + backfill invoke this with elevated privileges; no direct grants.

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2: Verification-gated triggers on auth.users
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_user_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null and new.email_confirmed_at is not null then
    perform public.claim_bookings_for_user(new.id, new.email);
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_claim_bookings on auth.users;
create trigger on_auth_user_created_claim_bookings
  after insert on auth.users
  for each row
  execute function public.handle_user_email_confirmed();

create or replace function public.handle_user_email_confirmation_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.email_confirmed_at is null and new.email_confirmed_at is not null)
     and new.email is not null then
    perform public.claim_bookings_for_user(new.id, new.email);
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_confirmed_claim_bookings on auth.users;
create trigger on_auth_user_confirmed_claim_bookings
  after update of email_confirmed_at on auth.users
  for each row
  execute function public.handle_user_email_confirmation_update();

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 3: ALTER booking_media SELECT policy — case-insensitive + ownership
-- ─────────────────────────────────────────────────────────────────────────────
-- Existing policy "Users can view media for their bookings" compared
-- b.client_email = jwt email (case-sensitive). Broaden to allow either
-- ownership (agent_id = auth.uid()) or case-insensitive email match.
-- Admin full-access policy is untouched.
alter policy "Users can view media for their bookings"
  on public.booking_media
  using (
    exists (
      select 1
        from public.bookings b
       where b.id = booking_media.booking_id
         and (
           b.agent_id = auth.uid()
           or lower(b.client_email) = lower(auth.jwt() ->> 'email')
         )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 4: One-time backfill
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  r record;
  v_lowered integer := 0;
  v_claimed integer := 0;
  v_n       integer;
begin
  -- Normalize stored client_email to lowercase (idempotent).
  update public.bookings
     set client_email = lower(client_email)
   where client_email is not null
     and client_email <> lower(client_email);
  get diagnostics v_lowered = row_count;

  -- For every already-confirmed auth user, run the claim.
  for r in
    select id, email
      from auth.users
     where email is not null
       and email_confirmed_at is not null
  loop
    v_n := public.claim_bookings_for_user(r.id, r.email);
    v_claimed := v_claimed + coalesce(v_n, 0);
  end loop;

  raise notice 'booking-ownership-claim backfill: % rows lowercased, % bookings claimed',
    v_lowered, v_claimed;
end;
$$;
