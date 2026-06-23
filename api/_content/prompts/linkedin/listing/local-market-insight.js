// LinkedIn framework #1: Local Market Insight.
//
// PROSE-DATA-DRIVEN: the agent surfaces a specific local data point or
// observation, explains what it MEANS, gives their read, and invites the
// conversation. Listing is GROUNDING (the local market context), not the
// subject. The post is the content; the body lives or dies on the
// SPECIFICITY of the data point and the clarity of the take.

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

const FRAMEWORK = "local_market_insight";

const TEMPLATE = `You are writing a LinkedIn post for {agent_name}.

VOICE PROFILE
- Tone: {tone_descriptors}
- CTA style: {cta_style}
- Signature phrases: {signature_phrases}
- Words to avoid: {avoided_words}
- License number: {license_number}
- Brokerage: {brokerage_name}

LOCAL MARKET (grounding — this post is ABOUT the market, not this listing)
- Neighborhood: {neighborhood}
- City: {city}
- Optional data point the agent wants to anchor on: {market_stat}

FRAMEWORK: LOCAL MARKET INSIGHT (prose, data-anchored, conversational)
Write a single LinkedIn post that surfaces a specific {neighborhood}/{city} market observation, explains its meaning, gives the agent's read, and invites discussion. FIXED beats (voice only at HOOK, TAKE, CTA verb):

1. HOOK (voice slot, within the first ~210 characters): lead with the SPECIFIC data point or local observation in the agent's voice. No generic openers. Vary opener type per HOOK ORIGINALITY.
2. WHAT IT MEANS (2 short paragraphs, neutral prose): plainly explain what this data point implies for buyers, sellers, or both. Stay specific to {city}/{neighborhood}; no generic national-market filler. One inline statistic is fine if it strengthens the explanation; do not turn this into a bullet list.
3. TAKE (voice slot, 1–2 sentences): the agent's HONEST read of what this means going into the next few weeks/months. Be specific, not hedged.
4. SOFT INVITE (1 short paragraph): invite people working in the market — buyers, sellers, peers — to add what they're seeing. Open-ended; not "DM me".
5. COMPLIANCE LINE: "{agent_name} | {brokerage_name} | TREC License #{license_number}" on its own line.
6. CTA LEAD-IN (voice slot verb, FINAL line of the body): invite the reader to dig deeper at the property page. End with a colon. NO URL.
7. HASHTAG LINE (separate final line after the CTA, with a blank line above it): 3–5 lowercase hashtags. Mix one or two LOCAL ({city}/{neighborhood}-related) with niche professional tags.

STRUCTURAL VARIATION (specific to this framework, do not copy from others):
- Prose-data-driven. ONE inline statistic is welcome. NO bullet list. NO checkmark-per-line shape.
- The data point must be CONCRETE and LOCAL — a specific street/zip/neighborhood number beats a national headline every time.

${linkedinComplianceBlock()}

${linkedinOutputFormatBlock(FRAMEWORK)}`;

const REQUIRED_VARS = [
  "agent_name", "tone_descriptors", "cta_style", "signature_phrases", "avoided_words",
  "license_number", "brokerage_name", "neighborhood", "city", "market_stat",
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
    market_stat: resolveOverride(extras, listing, "market_stat", "(no specific stat supplied — surface one specific observation about the local market grounded in your own recent activity)"),
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
