// Vercel Serverless Function — Publish a microsite for a booking
// POST /api/publish-microsite
//   Body: { bookingId, theme, slug, propertyData }
//   Headers: Authorization: Bearer <supabase access token>
//
// This endpoint replaces the client-side publish flow that used to
// download media from the private booking-media bucket, upload it to the
// public published-media bucket, and write the microsites row directly.
// All of that now lives behind this endpoint with an entitlement check
// up front. The endpoint runs with the service-role key so it bypasses
// row-level security on storage and the microsites table; entitlement
// is enforced explicitly in code (and as defense-in-depth in the new
// migration 010_microsite_entitlement.sql).
//
// Required Vercel environment variables:
//   SUPABASE_URL              — https://cbpnjuotoxtmefmedpmj.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — service role key (also used by stripe-webhook.js
//                               and calendar.js — same variable, no new secrets)
//
// External calls: as of Stage 4 schools, this endpoint makes a best-effort
// call to bake nearby-school directory data AND the listing's geocoded
// coordinates onto the microsite — the US Census geocoder + the Urban
// Institute NCES CCD directory (both FREE, NO API key). The listing is
// geocoded ONCE; both schools and coordinates come from that single geocode.
// The coordinates are baked so the live commute tool (Stage 4 commute) has an
// origin without geocoding mid-conversation. The lookup is strictly
// non-blocking: it is wrapped in a timeout and try/catch so any slowness or
// failure resolves to schools:[] / coordinates:null and can NEVER delay or
// fail a publish.

import { createClient } from "@supabase/supabase-js";
import { checkMicrositeEntitlement } from "./_lib/entitlement.js";
import { listingPayloadFromMicrosite } from "./_lib/listingFromMicrosite.js";
import { geocodeAddress, getNearbySchoolsFromGeo } from "./_lib/schools.js";

// Best-effort, strictly non-blocking bake of schools + coordinates. Geocodes
// ONCE, then derives both from that geo. Races the whole thing against a
// timeout and swallows every failure → always resolves to
// { schools:[], coordinates:null } on any error/timeout, never throws, never
// delays the publish beyond SCHOOLS_TIMEOUT_MS.
const SCHOOLS_TIMEOUT_MS = 10000;
async function bakeSchoolsAndCoordinates(fullAddress) {
  const EMPTY = { schools: [], coordinates: null };
  try {
    const result = await Promise.race([
      (async () => {
        const geo = await geocodeAddress(fullAddress);
        if (!geo) return EMPTY;
        return {
          schools: await getNearbySchoolsFromGeo(geo),
          coordinates: { lat: geo.lat, lng: geo.lng },
        };
      })(),
      new Promise((resolve) => setTimeout(() => resolve(null), SCHOOLS_TIMEOUT_MS)),
    ]);
    if (!result || !Array.isArray(result.schools)) return EMPTY;
    return { schools: result.schools, coordinates: result.coordinates || null };
  } catch (err) {
    console.error("bakeSchoolsAndCoordinates: non-fatal error, baking empty:", err);
    return EMPTY;
  }
}

const PUBLIC_APP_BASE = "https://app.milestonemediaphotography.com";

// ── CORS helper (matches calendar.js / send-email.js style) ──────────
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

