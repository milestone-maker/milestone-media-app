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

import { createClient } from "@supabase/supabase-js";
import { checkMicrositeEntitlement } from "./_lib/entitlement.js";

const PUBLIC_APP_BASE = "https://app.milestonemediaphotography.com";

// ── CORS helper (matches calendar.js / send-email.js style) ──────────
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function getServiceClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Extract a Bearer token from the Authorization header.
function bearerFrom(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

// ── main handler ─────────────────────────────────────────────────────
export default async function handler(req, res) {
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

    const supabase = getServiceClient();
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: "invalid or expired session" });
    }
    const authUser = authData.user;

    // ── 2. Resolve agent profile (for role) ──
    const { data: profile, error: profileErr } = await supabase
      .from("agents")
      .select("id, role")
      .eq("id", authUser.id)
      .single();
    if (profileErr || !profile) {
      return res.status(401).json({ error: "no agent profile for this user" });
    }
    const user = { id: profile.id, role: profile.role };

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

    // ── 5. Entitlement check ──
    const { entitled, reason } = checkMicrositeEntitlement(user, booking);
    if (!entitled) {
      return res.status(403).json({ error: reason });
    }

    // ── 6. Fetch booking media ──
    const { data: mediaRows, error: mediaErr } = await supabase
      .from("booking_media")
      .select("*")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false });
    if (mediaErr) {
      console.error("booking_media fetch error:", mediaErr);
      return res.status(500).json({ error: "failed to load booking media" });
    }

    // ── 7. Copy private booking files → public published-media bucket ──
    const publishedPhotos = [];
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

      if (item.file_type === "video") {
        publishedVideo = publicUrl;
      } else {
        publishedPhotos.push(publicUrl);
      }
    }

    // ── 8. Build the final property_data, preserving every other field ──
    //    Field name translation mirrors the original client-side handlePublish:
    //    camelCase form fields → snake_case database fields.
    let galleryPhotos = publishedPhotos;
    let heroImg = publishedPhotos[0] || propertyData.heroImg || "";
    let videoUrl = publishedVideo || propertyData.videoUrl || "";

    // Pull the matterport / 3D tour URL from the media rows if present
    const tourRow = (mediaRows || []).find(m => m.file_type === "3d_tour");
    const matterportUrl = tourRow?.tour_url || tourRow?.url || propertyData.matterportUrl || "";

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
      hero_img: heroImg,
      listing_id: propertyData.listingId || null,
      booking_id: bookingId,
      source_type: "booking",
      matterport_url: matterportUrl,
      video_url: videoUrl,
      floorplan_url: propertyData.floorplanUrl || null,
      gallery_photos: galleryPhotos,
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

    // ── 10. Done ──
    return res.json({
      slug,
      liveUrl: `${PUBLIC_APP_BASE}/p/${slug}`,
      microsite: saved,
    });
  } catch (err) {
    console.error("publish-microsite error:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}
