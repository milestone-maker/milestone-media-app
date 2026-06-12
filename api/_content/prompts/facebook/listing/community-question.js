// Facebook Stage 2 — FB framework #2: Community Question.
//
// A genuine, open question that invites locals to reply — engagement-first.
// Area framing is factual only (Fair Housing binds via the system prompt).
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

const FRAMEWORK = "community_question";

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
- Question topic: {question_topic}

FRAMEWORK: COMMUNITY QUESTION
Write a conversational, multi-paragraph Facebook post built to earn replies. FIXED beats (voice only at HOOK, TAKE, CTA verb):

1. HOOK (voice slot, 1–2 sentences): frame the area or everyday-life topic in the agent's voice — grounded in a factual {city} / {neighborhood} detail.
2. CONTEXT (2–3 short paragraphs): set up the question with factual local color — amenities, geography, what's nearby, seasonal rhythms. No demographic or steering language.
3. THE QUESTION (1 short paragraph): ask ONE genuine, open question that invites locals to share (favorite spot, best-kept routine, what they'd change). It must feel real, not rhetorical — the whole post exists to start this thread.
4. SOFT BRIDGE (1–2 sentences): mention, lightly, that you're helping someone find a home here ({beds} bed / {baths} bath in {neighborhood}) — a passing note, not a pitch.
5. TAKE (voice slot, 1–2 sentences): a brief reflective line tying the question back to what makes a place worth living in (factual, no steering).
6. COMPLIANCE LINE: "{agent_name} | {brokerage_name} | TREC License #{license_number}" on its own line.
7. CTA LEAD-IN (voice slot verb, final line): nudge readers to answer in the comments AND to see the home's page. End with a colon. NO URL.

${fbComplianceBlock()}

${fbOutputFormatBlock(FRAMEWORK)}`;

const REQUIRED_VARS = [
  "agent_name", "tone_descriptors", "cta_style", "signature_phrases", "avoided_words",
  "license_number", "brokerage_name", "neighborhood", "city", "beds", "baths", "sqft",
  "features", "question_topic",
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
    question_topic: resolveOverride(extras, listing, "question_topic", "what makes this part of town feel like home"),
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
