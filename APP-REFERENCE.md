# Milestone Media — Agent Back-Office App Reference
> Share this file at the start of any session to restore full context.

---

## Live App
- **URL:** https://milestone-media-app.vercel.app
- **Hosting:** Vercel (auto-deploy from GitHub on push to main)
- **GitHub:** https://github.com/milestone-maker/milestone-media-app.git
- **Purpose:** Agent back-office dashboard — media delivery, bookings, analytics, microsites
- **Accessed from:** "Agent Login" link in website nav → https://milestonemediaphotography.com

---

## Tech Stack
- **Frontend:** React + Vite (single `App.jsx` file, all inline styles)
- **Backend:** Supabase (PostgreSQL, Auth, Storage, Row Level Security)
- **Auth:** Supabase Auth — email/password + Google OAuth
- **Storage:** Supabase Storage bucket "media" — file uploads per listing
- **Fonts:** Cormorant Garamond + Jost (Google Fonts) — matches website
- **PWA:** Installable on phones via manifest.json + service worker

---

## Supabase
- **Project ID:** cbpnjuotoxtmefmedpmj
- **URL:** https://cbpnjuotoxtmefmedpmj.supabase.co
- **Dashboard:** https://supabase.com/dashboard/project/cbpnjuotoxtmefmedpmj
- **Anon Key:** eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNicG5qdW90b3h0bWVmbWVkcG1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDcwMTMsImV4cCI6MjA4OTkyMzAxM30.T6T8ACQPwnokeajrb47kbcQ82bauu4S1z1pb9wsv5OM
- **Storage bucket:** "media" (public, 50MB file limit)
- **Storage folder structure:** `{listing-slug}/{media-type}/filename`

### Database Tables (7)
| Table | Purpose |
|-------|---------|
| `agents` | User profiles (synced from auth.users via trigger) |
| `listings` | Property listings |
| `media` | Media metadata linked to listings |
| `bookings` | Shoot bookings |
| `microsites` | Custom property microsites |
| `leads` | Lead capture from microsites |
| `analytics` | View/share/lead tracking |

### Key Database Functions
- **`is_admin()`** — `security definer` function that checks if current user has role='admin' in agents table. Used in all admin RLS policies to avoid infinite recursion.
- **Auto-profile trigger** — Automatically creates an agent profile row when a new user signs up via auth.

### Row Level Security (RLS)
- All tables have RLS enabled
- Agents can read their own data
- Admins (checked via `public.is_admin()`) can read/write all data
- The `is_admin()` function uses `security definer` to bypass RLS on the agents table (prevents infinite recursion)

### Microsites RLS (fixed March 2026)
All old listing_id-based policies were dropped and replaced with agent_id-based policies:
- **Public can view published microsites** — `FOR SELECT USING (published = true)` (no auth needed for /p/ pages)
- **Agents can insert own microsites** — `FOR INSERT WITH CHECK (agent_id = auth.uid())`
- **Agents can view own microsites** — `FOR SELECT USING (agent_id = auth.uid())`
- **Agents can update own microsites** — `FOR UPDATE USING/WITH CHECK (agent_id = auth.uid())`
- **Agents can delete own microsites** — `FOR DELETE USING (agent_id = auth.uid())`
- **Admins can select/insert/update/delete all microsites** — separate policies using `public.is_admin()`
- Migration file: `supabase/004_fix_microsites_rls.sql`

### Microsites Table Columns (after migrations)
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | Primary key |
| `listing_id` | uuid | Nullable (was NOT NULL, altered). References listings(id) |
| `agent_id` | uuid | References auth.users(id). Used for RLS |
| `theme` | text | Must be: 'Obsidian', 'Ivory', 'Slate', 'Blush' |
| `slug` | text | Unique. Used in /p/{slug} URL |
| `published` | boolean | Controls public visibility |
| `property_data` | jsonb | Stores address, city, price, beds, baths, sqft, description, features, hero_img, agent info, media_types |
| `agent_name` | text | Agent display name |
| `agent_phone` | text | Agent phone |
| `custom_domain` | text | For Luxury package custom domains |
| `notif_*` | various | Notification preferences |
| `created_at` | timestamptz | Auto-set |

---

## Google OAuth
- **Client ID:** (stored in Google Cloud Console — do not commit)
- **Client Secret:** (stored in Google Cloud Console — do not commit)
- **Google Cloud Project:** "Milestone Media" (console.cloud.google.com)
- **Authorized redirect URI:** https://cbpnjuotoxtmefmedpmj.supabase.co/auth/v1/callback
- **Configured in:** Supabase Dashboard → Authentication → Providers → Google

---

## App Structure

### Layouts (responsive)
- **Desktop (>=768px):** Top navigation bar with "Milestone Media & Photography" branding, uppercase nav links (Showcase, Book, Media, Analytics, Microsite), profile avatar. Full-width content area with "Agent Portal" section header and gold divider.
- **Mobile (<768px):** Compact header with logo + avatar, bottom tab bar with icons, content capped at 480px.

### Views / Tabs
| Tab | Component | Purpose |
|-----|-----------|---------|
| Showcase | `ShowcaseView` | Property listings with photo galleries, stats, media tags |
| Book | `BookView` | Package selection and booking |
| Media | `MediaView` | Upload/download media via Supabase Storage (admin uploads, agents download) |
| Analytics | `AnalyticsView` | View/share/lead stats per listing |
| Microsite | `MicrositeView` | Custom property microsites (build, preview, publish) |

### Public Pages (no auth required)
| Route | Component | Purpose |
|-------|-----------|---------|
| `/p/{slug}` | `PublicMicrosite` | Public property microsite — hero, gallery, 3D tour, video, agent card, lead capture |
| `/p/{slug}` | `PublicLeadCaptureForm` | Lead form embedded in microsite — inserts to leads table |

