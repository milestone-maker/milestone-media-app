-- ============================================================
-- 029: Photo Intelligence — photo_labels
-- ============================================================
-- Persists the vision-classification result for each listing photo: one
-- row per photo per listing. Written/updated by the photo-intelligence
-- endpoint (ships later) after content-engine classifyImages() returns,
-- and editable by the agent (category corrections set agent_corrected).
--
-- The classifier reads photos from microsites.property_data.gallery_photos
-- (public published-media URLs); those URLs are the stable per-photo
-- identity here, since gallery_photos are bare URL strings with no id.
--
-- Design decisions (mirror the closest existing analog, migration 025
-- generated_content, except where this table's shape forces a difference):
--   • Additive only — no DROPs. gen_random_uuid() PK (project convention).
--   • listing_id is a hard FK (cascade delete): labels are meaningless
--     once the owning listing is gone — same stance 025 takes.
--   • microsite_id is a soft FK (on delete set null): photos physically
--     belong to the microsite, but losing the microsite link should not
--     erase a label still attached to a live listing.
--   • UNIQUE (listing_id, photo_url) is the upsert conflict target — one
--     label row per photo per listing. Its btree index leads with
--     listing_id, so it already covers the per-listing lookup the UI does
--     (load all labels for the selected listing); NO separate listing_id
--     index is added (it would duplicate the unique index's coverage).
--   • category is constrained to the fixed eight-bucket set + 'other'.
--   • confidence is nullable (agent-corrected rows have no model score);
--     when present it must be in [0,1].
--   • RLS: this table has NO agent_id column — ownership lives on the
--     parent listings row. So the agent-scoped policies mirror 025's
--     four-verb structure but scope THROUGH the parent listing using the
--     codebase's established child-ownership idiom (see public.leads
--     policies in schema.sql + migration 024):
--         listing_id in (select id from public.listings
--                        where agent_id = auth.uid())
--     Admin access uses the existing public.is_admin() helper, exactly
--     as 025 does.
--   • created_at + updated_at both present. Unlike 025 (immutable,
--     created_at only), this table is MUTABLE (agent category
--     corrections), so it carries updated_at. There is NO shared
--     updated_at trigger function in this schema — migrations 015 and 018
--     keep updated_at columns maintained by application code rather than a
--     DB trigger (migration 015: "no shared handle_updated_at function
--     exists today"). This table follows that same convention: the
--     endpoint sets updated_at on upsert. No trigger is invented here.
-- ============================================================

create table public.photo_labels (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references public.listings(id)   on delete cascade,
  microsite_id    uuid          references public.microsites(id) on delete set null,

  photo_url       text not null,
  category        text not null check (category in (
                    'front_facade',
                    'backyard',
                    'drone',
                    'living',
                    'dining',
                    'kitchen',
                    'primary_bedroom',
                    'primary_bathroom',
                    'other'
                  )),
  features        jsonb not null default '[]'::jsonb,
  confidence      numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  sort_order      int not null default 0,
  agent_corrected boolean not null default false,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- One label row per photo per listing; the upsert conflict target.
  unique (listing_id, photo_url)
);

comment on table public.photo_labels is
  'Vision-classification result per listing photo (one row per photo per listing). Written/updated by the photo-intelligence endpoint after content-engine classifyImages(); category corrections set agent_corrected. updated_at is application-maintained (no shared trigger function in this schema).';

-- NOTE: no separate index on listing_id — the UNIQUE (listing_id, photo_url)
-- constraint's btree index leads with listing_id and already serves the
-- per-listing lookups the Content tab performs.

alter table public.photo_labels enable row level security;

-- Agent-scoped policies — mirror migration 025's four-verb structure, but
-- scope through the parent listing (no agent_id column on this table).
create policy "Agents can view labels for own listings"
  on public.photo_labels for select
  using (
    listing_id in (select id from public.listings where agent_id = auth.uid())
  );

create policy "Agents can insert labels for own listings"
  on public.photo_labels for insert
  with check (
    listing_id in (select id from public.listings where agent_id = auth.uid())
  );

create policy "Agents can update labels for own listings"
  on public.photo_labels for update
  using (
    listing_id in (select id from public.listings where agent_id = auth.uid())
  )
  with check (
    listing_id in (select id from public.listings where agent_id = auth.uid())
  );

create policy "Agents can delete labels for own listings"
  on public.photo_labels for delete
  using (
    listing_id in (select id from public.listings where agent_id = auth.uid())
  );

create policy "Admins can manage all photo labels"
  on public.photo_labels for all
  using (public.is_admin());
