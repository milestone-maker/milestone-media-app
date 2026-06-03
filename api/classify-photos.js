// Vercel Serverless Function — Photo Intelligence: classify listing photos.
// POST /api/classify-photos
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    { listing_id, force? }
//
// Flow mirrors api/content-generate.js:
//   1. CORS + method guard
//   2. Bearer auth → supabase.auth.getUser
//   3. agents-row load → subscription gate (402 for unsubscribed non-admins;
//      admins bypass)
//   4. Service-role load of the listing; ownership check (admin → any
//      listing; otherwise listing.agent_id must equal the caller)
//   5. Resolve the linked microsite (microsites.listing_id = listing_id);
//      build the ordered, deduped photo list = [hero_img, ...gallery_photos]
//   6. Selection preserving agent corrections:
//        • never classify a photo whose label is agent_corrected
//        • force=false → only photos with NO existing label (incremental)
//        • force=true  → all non-agent_corrected photos (refresh)
//      Empty to-classify set → skip the model entirely, return existing labels.
//   7. Classify in chunks (~10 photos) with bounded concurrency, via
//      @milestone-maker/content-engine classifyImages() + forced tool use
//      (engine stays domain-agnostic; the nine-category tool lives here)
//   8. Upsert labels (conflict target listing_id,photo_url; agent_corrected
//      rows are never in the classify set, so never overwritten)
//   9. Re-read all labels for the listing (existing + new) ordered by
//      sort_order and return them
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY            (read by @anthropic-ai/sdk inside engine)

import { createClient } from "@supabase/supabase-js";
import { isSubscribed } from "./_lib/subscription.js";

// Engine is CommonJS; lazy-imported on first use so test runs that inject a
// mock classifier (via depsOverride.classifyImages) don't require the package
// to be installed. Mirrors api/content-generate.js's shim exactly.
let _classifyImages = null;
async function getClassifyImages() {
  if (!_classifyImages) {
    const engine = (await import("@milestone-maker/content-engine")).default;
    _classifyImages = engine.classifyImages;
  }
  return _classifyImages;
}

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

// Vision classifier defaults. Haiku is the right tier for 9-way bucketing +
// short feature lists; cheap and fast across ~40 photos. maxTokens covers a
// chunk of ~10 classification objects with room to spare.
const DEFAULT_MODEL      = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 2048;

// Batching: ~10 photos per model call, at most 3 calls in flight. Keeps each
// call's image list small enough for reliable per-image classification while
// staying well under the function's maxDuration and Anthropic rate limits.
const CHUNK_SIZE  = 10;
const CONCURRENCY = 3;

// The fixed nine-category set — MUST match migration 029's CHECK constraint.
const CATEGORIES = [
  "front_facade",
  "backyard",
  "drone",
  "living",
  "dining",
  "kitchen",
  "primary_bedroom",
  "primary_bathroom",
  "other",
];

// The classification tool — domain lives HERE (Milestone-side); the engine
// stays generic. The category enum is the migration's nine values exactly.
const CLASSIFY_TOOL = {
  name: "classify_photos",
  description:
    "Record the category, notable features, and confidence for each listing photo. Reference each photo by the 0-based index it was given in the message.",
  input_schema: {
    type: "object",
    properties: {
      classifications: {
        type: "array",
        description: "One entry per image in the message.",
        items: {
          type: "object",
          properties: {
            index: {
              type: "integer",
              description: "The 0-based index of the image as labeled in the message (Image 0, Image 1, …).",
            },
            category: {
              type: "string",
              enum: CATEGORIES,
              description: "The single best-fit category for this photo.",
            },
            features: {
              type: "array",
              items: { type: "string" },
              description: "Short notable features visible in the photo (e.g. 'marble island', 'pool', 'vaulted ceiling').",
            },
            confidence: {
              type: "number",
              description: "Confidence in the category, 0 to 1.",
            },
          },
          required: ["index", "category", "features", "confidence"],
        },
      },
    },
    required: ["classifications"],
  },
};

