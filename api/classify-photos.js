// Vercel Serverless Function — Photo Intelligence: classify listing photos.
// POST /api/classify-photos
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    { listing_id, force? }
//
// Flow:
//   1. CORS + method guard
//   2. Bearer auth → supabase.auth.getUser
//   3. agents-row load → subscription gate (402 for unsubscribed non-admins;
//      admins bypass)
//   4. Service-role load of the listing; ownership check (admin → any
//      listing; otherwise listing.agent_id must equal the caller)
//   5. Delegate the actual work (microsite resolution, photo list, selection
//      preserving agent corrections, chunked classify, upsert, re-read) to
//      classifyForListing() in api/_lib/classifyPhotosCore.js. HTTP contract
//      is byte-identical to the pre-refactor handler: same response body
//      shape, same status codes, same warnings-only-when-present behavior.
//
// Stage 2b addition: when at least one classify chunk failed (either partial
// with some succeeding, or all-failed → 502), emit a
// 'classify_photos_partial_failure' incident so the auto-remediation
// executor can re-run the listing (force=false; agent_corrected rows are
// safe, already-labeled photos are skipped).
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY            (read by @anthropic-ai/sdk inside engine)

import { createClient } from "@supabase/supabase-js";
import { hasFeatureAccess } from "./_lib/subscription.js";
import { withSentry } from "./_lib/sentry.js";
import { classifyForListing } from "./_lib/classifyPhotosCore.js";
import { logIncident } from "./_lib/incidents.js";

// ── module-load deps (overridable via depsOverride for tests) ────────
const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _supabaseSingleton = null;
function defaultSupabase() {
  if (!_supabaseSingleton) {
    _supabaseSingleton = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabaseSingleton;
}

// ── helpers ──────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function bearerFrom(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

// ── main handler ─────────────────────────────────────────────────────

async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = depsOverride?.supabase || defaultSupabase();

  try {
    // ── 1. Auth ──
    const token = bearerFrom(req);
    if (!token) return res.status(401).json({ error: "missing Authorization header" });

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: "invalid or expired session" });
    }
    const authUser = authData.user;

    // ── 1b. Subscription gate (mirrors content-generate.js; admins exempt) ──
    const { data: agentRow, error: agentErr } = await supabase
      .from("agents")
      .select("role, subscription_status, is_beta, beta_expires_at")
      .eq("id", authUser.id)
      .maybeSingle();
    if (agentErr) {
      console.error("[classify-photos] agent lookup error:", agentErr);
      return res.status(500).json({ error: "agent lookup failed", details: agentErr.message });
    }
    if (!agentRow) {
      return res.status(401).json({ error: "no agent profile for this user" });
    }
    const isAdmin = agentRow.role === "admin";
    if (!isAdmin && !hasFeatureAccess(agentRow)) {
      return res.status(402).json({ error: "subscription_required" });
    }

    // ── 2. Validate body ──
    const body = req.body || {};
    const { listing_id } = body;
    const force = body.force === true;
    if (!listing_id) return res.status(400).json({ error: "listing_id is required" });

    // ── 3. Load + ownership-check listing ──
    const { data: listing, error: lErr } = await supabase
      .from("listings")
      .select("*")
      .eq("id", listing_id)
      .maybeSingle();
    if (lErr) {
      console.error("[classify-photos] listing fetch error:", lErr);
      return res.status(500).json({ error: "listing fetch failed", details: lErr.message });
    }
    if (!listing) return res.status(404).json({ error: "listing not found" });
    if (!isAdmin && listing.agent_id !== authUser.id) {
      return res.status(403).json({ error: "listing does not belong to caller" });
    }

    // ── 4. Delegate the work to the shared core ──
    const result = await classifyForListing({
      supabase,
      listing_id,
      force,
      model:          depsOverride?.model,
      maxTokens:      depsOverride?.maxTokens,
      classifyImages: depsOverride?.classifyImages,
    });

    // ── 5. Stage 2b: emit a partial-failure incident when at least one
    //       chunk failed. Fires on partial (some chunks OK) AND all-failed
    //       (502 → the whole classification failed). Never fires when all
    //       chunks succeeded, even if there were dropped-category warnings
    //       (those are normal validation events, not a retryable failure).
    if (result.chunks_failed > 0) {
      await logIncident({
        source: "handler",
        kind: "classify_photos_partial_failure",
        severity: "medium",
        subjectType: "listing",
        subjectId: listing_id,
        dedupeKey: `listing:${listing_id}:${Math.floor(Date.now() / 3600000)}`,
        agentId: authUser.id,
        payload: {
          chunks_total: result.chunks_total,
          chunks_failed: result.chunks_failed,
          warnings_sample: result.warnings.slice(0, 5),
          force,
        },
        errorMessage: result.warnings.slice(0, 3).join(" | "),
      });
    }

    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error("[classify-photos] fatal:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}

export default withSentry(handler);
