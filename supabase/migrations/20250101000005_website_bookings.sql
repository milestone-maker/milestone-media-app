-- Migration 005: Agent tracking + website booking support
-- Applied directly via Management API on 2026-04-06
--
-- The live bookings table had no agent_id or source column.
-- This migration adds both and tightens the agent SELECT policy.

-- 1. Add agent_id (nullable) to link app bookings to the logged-in agent
--    Website bookings (unauthenticated) will have agent_id = NULL
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Add source column to distinguish 'website' vs 'app' bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'app';

-- 3. Replace the overly-broad "Agents can view bookings" policy (allowed all
--    authenticated users to see all bookings) with one scoped to their own.
--    Admins retain full visibility via the existing "Admins full access" policy.
DROP POLICY IF EXISTS "Agents can view bookings" ON public.bookings;

CREATE POLICY "Agents can view own bookings"
  ON public.bookings FOR SELECT
  USING (
    agent_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = auth.uid() AND agents.role = 'admin'
    )
  );
