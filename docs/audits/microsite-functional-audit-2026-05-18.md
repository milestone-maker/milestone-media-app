# Microsite Functional Audit — 2026-05-18

> Read-only audit of the microsite system in `milestone-media-app`. The output is a prioritized punch list for follow-up fix sessions. **No code changes were made in the audit session.**

---

## 1. Executive summary

The microsite system functions end-to-end at a basic level: an agent can pick a booking/listing as source, choose a theme, click Publish, and a public page renders at `/p/:slug` with photos pulled from the agent's media uploads. The agent-facing builder UI has a hero-picker, theme picker, and field auto-population, and the public page renders a multi-section layout (hero / gallery / video / floor plan / lead form) with theme styling.

But the system has **one P0 blocker** (the database `microsites.theme` CHECK constraint accepts only 4 of the 14 themes the UI offers, so publishing with most themes fails or has silently been worked around with untracked DB drift), **two P0 functional bugs** (the agent's hero-image selection is silently discarded at publish time; the Showcase view selects a nonexistent column on `microsites`), and **a wide assortment of P1/P2 polish issues** (no Open Graph metadata, no mobile responsiveness, snapshot-only data with no re-sync path, stale `schema.sql` relative to migrations 003/008/010/014, dead "Delivered Media" chips that read from a stored array rather than actual uploads, missing floor-plan thumbnails in MediaView, and one duplicate object key that's functionally benign but produces a build warning every deploy).

**Recommended fix order is in §6. Hero image is the most user-visible problem and the one users will keep raising, but the theme-constraint issue must be resolved first because it's likely silently broken or relying on untracked DB drift. The agent voice profile / Stage 5c content-generation system is unrelated to microsites and out of scope here.**

---

## 2. Microsite data flow

```
[Agent uploads media via MediaView]
        │
        ▼  storage bucket: listing-media/{listing_id}/{photos,drone,3d-tour,video,floorplan,twilight}/...
        │
[Bookings table also tracks per-booking media] ───┐
        │                                         │
        ▼                                         ▼  storage bucket: booking-media/{booking_id}/...
[Agent opens Microsite tab → MicrositeView]       │
        │                                         │
        ├── selects a SOURCE (listing OR booking) │
        ├── builder auto-loads photos from        │
        │   listing-media into UI as listingPhotos│
        ├── auto-picks first photo as heroImg     │
        ├── agent can override hero via picker UI │
        │   (Microsite/index.jsx:1949)            │
        ├── agent picks a theme                   │
        └── click PUBLISH ─────────────────────────┘
                                                  │
                                                  ▼
                  POST /api/publish-microsite { bookingId, theme, slug, propertyData }
                                                  │
                  [server: entitlement check via _lib/entitlement.js]
                                                  │
                  [server: download every booking_media row from booking-media bucket]
                  [server: upload each file to published-media/{slug}/...] ← NEW PUBLIC URLS
                                                  │
                  [server: build property_data JSONB snapshot:
                     - address, city, price, beds, baths, sqft, description, features, media_types
                     - agent_name, agent_phone, agent_email
                     - hero_img ← publishedPhotos[0] OR propertyData.heroImg OR ""  (see §3)
                     - listing_id, booking_id, source_type
                     - matterport_url, video_url, floorplan_url
                     - gallery_photos: array of published-media URLs
                  ]
                                                  │
                  [server: UPSERT into public.microsites (agent_id, slug, theme, property_data, ...)]
                                                  │
                                                  ▼
                  liveUrl: https://app.milestonemediaphotography.com/p/{slug}
                                                  │
                                                  ▼
[Visitor hits /p/{slug}]
        │
        ▼  client SPA: PublicMicrosite (App.jsx:283-770+)
        │
        ├── supabase.from("microsites").select("*").eq("slug", slug).eq("published", true)
        ├── reads property_data, resolves theme via THEMES catalog (src/lib/ui.jsx)
        ├── renders hero / gallery / video / floor plan / lead form
        └── lead form → INSERT into public.leads (listing_id, microsite_id, name, email, ...)
```

### Data model: snapshot, not live join
**Microsites are snapshots.** `property_data` is built once at publish and stored as JSONB on the row. The PublicMicrosite reads only from the `microsites` row — no join to `listings` or `bookings` at render time. **There is no re-sync mechanism.** If the underlying listing changes after publish (price drop, new features, more photos), the microsite shows stale data until the agent manually re-publishes. There's no "data is stale" indicator, no auto-republish hook on listing update, and no diff-view between snapshot and live source.

