// Facebook Stage 2 — FB framework #5: Resource Drop.
//
// A genuinely useful buyer/seller resource with a SOFT lead-magnet CTA. Value
// first; the home and the agent are woven in lightly. Area/market references are
// factual only (Fair Housing binds via the system prompt).
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

const FRAMEWORK = "resource_drop";

const TEMPLATE = `You are writing a long-form Facebook post for {agent_name}.

VOICE PROFILE
- Tone: {tone_descriptors}
- CTA style: {cta_style}
- Signature phrases: {signature_phrases}
- Words to avoid: {avoided_words}
- License number: {license_number}
- Brokerage: {brokerage_name}

LISTING (lightly referenced — value comes first)
- Neighborhood: {neighborhood}
- City: {city}
- Beds: {beds} | Baths: {baths} | Sqft: {sqft}
- Standout features: {features}
- Resource topic: {resource_topic}

FRAMEWORK: RESOURCE DROP
Write a useful, generous, multi-paragraph Facebook post that helps buyers or sellers. FIXED beats (voice only at HOOK, TAKE, CTA verb):

1. HOOK (voice slot, 1–2 sentences): promise the value in the agent's voice — what the reader will walk away knowing about {resource_topic}.
2. THE RESOURCE (the bulk — 3–6 short, scannable points or steps): genuinely useful, specific, and accurate guidance on {resource_topic} for the {city} / {neighborhood} market. Factual only — process, timing, checklists, what to watch for. No demographic or steering language.
3. LIGHT TIE-IN (1–2 sentences): connect the resource to how you help, and mention the current home ({beds} bed / {baths} bath in {neighborhood}) as a passing example — not a pitch.
4. TAKE (voice slot, 1–2 sentences): a reflective line on why getting this right matters.
5. COMPLIANCE LINE: "{agent_name} | {brokerage_name} | TREC License #{license_number}" on its own line.
6. CTA LEAD-IN (voice slot verb, final line): a SOFT lead-magnet invite — offer the full version / to answer questions in the comments — and point to the home's page. End with a colon. NO URL.

${fbComplianceBlock()}

${fbOutputFormatBlock(FRAMEWORK)}`;

const REQUIRED_VARS = [
  "agent_name", "tone_descriptors", "cta_style", "signature_phrases", "avoided_words",
  "license_number", "brokerage_name", "neighborhood", "city", "beds", "baths", "sqft",
  "features", "resource_topic",
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
    resource_topic: resolveOverride(extras, listing, "resource_topic", "what first-time buyers should know before touring homes"),
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
