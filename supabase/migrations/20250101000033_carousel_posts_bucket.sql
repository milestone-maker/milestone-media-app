-- ============================================================
-- 033: bundle.social Stage 2b — carousel-posts storage bucket
-- ============================================================
-- Public Storage bucket for composed carousel images. The browser composes
-- the carousel (Canvas → PNG cards / JPEG photos), uploads each image here,
-- and passes the resulting PUBLIC URLs to /api/social-post, which hands them
-- to bundle.social's /upload/from-url. Public read is REQUIRED so bundle can
-- fetch the images server-side (and getPublicUrl works client-side).
--
-- Mirrors the existing public agent-branding bucket (migration 008) EXACTLY:
-- same bucket shape and the same storage.objects RLS idiom — public SELECT,
-- and authenticated INSERT/UPDATE/DELETE confined to the caller's own
-- top-level folder via (storage.foldername(name))[1] = auth.uid()::text.
--
-- Object path convention: carousel-posts/{agent_id}/{content_id}/{NN_*.png|jpg}
-- so the first path segment is the owning agent (matches the policy), and
-- re-posting the same content overwrites (upsert) rather than duplicating.
--
-- Additive change to the shared/live DB (new bucket + policies); nothing
-- existing reads it.
-- ============================================================

-- 1. Create the public bucket (10 MB/file headroom for composed 1080x1350
--    PNG cards; png/jpeg are all the compositor emits).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'carousel-posts',
  'carousel-posts',
  true,
  10485760, -- 10 MB max per file
  ARRAY['image/jpeg','image/jpg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 2. Storage RLS: anyone can read (bundle fetches the images by public URL).
CREATE POLICY "Public can view carousel posts"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'carousel-posts');

-- 3. Storage RLS: agents can upload/update/delete only within their own
--    top-level folder. Files are namespaced: carousel-posts/{agent_id}/...
CREATE POLICY "Agents can upload own carousel posts"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'carousel-posts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Agents can update own carousel posts"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'carousel-posts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Agents can delete own carousel posts"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'carousel-posts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
