// Vercel Serverless Function — Parse comparable sales from raw text.
// POST /api/parse-comps
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    { microsite_slug, raw_text }
//
// Agent-authenticated. Takes pasted MLS / CMA / spreadsheet text and uses
// Anthropic to extract structured comparable sales for the agent to review
// before saving into microsite_comps (the client does the insert).
//
// Flow (mirrors api/content-generate.js + api/publish-microsite.js):
//   1. CORS + method guard.
//   2. Bearer auth → supabase.auth.getUser.
//   3. Validate body shape (slug + raw_text strings).
//   4. Load microsite by slug (service role); ownership-check agent_id.
//   5. Validate raw_text length (50–20000 chars).
//   6. Call Anthropic (claude-sonnet-4-6) with a strict extraction prompt.
//   7. Parse the JSON reply; return { comps: [...] }.
//   8. 500 on Anthropic failure or unparseable JSON.
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY            (same key used by microsite-chat / content-generate)

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { withSentry } from "./_lib/sentry.js";

// ── constants ────────────────────────────────────────────────────────
const MODEL          = "claude-sonnet-4-6";
const MAX_TOKENS     = 4096;
const RAW_TEXT_MIN   = 50;
const RAW_TEXT_MAX   = 20000;

const SYSTEM_PROMPT = `You are a data extraction assistant. The user will paste raw text containing real estate comparable sales — typically from an MLS export, CMA report, or pasted spreadsheet. Extract each individual comp as a structured object.

For each comp, extract:
- address (string) — the property's street address, including city if present
- sale_price (number) — sold price as an integer dollar amount, no commas or currency symbols
- sale_date (string) — date in YYYY-MM-DD format
- sqft (number or null) — square footage as an integer
- beds (number or null) — bedroom count as an integer
- baths (number or null) — bathroom count as a number (allow decimals like 2.5)
- distance_miles (number or null) — distance from the subject property if mentioned
- notes (string or null) — any concise note worth preserving (e.g., "renovated 2024", "pool")
- confidence (string) — "high" | "medium" | "low" based on how clear the data was in the source text

Rules:
- Return a JSON object with a single "comps" key whose value is an array.
- If a field is missing or ambiguous, return null for that field.
- Never invent data. If you can't determine a field with reasonable confidence, return null.
- If the input contains no recognizable comparable sales, return { "comps": [] }.
- Do not include any text before or after the JSON object. No markdown, no commentary.`;

// ── singletons (overridable for tests via depsOverride) ─────────────
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

let _anthropicSingleton = null;
function defaultAnthropic() {
  if (!_anthropicSingleton) {
    _anthropicSingleton = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropicSingleton;
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

// Pull the first JSON object out of the model's reply. The prompt asks for
// raw JSON, but we tolerate accidental markdown fences or stray prose by
// slicing to the outermost braces before parsing.
function extractJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = fenced.indexOf("{");
  const end   = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object found in model output");
  }
  return JSON.parse(fenced.slice(start, end + 1));
}

// Coerce one extracted comp into our shape, dropping anything unusable.
function normalizeComp(c) {
  if (!c || typeof c !== "object") return null;
  const num = (v) => {
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(/[,$]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const str = (v) => (v == null || v === "" ? null : String(v));
  const address = str(c.address);
  if (!address) return null; // address is the one field we require
  const conf = String(c.confidence || "").toLowerCase();
  return {
    address,
    sale_price:     num(c.sale_price),
    sale_date:      str(c.sale_date),
    sqft:           num(c.sqft),
    beds:           num(c.beds),
    baths:          num(c.baths),
    distance_miles: num(c.distance_miles),
    notes:          str(c.notes),
    confidence:     ["high", "medium", "low"].includes(conf) ? conf : "low",
  };
}

// ── main handler ─────────────────────────────────────────────────────
//
// depsOverride is for unit tests only — production callers use the 2-arg
// form and the lazy default singletons are used.
async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase  = depsOverride?.supabase  || defaultSupabase();
  const anthropic = depsOverride?.anthropic || defaultAnthropic();
  const model     = depsOverride?.model     || MODEL;

  try {
    // ── 1. Auth ──
    const token = bearerFrom(req);
    if (!token) return res.status(401).json({ error: "missing Authorization header" });

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: "invalid or expired session" });
    }
    const authUser = authData.user;

    // ── 2. Validate body ──
    const body = req.body || {};
    const slug    = typeof body.microsite_slug === "string" ? body.microsite_slug.trim() : "";
    const rawText = typeof body.raw_text === "string" ? body.raw_text : "";

    if (!slug)     return res.status(400).json({ error: "microsite_slug is required" });
    if (!rawText)  return res.status(400).json({ error: "raw_text is required" });

    // ── 3. Load + ownership-check microsite ──
    const { data: microsite, error: micErr } = await supabase
      .from("microsites")
      .select("id, slug, agent_id")
      .eq("slug", slug)
      .maybeSingle();
    if (micErr) {
      console.error("[parse-comps] microsite lookup error:", micErr);
      return res.status(500).json({ error: "microsite lookup failed" });
    }
    if (!microsite) return res.status(404).json({ error: "microsite not found" });
    if (microsite.agent_id !== authUser.id) {
      return res.status(403).json({ error: "you do not own this microsite" });
    }

    // ── 4. Validate raw_text length ──
    const len = rawText.trim().length;
    if (len < RAW_TEXT_MIN || len > RAW_TEXT_MAX) {
      return res.status(400).json({
        error: `raw_text must be between ${RAW_TEXT_MIN} and ${RAW_TEXT_MAX} characters`,
      });
    }

    // ── 5. Call Anthropic ──
    let replyText = "";
    try {
      const apiResp = await anthropic.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: "user", content: rawText }],
      });
      const block = (apiResp?.content || []).find(b => b.type === "text");
      replyText = block?.text || "";
    } catch (apiErr) {
      console.error("[parse-comps] anthropic call error:", apiErr);
      return res.status(500).json({ error: "comp parsing failed — please try again" });
    }

    // ── 6. Parse JSON ──
    let parsed;
    try {
      parsed = extractJson(replyText);
    } catch (parseErr) {
      console.error("[parse-comps] JSON parse error:", parseErr, "raw:", replyText.slice(0, 500));
      return res.status(500).json({ error: "could not parse comps from the pasted text — please try again or add them manually" });
    }

    const comps = Array.isArray(parsed?.comps)
      ? parsed.comps.map(normalizeComp).filter(Boolean)
      : [];

    return res.status(200).json({ comps });
  } catch (err) {
    console.error("[parse-comps] error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}

export default withSentry(handler);

// Exposed for tests.
export const _internals = { extractJson, normalizeComp, SYSTEM_PROMPT };
