// LinkedIn framework #5: Neighborhood Expertise.
//
// INSIDER LOCAL KNOWLEDGE: one specific, useful-to-know thing about
// {neighborhood} that only someone who actually works there would surface
// → why it matters. Listing is GROUNDING (this neighborhood), not the
// subject. The post is the content; the body lives or dies on the
// SPECIFICITY of the insider detail — generic "great schools, walkable"
// content is exactly what this framework must NOT produce.

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

const FRAMEWORK = "neighborhood_expertise";

const TEMPLATE = `You are writing a LinkedIn post for {agent_name}.

VOICE PROFILE
- Tone: {tone_descriptors}
- CTA style: {cta_style}
- Signature phrases: {signature_phrases}
- Words to avoid: {avoided_words}
- License number: {license_number}
- Brokerage: {brokerage_name}

THE NEIGHBORHOOD (the subject of this post)
- Neighborhood: {neighborhood}
- City: {city}
- The specific insider detail the agent wants to surface: {neighborhood_detail}
- Listing features (loose grounding, optional reference): {features}

FRAMEWORK: NEIGHBORHOOD EXPERTISE (insider, factual, specific)
Write a single LinkedIn post that surfaces ONE specific {neighborhood} detail an outsider wouldn't know, then explains why it matters. FAIR HOUSING is the hardest guardrail here — every observation must be about PLACES, FACTS, and amenities, never about the people who live there. FIXED beats (voice only at HOOK, TAKE, CTA verb):

1. HOOK (voice slot, within the first ~210 characters): drop the SPECIFIC insider detail in the agent's voice — a sub-block, a small street pattern, a school-day traffic shift, a specific business or geographic feature, a HOA or zoning quirk, etc. Vary opener type per HOOK ORIGINALITY. NEVER use generic "great schools / walkable / family-friendly" framing.
2. THE DETAIL (1–2 short paragraphs, neutral prose): elaborate factually — distances, hours, street names, observable patterns. Stay specific to {neighborhood}; do not slip into city- or country-level generalities.
3. WHY IT MATTERS (1–2 short paragraphs, neutral prose): factually connect this detail to what a buyer or seller actually evaluates — commute, lifestyle patterns, property condition, resale. NO demographic framing, NO steering proxies ("desirable", "safe", "good for families"). Just facts and amenities.
4. TAKE (voice slot, 1–2 sentences): the agent's honest read on how this detail shows up in conversations with people who don't live there yet.
5. SOFT INVITE (1 sentence or short paragraph): invite locals or peers who work this neighborhood to add their own insider observation.
6. COMPLIANCE LINE: "{agent_name} | {brokerage_name} | TREC License #{license_number}" on its own line.
7. CTA LEAD-IN (voice slot verb, FINAL line of the body): point readers to the property page for the home currently anchoring this market. End with a colon. NO URL.
8. HASHTAG LINE (separate final line, blank line above it): 3–5 lowercase hashtags. Mix one or two LOCAL ({city}/{neighborhood}-related) with niche professional tags.

STRUCTURAL VARIATION (specific to this framework, do not copy from others):
- INSIDER + FACTUAL. NO bullet list. The single insider detail is the load-bearing element.
- FAIR HOUSING is the hardest guardrail here. Re-read every sentence for demographic implications and rewrite anything that describes people, lifestyle archetypes, or "kinds" of areas.

${linkedinComplianceBlock()}

${linkedinOutputFormatBlock(FRAMEWORK)}`;

const REQUIRED_VARS = [
  "agent_name", "tone_descriptors", "cta_style", "signature_phrases", "avoided_words",
  "license_number", "brokerage_name", "neighborhood", "city", "neighborhood_detail", "features",
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
    neighborhood_detail: resolveOverride(extras, listing, "neighborhood_detail", "(no specific detail supplied — surface one insider observation grounded in the agent's recent activity in this neighborhood)"),
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
