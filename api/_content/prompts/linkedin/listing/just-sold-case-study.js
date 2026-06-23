// LinkedIn framework #3: Just-Sold Case Study.
//
// SALE NARRATIVE WITH NUMBERS: the story of THIS listing's sale — days on
// market, above/below ask, the hurdle that defined the deal — told as a
// short story, NOT a "SOLD" flyer. Listing IS the subject. Numbers are
// inline grounding, not the decoration. The post is the content; the body
// lives or dies on the specificity of the hurdle and the honesty of the
// number commentary.

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

const FRAMEWORK = "just_sold_case_study";

const TEMPLATE = `You are writing a LinkedIn post for {agent_name}.

VOICE PROFILE
- Tone: {tone_descriptors}
- CTA style: {cta_style}
- Signature phrases: {signature_phrases}
- Words to avoid: {avoided_words}
- License number: {license_number}
- Brokerage: {brokerage_name}

THE SALE (the subject of this post)
- Neighborhood: {neighborhood}
- City: {city}
- Beds: {beds} | Baths: {baths} | Sqft: {sqft}
- Features: {features}
- Sale numbers (use whatever the agent supplied): {sale_numbers}
- The hurdle that defined this deal: {sale_hurdle}

FRAMEWORK: JUST-SOLD CASE STUDY (story of THIS sale, NOT a flyer)
Write a single LinkedIn post that tells the story of this specific sale — the hurdle, what the agent did about it, the outcome with numbers, the lesson kept. This is NOT a "SOLD" announcement; it is a SHORT CASE STUDY. FIXED beats (voice only at HOOK, TAKE/lesson, CTA verb):

1. HOOK (voice slot, within the first ~210 characters): open on THE HURDLE — the specific thing that made this sale harder or more interesting than usual, in the agent's voice. Vary opener type per HOOK ORIGINALITY. NEVER open with "Just sold!" or any variant.
2. THE STORY (2–3 short paragraphs, neutral prose): walk the reader through what happened. Cover the strategic move(s) the agent made, the moment(s) where the path forked, what the buyer side did, and how the deal got over the line. Stay specific to this sale.
3. THE NUMBERS (1 short paragraph, neutral prose): name the concrete numbers that mattered — days on market, percentage above or below ask, price corrections along the way. Use the {sale_numbers} the agent supplied. One small inline number block is fine; do NOT bullet-list them.
4. THE LESSON (voice slot — the agent's TAKE, 1–2 sentences): what this sale taught the agent. Specific to this story; not a fortune-cookie aphorism.
5. SOFT INVITE (1 short paragraph): invite sellers or buyers thinking about a similar situation to add a question or perspective.
6. COMPLIANCE LINE: "{agent_name} | {brokerage_name} | TREC License #{license_number}" on its own line.
7. CTA LEAD-IN (voice slot verb, FINAL line of the body): point readers to the listing page (the home that closed). End with a colon. NO URL.
8. HASHTAG LINE (separate final line, blank line above it): 3–5 lowercase hashtags. Mix one or two LOCAL ({city}/{neighborhood}-related) with niche professional tags.

STRUCTURAL VARIATION (specific to this framework, do not copy from others):
- STORY ARC + INLINE NUMBERS. NOT a flyer. NOT bullets of stats.
- The hurdle is the load-bearing element — without a specific hurdle this framework collapses into a sold flyer. If {sale_hurdle} is missing, pick the most interesting concrete challenge from {features} or {sale_numbers} and lead with that.

${linkedinComplianceBlock()}

${linkedinOutputFormatBlock(FRAMEWORK)}`;

const REQUIRED_VARS = [
  "agent_name", "tone_descriptors", "cta_style", "signature_phrases", "avoided_words",
  "license_number", "brokerage_name", "neighborhood", "city", "beds", "baths", "sqft",
  "features", "sale_numbers", "sale_hurdle",
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
    sale_numbers: resolveOverride(extras, listing, "sale_numbers", "(no specific sale numbers supplied — describe the deal qualitatively without inventing concrete numbers)"),
    sale_hurdle:  resolveOverride(extras, listing, "sale_hurdle",  "(no specific hurdle supplied — pick the most interesting concrete challenge from the listing's features and lead with that)"),
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
