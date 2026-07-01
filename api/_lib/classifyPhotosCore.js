// Stage 2b — extracted "core" of api/classify-photos.js.
//
// The HTTP handler at api/classify-photos.js keeps auth / subscription /
// listing-ownership; the actual work (microsite lookup → photo list →
// selection preserving agent corrections → chunked classify → upsert) lives
// here so both the handler AND the Stage 2b executor
// (api/_lib/executors/classifyPhotosRerun.js) can reuse it.
//
// classifyForListing({ supabase, listing_id, force, model, maxTokens,
//                       classifyImages }) → {
//   ok, statusCode, body,
//   chunks_total,   // number of model chunks attempted (0 if none needed)
//   chunks_failed,  // how many of those chunks threw
//   warnings,       // full warnings array (may be empty)
// }
//
// `body` is the exact response body the handler returns verbatim. On success
// with no chunk failures it OMITS the `warnings` key (byte-identical to
// pre-refactor behavior). The `chunks_total`/`chunks_failed`/`warnings`
// metadata is for the handler's incident-emission and is NOT part of `body`.
//
// The engine module (`@milestone-maker/content-engine`) is lazy-imported so
// tests that inject a mock `classifyImages` via depsOverride don't require
// the engine to be installed.

const DEFAULT_MODEL      = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 2048;

const CHUNK_SIZE  = 10;
const CONCURRENCY = 3;

