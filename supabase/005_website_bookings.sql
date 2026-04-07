-- Migration 005: Allow public website bookings
-- Website bookings come from unauthenticated visitors, so agent_id is null
-- and the existing "Agents can insert own bookings" RLS policy blocks them.

-- 1. Make agent_id nullable (website bookings have no authenticated agent)
alter table public.bookings
  alter column agent_id drop not null;

-- 2. Add a source column so admin can distinguish website vs app bookings
alter table public.bookings
  add column if not exists source text default 'app';

-- 3. Allow unauthenticated (public) inserts for website bookings
--    Only permitted when agent_id is null (i.e. public visitor, not a logged-in agent)
create policy "Public can submit website bookings"
  on public.bookings for insert
  with check (agent_id is null);
