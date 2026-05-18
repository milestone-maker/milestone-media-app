// Stage 5c — Instagram listing prompt #5: Neighborhood-First.
//
// Underscored folder (_content/) keeps this file out of Vercel's
// serverless-function routing — Vercel only deploys files under api/
// that don't start with _.
//
// Contract: every prompt module exports the same shape so registry.js
// can dispatch uniformly. The build() function receives the loaded
// voiceProfile + listing rows plus per-request extras, and returns the
// { systemPrompt, userMessage } pair the content-engine will send.
//
// lifestyle_angle is request-only — no listings column; resolveOverride
// falls through to the default fallback when absent.

import {
  formatList,
  requireBuildInputs,
  mapVoiceProfileToPromptVars,
  mapListingToPromptVars,
  resolveOverride,
  requirePromptVars,
  substituteTemplate,
  INSTAGRAM_CAPTION_SYSTEM_PROMPT,
} from "../../_helpers.js";

const TEMPLATE = `You are writing an Instagram neighborhood-first listing caption for {agent_name}. This framework leads with the area and lifestyle before revealing the home — used by agents who want to own a submarket.

VOICE PROFILE
- Tone descriptors: {tone_descriptors}
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
- Lifestyle angle: {lifestyle_angle}

FRAMEWORK: NEIGHBORHOOD-FIRST

Write a caption with these nine sections, in this order:

1. HOOK (1-2 sentences): Open with a specific neighborhood moment or scene tied to the lifestyle angle. Land in the area before mentioning the home.

2. LIFESTYLE PROOF (2-3 sentences): Name 2-3 specific neighborhood details — local spots, daily rituals, walkability, weekend rhythms. Real and observable, not generic.

3. BRIDGE (1 sentence): Transition from the neighborhood to the property.

4. REVEAL: State neighborhood, beds, baths, sqft. Do not include the full street address.

5. FEATURES (1-2 sentences): Highlight 1-2 features that match the lifestyle angle.

6. TAKE (1 sentence): A reflective line in the agent's voice tying the lifestyle and the home together.

7. CTA (1 sentence): Use the agent's preferred CTA verb and style.

8. COMPLIANCE: Format exactly as: "{agent_name} | {brokerage_name} | TREC License #{license_number}"

9. HASHTAGS: 8-12 hashtags. Heavily weighted toward neighborhood and city. Include adjacent-neighborhood tags too if relevant. 1-2 niche tags for home style or buyer type.

RULES
- Never use words in the avoided_words list.
- Naturally incorporate 1-2 signature phrases if they fit; do not force them.
- Do not use emojis unless the voice profile explicitly enables them.
- Stay grounded in the specific neighborhood — generic "great location" lines defeat the framework.
- FAIR HOUSING: Do not describe the neighborhood in ways that touch on protected classes (race, color, religion, national origin, sex, familial status, disability). Focus on observable lifestyle and amenities, not who lives there or "would fit in."

OUTPUT FORMAT (return only valid JSON, no other text):
{
  "caption": "<full caption with sections joined by line breaks>",
  "hook_line": "<just the hook>",
  "cta_line": "<just the CTA>",
  "hashtags": ["tag1", "tag2", ...],
  "framework_used": "neighborhood_first",
  "license_number": "{license_number}",
  "platform": "instagram",
  "content_type": "listing"
}`;

const SYSTEM_PROMPT = INSTAGRAM_CAPTION_SYSTEM_PROMPT;

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
  "lifestyle_angle",
];

/**
 * Build {systemPrompt, userMessage} for the Neighborhood-First listing prompt.
 *
 * @param {object} ctx
 * @param {object} ctx.voiceProfile  Row from public.agent_voice_profiles.
 * @param {object} ctx.listing       Row from public.listings.
 * @param {object} [ctx.extras]      Per-request overrides. lifestyle_angle
 *                                   here is request-only (no listings column);
 *                                   resolveOverride falls through to the
 *                                   default fallback when absent.
 */
function build({ voiceProfile, listing, extras = {} }) {
  requireBuildInputs({ voiceProfile, listing }, "neighborhood-first");

  // TEMPORARY MAPPING (Stage 5c MVP):
  // The prompt asks for "signature phrases" but agent_voice_profiles has
  // no such column. We concatenate hook_lines + take_lines as a reasonable
  // proxy so the agent's voice still leaks into the caption. Future work
  // (tracked separately) will route hook_lines into the HOOK section and
  // take_lines into the TAKE section for more precise voice injection.
  const signaturePhrases = formatList(
    [...(voiceProfile.hook_lines || []), ...(voiceProfile.take_lines || [])],
    "(none specified — match overall tone)"
  );

  const vars = {
    ...mapVoiceProfileToPromptVars(voiceProfile),
    ...mapListingToPromptVars(listing),
    signature_phrases: signaturePhrases,
    lifestyle_angle: resolveOverride(
      extras, listing, "lifestyle_angle",
      "a neighborhood with strong daily rituals and walkable charm"
    ),
  };

  requirePromptVars(vars, REQUIRED_VARS, "neighborhood-first");
  return { systemPrompt: SYSTEM_PROMPT, userMessage: substituteTemplate(TEMPLATE, vars) };
}

export default {
  platform:       "instagram",
  content_type:   "listing",
  framework_name: "neighborhood_first",
  template:       TEMPLATE,
  requiredVars:   REQUIRED_VARS,
  additionalRequiredOutputFields: [],
  build,
};
