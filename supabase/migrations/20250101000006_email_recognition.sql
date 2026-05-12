-- ============================================================
-- 006: Email recognition — link website bookings to accounts
-- ============================================================

-- 1. RPC function: check if an email has an account (callable by anon)
CREATE OR REPLACE FUNCTION public.check_agent_email(check_email text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  found_id uuid;
BEGIN
  SELECT id INTO found_id
  FROM auth.users
  WHERE lower(email) = lower(check_email)
  LIMIT 1;

  IF FOUND THEN
    RETURN json_build_object('exists', true, 'agent_id', found_id::text);
  ELSE
    RETURN json_build_object('exists', false, 'agent_id', null);
  END IF;
END;
$$;

-- Allow anon (website) and authenticated users to call this function
GRANT EXECUTE ON FUNCTION public.check_agent_email(text) TO anon;
GRANT EXECUTE ON FUNCTION public.check_agent_email(text) TO authenticated;

-- 2. Update SELECT policy so agents can also see bookings that match their email
--    (website bookings placed before they had an account)
DROP POLICY IF EXISTS "Agents can view own bookings" ON public.bookings;
CREATE POLICY "Agents can view own bookings" ON public.bookings
  FOR SELECT USING (
    agent_id = auth.uid()
    OR lower(client_email) = lower(auth.jwt()->>'email')
    OR EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = auth.uid() AND agents.role = 'admin'
    )
  );

-- 3. Add UPDATE policy so agents can claim unclaimed website bookings
--    (set agent_id on bookings where their email matches and agent_id is null)
DROP POLICY IF EXISTS "Agents can claim own bookings" ON public.bookings;
CREATE POLICY "Agents can claim own bookings" ON public.bookings
  FOR UPDATE USING (
    lower(client_email) = lower(auth.jwt()->>'email')
    AND agent_id IS NULL
  )
  WITH CHECK (agent_id = auth.uid());
