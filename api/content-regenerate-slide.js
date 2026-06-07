// Vercel Serverless Function — single-card statement regeneration.
// POST /api/content-regenerate-slide
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    { voice_profile_id, listing_id, category, features? }
//   Returns: { statement }
//
// Purpose: after an agent swaps the photo on ONE carousel slide in the Stage 2
// lightbox, regenerate just THAT card's "statement-then-reveal" line so the
// wording matches the new photo's room. This is deliberately NOT the
// whole-carousel generate flow (api/content-generate.js) — it produces one
// statement in isolation from one room + the agent's voice profile.
//
// Auth + gating mirror api/content-generate.js EXACTLY:
//   1. CORS + method guard
//   2. Bearer auth → supabase.auth.getUser
//   3. Subscription gate (admins exempt) via _lib/subscription.isSubscribed
//   4. Service-role load + ownership-check of agent_voice_profiles AND listings
//      (both must belong to the calling agent)
//   5. Build the single-statement prompt (reuses subjectWithFeatures +
//      mapVoiceProfileToPromptVars + INSTAGRAM_CAPTION_SYSTEM_PROMPT)
//   6. Call the engine through the shared generateAndParseObject() helper
//   7. Validate the model returned a non-empty statement; return { statement }
//
// NOTE: unlike content-generate, this endpoint does NOT require the voice
// profile's license_number — the output is a single room statement with no
// TREC compliance line, so the 422 license guard does not apply here.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.

import { createClient } from "@supabase/supabase-js";
import { isSubscribed } from "./_lib/subscription.js";
import { buildRegenerateStatementPrompt } from "./_content/prompts/instagram/listing/regenerate-statement.js";
import {
  generateAndParseObject,
  DEFAULT_MODEL,
  DEFAULT_MAX_TOKENS,
} from "./content-generate.js";

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

export default async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase  = depsOverride?.supabase  || defaultSupabase();
  const generate  = depsOverride?.generate  || generateAndParseObject;
  const model     = depsOverride?.model     || DEFAULT_MODEL;
  const maxTokens = depsOverride?.maxTokens || DEFAULT_MAX_TOKENS;

  try {
    // ── 1. Auth ──
    const token = bearerFrom(req);
    if (!token) return res.status(401).json({ error: "missing Authorization header" });

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: "invalid or expired session" });
    }
    const authUser = authData.user;

    // ── 1b. Subscription gate (admins exempt) ──
    const { data: agentRow, error: agentErr } = await supabase
      .from("agents")
      .select("role, subscription_status")
      .eq("id", authUser.id)
      .maybeSingle();
    if (agentErr) {
      console.error("[content-regenerate-slide] agent lookup error:", agentErr);
      return res.status(500).json({ error: "agent lookup failed", details: agentErr.message });
    }
    if (!agentRow) {
      return res.status(401).json({ error: "no agent profile for this user" });
    }
    if (agentRow.role !== "admin" && !isSubscribed(agentRow)) {
      return res.status(402).json({ error: "subscription_required" });
    }

    // ── 2. Validate request body ──
    const body = req.body || {};
    const { voice_profile_id, listing_id, category } = body;
    const features = Array.isArray(body.features) ? body.features : [];

    if (!voice_profile_id) return res.status(400).json({ error: "voice_profile_id is required" });
    if (!listing_id)       return res.status(400).json({ error: "listing_id is required" });
    if (!category || !String(category).trim()) {
      return res.status(400).json({ error: "category is required" });
    }

    // ── 3. Load + ownership-check voice profile ──
    const { data: voiceProfile, error: vpErr } = await supabase
      .from("agent_voice_profiles")
      .select("*")
      .eq("id", voice_profile_id)
      .maybeSingle();
    if (vpErr) {
      console.error("[content-regenerate-slide] voice profile fetch error:", vpErr);
      return res.status(500).json({ error: "voice profile fetch failed", details: vpErr.message });
    }
    if (!voiceProfile) return res.status(404).json({ error: "voice profile not found" });
    if (voiceProfile.agent_id !== authUser.id) {
      return res.status(403).json({ error: "voice profile does not belong to caller" });
    }

    // ── 4. Load + ownership-check listing ──
    const { data: listing, error: lErr } = await supabase
      .from("listings")
      .select("*")
      .eq("id", listing_id)
      .maybeSingle();
    if (lErr) {
      console.error("[content-regenerate-slide] listing fetch error:", lErr);
      return res.status(500).json({ error: "listing fetch failed", details: lErr.message });
    }
    if (!listing) return res.status(404).json({ error: "listing not found" });
    if (listing.agent_id !== authUser.id) {
      return res.status(403).json({ error: "listing does not belong to caller" });
    }

    // ── 5. Build the single-statement prompt ──
    let built;
    try {
      built = buildRegenerateStatementPrompt({ voiceProfile, category, features });
    } catch (buildErr) {
      console.error("[content-regenerate-slide] prompt build error:", buildErr);
      return res.status(400).json({ error: "prompt build failed", details: buildErr.message });
    }

    // ── 6. Call the engine through the shared object-capture helper ──
    let result;
    try {
      result = await generate({
        model,
        maxTokens,
        promptBuilders: {
          buildSystemPrompt: () => built.systemPrompt,
          buildUserMessage:  () => built.userMessage,
        },
      });
    } catch (engineErr) {
      console.error("[content-regenerate-slide] engine call failed", {
        message: engineErr?.message,
        code:    engineErr?.code,
      });
      if (engineErr?.code === "ENGINE_PARSE_FAILED") {
        return res.status(502).json({ error: "model returned unparseable JSON" });
      }
      return res.status(502).json({ error: "statement regeneration failed", details: engineErr?.message });
    }

    // ── 7. Validate output shape ──
    const parsed = result?.parsed;
    const statement = parsed && typeof parsed === "object" ? parsed.statement : null;
    if (typeof statement !== "string" || !statement.trim()) {
      console.error("[content-regenerate-slide] model output missing statement", { raw: result?.raw });
      return res.status(502).json({ error: "model output missing statement" });
    }

    return res.status(200).json({ statement: statement.trim() });
  } catch (err) {
    console.error("[content-regenerate-slide] fatal:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}