### Storage layout
- **`listing-media`** (public bucket) — agent's working uploads, organized by `{listing_id}/{type}/`. MediaView and the Microsite builder both read from here.
- **`booking-media`** (private bucket) — per-booking media, populated separately by AdminView for the booking flow. **The publish handler ONLY reads from booking-media**, not from listing-media. This is the source of the bucket-mismatch dimension of the hero-image bug (see §3).
- **`published-media`** (public bucket) — destination for the publish handler's copy. URLs here are what microsite visitors see.
- **`agent-branding`** (public bucket) — logos/headshots (migration 008). Surfaces on the microsite via agent_branding fields, though I did not deeply trace this in the audit.

### Fields driving the rendered page
The `PublicMicrosite` component in App.jsx reads `microsite.property_data` and renders these keys (all from the snapshot, never re-read from source):

| `property_data` key | Drives |
|---|---|
| `hero_img` | Hero section background image |
| `gallery_photos[]` | Photo gallery |
| `video_url` | Embedded video player |
| `matterport_url` | 3D tour embed |
| `floorplan_url` | Floor plan section |
| `address` / `city` / `price` / `beds` / `baths` / `sqft` | Property facts row |
| `description` / `features[]` | Description + features sections |
| `agent_name` / `agent_phone` / `agent_email` | Contact card + lead form attribution |
| `listing_id` / `booking_id` / `microsite_id` | Lead form payload |

---

## 3. Hero image investigation

### The agent CAN select a hero in the UI
`src/views/Microsite/index.jsx:1921-1958` renders a 3-column thumbnail strip of all `listingPhotos`. Clicking any thumbnail sets `data.heroImg` and shows a gold border + "Hero Photo" badge on the selected one. The UI affordance is real and functional.

### The agent's selection IS sent to the publish endpoint
`src/views/Microsite/index.jsx:1216` — `heroImg: data.heroImg` is included in the `propertyData` payload to `POST /api/publish-microsite`.

### But the server silently overrides it. Two root causes stack:

**Root cause A — precedence bug.** `api/publish-microsite.js:168`:
```js
let heroImg = publishedPhotos[0] || propertyData.heroImg || "";
```
The first element of `publishedPhotos` (the server-side post-copy URL list) always wins if any photo was uploaded. Since the publish path requires media to copy, `publishedPhotos[0]` is essentially always truthy and the agent's `propertyData.heroImg` is never consulted. **The first photo from booking media — ordered `created_at DESC` (most recent upload first) — always becomes the hero.**

**Root cause B — bucket mismatch.** Even if the precedence were swapped, the agent's `data.heroImg` is a URL from the **`listing-media`** bucket (set by Microsite/index.jsx:920 `.from("listing-media").list(...)`). The publish handler copies from **`booking-media`** → **`published-media`**. The two media sets may not even contain the same files — the agent's hero choice references a photo that may not have a corresponding row in `booking_media`, and even if the same file exists in both buckets, the URLs differ. So the publish handler would need to map the agent's listing-media URL to its corresponding published-media URL by filename (which is possible — both buckets organize files with the same filename), or accept a file identifier instead of a URL.

### Data model supports the override; the bug is in the publish logic
- `microsites.property_data` is JSONB. `hero_img` is just a key inside that JSONB blob. The data model imposes no constraint that forces hero_img to be the first photo.
- No dedicated `hero_image_id`, `hero_index`, or `hero_position` column exists, but none is needed — JSONB is flexible enough.

### Fix complexity: MEDIUM
A correct fix needs at least:
1. Swap the precedence in `publish-microsite.js:168` so `propertyData.heroImg` wins when present.
2. Either (a) map the agent's `listing-media` URL to a `published-media` URL by filename inside the copy loop, OR (b) make the UI hero picker pull from `booking-media` to match the publish source, OR (c) change the publish handler to copy from `listing-media` instead of `booking-media`. Option (c) is the cleanest if booking-media duplication isn't load-bearing elsewhere, but requires understanding what `booking-media` is for that `listing-media` isn't.
3. Optionally add a re-publish-only-hero endpoint so agents can change hero post-publish without re-uploading the entire media set (storage cost matters here — large drone files getting re-copied on every minor edit is wasteful).

**Estimate: 1–2 days for a clean fix that includes the post-publish hero-edit path. ~2 hours for a minimum viable fix that just respects the agent's initial choice.**

---

## 4. Verified known bugs

