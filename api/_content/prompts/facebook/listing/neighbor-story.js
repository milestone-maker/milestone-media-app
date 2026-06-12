// Facebook Stage 2 — FB framework #1: Neighbor Story.
//
// A local human-story arc seeded from the listing's AREA (factual geography /
// amenities only — Fair Housing binds via FACEBOOK_CAPTION_SYSTEM_PROMPT). The
// home is woven in softly; the post leads with place, not pitch.
//
// Output: the universal 7 fields with platform:"facebook", no slides.

import {
  formatList,
  requireBuildInputs,
  mapVoiceProfileToPromptVars,
  mapListingToPromptVars,
  resolveOverride,
  requirePromptVars,
  substituteTemplate,
} from "../../_helpers.js";
import {
  FACEBOOK_CAPTION_SYSTEM_PROMPT,
  fbComplianceBlock,
  fbOutputFormatBlock,
} from "../_helpers.js";

const FRAMEWORK = "neighbor_story";

const TEMPLATE = `You are writing a long-form Facebook post for {agent_name}.

VOICE PROFILE
- Tone: {tone_descriptors}
- CTA style: {cta_style}
- Signature phrases: {signature_phrases}
- Words to avoid: {avoided_words}
- License number: {license_number}
- Brokerage: {brokerage_name}

LISTING (area-framing source — use factual details only)
- Neighborhood: {neighborhood}
- City: {city}
- Beds: {beds} | Baths: {baths} | Sqft: {sqft}
- Standout features: {features}
- Story angle: {story_angle}

FRAMEWORK: NEIGHBOR STORY
Write a warm, multi-paragraph Facebook post with these FIXED beats (voice only at HOOK, TAKE, CTA verb):

1. HOOK (voice slot, 1–2 sentences): open on a vivid, specific local moment tied to the area, grounded in one real, factual place detail. Do not mention the listing yet. Make it ORIGINAL to this post — vary the opener type per HOOK ORIGINALITY, and do NOT reflexively open with the neighborhood name.
2. STORY (2–4 short paragraphs): tell a small human arc about everyday life in and around {neighborhood} / {city}, anchored ONLY to factual area features — geography, amenities, distances, local landmarks. No demographic or steering language.
3. BRIDGE (1 short paragraph): softly connect that sense of place to this home ({beds} bed / {baths} bath in {neighborhood}), referencing 1–2 standout features that fit the story.
4. TAKE (voice slot, 1–2 sentences): a reflective line about what makes a place feel like home (no steering, no demographic framing).
5. COMPLIANCE LINE: "{agent_name} | {brokerage_name} | TREC License #{license_number}" on its own line.
6. CTA LEAD-IN (voice slot verb, final line): invite the reader into the property's page and to join the conversation. End with a colon. NO URL.

${fbComplianceBlock()}

${fbOutputFormatBlock(FRAMEWORK)}`;

const REQUIRED_VARS = [
  "agent_name", "tone_descriptors", "cta_style", "signature_phrases", "avoided_words",
  "license_number", "brokerage_name", "neighborhood", "city", "beds", "baths", "sqft",
  "features", "story_angle",
];

function build({ voiceProfile, listing, extras = {} }) {
  requireBuildInputs({ voiceProfile, listing }, FRAMEWORK);
  const signaturePhrases = formatList(
    [...(voiceProfile.hook_lines || []), ...(voiceProfile.take_lines || [])],
    "(none specified — match overall tone)"
  );
  const vars = {
    ...mapVoiceProfileToPromptVars(voiceProfile),
    ...mapListingToPromptVars(listing),
    signature_phrases: signaturePhrases,
    story_angle: resolveOverride(extras, listing, "story_angle", "everyday life in a real Texas neighborhood"),
  };
  requirePromptVars(vars, REQUIRED_VARS, FRAMEWORK);
  return { systemPrompt: FACEBOOK_CAPTION_SYSTEM_PROMPT, userMessage: substituteTemplate(TEMPLATE, vars) };
}

export default {
  platform:       "facebook",
  content_type:   "listing",
  framework_name: FRAMEWORK,
  template:       TEMPLATE,
  requiredVars:   REQUIRED_VARS,
  additionalRequiredOutputFields: [],
  maxTokens:      3500,
  build,
};
