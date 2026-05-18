// Stage 5c — Instagram listing prompt #2: "You" Hook Listing.
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
// Shared mapping / validation / substitution logic lives in
// ../../_helpers.js. scene_angle is request-only — no listings column;
// resolveOverride falls through to a default fallback when neither
// extras nor a (nonexistent) listing column supplies it.

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

const TEMPLATE = `You are writing an Instagram listing caption for {agent_name}.

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
- Scene angle: {scene_angle}

FRAMEWORK: "YOU" HOOK LISTING

Write a caption with these eight sections, in this order:

1. HOOK (1 sentence): Begin with the word "You" and drop the viewer into a sensory moment inside or near the home. Tie to the scene angle. Must land within 3 seconds of reading. Match the agent's tone exactly.

2. SENSORY EXPANSION (1-2 sentences): Continue the scene with sight, sound, smell, or feel details. Stay in second person ("you"). Preserve the rhythm of the hook.

3. REVEAL: State neighborhood, beds, baths, sqft. Do not include the full street address.

4. FEATURES (2-3 short sentences): Highlight features that ground the sensory scene from the hook in physical details of the home.

5. TAKE (1 sentence): A reflective line about what living here would feel like. Use the agent's reflection style.

6. CTA (1 sentence): Use the agent's preferred CTA verb and style.

7. COMPLIANCE: Format exactly as: "{agent_name} | {brokerage_name} | TREC License #{license_number}"

8. HASHTAGS: 8-12 hashtags. Weight toward neighborhood, city, and DFW tags. Include 1-2 niche tags for home style or buyer type. No generic spam tags.

RULES
- Never use words in the avoided_words list.
- Naturally incorporate 1-2 signature phrases if they fit; do not force them.
- Do not use emojis unless the voice profile explicitly enables them.
- Stay in second person ("you") through HOOK and SENSORY EXPANSION; the FEATURES section can shift to third person if it reads more naturally.

OUTPUT FORMAT (return only valid JSON, no other text):
{
  "caption": "<full caption with sections joined by line breaks>",
  "hook_line": "<just the hook>",
  "cta_line": "<just the CTA>",
  "hashtags": ["tag1", "tag2", ...],
  "framework_used": "you_hook_listing",
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
  "scene_angle",
];

/**
 * Build {systemPrompt, userMessage} for the "You" Hook listing prompt.
 *
 * @param {object} ctx
 * @param {object} ctx.voiceProfile  Row from public.agent_voice_profiles.
 * @param {object} ctx.listing       Row from public.listings.
 * @param {object} [ctx.extras]      Per-request overrides. scene_angle here
 *                                   is request-only (no listings column);
 *                                   resolveOverride falls through to the
 *                                   default fallback when absent.
 */
function build({ voiceProfile, listing, extras = {} }) {
  requireBuildInputs({ voiceProfile, listing }, "you-hook");

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
    scene_angle: resolveOverride(
      extras, listing, "scene_angle",
      "a quiet moment somewhere in the home"
    ),
  };

  requirePromptVars(vars, REQUIRED_VARS, "you-hook");
  return { systemPrompt: SYSTEM_PROMPT, userMessage: substituteTemplate(TEMPLATE, vars) };
}

export default {
  platform:       "instagram",
  content_type:   "listing",
  framework_name: "you_hook_listing",
  template:       TEMPLATE,
  requiredVars:   REQUIRED_VARS,
  build,
};