### Bug #1 — Showcase "Delivered Media" chips don't render

**Confirmed.** `src/views/Showcase/index.jsx:58`:
```js
const displayMedia = listing.media_types || (listing.package === "Luxury"
  ? ["Photos", "Drone", "3D Tour", "Film", "Floor Plan", "Microsite", "Twilight"]
  : listing.package === "Signature"
  ? ["Photos", "Drone", "Reels"]
  : ["Photos"]);
```

The chips render from `listing.media_types` (a column on `listings`, JSONB array per schema), falling back to a static list keyed on `listing.package`. Two failure modes:

- If `media_types` is `[]` (empty array — truthy in JS), `displayMedia = []` and zero chips render even though uploads exist.
- If `media_types` is `null` and `package` is also null, the fallback chain lands on `["Photos"]`, hiding any other uploaded media types.

There is **no code that writes to `listing.media_types` when uploads happen.** MediaView uploads to storage (`src/views/Media/index.jsx:79+`) but doesn't update the row. So the column drifts from reality forever.

**Fix complexity: SMALL-MEDIUM.** Either (a) compute `displayMedia` from real storage in Showcase (mirror MediaView's `fetchMedia` loop), or (b) on every upload, update `listings.media_types` to include the relevant type. Option (a) is simpler but slower; option (b) keeps the data normalized.

### Bug #2 — MediaView floor plan doesn't display

**Confirmed.** `src/views/Media/index.jsx:374`:
```js
{["Photos", "Drone", "3D Tour", "Film", "Floor Plan", "Twilight"].map((m) => {
  const count = mediaFiles[m]?.length || 0;
  const hasFiles = count > 0;
  const thumb = hasFiles && (m === "Photos" || m === "Drone" || m === "Twilight")
    ? mediaFiles[m][0].url
    : null;
  ...
```

The `thumb` allowlist excludes Floor Plan, Film, and 3D Tour from thumbnail rendering. For Floor Plan specifically, the tile renders with the file count + "View" button (line 391), but no preview image — likely the user-reported "doesn't display."

**Root cause: deliberate allowlist gap.** When the tile is clicked (`onClick={() => hasFiles ? setViewingType(m) : ...}`), the `setViewingType(m)` modal handles the file. Unless the modal has its own filter, the file IS viewable on click — just not in the tile thumbnail. (I did not trace the viewing modal in this audit; will verify when fixing.)

**Fix complexity: SMALL.** Add "Floor Plan" to the thumbnail allowlist (it's an image file, same render path works). Film + 3D Tour are video/embed types and need different handling.

### Bug #3 — Duplicate `borderLeft` key in object literal

**Confirmed.** `src/views/Microsite/index.jsx:513-515`:
```js
borderLeft: `4px solid ${t.accent}`,    // ← line 513
border: `1px solid ${t.border}`,
borderLeft: `4px solid ${t.accent}`,    // ← line 515 (duplicate, overrides line 513)
```

**Both values are identical strings** — `\`4px solid ${t.accent}\``. The second silently overrides the first, but produces the same result. Functionally benign: the rendered border looks the same either way. The bug surfaces only as a Vite/esbuild build-time warning that ships on every deploy.

**Fix complexity: SMALL.** Delete one of the duplicates. 1-line fix.

### Same-class search
Grepped `src/views/Microsite/index.jsx` for repeated style keys in adjacent lines; nothing else matched the pattern. The borderLeft instance is isolated.

### Bug #4 — Hero image cannot be changed by the agent

**Confirmed and analyzed in detail in §3.** Diagnosis: (c) — auto-selection logic exists, UI override path exists at both the picker and payload level, but the server's publish logic does the wrong fallback order AND there's a storage-bucket mismatch between what the UI hero picker references and what the publish handler copies.

---

## 5. Newly discovered issues

### P0 — Blocks beta

**N1. `microsites.theme` CHECK constraint vs UI THEMES catalog drift.** Schema's check constraint allows only `('Obsidian', 'Ivory', 'Slate', 'Blush')`. `src/lib/ui.jsx:11-32` exports 14 themes (Prestige, Dusk, Noir, Obsidian, Slate, Loft, Ember, Maison, Classic, Ivory, Blanc, Coastal, Grove, Sage). The PublicMicrosite uses `"Prestige"` as the default-class check (App.jsx:414). **No migration relaxes the constraint.** Either it was dropped manually via the Supabase dashboard (untracked drift), OR publishing with 11 of 14 themes fails server-side with a CHECK violation. Plus: the catalog includes neither "Blush" (which the constraint allows) nor any reflection of the constraint's actual allowed set. Verify with `supabase db query --linked` and either re-introduce the dropped constraint as a migration or relax it in a migration to match the catalog.

**N2. `Showcase/index.jsx:49` selects column that doesn't exist.**
```js
supabase.from("microsites").select("id, slug, theme, data, created_at")
```
There's no `data` column on `microsites` — the actual JSONB blob is `property_data`. The query returns rows with `data: null`. Wherever `setMicrosites(data)` consumers read `m.data` to render previews, they get null and likely render nothing. Either fix to `select("id, slug, theme, property_data, created_at")` or rename the consumer references.

**N3. `schema.sql` is stale relative to migrations.** `supabase/schema.sql` shows the `microsites` table with 16 columns — but migrations 003, 008, 010, 014 add `property_data`, `agent_id`, `custom_domain` and likely more (didn't read 010/014 deeply). Anyone bootstrapping a fresh Supabase project from schema.sql alone gets a broken microsites table. Should regenerate from the linked DB or treat migrations as source of truth and delete the table definitions from schema.sql.

### P1 — Noticeable to agents/buyers

**N4. No Open Graph / shareable metadata.** `index.html` has only the generic site title ("Milestone Media & Photography") and a generic description. The published microsite is a React SPA — `<title>` and `<meta>` updates client-side aren't seen by social/messaging crawlers (Facebook, X, iMessage, Slack), so sharing a microsite link produces no preview, no image, no listing-specific title. This kills the primary distribution mechanism for the microsite. Fix requires either SSR/static generation for `/p/:slug` (significant), or an edge function that serves bot user-agents a minimal HTML with og: tags (medium), or a Vercel rewrite + serverless function pattern.

**N5. No mobile responsiveness.** Skimmed inline styles across Microsite/index.jsx and App.jsx — pervasive fixed-pixel padding (`padding: "80px 40px"`), fixed grid columns (`gridTemplateColumns: "repeat(3, 1fr)"`), fixed widths (`maxWidth: 1200, padding: "60px 40px"`). Saw zero `@media` queries. Mobile viewports likely show horizontal scroll, cramped grids, and unreadable text sizes. Agents will share microsites primarily via text message; visitors will mostly open them on phones. This is a major gap for a real-estate-marketing product.

**N6. Microsite data is snapshot-only with no re-sync.** As documented in §2, listing changes after publish don't propagate. There's no "your listing has been updated — re-publish?" indicator in the agent UI, no auto-republish hook, no diff view. Agents who edit price or add features will not see those changes on their public microsite until they remember to re-publish. Severity depends on agent workflow expectations.

**N7. Public lead capture insert relies on RLS that wasn't fully traced.** `PublicLeadCaptureForm` (App.jsx:1265-1284) does an unauthenticated `supabase.from("leads").insert(...)`. For this to work, `public.leads` must have an RLS policy allowing anonymous inserts. Schema.sql comment line 237 mentions "publicly insertable (from microsite visitors)" but I didn't verify the policy is actually in place. If it isn't, lead submissions silently fail with no user-visible error other than "Failed to submit. Please try again." Worth verifying.

**N8. "Reels" / "Microsite" media types in `displayMedia` defaults don't exist as upload categories.** Showcase line 58 lists `["Photos", "Drone", "Reels"]` for Signature and `[..., "Microsite", ...]` for Luxury — but neither MediaView nor the storage layout has a "Reels" folder or a "Microsite" upload type. These chips will render but link to nothing meaningful.

**N9. The Showcase "Share" button does nothing.** `src/views/Media/index.jsx:430` renders a "Share ↗" button on the Microsite card but has no `onClick`. Cosmetic but suggests incomplete feature.

### P2 — Polish

**N10. Hardcoded mock share URL.** `src/views/Media/index.jsx:423`: `milestone.media/${listing.address.split(" ")[0].toLowerCase()}` — a fake URL string. Real URL is `app.milestonemediaphotography.com/p/{slug}`. Confusing if shown to an agent before publishing.

**N11. Theme test on string equality is brittle.** App.jsx:414 `microsite?.theme === "Prestige"`, App.jsx:520 `if (isPrestige)` etc. Theme-specific branches like this exist for at least Prestige. Adding a new theme requires hunting for these branches. Recommend a theme metadata property (`{ name: "Prestige", layout: "cinematic" }`) consumed via lookup — actually THEME_LAYOUT already does this for layout names, but the Prestige isDarkTheme-style checks are inline string checks.

**N12. `THEME_LAYOUT` references themes (Dusk, Ember, Loft) that may not appear in the publishable subset.** If the theme constraint is enforced, picking a layout that depends on Dusk would never trigger.

**N13. The hero picker auto-overrides agent's choice when photos reload.** `src/views/Microsite/index.jsx:932` and `:1031`: `setData(d => ({ ...d, heroImg: photos[0] }))` runs on every photo refetch. If the agent picks photo #4 and then the media list re-fetches (e.g., on tab switch), heroImg silently reverts to photo #1. Subtle UX bug compounding the publish-time hero-discard issue.

**N14. Theme migration for the publish endpoint isn't gated on theme validity.** `api/publish-microsite.js:91` only validates `theme` is present, not that it's a permitted value. Combined with N1, the server happily attempts to insert any theme string and lets the database reject it with a 500.

**N15. `booking_media` table not in `schema.sql`.** Only migration 007 references it. Definition is wherever it was created — probably an earlier migration not in the inventory or in a manual DB action. Same drift category as N3.

**N16. Custom domain field exists (`microsites.custom_domain`, migration 003) but no code uses it.** Dead column awaiting a Phase 2 feature; no harm but worth noting for the data model audit.

**N17. The publish handler's "most-recent upload wins" hero ordering is counterintuitive.** Even setting aside N4, the line `.order("created_at", { ascending: false })` means the LAST photo uploaded becomes the default hero — surprising to agents who think of "first" as "first I uploaded."

### Edge cases to verify in follow-up fixes

- **No photos uploaded:** Hero falls through to empty string. Public page renders broken `<img src="">`. Test what this looks like.
- **No voice profile:** Unrelated to microsites — voice profiles drive the Stage 5c content-generation system, not microsite rendering. Out of scope here.
- **Incomplete listing data:** `data.address || ""`, `data.city || ""` — empty strings render as blank in the hero section. Likely just shows as a small empty band.
- **Slug collision:** `microsites.slug` is `unique` but the upsert path is `(slug, agent_id)`. Two agents trying to publish the same slug — first writes, second fails with unique violation. No friendly handling.

---

## 6. Recommended fix order

Order is roughly by **(severity × user-visibility × dependency on other fixes)**.

### Phase 1 — Verify and stabilize the data layer (must precede any UI/styling work)

1. **N1: Verify the `microsites.theme` CHECK constraint state.** Run `supabase db query --linked` to inspect the current constraint definition. If it was dropped via dashboard, add a migration that either drops it again explicitly (codifying the drift) or rebuilds it as a wider allowlist matching the THEMES catalog. **If publishing currently fails for non-Obsidian themes, this is THE most urgent fix.** Without it, all subsequent UI work is built on a broken foundation.

2. **N3: Regenerate `schema.sql`** from the linked DB OR remove stale table defs and treat migrations as source of truth. Required so all subsequent audits aren't misled. Trivial mechanical step.

3. **N2: Fix the broken `microsites.data` → `property_data` query** in Showcase/index.jsx:49. Tiny fix, but it's currently making the Showcase microsite preview render with null data.

### Phase 2 — Hero image (the most visible user complaint)

4. **Bug #4 + sub-fixes:** Resolve the precedence inversion in publish-microsite.js, resolve the bucket mismatch, and decide whether to add a hero-only re-publish endpoint. Plan as one design session even if shipped as multiple PRs. Also fix N13 (auto-override on photo refetch) and N17 (most-recent-first ordering) at the same time since they're all part of the same user mental model.

### Phase 3 — Public surface quality

5. **N4: Open Graph metadata for `/p/:slug`.** Without this, microsite sharing doesn't work as a marketing tool. Major effort (SSR or edge function), but critical to actual usefulness.

6. **N5: Mobile responsiveness.** Most microsite visitors will be on phones. Pass over inline styles to add media-query breakpoints or replace fixed pixel values with relative units. Estimate ~2 days of styling triage.

7. **Bug #1 + N6: Delivered Media chips + snapshot staleness.** Connect chips to real upload state and decide on a re-sync UX (manual button, auto-prompt, or background refresh).

### Phase 4 — MediaView polish + small bugs

8. **Bug #2:** Add Floor Plan to thumbnail allowlist + verify viewing modal handles all types.
9. **Bug #3:** Delete the duplicate `borderLeft` line — fixes the Vite build warning.
10. **N7:** Verify `leads` table has a public-insert RLS policy. If not, add one.
11. **N8, N9, N10, N11, N12, N14:** Cleanup pass on dead/wrong references. Mostly small.

### Phase 5 — Defer until template redesign

12. **N15, N16:** Stale schema refs and unused `custom_domain` — capture but don't fix until the broader template-redesign session lands.

### Why this order
- Phase 1 protects the work in Phases 2–4 from being built on broken assumptions or invisible DB drift.
- Phase 2 is the user-visible issue most likely to surface as a support request.
- Phase 3 is the difference between "the feature technically works" and "the feature actually drives leads." Without OG metadata and mobile responsiveness, the microsite isn't a usable marketing artifact.
- Phase 4 is polish that should slot into any small-PR slot.
- Phase 5 is what's wise to wait on until you have a full template redesign in front of you, so you can decide whether to keep, drop, or repurpose dead columns.

---

## 7. Migrations needed

| # | Migration | Purpose | Notes |
|---|---|---|---|
| 1 | `XXX_microsites_theme_constraint_align.sql` | Bring `microsites.theme` CHECK constraint into agreement with `src/lib/ui.jsx` THEMES (or vice versa). Confirm current DB state first. | Blocks Phase 1. May be a no-op DB-side if the constraint was already dropped manually; if so, codify the drop. |
| 2 | (Optional) `XXX_listings_media_types_backfill.sql` | If we go the "store media_types on listing" route for Bug #1, backfill existing rows from current storage. | Only if we don't go the "compute from storage" route. |
| 3 | `XXX_leads_public_insert_policy.sql` | Only if RLS verification (N7) finds the policy is missing. | Tiny; add a permissive INSERT policy with no `using` clause. |
| 4 | (Optional, hero-fix related) | If we decide to add a `hero_image_path` text column to `microsites` so the agent can change the hero without re-publishing, add it here. | JSONB-only solution would not need a migration; this is only if we want first-class column-level support. |

No migration needed for the property_data shape — it's JSONB and the publish handler controls the schema. Adding/renaming JSONB keys is application-code work.

---

## End of audit

Generated 2026-05-18 against commit `6e3479d` (Stage 5c frameworks 4–7 deploy). Audit is read-only; no files outside `docs/audits/` were created or modified.

---

## Theme investigation (follow-up)

Read-only follow-up triggered by the user noting a previous theme-cleanup pass and wanting to confirm what survived.

### 1. Live DB constraint

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.microsites'::regclass AND contype = 'c';
```

Returns exactly one CHECK constraint:

```
microsites_theme_check
CHECK ((theme = ANY (ARRAY[
  'Prestige', 'Dusk', 'Noir', 'Obsidian', 'Slate', 'Loft', 'Ember',
  'Maison', 'Classic', 'Ivory', 'Blanc', 'Coastal', 'Grove', 'Sage'
])))
```

**14 themes allowed.** This is exactly the set in `src/lib/ui.jsx` THEMES — no drift between DB and UI catalog. The original P0 worry from the first-pass audit (untracked drift, broken publish for most themes) is downgraded: **publish works for every theme the UI offers.** The remaining concern is only that `supabase/schema.sql` still shows the original 4-theme constraint (`'Obsidian', 'Ivory', 'Slate', 'Blush'`), so the file is stale relative to live (covered by N3).

### 2. SURVIVORS vs GHOSTS

**SURVIVORS (14):** every theme in `src/lib/ui.jsx` THEMES is also in the DB constraint. None ghost-only-in-UI.

**GHOSTS (1):** `Blush` — present in the original `schema.sql` constraint, absent from both the live DB and the current UI catalog. Fully retired everywhere except in the stale schema.sql definition.

| # | Theme | DB | UI THEMES | Layout group (THEME_LAYOUT) |
|---|---|---|---|---|
| 1 | Prestige | ✓ | ✓ | cinematic *(plus dedicated render branch)* |
| 2 | Dusk | ✓ | ✓ | cinematic |
| 3 | Noir | ✓ | ✓ | split |
| 4 | Obsidian | ✓ | ✓ | cinematic |
| 5 | Slate | ✓ | ✓ | split |
| 6 | Loft | ✓ | ✓ | split |
| 7 | Ember | ✓ | ✓ | cinematic |
| 8 | Maison | ✓ | ✓ | minimal |
| 9 | Classic | ✓ | ✓ | minimal |
| 10 | Ivory | ✓ | ✓ | minimal |
| 11 | Blanc | ✓ | ✓ | minimal |
| 12 | Coastal | ✓ | ✓ | editorial |
| 13 | Grove | ✓ | ✓ | editorial |
| 14 | Sage | ✓ | ✓ | editorial |
| — | Blush | ✗ | ✗ | — *(retired)* |

### 3. Plain-English descriptions

Typography is shared across all themes (Cormorant Garamond for display, Jost for UI/body). What differentiates them is **color palette, accent character, and which of the four layout variants they trigger.** Below are the meaningfully-different vs near-duplicate readings.

**Layout group A — Cinematic (4 themes)**

- **Prestige** — Signature Milestone. Near-black `#0f0f1a` background, **gold accent** `#C9A84C`, cream tertiary `#F5ECD7`. Uses a **dedicated render path** (App.jsx:520) different from every other theme: fixed full-bleed hero background image, ticker-style auto-scrolling photo gallery, condensed nav (Gallery / Media / Details / Contact) with media sub-tabs for Cinematic Film / Virtual Tour / Floor Plan. Should be thought of as a distinct **template**, not just a color skin.
- **Dusk** — Plum-black `#1A1525` background, **lavender accent** `#9B8EC4`, with cream + champagne support colors. Same cinematic shared-render structure as Obsidian/Ember below. Mood: dramatic, evening, slightly feminine.
- **Obsidian** — Near-pure-black `#050508` background, **teal accent** `#6EC6C6`. Most minimal of the cinematic group; the accent is cool/clinical rather than warm. Distinguished from Prestige by accent only (and by not getting Prestige's dedicated render). Distinguished from Dusk by accent only.
- **Ember** — Coffee-brown `#3D2B1F` background, **terracotta accent** `#D4956A`. Same cinematic shared-render structure. Mood: warm, masculine.

**Layout group B — Split (3 themes)**

- **Noir** — Pure black `#0A0A0A` background, **crimson accent** `#C41E3A` against white text. Aggressive, fashion-magazine-ish. Highest-contrast theme overall.
- **Slate** — Slate-blue `#2C3E50` background, **muted blue accent** `#5D8AA8`. Professional, neutral, corporate-feeling. Closest "office real estate broker" theme.
- **Loft** — Charcoal `#1A1A1A` background, **mustard accent** `#C8B400`. Industrial / Brooklyn warehouse vibe. Differs from Slate by accent character (warm vs cool) and from Noir by being less aggressive in contrast.

**Layout group C — Minimal (4 themes)**

- **Maison** — Espresso-on-cream-ish background `#2C2416` (dark), **muted gold accent** `#D4A853`, white card surfaces in the swatches. French/old-world refinement. **Note: this is the only dark-background theme in the minimal group**, which is a quirk — minimal usually implies light.
- **Classic** — Navy `#1B2A4A` background, **gold accent** `#C9A84C`, cream supports. Traditional American luxury — yacht-club / equestrian.
- **Ivory** — Warm-off-white `#FAF8F5` background, near-black text, **gold accent** `#C9A84C`. The default "light luxury" theme. Same gold accent as Classic and Prestige; differs by being light-backgrounded.
- **Blanc** — Pure white `#fff` background, near-black text `#111`, **richer gold accent** `#D4AF37`. The cleanest, most magazine-like theme. **Functionally near-identical to Ivory** — both are gold-on-white minimal layouts; differences are: background warmth (cream vs pure white) and accent saturation (`#C9A84C` vs `#D4AF37`). These two are the closest pair in the catalog and would be a candidate for consolidation if any.

**Layout group D — Editorial (3 themes)**

- **Coastal** — Pale stone `#F8F5F0` background, **deep teal accent + text** `#2A4A5E`. Both background and accent visibly natural / seaside.
- **Grove** — Warm cream `#F5F0E8` background, **forest green accent + text** `#2D4A2D`. Land-side counterpart to Coastal. Same warm-cream-bg / colored-text-and-accent formula, different color family.
- **Sage** — Deep forest `#2D3D30` background (DARK), **lighter sage accent** `#5B7B6A`, white text. The only dark-background theme in the editorial group. Inverse of Grove (Grove is sage-on-cream, Sage is white-on-forest).

**Quick observations on potential duplication:**
- **Ivory ↔ Blanc**: nearly identical (light minimal + gold accent). True candidates for merging if catalog simplification is a goal.
- **Classic ↔ Ivory**: same accent (`#C9A84C`), opposite background (navy vs cream). Distinct enough to keep both.
- **Dusk / Obsidian / Ember**: same layout, differ only by background+accent color. They're "color presets" of the same template. Real but shallow differences.
- **Coastal ↔ Grove**: identical formula, different color family (sea vs land). Real product differentiator if agents serve different niches.
- **Maison**: structurally an outlier — dark theme in the minimal group. Worth confirming whether that's intentional or a misgrouping in THEME_LAYOUT.

### 4. Hardcoded theme-name references in src/

Only **three** files reference theme names as string literals:

| File:line | Reference | What it does |
|---|---|---|
| `src/lib/ui.jsx:13-29` | All 14 names | The canonical THEMES catalog. |
| `src/App.jsx:273-279` | All 14 names | `THEME_LAYOUT` map → which layout variant each theme uses. |
| `src/App.jsx:414` | `"Prestige"` | `const isPrestige = microsite?.theme === "Prestige";` — gates the dedicated Prestige render branch (line 520) and a different nav-sections layout (lines 416-426). |
| `src/App.jsx:294, 547, 633` | `prestigeMediaTab`, comment "Prestige only" | State + render code inside the `isPrestige` branch. |
| `src/views/Showcase/index.jsx:274` | `"Classic"` fallback | `{ms.theme || "Classic"}` — display fallback when a microsite row has null theme (shouldn't happen since DB defaults to `'Obsidian'` and theme is NOT NULL, but defensive). |

**The Prestige reference at App.jsx:414 is intentional and load-bearing.** It's not a ghost — it's the entry point to a substantially different render path. If a microsite has any other theme name, `isPrestige` is `false`, the shared render path runs, and `THEME_LAYOUT[theme]` picks one of the four shared layouts. **Nothing silently breaks** when a non-Prestige theme is used; the shared render handles all 13 others correctly via the layout map.

### 5. Cleanup inventory

Minimal — the catalog and DB are aligned. Items below are all stylistic / hygiene, not functional fixes.

| # | File:line | Change in one sentence |
|---|---|---|
| 1 | `supabase/schema.sql` (microsites table block, ~line 79) | Update the inline `theme text not null default 'Obsidian' check (theme in (...))` to list the 14 surviving themes, OR remove the inline check entirely if you treat migrations as source of truth. (Covered by N3 — regenerate schema.sql.) |
| 2 | `supabase/schema.sql` — same line, `'Blush'` reference | Remove `'Blush'` from the check list once schema.sql is regenerated. No code anywhere references Blush; it's already retired in DB and UI. |
| 3 | `src/App.jsx:414` (`isPrestige` check) | No change needed; intentional, load-bearing. Optionally extract to a `THEMES.find(t => t.name === microsite?.theme)?.renderVariant === "prestige"` pattern (adds a `renderVariant` field to the THEMES entries) — only worth doing if you anticipate a second theme with a dedicated render path. |
| 4 | `src/App.jsx:273-279` (THEME_LAYOUT) | Confirm Maison's grouping under `"minimal"` is intentional given it's the only dark background in that group. Either re-group to `"cinematic"` or `"split"`, or accept as designed. |
| 5 | `src/views/Showcase/index.jsx:274` (`{ms.theme || "Classic"}`) | The fallback is benign but the DB default is `'Obsidian'`, not `'Classic'`. Either change to `"Obsidian"` for consistency, or drop the fallback entirely since theme is NOT NULL. |
| 6 | New migration (optional) | If Blush retirement is to be tracked in migration history, add a no-op or commented migration documenting the manual ALTER that swapped the 4-theme constraint for the 14-theme constraint. Otherwise the DB drift remains invisible to future audits — same drift category that triggered this whole follow-up. **Strongly recommended.** |

### Net result of the investigation

**No urgent cleanup is required.** The cleanup pass the user referenced appears to have been the manual DB ALTER that expanded the theme constraint from 4 to 14 to match the UI catalog. That work succeeded — the DB and UI are aligned. The remaining items are:
- One stale file (schema.sql) — already on the punch list as N3.
- One untracked DB ALTER worth backfilling as a migration for future-audit clarity.
- One stylistic call (Maison's layout grouping).
- One trivial fallback-string fix.

The original audit's N1 (theme-constraint as P0 blocker) is **downgraded to a clarification: the constraint was tightened post-original-schema and the catalog matches.** N3 (stale schema.sql) absorbs what remains.

