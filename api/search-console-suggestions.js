// Vercel Serverless Function — Search Console optimization suggestions (admin-only).
// GET|POST /api/search-console-suggestions?slug=<slug>[&startDate&endDate]
//   Headers: Authorization: Bearer <supabase access token>
//
// ADVISORY ONLY. For one listing page, pulls the queries it actually appears
// for in Search Console, then asks Claude for an improved <title> / meta
// description and a few specific recommendations. Nothing is auto-applied and
// there are no schema changes — the admin reads the suggestions and decides.
//
// Gated exactly like api/search-console.js (admin role required). The GSC query
// and the Anthropic call are injectable seams so tests use canned responses.
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   GSC_OAUTH_CLIENT_ID, GSC_OAUTH_CLIENT_SECRET, GSC_REFRESH_TOKEN, GSC_SITE_URL
//   ANTHROPIC_API_KEY

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { fetchPageQueryData as realFetchPageQueryData } from "./_lib/searchConsole.js";
import { buildTitle, buildDescription } from "./render-microsite.js";

const MODEL      = "claude-sonnet-4-6"; // generative tier (matches parse-comps / microsite-chat)
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `You are an SEO assistant for individual real estate listing pages. You are given a page's CURRENT <title> and meta description, the underlying listing details, the page's Search Console metrics, and the actual search queries the page appears for.

Suggest improvements that will help the page rank for and earn clicks from the queries it already appears for. Ground every suggestion in the listing details or the real queries — never invent facts (no fake neighborhoods, awards, or features).

Return ONLY a JSON object, no markdown and no commentary, with exactly these keys:
- "suggestedTitle": string, an improved <title>, <= 60 characters.
- "suggestedDescription": string, an improved meta description, <= 155 characters.
- "recommendations": array of up to 4 short, specific, actionable strings (e.g. "Add the neighborhood 'Kessler Park' — you rank for it but it's missing from the title", "Your description never mentions 'pool', a query driving impressions").

If the current title/description are already strong, say so in a recommendation and keep the suggested versions close to the originals.`;

