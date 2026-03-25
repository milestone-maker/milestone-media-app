# Milestone Media & Photography — Master Project Overview
> Share this file at the start of any new session to restore full context quickly.

---

## The Business
Tyshawn Miles runs **Milestone Media & Photography**, a professional real estate media company in Dallas–Fort Worth. Services include photography, drone, 3D virtual tours, cinematic films, custom microsites, and twilight photography for real estate agents.

---

## Two Codebases, One Brand

### 1. Website (Storefront)
- **URL:** https://milestonemediaphotography.com
- **Hosting:** Netlify (drag-and-drop deploy)
- **Folder:** `milestone-media-site/`
- **Tech:** Static HTML/CSS/JS, no frameworks
- **Purpose:** Marketing site for agents — services, packages, portfolio, booking, contact
- **Reference:** `milestone-media-site/SITE-REFERENCE.md`

### 2. App (Agent Back Office)
- **URL:** https://milestone-media-app.vercel.app
- **Hosting:** Vercel (auto-deploy from GitHub)
- **Folder:** `milestone-media-app/`
- **Tech:** React + Vite + Supabase
- **Purpose:** Agent dashboard — media delivery, bookings, analytics, microsites
- **Reference:** `milestone-media-app/APP-REFERENCE.md`

### How They Connect
- Website nav has "Agent Login" link → opens the Vercel app in a new tab
- Both share the same Supabase backend for auth and data
- Website is the public-facing storefront; app is the authenticated back office
- Phasing out Rela/ListVT — replacing with custom booking + microsites in the app

---

## Key Accounts & Credentials

| Service | Account | Notes |
|---------|---------|-------|
| Supabase | cbpnjuotoxtmefmedpmj | DB, Auth, Storage |
| Vercel | milestone-maker (GitHub) | Auto-deploy on push |
| Netlify | sparkling-granita-875740 | Drag-and-drop deploy |
| Google Cloud | "Milestone Media" project | OAuth client for Google sign-in |
| Cloudflare Workers | smiles-1d6.workers.dev | AI chat proxy |
| MailerLite | smiles@milestonemediaphoto.com | Email automation |
| GitHub | milestone-maker/milestone-media-app | App source code |

---

## Current State (as of March 25, 2026)

### Done
- Website fully built and live with hero video, AI chat widget, lead magnet, contact form
- Agent Login link added to website nav
- Supabase backend: 7 tables, RLS policies, is_admin() function, auto-profile trigger
- Auth: email/password + Google OAuth both working
- Media upload/download via Supabase Storage (admin uploads, agents view/download)
- Responsive app: desktop top-nav layout + mobile bottom tab bar
- Admin account (Tyshawn) confirmed working with admin badge
- **Microsite builder** — 4 themes (Obsidian, Ivory, Slate, Blush), form pre-populates from listing, preview, publish
- **Public microsite pages** — `/p/{slug}` renders without auth: hero image, property details, description, agent card with name/phone/initials, lead capture form (In-Person/Virtual/Offer)
- **RLS fix** — Nuclear reset of microsites policies: dropped old listing_id-based policies, replaced with clean agent_id-based INSERT/SELECT/UPDATE/DELETE + admin policies + public SELECT for published
- **Test confirmed working** — Publish → DB insert → public page renders with full data at `/p/2410-prosperity`

### Website Audit Fixes (March 24, 2026) — Deployed to Netlify
- **Hero headline** — Changed to "More Than Media. A Listing Experience."
- **Hero layout** — Text moved to lower-left (flex-end), overlay reworked: bottom-up gradient keeps text readable, top/right of screen lets video show through
- **4K hero video** — Compressed 4K MOV (565MB) → optimized MP4 (114MB, 8Mbps H.264). Dual-source: screens 1200px+ get 4K, smaller get 1080p
- **Lead magnet banner** — Reframed from "FREE DOWNLOAD" to "The Agent's Media Prep Guide — So your listing is camera-ready before we arrive."
- **Service icons** — Replaced all 6 emojis (📷🚁🌐🎬🏠🌅) with gold SVG line-art icons
- **Showcase section** — New copy: "Showcase Was the Upgrade. This Is the Shift." with subtext about control, branding, and buyer journey. Badge changed to "Beyond Showcase"
- **"Why Milestone" block** — Added above testimonials: "More than media. A listing experience." + "Most real estate media companies stop at delivery…"
- **Testimonials rebuilt** — 3-card grid with star ratings, professional template (Agent Name / REALTOR® · Brokerage Name / City, TX)
- **Buttons** — All "Book a Shoot" → "Book Your Listing"
- **Signature package** — Added "Custom property microsite" to features
- **Add-Ons** — Changed to "Property microsite (+$50)"
- **Showcase checkpoints** — Changed "Showcase-Eligible Photography" to "High-Impact Property Visuals"
- **AI chat prompt** — Updated with Zillow Showcase knowledge and microsite pricing per package

