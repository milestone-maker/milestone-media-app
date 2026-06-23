-- ============================================================
-- 053: generated_content — single_image_url for LinkedIn text-first
-- ============================================================
-- The seven LinkedIn text-first frameworks (introduced in
-- api/_content/prompts/linkedin/listing/*.js) each emit a single post body
-- with NO slides[]. Each post can be either text-only OR text + ONE clean
-- supporting image. The image choice lives on the result panel as an inline
-- picker (mirroring how Facebook and Instagram surface their photos inline
-- rather than burying them in the post modal).
--
-- For that choice to survive reload and to be authoritative at post time,
-- it has to persist on the generated_content row. The existing schema has
-- caption + hook_line + cta_line + hashtags + slides + license_number +
-- platform + framework_name + content_type; nothing applies to "one chosen
-- image for a text-first post". This migration adds one nullable column for
-- exactly that. It is INTENTIONALLY GENERIC:
--   • null = text-only (the default)
--   • a public Supabase Storage URL = the single image the agent picked
-- Other platforms can adopt the same field later (e.g. if Instagram ever
-- supports a non-carousel single post, or Facebook adds a single-image
-- variant); for now it is read only on the LinkedIn text-first path.
--
-- Design decisions:
--   • Nullable text — same shape and nullability as other optional URL
--     columns elsewhere (e.g. agent_voice_profiles.agency_logo_url).
--   • No CHECK constraint. The application validates the URL against the
--     project's Supabase Storage host allowlist at post time (the same
--     allowlist api/social-post.js already uses for imageUrls); pushing
--     that allowlist into a CHECK constraint would be brittle if the host
--     ever changes.
--   • No backfill — existing rows are text-only by definition (they
--     predate the inline picker); leaving the column NULL is the correct
--     default for them.
--   • Additive only. No DROPs. No data writes here.
-- ============================================================

alter table public.generated_content
  add column if not exists single_image_url text;

comment on column public.generated_content.single_image_url is
  'Optional single supporting image for a text-first post (LinkedIn text-first frameworks today; potentially other single-image platforms later). Null = text-only. Set by the inline Result-panel picker; read by api/social-post.js at post time. Stored as a public Supabase Storage URL from this project; validated against the storage-host allowlist at post time. Added in migration 053.';
