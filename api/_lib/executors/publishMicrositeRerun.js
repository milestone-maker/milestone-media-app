// Stage 2b executor — retry the single storage move that failed during
// api/publish-microsite.js.
//
// Scope: kind='publish_microsite_storage_move_failed' only. Other publish-
// microsite failure kinds ('publish_microsite_write_failed',
// 'publish_microsite_handler_error') are deliberately NOT covered — those
// leave no microsite row and no propertyData to reconstruct.
//
// What this executor does (per incident, per file):
//   1. Read {file_path, file_type, slug} from row.payload; bookingId from
//      row.subject_id; agentId from row.agent_id.
//   2. Verify the booking is owned by that agent (defense in depth).
//   3. Look up the specific booking_media row by (booking_id, file_path).
//   4. Download from `booking-media/${file_path}`.
//   5. Upload to `published-media/${slug}/${filename}` with upsert:true —
//      matches the write pattern the original publish handler uses at
//      api/publish-microsite.js:267 so a duplicate write is a byte-for-byte
//      overwrite.
//   6. Resolve the public URL.
//   7. Look up the existing microsite row (owner-scoped) and patch its
//      property_data: append the URL to gallery_photos if missing, or set
//      video_url if this is a video and it's not already set. If nothing
//      changed, skip the UPDATE entirely — public.microsites has no
//      updated_at column to bump, and the incident's own resolved_at +
//      notes are the audit trail.
//   8. Return { outcome, notes }.
//
// Never throws — a caught error becomes { outcome:'failed', ... }.
//
// Idempotency:
//   * Storage upload uses upsert:true (byte-for-byte overwrite).
//   * gallery_photos gets a `.includes()` guard before appending.
//   * video_url is only set when different.
//   * The microsite row is patched by id → no accidental cross-agent writes.

import { createClient } from "@supabase/supabase-js";

let _supabase = null;
function serviceRoleClient() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabase = createClient(url, key);
  return _supabase;
}

/**
 * @param {{ row: object, supabase?: object }} args
 * @returns {Promise<{ outcome:'fixed'|'failed', notes:string, errorMessage?:string }>}
 */