// Lazy singleton so unit tests can inject a mock via depsOverride
// without forcing a new client per request in production.
let _supabaseSingleton = null;
function defaultSupabase() {
  if (!_supabaseSingleton) {
    _supabaseSingleton = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _supabaseSingleton;
}

// Extract a Bearer token from the Authorization header.
function bearerFrom(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

// ── main handler ─────────────────────────────────────────────────────
//
// depsOverride is for unit tests only — production callers use the
// 2-arg form and the lazy default supabase singleton is used.
export default async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ── 1. Authenticate the caller ──
    const token = bearerFrom(req);
    if (!token) return res.status(401).json({ error: "missing Authorization header" });

    const supabase = depsOverride?.supabase || defaultSupabase();
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: "invalid or expired session" });
    }
    const authUser = authData.user;

    // ── 2. Resolve agent profile (for role + subscription state) ──
    const { data: profile, error: profileErr } = await supabase
      .from("agents")
      .select("id, role, is_beta, subscription_tier, subscription_status, agency_name, agency_logo_url, profile_photo_url, full_name")
      .eq("id", authUser.id)
      .single();
    if (profileErr || !profile) {
      return res.status(401).json({ error: "no agent profile for this user" });
    }
    const user = { id: profile.id, role: profile.role };
    const subscription = {
      tier: profile.subscription_tier || null,
      status: profile.subscription_status || null,
    };

    // ── 2b. Resolve brokerage name (Stage 6 white-label snapshot) ──
    //   brokerage_name lives on agent_voice_profiles (1:many per agent).
    //   Read with the service-role client (RLS-exempt) so it can be frozen
    //   into property_data below for the anonymous visitor view. Best-effort:
    //   a missing/absent row resolves to "" and never blocks the publish.
    const { data: voiceProfile } = await supabase
      .from("agent_voice_profiles")
      .select("brokerage_name")
      .eq("agent_id", authUser.id)
      .limit(1)
      .maybeSingle();

    // ── 3. Validate request body ──
    const { bookingId, theme, slug, propertyData } = req.body || {};
    if (!bookingId || !theme || !slug || !propertyData) {
      return res.status(400).json({
        error: "bookingId, theme, slug, and propertyData are required",
      });
    }

    // ── 4. Fetch the booking ──
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("id, agent_id, invoice_paid, selected_package, selected_addons, address")
      .eq("id", bookingId)
      .single();
    if (bookingErr || !booking) {
      return res.status(404).json({ error: "booking not found" });
    }

    // ── 4b. Existing microsite for this booking (path 3) ──
    //   If the agent already owns a microsite for this booking, it stays
    //   editable / re-publishable regardless of the booking's original
    //   package or invoice state. Owner-scoped so it can only ever match
    //   the caller's own row. property_data->>'booking_id' is a text match
    //   on the JSONB blob the publish step writes (see step 8).
    const { data: existingMicrosite } = await supabase
      .from("microsites")
      .select("id, agent_id")
      .eq("agent_id", user.id)
      .eq("property_data->>booking_id", bookingId)
      .limit(1)
      .maybeSingle();

    // ── 5. Entitlement check ──
    const { entitled, reason } = checkMicrositeEntitlement(user, booking, subscription, {
      isBeta: profile.is_beta === true,
      existingMicrosite: existingMicrosite || null,
    });
    if (!entitled) {
      return res.status(403).json({ error: reason });
    }

    // ── 6. Fetch booking media ──
    //
    // Order by sort_order ASC NULLS LAST with created_at ASC as a stable
    // tiebreaker. Migration 007 added sort_order specifically so first-
    // uploaded comes first; the UI (Microsite/index.jsx) sorts the same
    // way so client and server agree on which photo is "first."
    const { data: mediaRows, error: mediaErr } = await supabase
      .from("booking_media")
      .select("*")
      .eq("booking_id", bookingId)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (mediaErr) {
      console.error("booking_media fetch error:", mediaErr);
      return res.status(500).json({ error: "failed to load booking media" });
    }

    // ── 7. Copy private booking files → public published-media bucket ──
    //
    // While copying, we also build an id → publishedUrl map so the hero
    // resolution in step 8 can take the agent's heroMediaId pick (a
    // booking_media row id) and return the matching public URL. Agents
    // work with signed private URLs in the UI that can't be stored as
    // the hero, so we resolve by id, not by URL.
    const publishedPhotos = [];
    const publishedUrlForId = Object.create(null);
    let publishedVideo = null;

    for (const item of (mediaRows || [])) {
      // 3D tour items are just URLs in the row — nothing to copy.
      if (item.file_type === "3d_tour" || !item.file_path) continue;

      const { data: blob, error: dlErr } = await supabase
        .storage
        .from("booking-media")
        .download(item.file_path);
      if (dlErr || !blob) {
        console.error("download error for", item.file_path, dlErr);
        continue;
      }

      const fileName = item.file_path.split("/").pop();
      const destPath = `${slug}/${fileName}`;
      const { error: upErr } = await supabase
        .storage
        .from("published-media")
        .upload(destPath, blob, { upsert: true, contentType: blob.type });
      if (upErr) {
        console.error("upload to published-media error:", upErr);
        continue;
      }

      const { data: pubUrlData } = supabase
        .storage
        .from("published-media")
        .getPublicUrl(destPath);
      const publicUrl = pubUrlData?.publicUrl;
      if (!publicUrl) continue;

      // Record id→url for every successfully published item, including
      // video — a future framework that wants a video hero can use the
      // same lookup.
      publishedUrlForId[item.id] = publicUrl;

      if (item.file_type === "video") {
        publishedVideo = publicUrl;
      } else {
        publishedPhotos.push(publicUrl);
      }
    }

    // ── 8. Build the final property_data, preserving every other field ──
    //    Field name translation mirrors the original client-side handlePublish:
    //    camelCase form fields → snake_case database fields.
    //
    // Hero resolution precedence (Phase 2 fix — Bug #4 + N13 + N17):
    //   1. propertyData.heroMediaId → publishedUrlForId[heroMediaId]
    //      (agent's explicit pick, resolved to a published-media URL)
    //   2. publishedPhotos[0]
    //      (auto-fallback: first photo in sort_order, matches UI default)
    //   3. propertyData.heroImg
    //      (legacy fallback for pre-fix clients still sending only a URL;
    //       only useful if it's already a published-media URL)
    //   4. "" (no media at all)
    let galleryPhotos = publishedPhotos;
    let heroImg = "";
    let heroMediaId = "";
    if (propertyData.heroMediaId && publishedUrlForId[propertyData.heroMediaId]) {
      heroImg = publishedUrlForId[propertyData.heroMediaId];
      heroMediaId = propertyData.heroMediaId;
    } else if (publishedPhotos[0]) {
      heroImg = publishedPhotos[0];
      // Find the id that produced this URL so hero_media_id is still
      // written — lets future in-place hero edits resolve by id without
      // a second publish cycle.
      heroMediaId = Object.keys(publishedUrlForId)
        .find(id => publishedUrlForId[id] === publishedPhotos[0]) || "";
    } else if (propertyData.heroImg) {
      heroImg = propertyData.heroImg;
      heroMediaId = "";
    }
    let videoUrl = publishedVideo || propertyData.videoUrl || "";

    // Pull the matterport / 3D tour URL from the media rows if present
    const tourRow = (mediaRows || []).find(m => m.file_type === "3d_tour");
    const matterportUrl = tourRow?.tour_url || tourRow?.url || propertyData.matterportUrl || "";

    // Nearby schools + coordinates — baked once at publish (a snapshot), read
    // back by the chat. Build the full address from the street + the city
    // field (which holds city/state/zip together, e.g. "Prosper, Texas,
    // 75078"). One geocode yields both. Strictly non-blocking:
    // bakeSchoolsAndCoordinates never throws and is capped by a timeout.
    const fullAddress = [propertyData.address, propertyData.city]
      .map((p) => (p || "").trim())
      .filter(Boolean)
      .join(", ");
    const { schools: bakedSchools, coordinates: bakedCoordinates } = fullAddress
      ? await bakeSchoolsAndCoordinates(fullAddress)
      : { schools: [], coordinates: null };

    const finalPropertyData = {
      address: propertyData.address || "",
      city: propertyData.city || "",
      price: propertyData.price || "",
      beds: propertyData.beds || "",
      baths: propertyData.baths || "",
      sqft: propertyData.sqft || "",
      description: propertyData.description || "",
      features: Array.isArray(propertyData.features) ? propertyData.features.filter(Boolean) : [],
      media_types: Array.isArray(propertyData.mediaTypes) ? propertyData.mediaTypes : [],
      agent_name: propertyData.agentName || "",
      agent_phone: propertyData.agentPhone || "",
      agent_email: propertyData.agentEmail || "",
      // Stage 6 white-label: snapshot the agent's branding so the anonymous
      // visitor view can read it from property_data (the agents and
      // agent_voice_profiles tables are not anon-readable).
      agency_name: profile.agency_name || "",
      agency_logo_url: profile.agency_logo_url || "",
      profile_photo_url: profile.profile_photo_url || "",
      brokerage_name: voiceProfile?.brokerage_name || "",
      hero_img: heroImg,
      hero_media_id: heroMediaId,
      listing_id: propertyData.listingId || null,
      booking_id: bookingId,
      source_type: "booking",
      matterport_url: matterportUrl,
      video_url: videoUrl,
      floorplan_url: propertyData.floorplanUrl || null,
      gallery_photos: galleryPhotos,
      schools: bakedSchools,
      coordinates: bakedCoordinates,
    };

    // ── 9. Upsert microsite row (service-role; bypasses RLS) ──
    //    Existing row for (slug, agent_id) → UPDATE. Otherwise INSERT.
    //    Match the same agent-scoped behaviour the client previously
    //    enforced (never overwrite another agent's slug).
    const micrositeData = {
      agent_id: user.id,
      slug,
      theme,
      published: true,
      // Clear any prior retirement: (re)publishing restores LIVE. Keeps the
      // canonical "published = true AND retired_at IS NULL" definition
      // coherent so a re-published microsite counts against the live cap.
      retired_at: null,
      property_data: finalPropertyData,
      agent_name: finalPropertyData.agent_name,
      agent_phone: finalPropertyData.agent_phone,
    };

    const { data: existing } = await supabase
      .from("microsites")
      .select("id")
      .eq("slug", slug)
      .eq("agent_id", user.id)
      .maybeSingle();

    let saved, writeErr;
    if (existing?.id) {
      ({ data: saved, error: writeErr } = await supabase
        .from("microsites")
        .update(micrositeData)
        .eq("id", existing.id)
        .select()
        .single());
    } else {
      ({ data: saved, error: writeErr } = await supabase
        .from("microsites")
        .insert(micrositeData)
        .select()
        .single());
    }

    if (writeErr) {
      console.error("microsite write error:", writeErr);
      return res.status(500).json({ error: "failed to save microsite: " + writeErr.message });
    }

    // ── 9b. Additively mirror the microsite into a public.listings row ──
    //
    //   In the target model a published microsite IS a listing (1:1), and the
    //   Content tab reads listings (scoped by agent_id). So after the microsite
    //   write we keep a linked listings row in sync, using the SAME service-role
    //   client that just wrote the microsite.
    //
    //   STRICTLY NON-BLOCKING / additive: the microsite is the source of truth.
    //   The entire block is wrapped in try/catch — on ANY failure we log a
    //   warning and fall through; the publish still succeeds and the existing
    //   response shape is preserved. `linked_listing_id` is added to the
    //   response additively (null on failure) and never replaces a field.
    //
    //   Republish-safe idempotency: if the microsite already links a listings
    //   row that still exists → UPDATE it; otherwise INSERT a fresh row and set
    //   microsites.listing_id to it. Repeated republishes never duplicate.
    let linkedListingId = null;
    try {
      const listingPayload = listingPayloadFromMicrosite({
        propertyData: saved.property_data,
        agentId:      saved.agent_id,
      });

      let existingListing = null;
      if (saved.listing_id) {
        const { data: lr } = await supabase
          .from("listings")
          .select("id")
          .eq("id", saved.listing_id)
          .maybeSingle();
        existingListing = lr || null;
      }

      if (existingListing?.id) {
        // Linked listing still exists → update it from the mapping (no insert).
        const { error: updErr } = await supabase
          .from("listings")
          .update(listingPayload)
          .eq("id", existingListing.id);
        if (updErr) throw updErr;
        linkedListingId = existingListing.id;
      } else {
        // No (or stale) link → create a fresh listings row and link it back.
        const { data: newListing, error: insErr } = await supabase
          .from("listings")
          .insert({ ...listingPayload, created_at: new Date().toISOString() })
          .select("id")
          .single();
        if (insErr) throw insErr;
        linkedListingId = newListing.id;

        const { error: linkErr } = await supabase
          .from("microsites")
          .update({ listing_id: linkedListingId })
          .eq("id", saved.id);
        if (linkErr) throw linkErr;
      }
    } catch (listingErr) {
      // Best-effort mirror — never deny the agent their published microsite.
      console.warn(
        "[publish-microsite] listing mirror failed (publish still succeeded):",
        listingErr?.message || listingErr
      );
      linkedListingId = null;
    }

    // ── 10. Done ──
    return res.json({
      slug,
      liveUrl: `${PUBLIC_APP_BASE}/p/${slug}`,
      microsite: saved,
      linked_listing_id: linkedListingId,
    });
  } catch (err) {
    console.error("publish-microsite error:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}