### Website Positioning Overhaul (March 25, 2026) — Deploying to Netlify
- **Hero headline** — Changed to "The New Standard for Real Estate Listings in Dallas." with label "Dallas · Fort Worth · DFW Metro"
- **Hero subtext** — "We help serious agents present listings with cinematic media, branded marketing assets, and controlled buyer experiences that feel stronger than a basic portal listing."
- **Lead magnet banner** — Moved from above hero (was hidden behind video) to below hero, above trust bar
- **Old 6-card "What We Do" services section** — Removed entirely, replaced by new dark-mode sections below
- **"More than media" section** (new, dark) — 3 cards: Cinematic Visuals, Structured Presentation, Agent Growth Assets — each with gold icon, description, and bullet list
- **"The Milestone Listing Experience" section** (new, dark, split layout) — Left: heading, description, "What's inside" card (6 bullet points), "Who it's built for" card. Right: two browser mockups — top one shows real 2410 Prosperity Dr listing with actual property photos (img_09, img_01, img_02, img_03), URL bar, price/beds/baths/sqft; bottom one shows social rollout items
- **"Beyond Showcase" section** — Expanded with comparison layout: "Where we outperform a basic portal-style experience" subhead, two side-by-side cards (Typical portal listing vs Milestone experience with 5 bullet points each), background image (img_09.jpg at 12% opacity), checkmarks remain at bottom
- **"Why Milestone" standalone block** — Removed (absorbed into the new "More than media" section)
- **View Portfolio button** — Now scrolls to #portfolio "See the Difference" section instead of linking to external Gamma site
- **Font sizes** — Bumped all 14px body text to 16px across MTM cards, comparison cards, service cards, retainer section. Package feature lists bumped from 13px to 15px
- **Beyond Showcase badge** — Increased from 10px to 18px
- **Nav tagline experiment** — Tried adding "More than media. A listing experience." under logo, reverted back to clean "Milestone Media & Photography"

### Still Needs Action (Website)
- **Zenfolio redirect** — Redirect or unpublish the old Zenfolio wedding photography site so it stops appearing in Google results. Use 301 redirect to milestonemediaphotography.com, or unpublish entirely + request removal via Google Search Console.
- **Testimonial placeholders** — Replace "Agent Name / Brokerage Name" in all 3 testimonial cards with real agent names, brokerages, and quotes.

### Next Up (Phase 4d–4f: Admin + Media + Packages)
1. **Admin property creation panel** — Admin creates listings (address, details), assigns to agent via dropdown, sets package tier
2. **Admin media upload** — Upload photos, video to Supabase Storage for a listing; paste 3D tour (Matterport) link
3. **Connect microsites to listing media** — Agent sees uploaded photos in microsite builder, picks hero image, remaining photos populate gallery on public page
4. **Package tier logic:**
   - Essential: No microsite by default → "Add Microsite — $50" upgrade prompt → notifies admin → admin enables after payment
   - Signature: Free microsite on default Vercel URL (`/p/{slug}`)
   - Luxury: Custom domain microsite (agent brings their own domain)
5. **Phase 5:** Custom booking system (replace Rela)
6. **Phase 6:** IDX Integration (deferred)
7. Website portfolio/gallery page

---

## Important Rules
1. **Website design direction** — Premium, luxury tone. No emojis, no "free" language, no coupon-y framing. Gold SVG icons, serif headlines, minimal copy.
2. **App is the back office** — it's a separate dashboard, not a replica of the website.
3. **Git push from Cowork sandbox fails** — user must push from their own Terminal.
4. **Netlify deploys** — drag the entire `milestone-media-site` folder to production deploys.
5. **RLS on agents table** — always use `public.is_admin()`, never inline subqueries (causes infinite recursion).
6. **Microsites RLS** — Use agent_id-based policies, NOT listing_id-based. Old listing_id policies caused silent insert failures.
7. **Microsite theme CHECK constraint** — theme column must be exactly: 'Obsidian', 'Ivory', 'Slate', or 'Blush'.
8. **Supabase upsert + RLS** — When RLS blocks an upsert, Supabase returns `{data: null, error: null}` silently. Always use `.select()` after upsert and check if result is empty.
9. **Package tiers** — Essential = $50 add-on for microsite. Signature = free microsite (default URL). Luxury = custom domain microsite.
10. **Website section order** — Hero (video) → Lead Magnet Banner → Trust Bar → More Than Media (3 dark cards) → Milestone Listing Experience (split layout with real listing mockup) → Beyond Showcase (comparison + bg image) → How It Works → Packages → Portfolio → Testimonials → Lead Magnet Form → Booking → Footer
11. **Listing template** — `listings/2410-prosperity/` contains a working listing site (index.html + data.json) with real property data, used as the mockup in the Milestone Listing Experience section
12. **ChatGPT mockup reference** — User provided a dark-mode SaaS-style mockup from ChatGPT. Key elements adapted: eyebrow pills, stat cards, comparison layout, browser mockups, split sections. Adapted to match existing brand (Cormorant Garamond + Jost, gold accents, dark backgrounds).
