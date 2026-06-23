// LinkedIn framework #2: Client Win Story.
//
// NARRATIVE: a short anonymized story of a client challenge → how the agent
// navigated it → the outcome → the lesson the agent took from it. No names,
// no addresses, no identifying specifics. The listing is GROUNDING (the
// market this story lives in), not the subject. The narrative is the
// content; the body lives or dies on the SPECIFICITY of the challenge and
// the HONESTY of the lesson.

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
  LINKEDIN_POST_SYSTEM_PROMPT,
  linkedinComplianceBlock,
  linkedinOutputFormatBlock,
} from "../_helpers.js";

const FRAMEWORK = "client_win_story";

const TEMPLATE = `You are writing a LinkedIn post for {agent_name}.

VOICE PROFILE
- Tone: {tone_descriptors}
- CTA style: {cta_style}
- Signature phrases: {signature_phrases}
- Words to avoid: {avoided_words}
- License number: {license_number}
- Brokerage: {brokerage_name}

CONTEXT (grounding — the market this story lives in)
- Neighborhood: {neighborhood}
- City: {city}
- Optional anchor the agent supplied for the story: {story_angle}

FRAMEWORK: CLIENT WIN STORY (anonymized narrative — challenge → navigation → outcome → lesson)
Write a single LinkedIn post that tells a SHORT, anonymized client story from this market. ABSOLUTELY NO client names, NO street addresses, NO identifying details (employer, family configuration, etc.). FIXED beats (voice only at HOOK, TAKE/lesson, CTA verb):

1. HOOK (voice slot, within the first ~210 characters): drop the reader into the SPECIFIC CHALLENGE in the agent's voice — a concrete moment, decision, or constraint that defined this deal. No generic openers. Vary opener type per HOOK ORIGINALITY.
2. HOW IT WENT (2–3 short paragraphs, neutral prose): walk the reader through what the agent actually did — the concrete steps, the strategic moves, the moments where the path forked. Stay specific to the challenge; no generic "I worked hard for them" filler. Use anonymous shorthand like "the buyers" or "the seller", never names.
3. THE OUTCOME (1 short paragraph, neutral prose): what happened. A number is welcome (over/under list, days, etc.) if it strengthens the story.
4. THE LESSON (voice slot — the agent's TAKE, 1–2 sentences): the honest takeaway the agent kept from this deal. Make it specific to this story; not a fortune-cookie aphorism.
5. SOFT INVITE (1 short paragraph): invite peers or readers who've faced something similar to add their experience.
6. COMPLIANCE LINE: "{agent_name} | {brokerage_name} | TREC License #{license_number}" on its own line.
7. CTA LEAD-IN (voice slot verb, FINAL line of the body): point the reader into the property page for current work in this market. End with a colon. NO URL.
8. HASHTAG LINE (separate final line, blank line above it): 3–5 lowercase hashtags. Mix one or two LOCAL with niche professional tags.

STRUCTURAL VARIATION (specific to this framework, do not copy from others):
- NARRATIVE shape. Story arc, NOT a bullet list. NO Problem/Solution/Takeaway skeleton.
- The privacy guardrail is HARD: no names, no addresses, no identifying detail. If the agent's profile or signature phrases would identify a client, do NOT use them.

${linkedinComplianceBlock()}

${linkedinOutputFormatBlock(FRAMEWORK)}`;

const REQUIRED_VARS = [
  "agent_name", "tone_descriptors", "cta_style", "signature_phrases", "avoided_words",
  "license_number", "brokerage_name", "neighborhood", "city", "story_angle",
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
    story_angle: resolveOverride(extras, listing, "story_angle", "(no specific story supplied — pick a recent representative client challenge from this market and tell it anonymously)"),
  };
  requirePromptVars(vars, REQUIRED_VARS, FRAMEWORK);
  return { systemPrompt: LINKEDIN_POST_SYSTEM_PROMPT, userMessage: substituteTemplate(TEMPLATE, vars) };
}

export default {
  platform:       "linkedin",
  content_type:   "listing",
  framework_name: FRAMEWORK,
  template:       TEMPLATE,
  requiredVars:   REQUIRED_VARS,
  additionalRequiredOutputFields: [],
  maxTokens:      2500,
  build,
};
