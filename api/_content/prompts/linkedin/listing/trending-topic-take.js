// LinkedIn framework #6: Trending-Topic Take.
//
// OPINION-DRIVEN: a current real-estate news item or trend → localized to
// {city}/{neighborhood} → the agent's own take. Listing is loose grounding
// (the local market this trend applies to). The post is the content; the
// body lives or dies on the SPECIFICITY of the localization and the
// HONESTY of the take — not the headline itself.

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

const FRAMEWORK = "trending_topic_take";

const TEMPLATE = `You are writing a LinkedIn post for {agent_name}.

VOICE PROFILE
- Tone: {tone_descriptors}
- CTA style: {cta_style}
- Signature phrases: {signature_phrases}
- Words to avoid: {avoided_words}
- License number: {license_number}
- Brokerage: {brokerage_name}

CONTEXT (loose grounding — this post is about a current real-estate trend, localized)
- Neighborhood: {neighborhood}
- City: {city}
- The current news / trend the agent wants to address: {trend_topic}

FRAMEWORK: TRENDING-TOPIC TAKE (current item, localized, opinion-driven)
Write a single LinkedIn post that engages a current real-estate news item or trend, then localizes it to {city}/{neighborhood} with the agent's honest read. FIXED beats (voice only at HOOK, TAKE, CTA verb):

1. HOOK (voice slot, within the first ~210 characters): open by naming the trend or recent shift in a CONCRETE way — a specific number, a specific policy change, a specific market signal — in the agent's voice. Vary opener type per HOOK ORIGINALITY. NEVER start with "In today's market…" or any variant.
2. THE LOCAL ANGLE (2 short paragraphs, neutral prose): localize the trend to {city}/{neighborhood}. What's actually happening on the ground here that mirrors, deviates from, or complicates the national/regional headline? Use specific observations from the agent's actual recent activity — not generic "we're seeing…" filler.
3. THE TAKE (voice slot, 2–3 sentences): the agent's honest opinion. Stake a position. NOT "time will tell"; NOT "it depends". Be specific about what the agent thinks is going to happen and what they'd advise based on this read.
4. SOFT INVITE (1 short paragraph): invite people watching this trend — buyers, sellers, peers — to add what they're seeing or push back on the take.
5. COMPLIANCE LINE: "{agent_name} | {brokerage_name} | TREC License #{license_number}" on its own line.
6. CTA LEAD-IN (voice slot verb, FINAL line of the body): point readers to the property page for current work navigating this market. End with a colon. NO URL.
7. HASHTAG LINE (separate final line, blank line above it): 3–5 lowercase hashtags. Mix one local with niche professional tags.

STRUCTURAL VARIATION (specific to this framework, do not copy from others):
- OPINION-DRIVEN PROSE. The TAKE beat is longer here than in other frameworks (2–3 sentences) — this is the framework where the agent is most expected to stake a position.
- NO bullet lists. NO hedged "time will tell" non-takes. NO restating the headline without commentary.

${linkedinComplianceBlock()}

${linkedinOutputFormatBlock(FRAMEWORK)}`;

const REQUIRED_VARS = [
  "agent_name", "tone_descriptors", "cta_style", "signature_phrases", "avoided_words",
  "license_number", "brokerage_name", "neighborhood", "city", "trend_topic",
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
    trend_topic: resolveOverride(extras, listing, "trend_topic", "(no specific trend supplied — pick one current real-estate news item or market signal the agent has an honest opinion on and address it)"),
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
