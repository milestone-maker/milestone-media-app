// LinkedIn framework #4: Process Educator.
//
// EXPLANATORY, NOT PROMOTIONAL: a common question or mistake → a plain,
// non-condescending explanation → a reassurance → a clear next step. The
// post teaches something genuinely useful; it's NOT a "Most agents won't
// tell you this…" setup or a self-promotional hook in disguise. Listing is
// loose grounding (the kind of market this applies in), not the subject.

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

const FRAMEWORK = "process_educator";

const TEMPLATE = `You are writing a LinkedIn post for {agent_name}.

VOICE PROFILE
- Tone: {tone_descriptors}
- CTA style: {cta_style}
- Signature phrases: {signature_phrases}
- Words to avoid: {avoided_words}
- License number: {license_number}
- Brokerage: {brokerage_name}

CONTEXT (loose grounding — this post teaches a process, not the listing)
- Neighborhood: {neighborhood}
- City: {city}
- The specific question or mistake the agent wants to address: {teaching_topic}

FRAMEWORK: PROCESS EDUCATOR (teach something useful; do NOT self-promote)
Write a single LinkedIn post that explains a specific real-estate process question or common mistake in a way an attentive non-professional reader can act on. FIXED beats (voice only at HOOK, TAKE/reassurance, CTA verb):

1. HOOK (voice slot, within the first ~210 characters): open with the SPECIFIC question or misconception, in the agent's voice. Make it feel like a question a real person asked. Vary opener type per HOOK ORIGINALITY. NEVER use "Most agents won't tell you this…" or any variant of self-promotional setup.
2. THE EXPLANATION (2–3 short paragraphs, neutral prose): plainly explain how it actually works. No jargon without a quick definition. No bullet-list-with-emoji shape. If the explanation has 2–3 discrete steps it is OK to use a short numbered list (plain numbers, no decorative emoji on the lines) — but only if it genuinely clarifies. Otherwise, prose paragraphs.
3. REASSURANCE (voice slot — the agent's TAKE, 1–2 sentences): the agent's honest reassurance about navigating this. NOT "trust me, I'm the expert"; specific and grounded. E.g., "Most people overthink this — the part that actually matters is X."
4. THE NEXT STEP (1 short paragraph, neutral prose): tell the reader what to do with this information — the one concrete next thing to look at, ask, or check.
5. SOFT INVITE (1 sentence or short paragraph): invite questions or experience from people who've been through this.
6. COMPLIANCE LINE: "{agent_name} | {brokerage_name} | TREC License #{license_number}" on its own line.
7. CTA LEAD-IN (voice slot verb, FINAL line of the body): point readers to the property page for what's currently in motion. End with a colon. NO URL.
8. HASHTAG LINE (separate final line, blank line above it): 3–5 lowercase hashtags. Mix one local with niche professional tags.

STRUCTURAL VARIATION (specific to this framework, do not copy from others):
- EDUCATIONAL prose. ONE short numbered list is allowed if it genuinely clarifies — no decorative emoji, plain numbers. Otherwise: paragraphs only.
- NO self-promotional setups. NO "Here's the thing." or "But here's the kicker." tropes. Trust the reader's intelligence.

${linkedinComplianceBlock()}

${linkedinOutputFormatBlock(FRAMEWORK)}`;

const REQUIRED_VARS = [
  "agent_name", "tone_descriptors", "cta_style", "signature_phrases", "avoided_words",
  "license_number", "brokerage_name", "neighborhood", "city", "teaching_topic",
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
    teaching_topic: resolveOverride(extras, listing, "teaching_topic", "(no topic supplied — pick the single most common question or misconception about the buying or selling process for this market and address it)"),
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
