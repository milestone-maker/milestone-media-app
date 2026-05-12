-- ============================================================
-- 008: Agent branding — profile photo, agency logo, agency name
-- ============================================================

-- 1. Add branding columns to agents table
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS agency_name    text,
  ADD COLUMN IF NOT EXISTS agency_logo_url text,
  ADD COLUMN IF NOT EXISTS profile_photo_url text;

-- 2. Create public storage bucket for agent branding assets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'agent-branding',
  'agent-branding',
  true,
  5242880, -- 5 MB max per file
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage RLS: anyone can read (logos/photos must be visible on public microsites)
CREATE POLICY "Public can view agent branding"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'agent-branding');

-- 4. Storage RLS: agents can upload/update/delete their own files
--    Files are namespaced: agent-branding/{agent_id}/logo.jpg|photo.jpg
CREATE POLICY "Agents can upload own branding"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'agent-branding'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Agents can update own branding"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'agent-branding'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Agents can delete own branding"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'agent-branding'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