// ── singletons (overridable via depsOverride for tests) ──────────────
let _supabaseSingleton = null;
function defaultSupabase() {
  if (!_supabaseSingleton) {
    _supabaseSingleton = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function bearerFrom(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isoDay(d) { return d.toISOString().slice(0, 10); }
function defaultRange() {
  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 90); // 90 days → more query signal
  return { startDate: isoDay(start), endDate: isoDay(today) };
}

// Slice the first JSON object out of the model reply, tolerating code fences /
// stray prose (mirrors parse-comps.js). Throws if no object is present.
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

// Coerce parsed model output into the suggestion shape. Pure + defensive.
function normalizeSuggestions(p) {
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const recs = Array.isArray(p?.recommendations)
    ? p.recommendations.map(str).filter(Boolean).slice(0, 4)
    : [];
  return {
    suggestedTitle:       str(p?.suggestedTitle),
    suggestedDescription: str(p?.suggestedDescription),
    recommendations:      recs,
  };
}

// Assemble the user message from the page facts. Pure + testable.
function buildSuggestionPrompt({ pd, currentTitle, currentDescription, metrics, queries }) {
  const features = Array.isArray(pd?.features) ? pd.features.filter(Boolean).join(", ") : "";
  const m = metrics || {};
  const queryLines = (queries || [])
    .map((q) => `- "${q.query}" — ${q.impressions} impr, ${q.clicks} clicks, CTR ${(q.ctr * 100).toFixed(1)}%, avg position ${q.position}`)
    .join("\n");

  const user =
`CURRENT TITLE:
${currentTitle}

CURRENT META DESCRIPTION:
${currentDescription}

LISTING DETAILS:
- Address: ${pd?.address || "—"}
- City: ${pd?.city || "—"}
- Neighborhood: ${pd?.neighborhood || "—"}
- Beds: ${pd?.beds || "—"}
- Baths: ${pd?.baths || "—"}
- Sqft: ${pd?.sqft || "—"}
- Features: ${features || "—"}
- Description: ${(pd?.description || "—").toString().trim()}

PAGE SEARCH CONSOLE METRICS:
- Impressions: ${m.impressions ?? 0}
- Clicks: ${m.clicks ?? 0}
- CTR: ${((m.ctr ?? 0) * 100).toFixed(1)}%
- Avg position: ${m.position ?? 0}

TOP QUERIES THIS PAGE APPEARS FOR:
${queryLines || "(none)"}`;

  return { system: SYSTEM_PROMPT, user };
}

// ── main handler ─────────────────────────────────────────────────────
export default async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase           = depsOverride?.supabase           || defaultSupabase();
  const anthropic          = depsOverride?.anthropic          || defaultAnthropic();
  const fetchPageQueryData = depsOverride?.fetchPageQueryData  || realFetchPageQueryData;
  const model              = depsOverride?.model              || MODEL;

  // ── 1. Auth (admin-only) ──
  const token = bearerFrom(req);
  if (!token) return res.status(401).json({ error: "missing Authorization header" });

  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData?.user) {
    return res.status(401).json({ error: "invalid or expired session" });
  }
  const { data: agentRow, error: agentErr } = await supabase
    .from("agents")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (agentErr) {
    console.error("[gsc-suggestions] agent lookup error:", agentErr);
    return res.status(500).json({ error: "agent lookup failed", details: agentErr.message });
  }
  if (agentRow?.role !== "admin") {
    return res.status(403).json({ error: "admin_only" });
  }

  // ── 2. Inputs ──
  const q = { ...(req.query || {}), ...(req.body || {}) };
  const slug = typeof q.slug === "string" ? q.slug.trim() : "";
  if (!slug) return res.status(400).json({ error: "slug is required" });

  let { startDate, endDate } = q;
  if (startDate === undefined && endDate === undefined) {
    ({ startDate, endDate } = defaultRange());
  }
  if (!DATE_RE.test(startDate || "") || !DATE_RE.test(endDate || "")) {
    return res.status(400).json({ error: "startDate and endDate must be YYYY-MM-DD" });
  }

  try {
    // ── 3. Load the microsite + compute its CURRENT title/description ──
    const { data: microsite, error: msErr } = await supabase
      .from("microsites")
      .select("slug, property_data, listing_id")
      .eq("slug", slug)
      .maybeSingle();
    if (msErr) throw msErr;
    if (!microsite) return res.status(404).json({ error: "microsite not found" });

    const pd = microsite.property_data || {};
    const currentTitle       = buildTitle(pd);
    const currentDescription = buildDescription(pd);

    // ── 4. Per-page query data (injectable seam) ──
    const gsc = await fetchPageQueryData({ slug, startDate, endDate });
    if (gsc.status === "not_configured") {
      return res.status(200).json({ connected: false, reason: "not_configured" });
    }
    if (gsc.status === "no_access") {
      return res.status(200).json({ connected: false, reason: "no_access" });
    }

    const metrics    = gsc.totals || null;
    const topQueries = Array.isArray(gsc.queries) ? gsc.queries : [];
    const hasData    = topQueries.length > 0 || (metrics && metrics.impressions > 0);
    if (!hasData) {
      return res.status(200).json({ connected: true, hasData: false });
    }

    // ── 5. Ask Claude for structured suggestions ──
    const { system, user } = buildSuggestionPrompt({ pd, currentTitle, currentDescription, metrics, queries: topQueries });

    let replyText = "";
    const apiResp = await anthropic.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
    });
    const block = (apiResp?.content || []).find((b) => b.type === "text");
    replyText = block?.text || "";

    let suggestions;
    try {
      suggestions = normalizeSuggestions(extractJson(replyText));
    } catch (parseErr) {
      console.error("[gsc-suggestions] JSON parse error:", parseErr?.message, "raw:", replyText.slice(0, 300));
      return res.status(500).json({ error: "suggestions_failed", details: "could not parse model output" });
    }

    return res.status(200).json({
      connected: true,
      hasData: true,
      currentTitle,
      currentDescription,
      metrics,
      topQueries,
      suggestions,
    });
  } catch (err) {
    console.error("[gsc-suggestions] error:", err?.message || err);
    return res.status(500).json({ error: "suggestions_failed", details: err?.message || String(err) });
  }
}

// Exposed for tests.
export const _internals = { extractJson, normalizeSuggestions, buildSuggestionPrompt, SYSTEM_PROMPT };