const SYSTEM_PROMPT = `You are a real-estate photo classifier for a luxury listing media company. You will be shown a set of listing photos, each labeled with a 0-based index (Image 0, Image 1, …). Classify EVERY image into exactly one of these nine categories, and call the classify_photos tool with one entry per image, referencing each by its index.

Categories:
- front_facade: the FRONT exterior of the home, shot from the ground. Driveway, entry, front yard, street-facing elevation.
- backyard: the REAR exterior of the home, shot from the ground — including pool, spa, water features, patio, and rear yard.
- drone: any AERIAL shot (taken from above), whether of the front, rear, or surrounding context/neighborhood.
- living: the living room / great room / main interior gathering space.
- dining: the dining room / dedicated eating area.
- kitchen: the kitchen.
- primary_bedroom: the primary (master) bedroom specifically.
- primary_bathroom: the primary (master) bathroom specifically.
- other: anything outside the eight above — secondary bedrooms, non-primary bathrooms, hallways, garage, closets, laundry, office/bonus rooms, and tight detail/decor shots.

Rules:
- Classify every image; do not skip any.
- Reference each image by its given index.
- When a photo does not clearly fit one of the eight specific buckets, choose 'other' rather than guessing.
- features: list a few short, concrete things visible in the photo. confidence: your certainty 0–1.`;

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

// Dedupe an ordered list of photo URLs, dropping falsy values and keeping
// first occurrence. Each surviving photo's index becomes its sort_order
// (hero/first = 0). We carry that global sort_order on the descriptor so it
// stays correct regardless of how the to-classify subset is later chunked.
function buildPhotoList(propertyData) {
  const pd = propertyData || {};
  const raw = [pd.hero_img, ...(Array.isArray(pd.gallery_photos) ? pd.gallery_photos : [])];
  const seen = new Set();
  const out = [];
  for (const url of raw) {
    if (!url || typeof url !== "string") continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, sortOrder: out.length });
  }
  return out;
}

// Split an array into fixed-size chunks.
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Run `worker` over `items` with at most `limit` concurrent invocations,
// preserving result order. Workers never throw here — each returns a result
// object; failures are captured by the worker itself.
async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runner = async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await worker(items[idx], idx);
    }
  };
  const n = Math.min(limit, items.length) || 0;
  await Promise.all(Array.from({ length: n }, runner));
  return results;
}

// ── main handler ─────────────────────────────────────────────────────

