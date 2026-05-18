// Stage 5c — Instagram listing prompt #6: Problem-Solution.
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
// buyer_problem is request-only — no listings column; resolveOverride
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

const TEMPLATE = `You are writing an Instagram problem-solution listing caption for {agent_name}. This framework opens with a common buyer pain point and positions the home as the answer.

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
- Buyer problem: {buyer_problem}

FRAMEWORK: PROBLEM-SOLUTION

Write a caption with these nine sections, in this order:

1. HOOK (1 sentence): State the buyer problem sharply, using "You" or "Most buyers" framing. Make the pain feel real and land in 3 seconds.

2. ACKNOWLEDGE (1 sentence): Show that you understand the pain — empathize without sounding salesy.

3. BRIDGE (1 sentence): "Here's what's different about this one."

4. REVEAL: Neighborhood, beds, baths, sqft as the answer to the problem.

5. SOLUTION FEATURES (2-3 sentences): Map specific features directly to solving the stated buyer problem.

6. TAKE (1 sentence): A reframing line in the agent's voice — what becomes possible when the problem is solved.

7. CTA (1 sentence): Use the agent's preferred CTA verb and style.

8. COMPLIANCE: Format exactly as: "{agent_name} | {brokerage_name} | TREC License #{license_number}"

9. HASHTAGS: 8-12 hashtags. Mix of local (neighborhood, city, DFW) and problem-related tags like #FirstTimeBuyer, #GrowingFamily, #UpgradePath where they fit the buyer problem.

RULES
- Never use words in the avoided_words list.
- Naturally incorporate 1-2 signature phrases if they fit; do not force them.
- Do not use emojis unless the voice profile explicitly enables them.
- FAIR HOUSING: The buyer problem must never reference protected classes (race, color, religion, national origin, sex, familial status, disability). Frame problems around space, budget, location, work setup, or other neutral factors only. If the buyer_problem input touches a protected class, ignore it and use a neutral problem framed around space, budget, or location.

OUTPUT FORMAT (return only valid JSON, no other text):
{
  "caption": "<full caption with sections joined by line breaks>",
  "hook_line": "<just the hook>",
  "cta_line": "<just the CTA>",
  "hashtags": ["tag1", "tag2", ...],
  "framework_used": "problem_solution",
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
  "buyer_problem",
];

/**
 * Build {systemPrompt, userMessage} for the Problem-Solution listing prompt.
 *
 * @param {object} ctx
 * @param {object} ctx.voiceProfile  Row from public.agent_voice_profiles.
 * @param {object} ctx.listing       Row from public.listings.
 * @param {object} [ctx.extras]      Per-request overrides. buyer_problem
 *                                   here is request-only (no listings column);
 *                                   resolveOverride falls through to the
 *                                   default fallback when absent.
 */
function build({ voiceProfile, listing, extras = {} }) {
  requireBuildInputs({ voiceProfile, listing }, "problem-solution");

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
    buyer_problem: resolveOverride(
      extras, listing, "buyer_problem",
      "the search for a home that actually fits your life"
    ),
  };

  requirePromptVars(vars, REQUIRED_VARS, "problem-solution");
  return { systemPrompt: SYSTEM_PROMPT, userMessage: substituteTemplate(TEMPLATE, vars) };
}

export default {
  platform:       "instagram",
  content_type:   "listing",
  framework_name: "problem_solution",
  template:       TEMPLATE,
  requiredVars:   REQUIRED_VARS,
  additionalRequiredOutputFields: [],
  build,
};
