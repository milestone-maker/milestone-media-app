// Facebook Stage 2 — FB framework #4: Win Share.
//
// The listing-status EXCEPTION: celebrate a just-sold / under-contract win with
// genuine gratitude + factual social proof. Still Fair-Housing bound — thank
// people and describe the WORK, never demographics (system prompt binds).
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

const FRAMEWORK = "win_share";

const TEMPLATE = `You are writing a long-form Facebook post for {agent_name}.

VOICE PROFILE
- Tone: {tone_descriptors}
- CTA style: {cta_style}
- Signature phrases: {signature_phrases}
- Words to avoid: {avoided_words}
- License number: {license_number}
- Brokerage: {brokerage_name}

LISTING (the win)
- Neighborhood: {neighborhood}
- City: {city}
- Beds: {beds} | Baths: {baths} | Sqft: {sqft}
- Standout features: {features}
- Win status: {win_status}

FRAMEWORK: WIN SHARE (listing-status post — celebrating a result)
Write a warm, grateful, multi-paragraph Facebook post. FIXED beats (voice only at HOOK, TAKE, CTA verb):

1. HOOK (voice slot, 1–2 sentences): announce the win ({win_status}) in the agent's voice — celebratory but genuine. Make it ORIGINAL to this post — vary the opener type per HOOK ORIGINALITY; no stock celebration openers.
2. GRATITUDE (1–2 short paragraphs): thank the clients and everyone who helped — sincerely, by role (the sellers, the buyers, the lender, the inspector). NO demographic characterization of anyone.
3. SOCIAL PROOF (2–3 short paragraphs): what actually made it work, in factual terms — the prep, the pricing strategy, the marketing/media, the days-on-market, the response. Concrete, not boastful.
4. TAKE (voice slot, 1–2 sentences): a reflective line on what this result means / what you love about the work.
5. COMPLIANCE LINE: "{agent_name} | {brokerage_name} | TREC License #{license_number}" on its own line.
6. CTA LEAD-IN (voice slot verb, final line): invite anyone thinking about a move to reach out / join the conversation, and point to the home's page. End with a colon. NO URL.

${fbComplianceBlock()}

${fbOutputFormatBlock(FRAMEWORK)}`;

const REQUIRED_VARS = [
  "agent_name", "tone_descriptors", "cta_style", "signature_phrases", "avoided_words",
  "license_number", "brokerage_name", "neighborhood", "city", "beds", "baths", "sqft",
  "features", "win_status",
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
    win_status: resolveOverride(extras, listing, "win_status", "just went under contract"),
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
