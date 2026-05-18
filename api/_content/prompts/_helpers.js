// Shared helpers for prompt-module build() functions.
//
// Every Instagram listing framework (and most just-sold / educational /
// market frameworks) does the same boilerplate: null-guard the inputs,
// map voice-profile columns to placeholder names, map listing columns,
// resolve per-request overrides, validate required vars, substitute into
// the template. This module factors all of that out so each framework
// module is mostly its prompt template plus a few lines of glue.
//
// Out of scope for these helpers:
//   • Framework-specific creative decisions (e.g., which voice-profile
//     columns map to "signature phrases" — that stays per-framework).
//   • Endpoint-level concerns (auth, ownership, license-number 422 guard,
//     engine call, post-processing — those live in api/content-generate.js).

// ────────────────────────────────────────────────────────────────────
// Generic utilities
// ────────────────────────────────────────────────────────────────────

/**
 * Normalize a maybe-array value into an array. Useful for safely
 * spreading or iterating over Postgres `text[]` columns that may be
 * null when no row data was supplied.
 *
 * Inputs:
 *   value — anything; arrays pass through, everything else becomes [].
 *
 * Output:
 *   Array. Never null. Same reference when input was already an array.
 *
 * Assumes:
 *   • Caller does not care about the difference between "null array",
 *     "missing field", and "explicitly empty array" — all collapse to [].
 *
 * When to use:
 *   At the top of any helper that needs to iterate or spread a column
 *   that might be null.
 *
 * @param {*} value
 * @returns {Array}
 */
export function arrOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Format an array as a comma-separated string for prompt embedding,
 * with a fallback when the array is empty or contains only blanks.
 *
 * Inputs:
 *   arr      — array of strings (other types are coerced via String()).
 *   fallback — string returned when the array has no usable entries.
 *
 * Output:
 *   Either the joined string ("a, b, c") or the fallback string.
 *
 * Assumes:
 *   • Whitespace-only entries should be treated as missing.
 *   • Output is destined for prompt text — caller wants a human-readable
 *     comma list, not JSON.
 *
 * When to use:
 *   Anywhere a Postgres `text[]` column needs to be rendered into the
 *   prompt body as a flat list.
 *
 * @param {Array<*>|null|undefined} arr
 * @param {string} [fallback="(none specified)"]
 * @returns {string}
 */
export function formatList(arr, fallback = "(none specified)") {
  const a = arrOrEmpty(arr).filter((x) => x != null && String(x).trim() !== "");
  return a.length === 0 ? fallback : a.join(", ");
}

// ────────────────────────────────────────────────────────────────────
// Build-input guards
// ────────────────────────────────────────────────────────────────────

/**
 * Throw a labelled error if either voiceProfile or listing is missing.
 *
 * Inputs:
 *   { voiceProfile, listing } — the two row objects every prompt build
 *                               function receives.
 *   frameworkLabel            — short framework slug used to prefix the
 *                               error message (e.g., "story-driven").
 *                               Required so logs/endpoint responses can
 *                               identify which framework failed.
 *
 * Output:
 *   undefined. Throws on failure.
 *
 * Throw text:
 *   "<frameworkLabel> build: voiceProfile is required"
 *   "<frameworkLabel> build: listing is required"
 *
 * Assumes:
 *   • A non-null but otherwise malformed row (missing columns) is the
 *     caller's problem — requirePromptVars catches downstream missing
 *     placeholder values.
 *   • frameworkLabel is a stable identifier kept in sync with the
 *     module's framework_name export (though not validated here).
 *
 * When to use:
 *   First line of every framework build() function.
 *
 * @param {{voiceProfile:object, listing:object}} inputs
 * @param {string} frameworkLabel
 * @returns {void}
 * @throws {Error} If voiceProfile or listing is missing.
 */
export function requireBuildInputs({ voiceProfile, listing }, frameworkLabel) {
  if (!voiceProfile) throw new Error(`${frameworkLabel} build: voiceProfile is required`);
  if (!listing)      throw new Error(`${frameworkLabel} build: listing is required`);
}

// ────────────────────────────────────────────────────────────────────
// Voice-profile + listing → prompt-vars mappers
// ────────────────────────────────────────────────────────────────────

