-- ============================================================
-- MICROSITE UPGRADE: Add columns for public microsite pages
-- Run this in Supabase SQL Editor
-- ============================================================

-- Add property_data jsonb to store all listing details for public display
alter table public.microsites add column if not exists property_data jsonb default '{}';

-- Add agent_id to track which agent owns the microsite
alter table public.microsites add column if not exists agent_id uuid references auth.users(id) on delete set null;

-- Add custom_domain for Luxury tier (Phase 2)
alter table public.microsites add column if not exists custom_domain text;

-- Allow anyone to view published microsites (needed for public /p/slug pages)
create policy "Anyone can view published microsites"
  on public.microsites for select
  using (published = true);