### Key Files
| File | Purpose |
|------|---------|
| `src/App.jsx` | Entire app — all components, views, auth, layouts |
| `src/supabaseClient.js` | Supabase client configuration |
| `supabase/schema.sql` | Full database schema, RLS policies, functions, triggers |
| `public/manifest.json` | PWA manifest |
| `public/sw.js` | Service worker for PWA |
| `vercel.json` | SPA rewrite rules |
| `package.json` | Dependencies (React, Vite, @supabase/supabase-js) |

---

## Brand / Design System
- **Background:** #080c16 (deep navy-black)
- **Gold accent:** #c9a84c (primary), #e5c97e (light gold), #b08d57 (dark gold)
- **Text:** #F0EDE8 (primary), #8A8680 (muted)
- **Cards:** rgba(255,255,255,0.03) bg, rgba(255,255,255,0.06) border
- **Borders:** #2A2A2A (dark), rgba(255,255,255,0.08) (subtle)
- **Heading font:** Cormorant Garamond (serif) — page titles, property addresses, prices
- **Body font:** Jost (sans-serif) — nav links, labels, body text
- **Section labels:** Gold uppercase, 11px, 0.2em letter-spacing (e.g., "AGENT PORTAL")
- **Status badges:** Green (#4ade80) for Live, Gold (#c9a84c) for In Production
- **Admin badge:** Gold bg with gold border, uppercase "ADMIN"

---

## Admin Account
- **Email:** smiles@milestonemediaphoto.com
- **Role:** admin (set in agents table)
- **Name:** Tyshawn Miles
- **Permissions:** Upload/delete media, manage all listings, full access

---

## Deploy Process
1. Make changes to code in `milestone-media-app/`
2. Commit to Git: `git add . && git commit -m "description"`
3. Push from Terminal: `git push origin main`
4. Vercel auto-deploys from GitHub (takes ~1 minute)

**Note:** Git push doesn't work from Cowork sandbox (403 proxy error). Always push manually from Terminal.

---

## Microsite Themes
Four built-in themes (stored in THEMES array in App.jsx):
| Theme | Background | Accent | Vibe |
|-------|-----------|--------|------|
| Obsidian | #0a0a0a (dark) | #c9a84c (gold) | Dark luxury |
| Ivory | #f7f4ef (light) | #8b6914 (gold) | Light elegant |
| Slate | #0d1f2d (navy) | #5fb0d8 (blue) | Professional |
| Blush | #1c1014 (dark) | #d4807a (pink-red) | Warm/romantic |

---

## Package Tiers & Microsite Access
| Package | Microsite | URL Type | How |
|---------|-----------|----------|-----|
| Essential | $50 add-on | Default Vercel URL | Agent sees upgrade prompt → notifies admin → admin enables after payment |
| Signature | Included free | Default Vercel URL (`/p/{slug}`) | Automatically available |
| Luxury | Included free | Custom domain (agent brings own) | Agent provides their domain |

---

## Planned Workflow (Next Build)

### Admin Flow
1. Admin creates a property (address, city, price, beds, baths, sqft)
2. Admin assigns it to an agent via dropdown of registered agents
3. Admin uploads media: photos, video files, 3D tour (Matterport) link
4. Admin sets the package tier (Essential, Signature, Luxury)

### Agent Flow
1. Agent logs in → sees their property on Showcase tab with delivered media
2. Agent goes to Microsite tab → sees uploaded photos from admin
3. Agent picks hero image from uploaded photos
4. Agent fills in extra details (description, highlights, email)
5. Agent selects theme → previews → publishes
6. Public microsite shows hero image, photo gallery, video, 3D tour, agent card, lead form

### Essential Package Agent Flow
1. Agent goes to Microsite tab → sees "Add Microsite — $50" upgrade prompt
2. Clicking sends notification to admin
3. Admin enables microsite access after payment
4. Agent then follows normal Agent Flow above

---

## Pending / Roadmap
- [x] **Phase 3:** Add agent portal link on Netlify website → Vercel app ✅ DONE
- [x] **Phase 4a:** Microsite builder — themes, preview, publish to Supabase ✅ DONE
- [x] **Phase 4b:** Public microsite pages at /p/{slug} — hero, agent card, lead capture ✅ DONE
- [x] **Phase 4c:** RLS fix — nuclear reset of microsites policies to agent_id-based ✅ DONE
- [ ] **Phase 4d:** Admin property creation — create listings, assign to agents, upload media
- [ ] **Phase 4e:** Connect microsites to uploaded media — photo gallery, hero selection from uploads
- [ ] **Phase 4f:** Package tier logic — Essential upgrade prompt, Signature free, Luxury custom domain
- [ ] **Phase 5:** Custom booking system (replace Rela) — built into the app
- [ ] **Phase 6:** IDX Integration (deferred until revenue justifies cost)
- [ ] Turn off email confirmation requirement in Supabase Auth settings (toggle in dashboard)
- [ ] Portfolio/gallery page on website

---

## Known Issues & Workarounds
- **Git push from sandbox:** Fails with 403. Workaround: user pushes from their own Terminal.
- **Supabase dashboard screenshots:** Sometimes render blank in browser automation. Workaround: use Monaco editor API or DOM queries.
- **RLS infinite recursion:** Fixed with `is_admin()` security definer function. Do NOT use inline subqueries on the agents table in RLS policies.
- **Email confirmation loop:** Fixed by running `UPDATE auth.users SET email_confirmed_at = now()` in SQL Editor. Consider turning off email confirmation in Auth settings.

---

## Related Files
- **Website reference:** `milestone-media-site/SITE-REFERENCE.md`
- **Database schema:** `milestone-media-app/supabase/schema.sql`
