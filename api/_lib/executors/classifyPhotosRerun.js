// Stage 2b executor — re-run classify-photos for a listing whose original
// classification had a partial or all-chunks failure.
//
// Scope: kind='classify_photos_partial_failure' only.
//
// What this executor does:
//   1. Read listing_id from row.subject_id; agentId from row.agent_id.
//   2. Verify the listing is owned by that agent (defense in depth).
//   3. Call classifyForListing({supabase, listing_id, force: false}) — the
//      same core the HTTP handler uses. force=false means agent_corrected
//      rows are never touched and already-labeled photos are skipped. Only
//      the previously-missing (or previously-failed) photos get classified.
//   4. Map the core's return to the executor outcome shape.
//
// Never throws — a caught error becomes { outcome:'failed', ... }.
//
// Idempotency: the core's selection filter + upsert(onConflict) guarantee
// that a repeated run produces the same end state.

import { createClient } from "@supabase/supabase-js";
import { classifyForListing } from "../classifyPhotosCore.js";

let _supabase = null;
function serviceRoleClient() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabase = createClient(url, key);
  return _supabase;
}

function safeStringify(v) {
  try { return JSON.stringify(v); } catch {
    try { return String(v); } catch { return "<unserializable>"; }
  }
}

/**
 * @param {{ row: object, supabase?: object }} args
 * @returns {Promise<{ outcome:'fixed'|'failed', notes:string, errorMessage?:string }>}
 */
export async function classifyPhotosRerun({ row, supabase } = {}) {
  try {
    const client = supabase || serviceRoleClient();
    if (!client) {
      return {
        outcome: "failed",
        notes: "classify-rerun: service-role client not configured",
        errorMessage: "supabase not configured",
      };
    }

    const listingId = row?.subject_id ? String(row.subject_id) : null;
    const agentId   = row?.agent_id   ? String(row.agent_id)   : null;

    if (!listingId) {
      return {
        outcome: "failed",
        notes: "classify-rerun: missing subject_id (expected a listing_id)",
        errorMessage: "missing listing_id",
      };
    }

    // ── 2. Verify listing ownership (agentId may be null — allow if missing
    //       but if provided, must match).
    const { data: listing, error: lErr } = await client
      .from("listings")
      .select("id, agent_id")
      .eq("id", listingId)
      .maybeSingle();
    if (lErr) {
      return {
        outcome: "failed",
        notes: `classify-rerun: listing lookup error: ${lErr.message}`,
        errorMessage: lErr.message,
      };
    }
    if (!listing) {
      return {
        outcome: "failed",
        notes: `classify-rerun: listing ${listingId} not found`,
        errorMessage: "listing not found",
      };
    }
    if (agentId && listing.agent_id !== agentId) {
      return {
        outcome: "failed",
        notes: `classify-rerun: listing ${listingId} is not owned by agent ${agentId}`,
        errorMessage: "ownership mismatch",
      };
    }

    // ── 3. Call the shared core with force=false ──
    const result = await classifyForListing({
      supabase: client,
      listing_id: listingId,
      force: false,
    });

    // ── 4. Map to executor outcome ──
    if (!result.ok) {
      return {
        outcome: "failed",
        notes: `classify-rerun: core returned ${result.statusCode}: ${safeStringify(result.body)}`,
        errorMessage: result.body?.error || `core statusCode ${result.statusCode}`,
      };
    }

    const classified = result.body?.classified_count ?? 0;
    const warnings   = result.warnings || [];
    if (classified === 0 && warnings.length === 0) {
      return {
        outcome: "fixed",
        notes: "classify-rerun: already complete, no re-run needed",
      };
    }
    return {
      outcome: "fixed",
      notes: `classify-rerun: classified ${classified} new; warnings=${warnings.length}`,
    };
  } catch (err) {
    return {
      outcome: "failed",
      notes: `classify-rerun threw: ${err?.message || String(err)}`,
      errorMessage: err?.message || String(err),
    };
  }
}
