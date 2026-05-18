// Stage 5c — Instagram listing prompt #4: Behind-the-Scenes Pre-List.
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
// bts_context is request-only — no listings column; resolveOverride
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

const TEMPLATE = `You are writing an Instagram pre-list teaser caption for {agent_name}.

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
- Pre-list context (timing + what the visual shows): {bts_context}

FRAMEWORK: BEHIND-THE-SCENES PRE-LIST

Write a caption with these seven sections, in this order:

1. HOOK (1-2 sentences): Open with insider/early-access framing in the agent's voice. Make accessing this property before it hits the market feel valuable. Tie to the pre-list context.

2. BTS SETUP (1 sentence): Acknowledge what's happening behind the scenes (staging, drone shots, photography prep, etc.) based on the pre-list context. Don't describe the photo literally — write the line that goes alongside the photo.

3. TEASE (2-3 sentences): Hint at 2-3 standout features WITHOUT naming the address or revealing too much. Keep it slightly mysterious — make viewers want to ask for more.

4. TAKE (1 sentence): A reflective line in the agent's voice about why early access matters or what makes this listing worth waiting for.

5. CTA (1 sentence): A direct invitation to DM the agent for early access, using the agent's preferred CTA verb.

6. COMPLIANCE: Format exactly as: "{agent_name} | {brokerage_name} | TREC License #{license_number}"

7. HASHTAGS: 8-12 hashtags. Weight toward neighborhood, city, and DFW tags. Include 1-2 pre-list or coming-soon tags (e.g., #ComingSoon, #PreListAccess, #LakewoodComingSoon). No generic spam tags.

RULES
- NEVER reveal the full street address or anything that uniquely identifies the property.
- Never use words in the avoided_words list.
- Naturally incorporate 1-2 signature phrases if they fit; do not force them.
- Do not use emojis unless the voice profile explicitly enables them.
- Keep the tone insider/exclusive — the value here is access, not just information.

OUTPUT FORMAT (return only valid JSON, no other text):
{
  "caption": "<full caption with sections joined by line breaks>",
  "hook_line": "<just the hook>",
  "cta_line": "<just the CTA>",
  "hashtags": ["tag1", "tag2", ...],
  "framework_used": "behind_the_scenes_prelist",
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
  "bts_context",
];

/**
 * Build {systemPrompt, userMessage} for the Behind-the-Scenes Pre-List prompt.
 *
 * @param {object} ctx
 * @param {object} ctx.voiceProfile  Row from public.agent_voice_profiles.
 * @param {object} ctx.listing       Row from public.listings.
 * @param {object} [ctx.extras]      Per-request overrides. bts_context here
 *                                   is request-only (no listings column);
 *                                   resolveOverride falls through to the
 *                                   default fallback when absent.
 */
function build({ voiceProfile, listing, extras = {} }) {
  requireBuildInputs({ voiceProfile, listing }, "behind-the-scenes-prelist");

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
    bts_context: resolveOverride(
      extras, listing, "bts_context",
      "Prepping this one to go live soon — wrapping up final details."
    ),
  };

  requirePromptVars(vars, REQUIRED_VARS, "behind-the-scenes-prelist");
  return { systemPrompt: SYSTEM_PROMPT, userMessage: substituteTemplate(TEMPLATE, vars) };
}

export default {
  platform:       "instagram",
  content_type:   "listing",
  framework_name: "behind_the_scenes_prelist",
  template:       TEMPLATE,
  requiredVars:   REQUIRED_VARS,
  additionalRequiredOutputFields: [],
  build,
};