// The fixed nine-category set — MUST match migration 029's CHECK constraint.
export const CATEGORIES = [
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
export const CLASSIFY_TOOL = {
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

export const SYSTEM_PROMPT = `You are a real-estate photo classifier for a luxury listing media company. You will be shown a set of listing photos, each labeled with a 0-based index (Image 0, Image 1, …). Classify EVERY image into exactly one of these nine categories, and call the classify_photos tool with one entry per image, referencing each by its index.

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

// Dedupe an ordered list of photo URLs, dropping falsy values and keeping
// first occurrence. Each surviving photo's index becomes its sort_order
// (hero/first = 0).
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

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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

// Lazy engine import; mirrors the pre-refactor handler exactly.
let _classifyImages = null;
async function getClassifyImages() {
  if (!_classifyImages) {
    const engine = (await import("@milestone-maker/content-engine")).default;
    _classifyImages = engine.classifyImages;
  }
  return _classifyImages;
}

// ── main core function ──────────────────────────────────────────────

/**
 * @param {object} args
 * @param {object} args.supabase           - service-role Supabase client
 * @param {string} args.listing_id         - the listing to classify
 * @param {boolean} [args.force=false]     - refresh non-corrected photos even if labeled
 * @param {string}  [args.model]           - model override (test hook)
 * @param {number}  [args.maxTokens]       - max_tokens override (test hook)
 * @param {Function}[args.classifyImages]  - injected classifier (test hook)
 * @returns {Promise<{
 *   ok: boolean,
 *   statusCode: number,
 *   body: object,
 *   chunks_total: number,
 *   chunks_failed: number,
 *   warnings: string[],
 * }>}
 */
export async function classifyForListing({
  supabase,
  listing_id,
  force = false,
  model,
  maxTokens,
  classifyImages,
} = {}) {
  const resolvedModel     = model     || DEFAULT_MODEL;
  const resolvedMaxTokens = maxTokens || DEFAULT_MAX_TOKENS;
  const resolvedClassify  = classifyImages || (await getClassifyImages());

  // ── Resolve the linked microsite (prefer published, then newest) ──
  const { data: micrositeRows, error: msErr } = await supabase
    .from("microsites")
    .select("id, property_data, published, created_at")
    .eq("listing_id", listing_id)
    .order("published", { ascending: false })
    .order("created_at", { ascending: false });
  if (msErr) {
    console.error("[classify-photos] microsite fetch error:", msErr);
    return {
      ok: false,
      statusCode: 500,
      body: { error: "microsite fetch failed", details: msErr.message },
      chunks_total: 0,
      chunks_failed: 0,
      warnings: [],
    };
  }
  const microsite = Array.isArray(micrositeRows) ? micrositeRows[0] : micrositeRows;
  if (!microsite) {
    return {
      ok: false,
      statusCode: 404,
      body: { error: "no microsite for listing" },
      chunks_total: 0,
      chunks_failed: 0,
      warnings: [],
    };
  }
  const micrositeId = microsite.id;

  // ── Build the ordered, deduped photo list ──
  const photos = buildPhotoList(microsite.property_data);
  if (photos.length === 0) {
    return {
      ok: true,
      statusCode: 200,
      body: {
        listing_id,
        microsite_id: micrositeId,
        labels: [],
        classified_count: 0,
        skipped_agent_corrected_count: 0,
      },
      chunks_total: 0,
      chunks_failed: 0,
      warnings: [],
    };
  }

  // ── Load existing labels + decide what to classify ──
  const { data: existingRows, error: exErr } = await supabase
    .from("photo_labels")
    .select("*")
    .eq("listing_id", listing_id);
  if (exErr) {
    console.error("[classify-photos] existing labels fetch error:", exErr);
    return {
      ok: false,
      statusCode: 500,
      body: { error: "labels fetch failed", details: exErr.message },
      chunks_total: 0,
      chunks_failed: 0,
      warnings: [],
    };
  }
  const existingByUrl = new Map((existingRows || []).map((r) => [r.photo_url, r]));

  let skippedAgentCorrected = 0;
  const toClassify = photos.filter((p) => {
    const existing = existingByUrl.get(p.url);
    if (existing?.agent_corrected) { skippedAgentCorrected++; return false; }
    if (force) return true;
    return !existing;
  });

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

  // ── Nothing to classify → return existing labels, no model call ──
  if (toClassify.length === 0) {
    const labels = await readAllLabels();
    return {
      ok: true,
      statusCode: 200,
      body: {
        listing_id,
        microsite_id: micrositeId,
        labels,
        classified_count: 0,
        skipped_agent_corrected_count: skippedAgentCorrected,
      },
      chunks_total: 0,
      chunks_failed: 0,
      warnings: [],
    };
  }

  // ── Classify in chunks with bounded concurrency ──
  const chunks = chunk(toClassify, CHUNK_SIZE);
  const warnings = [];

  const chunkResults = await runPool(chunks, CONCURRENCY, async (photoChunk, chunkIdx) => {
    try {
      const result = await resolvedClassify({
        imageUrls:    photoChunk.map((p) => p.url),
        systemPrompt: SYSTEM_PROMPT,
        tool:         CLASSIFY_TOOL,
        model:        resolvedModel,
        maxTokens:    resolvedMaxTokens,
      });

      const classifications = Array.isArray(result?.classifications) ? result.classifications : [];
      const rows = [];
      for (const c of classifications) {
        const photo = photoChunk[c?.index];
        if (!photo) continue;
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

  const succeeded    = chunkResults.filter((r) => r?.ok);
  const chunks_total = chunkResults.length;
  const chunks_failed = chunks_total - succeeded.length;
  const rowsToUpsert = succeeded.flatMap((r) => r.rows);

  // ── All chunks failed → 502 ──
  if (succeeded.length === 0) {
    return {
      ok: false,
      statusCode: 502,
      body: { error: "classification failed", details: warnings },
      chunks_total,
      chunks_failed,
      warnings,
    };
  }

  // ── Upsert labels (conflict target listing_id,photo_url) ──
  if (rowsToUpsert.length > 0) {
    const { error: upErr } = await supabase
      .from("photo_labels")
      .upsert(rowsToUpsert, { onConflict: "listing_id,photo_url" });
    if (upErr) {
      console.error("[classify-photos] upsert error:", upErr);
      return {
        ok: false,
        statusCode: 500,
        body: { error: "labels upsert failed", details: upErr.message },
        chunks_total,
        chunks_failed,
        warnings,
      };
    }
  }

  // ── Re-read all labels (existing preserved + newly written) ──
  const labels = await readAllLabels();
  const body = {
    listing_id,
    microsite_id: micrositeId,
    labels,
    classified_count: rowsToUpsert.length,
    skipped_agent_corrected_count: skippedAgentCorrected,
  };
  if (warnings.length) body.warnings = warnings;
  return {
    ok: true,
    statusCode: 200,
    body,
    chunks_total,
    chunks_failed,
    warnings,
  };
}
