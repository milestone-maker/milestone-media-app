// Stage 5c — Instagram listing prompt #3: Walk-Through Carousel.
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
// ../../_helpers.js. slide_subjects is request-only — no listings
// column; resolveOverride falls through to the default fallback when
// neither extras nor a (nonexistent) column supplies it.
//
// Output contract: this is the first framework that emits a structured
// `slides` array in addition to the universal output fields. That
// extension is declared via `additionalRequiredOutputFields` on the
// default export so the endpoint validates `slides` presence.

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

const TEMPLATE = `You are writing an Instagram carousel post for {agent_name}. A carousel has multiple swipeable slides — your job is to generate the text overlay for each slide AND the main caption that appears under the post.

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
- Slide subjects (ordered, one slide per subject): {slide_subjects}

FRAMEWORK: WALK-THROUGH CAROUSEL

Generate TWO outputs:

A. SLIDE OVERLAYS — One short text per slide, each maximum 8 words:
- Cover slide (slide 1): A hook line in the agent's voice that makes swiping feel earned. Should land in 2 seconds.
- Subject slides (one per slide subject in order): Name the room or feature with one teaser sensory detail. The subject field for each slide must match the corresponding slide_subjects entry exactly.
- Final slide (last slide): A 1-line take combined with the agent's CTA verb. Should make the viewer want to reach out.

B. MAIN CAPTION (the text under the post):
1. OPEN (1 sentence): Tease the home in the agent's voice without revealing every room.
2. MIDDLE (2-3 sentences): Name 2-3 standout features that match the carousel content.
3. SWIPE PROMPT (1 sentence): Direct the viewer to swipe through.
4. COMPLIANCE: Format exactly as: "{agent_name} | {brokerage_name} | TREC License #{license_number}"
5. HASHTAGS: 8-12 hashtags. Weight toward neighborhood, city, and DFW tags. Include 1-2 niche tags for home style or buyer type. No generic spam tags.

RULES
- Never use words in the avoided_words list.
- Naturally incorporate 1-2 signature phrases if they fit; do not force them.
- Do not use emojis unless the voice profile explicitly enables them.
- Slide overlay text must be SHORT — every slide overlay max 8 words. Long overlay text defeats the carousel format.
- Total slide count must equal: 1 cover + N subjects + 1 final, where N is the count of slide_subjects entries.

OUTPUT FORMAT (return only valid JSON, no other text):
{
  "caption": "<main caption with sections joined by line breaks>",
  "slides": [
    {"slide_number": 1, "subject": "cover", "text": "<cover hook>"},
    {"slide_number": 2, "subject": "<first subject from slide_subjects>", "text": "<overlay text>"},
    {"slide_number": N+1, "subject": "<last subject from slide_subjects>", "text": "<overlay text>"},
    {"slide_number": N+2, "subject": "final", "text": "<take + CTA>"}
  ],
  "hook_line": "<text from the cover slide>",
  "cta_line": "<text from the final slide>",
  "hashtags": ["tag1", "tag2", ...],
  "framework_used": "walkthrough_carousel",
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
  "slide_subjects",
];

/**
 * Build {systemPrompt, userMessage} for the Walk-Through Carousel prompt.
 *
 * @param {object} ctx
 * @param {object} ctx.voiceProfile  Row from public.agent_voice_profiles.
 * @param {object} ctx.listing       Row from public.listings.
 * @param {object} [ctx.extras]      Per-request overrides. slide_subjects
 *                                   here is request-only (no listings
 *                                   column); resolveOverride falls through
 *                                   to the default fallback when absent.
 */
function build({ voiceProfile, listing, extras = {} }) {
  requireBuildInputs({ voiceProfile, listing }, "walkthrough-carousel");

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
    slide_subjects: resolveOverride(
      extras, listing, "slide_subjects",
      "kitchen, primary suite, primary bathroom, living area, outdoor space"
    ),
  };

  requirePromptVars(vars, REQUIRED_VARS, "walkthrough-carousel");
  return { systemPrompt: SYSTEM_PROMPT, userMessage: substituteTemplate(TEMPLATE, vars) };
}

export default {
  platform:       "instagram",
  content_type:   "listing",
  framework_name: "walkthrough_carousel",
  template:       TEMPLATE,
  requiredVars:   REQUIRED_VARS,
  additionalRequiredOutputFields: ["slides"],
  build,
};