export async function publishMicrositeRerun({ row, supabase } = {}) {
  try {
    const client   = supabase || serviceRoleClient();
    if (!client) {
      return { outcome: "failed", notes: "publish-rerun: service-role client not configured", errorMessage: "supabase not configured" };
    }

    const bookingId = row?.subject_id ? String(row.subject_id) : null;
    const agentId   = row?.agent_id   ? String(row.agent_id)   : null;
    const payload   = row?.payload    || {};
    const filePath  = typeof payload.file_path === "string" ? payload.file_path : null;
    const fileType  = typeof payload.file_type === "string" ? payload.file_type : null;
    const slug      = typeof payload.slug      === "string" ? payload.slug      : null;

    if (!bookingId || !agentId || !filePath || !slug) {
      return {
        outcome: "failed",
        notes: "publish-rerun: missing bookingId/agentId/file_path/slug on incident row",
        errorMessage: "missing identifiers",
      };
    }

    // ── 2. Verify booking ownership ──
    const { data: booking, error: bkErr } = await client
      .from("bookings")
      .select("id, agent_id")
      .eq("id", bookingId)
      .maybeSingle();
    if (bkErr) {
      return { outcome: "failed", notes: `publish-rerun: booking lookup error: ${bkErr.message}`, errorMessage: bkErr.message };
    }
    if (!booking) {
      return { outcome: "failed", notes: `publish-rerun: booking ${bookingId} not found`, errorMessage: "booking not found" };
    }
    if (booking.agent_id !== agentId) {
      return { outcome: "failed", notes: `publish-rerun: booking ${bookingId} is not owned by agent ${agentId}`, errorMessage: "ownership mismatch" };
    }

    // ── 3. Look up the specific booking_media row ──
    const { data: mediaRow, error: mErr } = await client
      .from("booking_media")
      .select("id, file_path, file_type")
      .eq("booking_id", bookingId)
      .eq("file_path", filePath)
      .maybeSingle();
    if (mErr) {
      return { outcome: "failed", notes: `publish-rerun: booking_media lookup error: ${mErr.message}`, errorMessage: mErr.message };
    }
    if (!mediaRow) {
      return {
        outcome: "failed",
        notes: `publish-rerun: no booking_media row for file_path=${filePath} in booking ${bookingId}`,
        errorMessage: "media row not found",
      };
    }

    // ── 4. Look up the existing microsite (owner-scoped) ──
    const { data: microsite, error: msErr } = await client
      .from("microsites")
      .select("id, agent_id, property_data")
      .eq("agent_id", agentId)
      .eq("property_data->>booking_id", bookingId)
      .limit(1)
      .maybeSingle();
    if (msErr) {
      return { outcome: "failed", notes: `publish-rerun: microsite lookup error: ${msErr.message}`, errorMessage: msErr.message };
    }
    if (!microsite) {
      return {
        outcome: "failed",
        notes: `publish-rerun: no existing microsite for booking ${bookingId} (cannot repair storage without full publish)`,
        errorMessage: "no existing microsite",
      };
    }

    // ── 5. Download from booking-media ──
    const { data: blob, error: dlErr } = await client
      .storage
      .from("booking-media")
      .download(filePath);
    if (dlErr || !blob) {
      return {
        outcome: "failed",
        notes: `publish-rerun: download error for ${filePath}: ${dlErr?.message || "no blob"}`,
        errorMessage: dlErr?.message || "download blob missing",
      };
    }

    // ── 6. Upload to published-media/{slug}/{filename} with upsert:true ──
    const fileName = filePath.split("/").pop();
    const destPath = `${slug}/${fileName}`;
    const { error: upErr } = await client
      .storage
      .from("published-media")
      .upload(destPath, blob, { upsert: true, contentType: blob.type });
    if (upErr) {
      return {
        outcome: "failed",
        notes: `publish-rerun: upload error to published-media/${destPath}: ${upErr.message}`,
        errorMessage: upErr.message,
      };
    }

    // ── 7. Resolve public URL ──
    const { data: pubUrlData } = client
      .storage
      .from("published-media")
      .getPublicUrl(destPath);
    const publicUrl = pubUrlData?.publicUrl;
    if (!publicUrl) {
      return {
        outcome: "failed",
        notes: `publish-rerun: could not resolve publicUrl for ${destPath}`,
        errorMessage: "no publicUrl",
      };
    }

    // ── 8. Patch microsite.property_data — idempotent ──
    const pd = { ...(microsite.property_data || {}) };
    const effectiveFileType = fileType || mediaRow.file_type || "photo";
    let changed = false;
    const notesParts = [];

    if (effectiveFileType === "video") {
      if (pd.video_url !== publicUrl) {
        pd.video_url = publicUrl;
        changed = true;
        notesParts.push("video_url set");
      } else {
        notesParts.push("video_url already correct");
      }
    } else {
      const existing = Array.isArray(pd.gallery_photos) ? pd.gallery_photos : [];
      if (!existing.includes(publicUrl)) {
        pd.gallery_photos = [...existing, publicUrl];
        changed = true;
        notesParts.push(`gallery_photos appended (now ${pd.gallery_photos.length})`);
      } else {
        notesParts.push("already in gallery_photos");
      }
    }

    // If property_data actually changed, patch it. Otherwise skip the UPDATE
    // entirely — public.microsites has no updated_at column to bump, and the
    // incident's own resolved_at + notes + the Slack follow-up are the audit
    // trail for the run. No row mutation is needed as evidence.
    if (!changed) {
      return {
        outcome: "fixed",
        notes: `publish-rerun: file_path=${filePath} → published-media/${destPath}; ${notesParts.join("; ")}; row unchanged (no property_data delta)`,
      };
    }

    const { error: patchErr } = await client
      .from("microsites")
      .update({ property_data: pd })
      .eq("id", microsite.id)
      .eq("agent_id", agentId); // defense in depth
    if (patchErr) {
      return {
        outcome: "failed",
        notes: `publish-rerun: microsite patch error: ${patchErr.message}`,
        errorMessage: patchErr.message,
      };
    }

    return {
      outcome: "fixed",
      notes: `publish-rerun: file_path=${filePath} → published-media/${destPath}; ${notesParts.join("; ")}`,
    };
  } catch (err) {
    return {
      outcome: "failed",
      notes: `publish-rerun threw: ${err?.message || String(err)}`,
      errorMessage: err?.message || String(err),
    };
  }
}
