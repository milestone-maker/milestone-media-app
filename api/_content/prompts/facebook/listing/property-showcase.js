// Facebook Stage 2 (addendum) — FB framework #6: Property Showcase.
//
// LISTING-FOCUSED: the home itself is the subject — architecture, layout,
// finishes, standout rooms/features, outdoor space, what makes THIS property
// special. FB-shaped: long-form and conversational, told a little like a story
// about the house — NOT a dry spec sheet, NOT a carousel.
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

const FRAMEWORK = "property_showcase";

const TEMPLATE = `You are writing a long-form Facebook post for {agent_name}.

VOICE PROFILE
- Tone: {tone_descriptors}
- CTA style: {cta_style}
- Signature phrases: {signature_phrases}
- Words to avoid: {avoided_words}
- License number: {license_number}
- Brokerage: {brokerage_name}

LISTING (THE SUBJECT — this post is about the HOME itself)
- Neighborhood: {neighborhood}
- City: {city}
- Price: {price}
- Beds: {beds} | Baths: {baths} | Sqft: {sqft}
- Description: {description}
- Standout features: {features}
- Feature focus (what to spotlight): {feature_focus}

FRAMEWORK: PROPERTY SHOWCASE (listing-focused — the home is the star)
Write a warm, multi-paragraph Facebook post that walks the reader through THIS home and makes them feel it. FIXED beats (voice only at HOOK, TAKE, CTA verb):

1. HOOK (voice slot, 1–2 sentences): open on the single most compelling thing about THIS house in the agent's voice — a room, a detail, a feeling the home gives off. Lead with the HOME, not the neighborhood.
2. THE WALKTHROUGH (the bulk — 3–5 short paragraphs): take the reader through the property like a story. Cover the architecture/layout, the standout rooms, the finishes, and the outdoor space — drawing on the description and the feature focus. Make it vivid and specific to THIS home; do not pad with generic real-estate filler and do not read like a bullet-point spec sheet.
3. WHAT MAKES IT SPECIAL (1 short paragraph): name the one or two things that set this property apart.
4. LIGHT CONTEXT (optional, 1–2 sentences): a factual note on where it sits ({neighborhood} / {city}) — only if it adds to the home's story. Keep it factual; no demographic or steering language.
5. TAKE (voice slot, 1–2 sentences): a reflective line about who would love living here / what this home makes possible (no steering, no demographic framing).
6. COMPLIANCE LINE: "{agent_name} | {brokerage_name} | TREC License #{license_number}" on its own line.
7. CTA LEAD-IN (voice slot verb, final line): invite the reader to see the full home and join the conversation. End with a colon. NO URL.

${fbComplianceBlock()}

${fbOutputFormatBlock(FRAMEWORK)}`;

const REQUIRED_VARS = [
  "agent_name", "tone_descriptors", "cta_style", "signature_phrases", "avoided_words",
  "license_number", "brokerage_name", "neighborhood", "city", "price", "beds", "baths", "sqft",
  "description", "features", "feature_focus",
];

function build({ voiceProfile, listing, extras = {} }) {
  requireBuildInputs({ voiceProfile, listing }, FRAMEWORK);
  const signaturePhrases = formatList(
    [...(voiceProfile.hook_lines || []), ...(voiceProfile.take_lines || [])],
    "(none specified — match overall tone)"
  );
  // feature_focus defaults to the listing's own standout features when the
  // agent doesn't specify what to spotlight.
  const featuresList = formatList(listing.features, "the home's standout features");
  const vars = {
    ...mapVoiceProfileToPromptVars(voiceProfile),
    ...mapListingToPromptVars(listing),
    price: (listing.price && String(listing.price).trim()) || "(price not specified)",
    description: (listing.description && String(listing.description).trim()) || "(no description provided)",
    signature_phrases: signaturePhrases,
    feature_focus: resolveOverride(extras, listing, "feature_focus", featuresList),
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
