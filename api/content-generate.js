// Vercel Serverless Function — Stage 5c content generation entry point.
// POST /api/content-generate
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    { voice_profile_id, listing_id, framework_name,
//              platform?, content_type?, story_angle? }
//
// Flow mirrors api/create-booking.js:
//   1. CORS + method guard
//   2. Bearer auth → supabase.auth.getUser
//   3. Service-role load of agent_voice_profiles + listings rows;
//      ownership-check both against the calling agent
//   4. Look up the prompt module in the registry
//   5. Build {systemPrompt, userMessage} from voice profile + listing
//   6. Call @milestone-maker/content-engine generatePosts() with
//      injected promptBuilders (engine stays domain-agnostic)
//   7. Engine returns parsed JSON; on parse failure we fall back to
//      object-extraction (engine only handles arrays), log the raw
//      output, and return 502 if still unparseable
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY            (read by @anthropic-ai/sdk inside engine)

import { createClient } from "@supabase/supabase-js";
import { hasFeatureAccess } from "./_lib/subscription.js";
import { findPrompt } from "./_content/registry.js";
import { canonicalizeHashtags } from "./_content/post-processors.js";
import { UNIVERSAL_REQUIRED_OUTPUT_FIELDS } from "./_content/prompts/_helpers.js";
import { selectCarouselPhotos } from "./_content/selectCarouselPhotos.js";
import { resolvePublishedMicrositeUrl, appendMicrositeToken } from "./_lib/microsite.js";
import { withSentry } from "./_lib/sentry.js";

const CAROUSEL_FRAMEWORK = "walkthrough_carousel";

// Zip deterministically-chosen photo URLs onto the model's slides array by
// POSITION — the engine/model never assign photos. slides shape:
// [cover, ...subjectSlides, final]. Mutates `slides` in place; pushes any
// non-fatal anomalies onto `warnings`.
function zipCarouselPhotos(slides, selection, listing, warnings) {
  if (!Array.isArray(slides) || slides.length < 2) {
    warnings.push("carousel had fewer than 2 slides; photos not zipped");
    return;
  }
  const heroFallback = listing?.hero_img || null;
  const n = slides.length;

  // Cover (first) + final (last).
  slides[0].photo_url = selection.coverPhoto?.photo_url ?? heroFallback;
  if (selection.coverPhoto?.category) slides[0].category = selection.coverPhoto.category;
  slides[0].is_cover = true;
  slides[n - 1].photo_url = selection.finalPhotoUrl ?? selection.coverPhoto?.photo_url ?? heroFallback;

  // Subject slides = the middle ones; align positionally with subjectSlides.
  const modelSubjectCount = n - 2;
  const expected = selection.subjectSlides.length;
  if (modelSubjectCount !== expected) {
    warnings.push(
      `carousel subject-slide count mismatch: model returned ${modelSubjectCount}, expected ${expected}; zipped best-effort by position`
    );
  }
  const count = Math.min(modelSubjectCount, expected);
  for (let k = 0; k < count; k++) {
    slides[k + 1].photo_url = selection.subjectSlides[k].photo_url;
    slides[k + 1].category  = selection.subjectSlides[k].category;
  }
}

// Engine is CommonJS; lazy-imported on first use so test runs that inject
// a mock generator (via depsOverride.generate) don't require the package
// to be installed. Production / live tests load it on first call.
// Default-import-then-destructure is the safest CJS→ESM interop pattern.
let _generatePosts = null;
async function getGeneratePosts() {
  if (!_generatePosts) {
    const engine = (await import("@milestone-maker/content-engine")).default;
    _generatePosts = engine.generatePosts;
  }
  return _generatePosts;
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

// Model + token budget defaults. No app-wide constants exist yet, so
// the first endpoint defines them; later endpoints can override per
// content type if needed.
// Exported so sibling endpoints (e.g. api/content-regenerate-slide.js) reuse the
// exact same model + token budget rather than drifting their own copy.
export const DEFAULT_MODEL      = "claude-sonnet-4-6";
export const DEFAULT_MAX_TOKENS = 2048;

// ── helpers ──────────────────────────────────────────────────────────
//
// Microsite link (Facebook): generation inserts a PLACEHOLDER TOKEN at the link
// slot via appendMicrositeToken (from api/_lib/microsite.js) rather than baking a
// live URL. The live URL is resolved + substituted at DISPLAY time (Content tab)
// and authoritatively at POST time (api/social-post.js FB path). We still resolve
// the URL here (resolvePublishedMicrositeUrl) purely to return microsite_url in
// the response so the UI can show whether a microsite exists yet.

// How many recent Facebook hooks to feed the avoidance block. Tunable — larger
// = stronger avoidance memory but a longer system prompt. 12 is a good balance.
export const RECENT_HOOK_MEMORY = 12;

/**
 * Resolve an agent's recent opening hooks for the anti-repetition memory.
 * Scoped by agent_id (the server-resolved caller — the same id persisted on
 * generated_content.agent_id) AND platform. Returns the most recent DISTINCT
 * non-empty hook_lines for that platform, newest first, capped at
 * RECENT_HOOK_MEMORY. New agent / no history on that platform → []. Defaults
 * to platform='facebook' for backwards compatibility with the original
 * Stage 2 callers.
 *
 * History accumulates as the agent generates: each generation persists its
 * hook_line, so the pool the next generation must avoid grows over time.
 */
async function defaultResolveRecentHooks(supabase, agentId, platform = "facebook") {
  const { data, error } = await supabase
    .from("generated_content")
    .select("hook_line")
    .eq("agent_id", agentId)
    .eq("platform", platform)
    .order("created_at", { ascending: false })
    .limit(RECENT_HOOK_MEMORY);
  if (error) {
    console.error("[content-generate] recent-hooks lookup error (continuing without avoidance):", error);
    return [];
  }
  const seen = new Set();
  const hooks = [];
  for (const row of data || []) {
    const h = (row?.hook_line || "").trim();
    if (!h || seen.has(h)) continue;
    seen.add(h);
    hooks.push(h);
  }
  return hooks;
}

/**
 * Append a clearly delimited "recently used openers — do not repeat" block to
 * the FB system prompt, AFTER the existing HOOK ORIGINALITY / BANNED OPENERS
 * rules. No-ops (returns the prompt unchanged) when there are no recent hooks.
 */
function appendHookAvoidanceBlock(systemPrompt, recentHooks) {
  if (!Array.isArray(recentHooks) || recentHooks.length === 0) return systemPrompt;
  const list = recentHooks.map((h, i) => `${i + 1}. ${h}`).join("\n");
  return (
    systemPrompt +
    "\n\nAGENT'S RECENTLY USED OPENERS — DO NOT REPEAT:\n" +
    "The lines below are hooks this agent has ALREADY used on recent Facebook posts. Your new hook MUST NOT echo, " +
    "paraphrase, or reuse the construction, wording, or angle of ANY of them — it must open in a clearly different " +
    "way from every one of them:\n" +
    list
  );
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

/**
 * The engine's generatePosts() expects an array shape and throws if the
 * model returns a single object. For these caption prompts we know the
 * model returns one object, so we run the call in _captureContext mode,
 * catch the engine's array-only parse failure, and do object-extraction
 * locally. Returns the parsed object plus the raw text for logging.
 */
export async function generateAndParseObject(opts) {
  const generatePosts = await getGeneratePosts();
  let captured;
  try {
    captured = await generatePosts({ ...opts, _captureContext: true });
    // Engine succeeded — model returned a JSON array. Unexpected for a
    // single-caption prompt, but accept the first element if shaped
    // correctly.
    if (Array.isArray(captured.posts) && captured.posts.length > 0) {
      return { parsed: captured.posts[0], raw: captured.rawResponseText };
    }
    return { parsed: captured.posts, raw: captured.rawResponseText };
  } catch (engineErr) {
    // Engine threw on parse — most likely because the model returned a
    // top-level object instead of an array. Re-run the parse ourselves
    // using the raw text the engine couldn't extract.
    //
    // The engine's _captureContext doesn't include rawResponseText on a
    // parse failure (it throws before the return), so we need to do a
    // second call. To avoid burning two Anthropic calls per request, we
    // instead reach into the engine's raw output via a fallback path:
    // the engine's parse failure message doesn't include the raw text,
    // so we can't recover it from the error alone.
    //
    // Strategy: detect "Failed to parse" and re-throw with context so
    // the caller logs + returns 502. We do NOT make a second API call.
    if (/Failed to parse/i.test(String(engineErr?.message))) {
      const wrap = new Error("content-engine returned unparseable JSON for object-shaped prompt");
      wrap.cause = engineErr;
      wrap.code  = "ENGINE_PARSE_FAILED";
      throw wrap;
    }
    throw engineErr;
  }
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

  const supabase  = depsOverride?.supabase  || defaultSupabase();
  const generate  = depsOverride?.generate  || generateAndParseObject;
  const model     = depsOverride?.model     || DEFAULT_MODEL;
  const maxTokens = depsOverride?.maxTokens || DEFAULT_MAX_TOKENS;
  const resolveMicrositeUrl = depsOverride?.resolveMicrositeUrl || resolvePublishedMicrositeUrl;
  const resolveRecentHooks  = depsOverride?.resolveRecentHooks  || defaultResolveRecentHooks;

  try {
    // ── 1. Auth ──
    const token = bearerFrom(req);
    if (!token) return res.status(401).json({ error: "missing Authorization header" });

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: "invalid or expired session" });
    }
    const authUser = authData.user;

    // ── 1b. Subscription gate (mirrors publish-microsite.js; admins exempt) ──
    //
    // Load the caller's role + subscription_status and reject unsubscribed
    // non-admins BEFORE running the engine. Tier-agnostic — any active status
    // qualifies (see api/_lib/subscription.js). The server is the real lock;
    // the Content-tab UI gate is defense-in-depth.
    const { data: agentRow, error: agentErr } = await supabase
      .from("agents")
      .select("role, subscription_status, is_beta, beta_expires_at")
      .eq("id", authUser.id)
      .maybeSingle();
    if (agentErr) {
      console.error("[content-generate] agent lookup error:", agentErr);
      return res.status(500).json({ error: "agent lookup failed", details: agentErr.message });
    }
    if (!agentRow) {
      return res.status(401).json({ error: "no agent profile for this user" });
    }
    if (agentRow.role !== "admin" && !hasFeatureAccess(agentRow)) {
      return res.status(402).json({ error: "subscription_required" });
    }

    // ── 2. Validate request body ──
    //
    // Structural keys are destructured explicitly; everything else
    // collects into `extras` and is forwarded to the prompt module's
    // build() unchanged. Each prompt module declares which override
    // keys it consumes via resolveOverride() calls — unknown keys are
    // silently ignored, so new frameworks add override fields without
    // touching this endpoint.
    const body = req.body || {};
    const {
      voice_profile_id,
      listing_id,
      framework_name,
      platform     = "instagram",
      content_type = "listing",
      ...extras
    } = body;

    if (!voice_profile_id) return res.status(400).json({ error: "voice_profile_id is required" });
    if (!listing_id)       return res.status(400).json({ error: "listing_id is required" });
    if (!framework_name)   return res.status(400).json({ error: "framework_name is required" });

    // ── 3. Look up prompt module ──
    // LinkedIn now has its own native prompt set under
    // api/_content/prompts/linkedin/listing/ (seven text-first frameworks).
    // The ONLY remaining LinkedIn alias is for the multi-photo gallery
    // option, which still reuses the Instagram walkthrough_carousel
    // prompt — that prompt emits per-photo slides[], which is exactly
    // what the LinkedIn gallery editor expects. Every other LinkedIn
    // framework resolves natively. The persisted generated_content row
    // stores platform='linkedin' regardless of the alias, so the post
    // path, scheduling, and analytics treat it as LinkedIn.
    let promptPlatform = platform;
    if (platform === "linkedin" && framework_name === CAROUSEL_FRAMEWORK) {
      promptPlatform = "instagram";
    }
    const promptMod = findPrompt(promptPlatform, content_type, framework_name);
    if (!promptMod) {
      return res.status(400).json({
        error: `no prompt registered for ${promptPlatform}/${content_type}/${framework_name}`,
      });
    }

    // ── 4. Load + ownership-check voice profile ──
    const { data: voiceProfile, error: vpErr } = await supabase
      .from("agent_voice_profiles")
      .select("*")
      .eq("id", voice_profile_id)
      .maybeSingle();
    if (vpErr) {
      console.error("[content-generate] voice profile fetch error:", vpErr);
      return res.status(500).json({ error: "voice profile fetch failed", details: vpErr.message });
    }
    if (!voiceProfile) return res.status(404).json({ error: "voice profile not found" });
    if (voiceProfile.agent_id !== authUser.id) {
      return res.status(403).json({ error: "voice profile does not belong to caller" });
    }
    if (!voiceProfile.license_number) {
      return res.status(422).json({
        error: "voice profile is missing license_number; required for TREC compliance line",
      });
    }

    // ── 5. Load + ownership-check listing ──
    const { data: listing, error: lErr } = await supabase
      .from("listings")
      .select("*")
      .eq("id", listing_id)
      .maybeSingle();
    if (lErr) {
      console.error("[content-generate] listing fetch error:", lErr);
      return res.status(500).json({ error: "listing fetch failed", details: lErr.message });
    }
    if (!listing) return res.status(404).json({ error: "listing not found" });
    if (listing.agent_id !== authUser.id) {
      return res.status(403).json({ error: "listing does not belong to caller" });
    }

    // ── 5b. (walkthrough_carousel only) Load photo labels → compute selection.
    //
    // Photo-driven carousels order/sequence slides from the listing's
    // classified photos. Only this framework reads photo_labels; every other
    // path is byte-for-byte unchanged. A read failure, no labels, or a
    // selection with zero subject slides all leave carouselSelection null →
    // build() + the post-parse zip take the legacy (text-only) path.
    let carouselSelection = null;
    if (framework_name === CAROUSEL_FRAMEWORK) {
      const { data: photoLabels, error: plErr } = await supabase
        .from("photo_labels")
        .select("*")
        .eq("listing_id", listing_id)
        .order("sort_order", { ascending: true });
      if (plErr) {
        console.error("[content-generate] photo_labels fetch error (continuing text-only):", plErr);
      } else {
        // Stage 4: required-rooms selection. selectCarouselPhotos returns a
        // fixed beat set (facade cover + living/kitchen/primary bed/primary bath,
        // + backyard only if a pool is detected), skipping rooms with no photo.
        // The count is fully selection-driven from here on — no cap.
        const sel = selectCarouselPhotos(photoLabels || []);
        if (sel.subjectSlides.length > 0) carouselSelection = sel;
      }
    }

    // ── 6. Build prompt strings ──
    let built;
    try {
      built = promptMod.build({
        voiceProfile,
        listing,
        extras,
        carouselSelection,
      });
    } catch (buildErr) {
      console.error("[content-generate] prompt build error:", buildErr);
      return res.status(400).json({ error: "prompt build failed", details: buildErr.message });
    }

    // ── 6b. (Facebook ONLY) Anti-repetition memory: load the agent's recent FB
    //        opening hooks and append an avoidance block to the FB system prompt
    //        AFTER its HOOK ORIGINALITY / BANNED OPENERS rules, so the new hook
    //        diverges from what this agent has already used. Never for Instagram;
    //        no-ops when the agent has no FB history yet.
    // FB + native LinkedIn frameworks both have a HOOK ORIGINALITY rule in
    // their system prompts and benefit from the same anti-repetition signal
    // (appended AFTER the original rules). LinkedIn gallery (the IG-aliased
    // walkthrough_carousel) uses IG's prompt, which has no HOOK ORIGINALITY
    // block to extend — appending the avoidance text there would dangle,
    // so skip. Hook history is scoped to the same platform the agent is
    // generating on, so FB history avoids FB repeats and LinkedIn history
    // avoids LinkedIn repeats independently.
    const useHookAvoidance = platform === "facebook" || (platform === "linkedin" && framework_name !== CAROUSEL_FRAMEWORK);
    if (useHookAvoidance) {
      const recentHooks = await resolveRecentHooks(supabase, authUser.id, platform);
      built.systemPrompt = appendHookAvoidanceBlock(built.systemPrompt, recentHooks);
    }

    // ── 7. Call the engine (caller injects already-built strings;
    //       engine stays stateless / domain-agnostic) ──
    // Per-module token budget: a framework may declare its own maxTokens
    // (FB long-form runs ~3500–4096); fall back to the endpoint default.
    const effectiveMaxTokens = promptMod.maxTokens || maxTokens;

    let result;
    try {
      result = await generate({
        model,
        maxTokens: effectiveMaxTokens,
        promptBuilders: {
          buildSystemPrompt: () => built.systemPrompt,
          buildUserMessage:  () => built.userMessage,
        },
      });
    } catch (engineErr) {
      console.error("[content-generate] engine call failed", {
        framework: framework_name,
        message:   engineErr?.message,
        code:      engineErr?.code,
      });
      if (engineErr?.code === "ENGINE_PARSE_FAILED") {
        return res.status(502).json({
          error: "model returned unparseable JSON",
          framework: framework_name,
        });
      }
      return res.status(502).json({ error: "content generation failed", details: engineErr?.message });
    }

    // ── 8. Validate the model's output shape ──
    let parsed = result.parsed;
    if (!parsed || typeof parsed !== "object") {
      console.error("[content-generate] parsed result not an object", { raw: result.raw });
      return res.status(502).json({ error: "model returned non-object payload" });
    }

    // ── 8a. (Facebook ONLY) Insert the microsite-link PLACEHOLDER TOKEN right
    //        after the model's CTA lead-in (the model writes the lead-in copy
    //        only — never a URL). Placed BEFORE the trailing hashtag block, which
    //        canonicalizeHashtags appends next. The token is ALWAYS inserted for
    //        FB; the live URL is substituted for it at display time + at POST time
    //        (so a microsite published/retired after generation is reflected).
    //        Never applied to Instagram. We still resolve the current URL only to
    //        return microsite_url in the response (UI "is there a microsite yet?").
    let micrositeUrl = null;
    // All LinkedIn flows AND all Facebook flows use the microsite-token-in-
    // caption pattern: appendMicrositeToken at generation time, then
    // substituteMicrositeToken at post time so the LIVE url at post time is
    // what publishes (microsites published/retired AFTER generation are
    // reflected). LinkedIn multi-photo gallery posts the FULL caption above
    // the gallery, same as the single-image LinkedIn / FB flow — so it
    // needs the token in the caption too.
    if (platform === "facebook" || platform === "linkedin") {
      micrositeUrl = await resolveMicrositeUrl(supabase, listing_id);
      parsed = { ...parsed, caption: appendMicrositeToken(parsed.caption) };
    }

    // Canonicalize hashtags so the caption-body block and the structured
    // hashtags[] array can never disagree on casing or content. Runs
    // before validation so the validated caption is the canonical one.
    const finalParsed = canonicalizeHashtags(parsed);

    // ── 8b. (walkthrough_carousel, photo-driven) Zip the deterministically
    //        chosen photo URLs onto the model's slides BY POSITION, using the
    //        SAME selection that drove the prompt. Skipped entirely on the
    //        legacy path (carouselSelection null). Non-fatal: a slide-count
    //        deviation zips best-effort and surfaces a warning rather than
    //        crashing.
    if (carouselSelection && Array.isArray(finalParsed.slides)) {
      const photoWarnings = [];
      zipCarouselPhotos(finalParsed.slides, carouselSelection, listing, photoWarnings);
      if (photoWarnings.length) finalParsed.photo_warnings = photoWarnings;
    }

    // Per-framework union: the universal minimum every Instagram
    // listing template emits, plus any extra fields the framework
    // module declares (e.g., walkthrough-carousel adds "slides").
    const required = [
      ...UNIVERSAL_REQUIRED_OUTPUT_FIELDS,
      ...(promptMod.additionalRequiredOutputFields || []),
    ];
    const missing = required.filter((k) => finalParsed[k] === undefined || finalParsed[k] === null);
    if (missing.length) {
      console.error("[content-generate] model output missing required fields", {
        missing,
        raw: result.raw,
      });
      return res.status(502).json({
        error: "model output missing required fields",
        missing,
      });
    }
    if (finalParsed.framework_used !== framework_name) {
      console.warn("[content-generate] framework_used mismatch", {
        expected: framework_name,
        got:      finalParsed.framework_used,
      });
    }

    // ── 9. Persist the generation (best-effort) ──
    //
    // Save a history row for the agent. agent_id is the server-resolved
    // caller id (authUser.id) — the same id used for the ownership checks
    // above — never a client-supplied value. This is wrapped in its own
    // try/catch: a save failure is logged but must NOT deny the caller
    // their generated content, so we fall through to the 200 response
    // either way. `saved_id` is added to the payload on success without
    // touching any existing field.
    let savedId = null;
    try {
      const insertRow = {
        agent_id:         authUser.id,
        listing_id:       listing_id,
        voice_profile_id: voice_profile_id,
        platform:         platform,
        content_type:     content_type,
        framework_name:   framework_name,
        caption:          finalParsed.caption,
        hook_line:        finalParsed.hook_line ?? null,
        cta_line:         finalParsed.cta_line ?? null,
        hashtags:         Array.isArray(finalParsed.hashtags) ? finalParsed.hashtags : [],
        license_number:   finalParsed.license_number ?? null,
      };
      // slides is only emitted by the walkthrough_carousel framework —
      // include the column only when present so non-carousel rows stay null.
      if (finalParsed.slides !== undefined && finalParsed.slides !== null) {
        insertRow.slides = finalParsed.slides;
      }

      const { data: savedRow, error: saveErr } = await supabase
        .from("generated_content")
        .insert(insertRow)
        .select("id")
        .maybeSingle();

      if (saveErr) {
        console.error("[content-generate] generated_content save failed (returning content anyway)", {
          framework: framework_name,
          message:   saveErr.message,
        });
      } else if (savedRow?.id) {
        savedId = savedRow.id;
      }
    } catch (saveCatch) {
      console.error("[content-generate] generated_content save threw (returning content anyway)", {
        framework: framework_name,
        message:   saveCatch?.message,
      });
    }

    // Additive response fields: saved_id (when persisted) + microsite_url for
    // Facebook (the resolved link, or null when none — the UI uses null to show
    // the "link inserts at post time" note). Never added for Instagram.
    // OVERRIDE the model-emitted platform with the REQUESTED platform. Needed
    // for the LinkedIn stopgap: the FB-aliased prompt forces the model to emit
    // "platform": "facebook" in its JSON output (per fbOutputFormatBlock), but
    // the caller asked for "linkedin" and the persisted row stores "linkedin"
    // — the response must agree so the result-panel render gates pick the
    // LinkedIn UI, not the FB album editor. Same defensive override is
    // applied to content_type for symmetry.
    return res.status(200).json({
      ...finalParsed,
      platform,                          // ← authoritative; ignores model echo
      content_type,                      // ← same reason
      ...(savedId ? { saved_id: savedId } : {}),
      ...(platform === "facebook" || platform === "linkedin" ? { microsite_url: micrositeUrl } : {}),
    });
  } catch (err) {
    console.error("[content-generate] fatal:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}

export default withSentry(handler);
