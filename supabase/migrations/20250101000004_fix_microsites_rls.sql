-- ============================================================
-- FIX: Nuclear reset of microsites RLS policies
-- Run this ENTIRE script in Supabase SQL Editor
-- ============================================================

-- Step 1: Drop ALL existing microsites policies (ignore errors for non-existent ones)
drop policy if exists "Agents can view own microsites" on public.microsites;
drop policy if exists "Agents can manage own microsites" on public.microsites;
drop policy if exists "Admins can manage all microsites" on public.microsites;
drop policy if exists "Anyone can view published microsites" on public.microsites;
drop policy if exists "Agents can insert own microsites" on public.microsites;
drop policy if exists "Agents can manage microsites by agent_id" on public.microsites;

-- Step 2: Make sure RLS is still enabled
alter table public.microsites enable row level security;

-- Step 3: Recreate policies cleanly

-- PUBLIC: Anyone can view published microsites (for /p/slug pages, no auth needed)
create policy "Public can view published microsites"
  on public.microsites for select
  using (published = true);

-- AGENTS: Can insert their own microsites (agent_id must match their auth ID)
create policy "Agents can insert own microsites"
  on public.microsites for insert
  with check (agent_id = auth.uid());

-- AGENTS: Can view their own microsites (even unpublished drafts)
create policy "Agents can view own microsites"
  on public.microsites for select
  using (agent_id = auth.uid());

-- AGENTS: Can update their own microsites
create policy "Agents can update own microsites"
  on public.microsites for update
  using (agent_id = auth.uid())
  with check (agent_id = auth.uid());

-- AGENTS: Can delete their own microsites
create policy "Agents can delete own microsites"
  on public.microsites for delete
  using (agent_id = auth.uid());

-- ADMIN: Full access to all microsites
create policy "Admins can select all microsites"
  on public.microsites for select
  using (public.is_admin());

create policy "Admins can insert all microsites"
  on public.microsites for insert
  with check (public.is_admin());

create policy "Admins can update all microsites"
  on public.microsites for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete all microsites"
  on public.microsites for delete
  using (public.is_admin());
