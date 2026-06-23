// LinkedIn framework #7: Question / Poll.
//
// GENUINE QUESTION: a real question the agent wants the answer to → a
// short, honest explanation of WHY they're asking → an open invite to
// comment. Listing is loose grounding (the market the question lives in).
// The post is SHORTER than other frameworks (toward the lower end of the
// 1,300–1,900 range) — the body lives or dies on whether the question is
// a real question someone would actually want to answer.

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

const FRAMEWORK = "question_poll";

const TEMPLATE = `You are writing a LinkedIn post for {agent_name}.

VOICE PROFILE
- Tone: {tone_descriptors}
- CTA style: {cta_style}
- Signature phrases: {signature_phrases}
- Words to avoid: {avoided_words}
- License number: {license_number}
- Brokerage: {brokerage_name}

CONTEXT (loose grounding — the market the question lives in)
- Neighborhood: {neighborhood}
- City: {city}
- The specific question the agent wants to ask: {agent_question}

FRAMEWORK: QUESTION / POLL (genuine question — shorter, conversation-first)
Write a single LinkedIn post that asks ONE genuine question the agent actually wants the answer to, explains why they're asking, and invites people to weigh in. Length here can be toward the LOWER end of the 1,300–1,900 character range — shorter is fine if the question carries it. FIXED beats (voice only at HOOK, TAKE, CTA verb):

1. HOOK (voice slot, within the first ~210 characters): open with the QUESTION itself — sharp, specific, in the agent's voice. Not a survey question, not a rhetorical setup. Vary opener type per HOOK ORIGINALITY.
2. WHY I'M ASKING (1–2 short paragraphs, neutral prose): explain the context honestly — what just happened in the agent's recent activity that prompted this question, or what specific decision a current buyer/seller is weighing. Make it specific.
3. WHAT I'M LISTENING FOR (voice slot — the agent's TAKE, 1–2 sentences): what kind of answer would actually be useful — a number, a personal experience, a counter-example. Frame what would move the agent's thinking.
4. THE INVITE (1 short paragraph): invite specific kinds of people (buyers in a similar spot, sellers who navigated this, peers who've seen the pattern) to comment with their take. Open-ended; not "DM me".
5. COMPLIANCE LINE: "{agent_name} | {brokerage_name} | TREC License #{license_number}" on its own line.
6. CTA LEAD-IN (voice slot verb, FINAL line of the body): point readers to the property page for the home anchoring the question. End with a colon. NO URL.
7. HASHTAG LINE (separate final line, blank line above it): 3–5 lowercase hashtags. Mix one local with niche professional tags.

STRUCTURAL VARIATION (specific to this framework, do not copy from others):
- SHORTER than the other frameworks. The question is the load-bearing element; everything else stays out of the way.
- The question must be a REAL question — one a thoughtful person would want to answer. Not a poll bait ("Which do you prefer: A or B?"). Not a rhetorical setup ("Why don't more people…?"). A genuine open question.

${linkedinComplianceBlock()}

${linkedinOutputFormatBlock(FRAMEWORK)}`;

const REQUIRED_VARS = [
  "agent_name", "tone_descriptors", "cta_style", "signature_phrases", "avoided_words",
  "license_number", "brokerage_name", "neighborhood", "city", "agent_question",
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
    agent_question: resolveOverride(extras, listing, "agent_question", "(no specific question supplied — pick one real, specific question the agent has been turning over recently and ask it sharply)"),
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