/**
 * Map an agent_voice_profiles row into the universal prompt-variable
 * names that every Instagram listing framework shares.
 *
 * Returns: {
 *   agent_name, brokerage_name, license_number,
 *   tone_descriptors, cta_style, avoided_words
 * }
 *
 * Specifics:
 *   • agent_name        ← voiceProfile.full_name
 *   • brokerage_name    ← voiceProfile.brokerage_name
 *   • license_number    ← voiceProfile.license_number (passed through;
 *                          may be null — see Assumes)
 *   • tone_descriptors  ← formatList(tone_descriptors, "warm and direct")
 *   • cta_style         ← "Preferred CTA verbs: <cta_verbs comma list>. Use one naturally."
 *   • avoided_words     ← formatList(phrases_to_avoid, "(none specified)")
 *
 * Assumes:
 *   • voiceProfile is a row from public.agent_voice_profiles matching
 *     the Stage 5b schema (columns: full_name, brokerage_name,
 *     license_number, tone_descriptors text[], cta_verbs text[],
 *     phrases_to_avoid text[]).
 *   • Caller has already null-guarded voiceProfile (use requireBuildInputs).
 *   • license_number may be null — caller is responsible for the 422
 *     guard at the endpoint level. This helper passes it through as-is.
 *
 * When to use:
 *   At the top of any framework build() function whose prompt template
 *   references the six universal voice-profile placeholders. Spread the
 *   result into your local vars object and overlay any framework-
 *   specific mappings (e.g., signature_phrases) on top.
 *
 * @param {object} voiceProfile  Row from public.agent_voice_profiles
 * @returns {{
 *   agent_name: string, brokerage_name: string, license_number: ?string,
 *   tone_descriptors: string, cta_style: string, avoided_words: string
 * }}
 */
export function mapVoiceProfileToPromptVars(voiceProfile) {
  return {
    agent_name:       voiceProfile.full_name,
    brokerage_name:   voiceProfile.brokerage_name,
    license_number:   voiceProfile.license_number,
    tone_descriptors: formatList(voiceProfile.tone_descriptors, "warm and direct"),
    cta_style:        "Preferred CTA verbs: " +
                      formatList(voiceProfile.cta_verbs, "send, schedule, ask") +
                      ". Use one naturally.",
    avoided_words:    formatList(voiceProfile.phrases_to_avoid, "(none specified)"),
  };
}

/**
 * Map a listings row into the universal prompt-variable names that
 * every real-estate listing framework shares.
 *
 * Returns: {
 *   neighborhood, city, beds, baths, sqft, features
 * }
 *
 * Specifics:
 *   • neighborhood ← listing.neighborhood (trimmed) → falls back to
 *                     listing.city (trimmed) → "(neighborhood not specified)"
 *   • city         ← listing.city || "(city not specified)"
 *   • beds         ← listing.beds (preserves 0 via ??) || "(beds not specified)"
 *   • baths        ← listing.baths (same)
 *   • sqft         ← listing.sqft || "(sqft not specified)"
 *   • features     ← formatList(listing.features, "(no standout features listed)")
 *
 * Assumes:
 *   • listing is a row from public.listings (Stage 5c schema: city text,
 *     neighborhood text NULL, beds int, baths int, sqft text,
 *     features jsonb default '[]').
 *   • Caller has already null-guarded listing (use requireBuildInputs).
 *   • Neighborhood-falls-back-to-city is correct for every listing
 *     framework today; if a future framework needs strict neighborhood
 *     (no city fallback), split this helper rather than parameterizing.
 *
 * When to use:
 *   At the top of any framework build() function whose prompt template
 *   references the six universal listing placeholders. Spread the result
 *   into your local vars object.
 *
 * @param {object} listing  Row from public.listings
 * @returns {{
 *   neighborhood: string, city: string,
 *   beds: (number|string), baths: (number|string),
 *   sqft: string, features: string
 * }}
 */
export function mapListingToPromptVars(listing) {
  const neighborhood =
    (listing.neighborhood && String(listing.neighborhood).trim()) ||
    (listing.city && String(listing.city).trim()) ||
    "(neighborhood not specified)";

  return {
    neighborhood,
    city:     listing.city  || "(city not specified)",
    beds:     listing.beds  ?? "(beds not specified)",
    baths:    listing.baths ?? "(baths not specified)",
    sqft:     listing.sqft  || "(sqft not specified)",
    features: formatList(listing.features, "(no standout features listed)"),
  };
}

// ────────────────────────────────────────────────────────────────────
// Per-request override resolution + validation + substitution
// ────────────────────────────────────────────────────────────────────

/**
 * Resolve a per-request creative override against the three-tier
 * precedence: request body > persisted listing column > static default.
 *
 * Inputs:
 *   extras   — per-request overrides object (may be {} or undefined-ish).
 *   listing  — listings row.
 *   key      — column / extras-key name (same on both sides).
 *   fallback — static default used when neither extras nor listing has
 *              a non-blank value.
 *
 * Output:
 *   Trimmed string from extras[key] if non-blank, else trimmed string
 *   from listing[key] if non-blank, else fallback.
 *
 * Assumes:
 *   • Same key name is used in the request body and the listings column
 *     (e.g., "story_angle" on both sides). If they ever diverge, split
 *     into two lookups at the call site rather than parameterizing.
 *   • Blank strings (whitespace only) are treated as "not set."
 *   • Output is destined for prompt text — always returns a string.
 *
 * When to use:
 *   Any framework field where the agent can override the persisted
 *   listing value at generation time (story_angle, hook_override,
 *   market_stat, sold_price_delta, etc.).
 *
 * @param {object} extras
 * @param {object} listing
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
 */
