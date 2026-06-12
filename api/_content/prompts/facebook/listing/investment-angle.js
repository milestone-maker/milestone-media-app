// Facebook Stage 2 (addendum) — FB framework #7: Investment Angle.
//
// LISTING-FOCUSED through a FINANCIAL lens: why THIS property makes financial
// sense — location value, price relative to the area, features that hold value,
// long-term / rental potential. FB-shaped long-form, conversational.
//
// GUARDRAILS (in addition to the shared rules): stay QUALITATIVE and factual.
// NEVER fabricate specific financial figures (no invented appreciation %,
// rental $, or comp prices the model doesn't actually have); NEVER guarantee or
// promise future returns/appreciation; frame the case in general terms grounded
// in the listing's REAL price/specs/location.
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

const FRAMEWORK = "investment_angle";

const TEMPLATE = `You are writing a long-form Facebook post for {agent_name}.

VOICE PROFILE
- Tone: {tone_descriptors}
- CTA style: {cta_style}
- Signature phrases: {signature_phrases}
- Words to avoid: {avoided_words}
- License number: {license_number}
- Brokerage: {brokerage_name}

LISTING (THE SUBJECT — make the financial case for THIS home)
- Neighborhood: {neighborhood}
- City: {city}
- Price: {price}
- Beds: {beds} | Baths: {baths} | Sqft: {sqft}
- Description: {description}
- Standout features: {features}
- Investment focus: {investment_focus}

FRAMEWORK: INVESTMENT ANGLE (listing-focused — the financial case)
Write a grounded, multi-paragraph Facebook post making the QUALITATIVE financial case for this property. FIXED beats (voice only at HOOK, TAKE, CTA verb):

1. HOOK (voice slot, 1–2 sentences): open on why THIS home is worth a smart buyer's attention financially, in the agent's voice.
2. THE CASE (the bulk — 3–5 short paragraphs): make the value argument using ONLY the listing's real details — its price point, its size, its location, and features that tend to hold value (lot, layout, condition, durable finishes, flexibility for rental/long-term use). Talk in general, qualitative terms about what tends to support value here. Reference the home's actual {price}, {sqft}, {beds}/{baths}, and {neighborhood} / {city} as the factual anchors.
3. LONG-TERM / USE POTENTIAL (1 short paragraph): discuss long-term ownership or rental potential in general terms grounded in the home's real attributes.
4. TAKE (voice slot, 1–2 sentences): a reflective, honest line on how you think about value (no hype).
5. COMPLIANCE LINE: "{agent_name} | {brokerage_name} | TREC License #{license_number}" on its own line.
6. CTA LEAD-IN (voice slot verb, final line): invite a real conversation about the numbers and point to the home's page. End with a colon. NO URL.

INVESTMENT GUARDRAILS (MANDATORY — on top of the shared rules):
- Stay QUALITATIVE and factual. Do NOT fabricate specific financial figures: no invented appreciation percentages,
  no made-up rental income dollar amounts, no comp/sale prices you do not actually have. The ONLY numbers you may
  state are the listing's real price, sqft, beds, and baths shown above.
- Do NOT guarantee, promise, or imply assured future returns, appreciation, or rental income. Use measured language
  ("can", "tends to", "historically the kind of feature buyers value") — never "will", "guaranteed", or "you'll earn".
- Frame everything as general, qualitative reasoning grounded in this home's real attributes, not invented data.

${fbComplianceBlock()}

${fbOutputFormatBlock(FRAMEWORK)}`;

const REQUIRED_VARS = [
  "agent_name", "tone_descriptors", "cta_style", "signature_phrases", "avoided_words",
  "license_number", "brokerage_name", "neighborhood", "city", "price", "beds", "baths", "sqft",
  "description", "features", "investment_focus",
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
    price: (listing.price && String(listing.price).trim()) || "(price not specified)",
    description: (listing.description && String(listing.description).trim()) || "(no description provided)",
    signature_phrases: signaturePhrases,
    investment_focus: resolveOverride(
      extras, listing, "investment_focus",
      "why this home holds value — location, price, and features buyers tend to want"
    ),
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