export default async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase      = depsOverride?.supabase      || defaultSupabase();
  const model         = depsOverride?.model         || DEFAULT_MODEL;
  const maxTokens     = depsOverride?.maxTokens     || DEFAULT_MAX_TOKENS;
  // classifyImages is resolved lazily from the engine unless injected.
  const classifyImages = depsOverride?.classifyImages || (await getClassifyImages());

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
      .select("role, subscription_status")
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
    if (!isAdmin && !isSubscribed(agentRow)) {
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

    // ── 4. Resolve the linked microsite (prefer published, then newest) ──
    const { data: micrositeRows, error: msErr } = await supabase
      .from("microsites")
      .select("id, property_data, published, created_at")
      .eq("listing_id", listing_id)
      .order("published", { ascending: false })
      .order("created_at", { ascending: false });
    if (msErr) {
      console.error("[classify-photos] microsite fetch error:", msErr);
      return res.status(500).json({ error: "microsite fetch failed", details: msErr.message });
    }
    const microsite = Array.isArray(micrositeRows) ? micrositeRows[0] : micrositeRows;
    if (!microsite) {
      return res.status(404).json({ error: "no microsite for listing" });
    }
    const micrositeId = microsite.id;

    // ── 5. Build the ordered, deduped photo list ──
    const photos = buildPhotoList(microsite.property_data);
    if (photos.length === 0) {
      return res.status(200).json({
        listing_id,
        microsite_id: micrositeId,
        labels: [],
        classified_count: 0,
        skipped_agent_corrected_count: 0,
      });
    }

    // ── 6. Load existing labels + decide what to classify ──
    const { data: existingRows, error: exErr } = await supabase
      .from("photo_labels")
      .select("*")
      .eq("listing_id", listing_id);
    if (exErr) {
      console.error("[classify-photos] existing labels fetch error:", exErr);
      return res.status(500).json({ error: "labels fetch failed", details: exErr.message });
    }
    const existingByUrl = new Map((existingRows || []).map((r) => [r.photo_url, r]));

    let skippedAgentCorrected = 0;
    const toClassify = photos.filter((p) => {
      const existing = existingByUrl.get(p.url);
      if (existing?.agent_corrected) { skippedAgentCorrected++; return false; } // never touch corrections
      if (force) return true;          // refresh all non-corrected
      return !existing;                // incremental: only unlabeled
    });

    // Helper to re-read all current labels for the listing, ordered.
    const readAllLabels = async () => {
      const { data, error } = await supabase
        .from("photo_labels")
        .select("*")
        .eq("listing_id", listing_id)
        .order("sort_order", { ascending: true });
      if (error) {
        console.error("[classify-photos] final labels read error:", error);
        return [];
      }
      return data || [];
    };

    // ── 6b. Nothing to classify → return existing labels, no model call ──
    if (toClassify.length === 0) {
      const labels = await readAllLabels();
      return res.status(200).json({
        listing_id,
        microsite_id: micrositeId,
        labels,
        classified_count: 0,
        skipped_agent_corrected_count: skippedAgentCorrected,
      });
    }

    // ── 7. Classify in chunks with bounded concurrency ──
    const chunks = chunk(toClassify, CHUNK_SIZE);
    const warnings = [];

    const chunkResults = await runPool(chunks, CONCURRENCY, async (photoChunk, chunkIdx) => {
      try {
        const result = await classifyImages({
          imageUrls:    photoChunk.map((p) => p.url),
          systemPrompt: SYSTEM_PROMPT,
          tool:         CLASSIFY_TOOL,
          model,
          maxTokens,
        });

        const classifications = Array.isArray(result?.classifications) ? result.classifications : [];
        const rows = [];
        for (const c of classifications) {
          // Map back OUR way: never trust the model for absolute position.
          // The returned index is relative to THIS chunk; resolve it to the
          // photo (which carries its true global sort_order).
          const photo = photoChunk[c?.index];
          if (!photo) continue; // index out of range — drop defensively
          if (!CATEGORIES.includes(c?.category)) {
            warnings.push(`chunk ${chunkIdx}: dropped photo ${photo.url} — invalid category "${c?.category}"`);
            continue;
          }
          rows.push({
            listing_id,
            microsite_id:    micrositeId,
            photo_url:       photo.url,
            category:        c.category,
            features:        Array.isArray(c.features) ? c.features : [],
            confidence:      typeof c.confidence === "number" ? c.confidence : null,
            sort_order:      photo.sortOrder,
            agent_corrected: false,
            updated_at:      new Date().toISOString(),
          });
        }
        return { ok: true, rows };
      } catch (err) {
        console.error(`[classify-photos] chunk ${chunkIdx} classify failed:`, err?.message);
        warnings.push(`chunk ${chunkIdx} classification failed: ${err?.message || "unknown error"}`);
        return { ok: false, rows: [] };
      }
    });

    const succeeded = chunkResults.filter((r) => r?.ok);
    const rowsToUpsert = succeeded.flatMap((r) => r.rows);

    // All chunks failed → 502.
    if (succeeded.length === 0) {
      return res.status(502).json({
        error:   "classification failed",
        details: warnings,
      });
    }

    // ── 8. Upsert labels (conflict target listing_id,photo_url) ──
    if (rowsToUpsert.length > 0) {
      const { error: upErr } = await supabase
        .from("photo_labels")
        .upsert(rowsToUpsert, { onConflict: "listing_id,photo_url" });
      if (upErr) {
        console.error("[classify-photos] upsert error:", upErr);
        return res.status(500).json({ error: "labels upsert failed", details: upErr.message });
      }
    }

    // ── 9. Re-read all labels (existing preserved + newly written) ──
    const labels = await readAllLabels();
    const payload = {
      listing_id,
      microsite_id: micrositeId,
      labels,
      classified_count: rowsToUpsert.length,
      skipped_agent_corrected_count: skippedAgentCorrected,
    };
    if (warnings.length) payload.warnings = warnings;
    return res.status(200).json(payload);
  } catch (err) {
    console.error("[classify-photos] fatal:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}