export function resolveOverride(extras, listing, key, fallback) {
  const extrasValue = extras && extras[key];
  if (extrasValue && String(extrasValue).trim()) return String(extrasValue).trim();
  const listingValue = listing && listing[key];
  if (listingValue && String(listingValue).trim()) return String(listingValue).trim();
  return fallback;
}

/**
 * Throw a labelled error listing any required placeholder values that
 * are undefined or null in the vars dict.
 *
 * Inputs:
 *   vars           — flat placeholder→value dict the build function
 *                    assembled.
 *   requiredKeys   — array of placeholder names the template references.
 *   frameworkLabel — short framework slug for the error prefix.
 *
 * Output:
 *   undefined. Throws on failure.
 *
 * Throw text:
 *   "<frameworkLabel> build: missing required placeholder values: <key1, key2, ...>"
 *
 * Assumes:
 *   • undefined and null are the only "missing" sentinels — empty string,
 *     0, and false are considered valid placeholder values (the prompt
 *     author chose those defaults).
 *   • The requiredKeys list is kept in sync with the template body by
 *     the prompt-module author. This helper does not introspect the
 *     template.
 *
 * When to use:
 *   Right before substituteTemplate(), to fail fast with a useful
 *   diagnostic instead of letting unfilled {placeholders} reach Claude.
 *
 * @param {object} vars
 * @param {string[]} requiredKeys
 * @param {string} frameworkLabel
 * @returns {void}
 * @throws {Error} If any requiredKeys are undefined or null in vars.
 */
export function requirePromptVars(vars, requiredKeys, frameworkLabel) {
  const missing = requiredKeys.filter((k) => vars[k] === undefined || vars[k] === null);
  if (missing.length) {
    throw new Error(
      `${frameworkLabel} build: missing required placeholder values: ${missing.join(", ")}`
    );
  }
}

/**
 * Substitute {placeholder} tokens in a prompt template with values from
 * the vars dict. Tokens whose keys are not present in vars are left
 * verbatim (so a template typo surfaces as a literal {bad_key} in the
 * prompt sent to Claude rather than a silent "undefined").
 *
 * Inputs:
 *   template — prompt body with {snake_case_key} placeholders.
 *   vars     — flat placeholder→value dict. Values are coerced via String().
 *
 * Output:
 *   Substituted prompt body string.
 *
 * Assumes:
 *   • Placeholders match the regex /\{(\w+)\}/g (word chars only,
 *     curly-delimited). JSON examples that contain `{ "key": ... }` in
 *     the template body do NOT match (the inner key starts with `"`,
 *     not a word char).
 *   • Caller has already validated all required keys via
 *     requirePromptVars — this helper does not re-check.
 *
 * When to use:
 *   Final step of every framework build() function, after vars assembly
 *   and validation.
 *
 * @param {string} template
 * @param {Object<string,*>} vars
 * @returns {string}
 */
export function substituteTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_m, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`
  );
}

// ────────────────────────────────────────────────────────────────────
// Shared system prompts
// ────────────────────────────────────────────────────────────────────

/** Shared default system prompt for Instagram-caption listing frameworks. Frameworks may override locally if their structure requires it. */
export const INSTAGRAM_CAPTION_SYSTEM_PROMPT =
  "You are a real-estate copywriter generating Instagram captions in the voice of a specific agent. " +
  "Follow the framework structure exactly. Return only the JSON object described in the OUTPUT FORMAT section, with no prose before or after.";

// ────────────────────────────────────────────────────────────────────
// Output validation
// ────────────────────────────────────────────────────────────────────

/**
 * Universal minimum set of required output fields that every Instagram
 * listing prompt template emits. Lifted from the OUTPUT FORMAT JSON
 * example baked into each template — these seven fields appear in
 * every framework's contract.
 *
 * Per-framework modules may extend this set via the
 * `additionalRequiredOutputFields` array on their default export
 * (e.g., walkthrough-carousel declares ["slides"]). The endpoint
 * validates the union of these two lists.
 *
 * Presence-only — the endpoint checks that each listed key has a
 * non-null/non-undefined value. Type-level validation is deliberately
 * out of scope; add a per-framework validateOutput(parsed) hook when
 * a concrete production failure mode justifies it.
 *
 * Frozen to discourage runtime mutation; spread or copy if a caller
 * needs to compute a union.
 */
export const UNIVERSAL_REQUIRED_OUTPUT_FIELDS = Object.freeze([
  "caption",
  "hook_line",
  "cta_line",
  "hashtags",
  "framework_used",
  "platform",
  "content_type",
]);
