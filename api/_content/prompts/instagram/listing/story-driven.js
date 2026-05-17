// Stage 5c — Instagram listing prompt #1: Story-Driven Listing.
//
// Underscored folder (_content/) keeps this file out of Vercel's
// serverless-function routing — Vercel only deploys files under api/
// that don't start with _.
//
// Contract: every prompt module exports the same shape so registry.js
// can dispatch uniformly. The build() function receives the loaded
// voiceProfile + listing rows plus per-request extras, and returns the
// { systemPrompt, userMessage } pair the content-engine will send.

const TEMPLATE = `You are writing an Instagram listing caption for {agent_name}.

VOICE PROFILE
- Tone: {tone_descriptors}
- CTA style: {cta_style}
- Signature phrases: {signature_phrases}
- Words to avoid: {avoided_words}
- License number: {license_number}
- Brokerage: {brokerage_name}

LISTING
- Neighborhood: {neighborhood}
- City: {city}
- Beds: {beds} | Baths: {baths} | Sqft: {sqft}
- Standout features: {features}
- Story angle: {story_angle}

FRAMEWORK: STORY-DRIVEN LISTING

Write a caption with these eight sections, in this order:

1. HOOK (1-2 sentences): Open with a vivid scene or short story tied to the story angle. Do NOT mention the property yet. Must land within 3 seconds of reading. Match the agent's tone exactly.

2. BRIDGE (1 sentence): Transition from the story to the property.

3. REVEAL: State neighborhood, beds, baths, sqft. Do not include full street address.

4. FEATURES (2-3 short sentences): Highlight standout details that tie back to the story angle.

5. TAKE (1 sentence): A reflective line about what this home represents emotionally. Use the agent's reflection style.

6. CTA (1 sentence): Use the agent's preferred CTA verb and style.

7. COMPLIANCE: Format exactly as: "{agent_name} | {brokerage_name} | TREC License #{license_number}"

8. HASHTAGS: 8-12 hashtags. Weight toward neighborhood, city, and DFW tags. Include 1-2 niche tags for home style or buyer type. No generic spam tags.

RULES
- Never use words in the avoided_words list.
- Naturally incorporate 1-2 signature phrases if they fit; do not force them.
- Do not use emojis unless the voice profile explicitly enables them.

OUTPUT FORMAT (return only valid JSON, no other text):
{
  "caption": "<full caption with sections joined by line breaks>",
  "hook_line": "<just the hook>",
  "cta_line": "<just the CTA>",
  "hashtags": ["tag1", "tag2", ...],
  "framework_used": "story_driven_listing",
  "license_number": "{license_number}",
  "platform": "instagram",
  "content_type": "listing"
}`;

const SYSTEM_PROMPT =
  "You are a real-estate copywriter generating Instagram captions in the voice of a specific agent. " +
  "Follow the framework structure exactly. Return only the JSON object described in the OUTPUT FORMAT section, with no prose before or after.";

// Stable list of placeholder keys the template uses — kept in sync with
// TEMPLATE above. Used by the substituter to flag missing required fields.
const REQUIRED_VARS = [
  "agent_name",
  "tone_descriptors",
  "cta_style",
  "signature_phrases",
  "avoided_words",
  "license_number",
  "brokerage_name",
  "neighborhood",
  "city",
  "beds",
  "baths",
  "sqft",
  "features",
  "story_angle",
];

function arrOrEmpty(v) {
  return Array.isArray(v) ? v : [];
}

function formatList(arr, fallback = "(none specified)") {
  const a = arrOrEmpty(arr).filter((x) => x != null && String(x).trim() !== "");
  return a.length === 0 ? fallback : a.join(", ");
}

/**
 * Map voiceProfile + listing rows + extras into the flat placeholder
 * dict the template expects, then substitute into TEMPLATE.
 *
 * @param {object} ctx
 * @param {object} ctx.voiceProfile  Row from public.agent_voice_profiles.
 * @param {object} ctx.listing       Row from public.listings.
 * @param {object} [ctx.extras]      Per-request overrides. story_angle here
 *                                   wins over listing.story_angle.
 */
function build({ voiceProfile, listing, extras = {} }) {
  if (!voiceProfile) throw new Error("story-driven build: voiceProfile is required");
  if (!listing)      throw new Error("story-driven build: listing is required");

  // TEMPORARY MAPPING (Stage 5c MVP):
  // The prompt asks for "signature phrases" but agent_voice_profiles has
  // no such column. We concatenate hook_lines + take_lines as a reasonable
  // proxy so the agent's voice still leaks into the caption. Future work
  // (tracked separately) will route hook_lines into the HOOK section and
  // take_lines into the TAKE section for more precise voice injection.
  const signaturePhrases = [
    ...arrOrEmpty(voiceProfile.hook_lines),
    ...arrOrEmpty(voiceProfile.take_lines),
  ];

  // story_angle: request body overrides the listing column when present.
  const storyAngle =
    (extras.story_angle && String(extras.story_angle).trim()) ||
    (listing.story_angle && String(listing.story_angle).trim()) ||
    "a memorable home in a desirable neighborhood";

  // neighborhood falls back to city when the listing row hasn't set one yet.
  const neighborhood =
    (listing.neighborhood && String(listing.neighborhood).trim()) ||
    (listing.city && String(listing.city).trim()) ||
    "(neighborhood not specified)";

  const vars = {
    agent_name:        voiceProfile.full_name,
    tone_descriptors:  formatList(voiceProfile.tone_descriptors, "warm and direct"),
    cta_style:         "Preferred CTA verbs: " + formatList(voiceProfile.cta_verbs, "send, schedule, ask") + ". Use one naturally.",
    signature_phrases: formatList(signaturePhrases, "(none specified — match overall tone)"),
    avoided_words:     formatList(voiceProfile.phrases_to_avoid, "(none specified)"),
    license_number:    voiceProfile.license_number,
    brokerage_name:    voiceProfile.brokerage_name,
    neighborhood,
    city:              listing.city || "(city not specified)",
    beds:              listing.beds ?? "(beds not specified)",
    baths:             listing.baths ?? "(baths not specified)",
    sqft:              listing.sqft || "(sqft not specified)",
    features:          formatList(listing.features, "(no standout features listed)"),
    story_angle:       storyAngle,
  };

  const missing = REQUIRED_VARS.filter((k) => vars[k] === undefined || vars[k] === null);
  if (missing.length) {
    throw new Error(`story-driven build: missing required placeholder values: ${missing.join(", ")}`);
  }

  const userMessage = TEMPLATE.replace(/\{(\w+)\}/g, (_m, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`
  );

  return { systemPrompt: SYSTEM_PROMPT, userMessage };
}

export default {
  platform:       "instagram",
  content_type:   "listing",
  framework_name: "story_driven_listing",
  template:       TEMPLATE,
  requiredVars:   REQUIRED_VARS,
  build,
};
