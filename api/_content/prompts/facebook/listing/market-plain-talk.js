// Facebook Stage 2 — FB framework #3: Market Plain Talk.
//
// A plain-spoken, long-form market take that uses the listing's price + area as
// the jumping-off point. Market FACTS only — price, price-per-sqft, area data —
// never demographic characterization (Fair Housing binds via the system prompt).
// Widest of the five, so the largest token budget.
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

const FRAMEWORK = "market_plain_talk";

const TEMPLATE = `You are writing a long-form Facebook post for {agent_name}.

VOICE PROFILE
- Tone: {tone_descriptors}
- CTA style: {cta_style}
- Signature phrases: {signature_phrases}
- Words to avoid: {avoided_words}
- License number: {license_number}
- Brokerage: {brokerage_name}

LISTING (market jumping-off point — use factual numbers only)
- Neighborhood: {neighborhood}
- City: {city}
- Price: {price}
- Beds: {beds} | Baths: {baths} | Sqft: {sqft}
- Standout features: {features}
- Market angle: {market_angle}

FRAMEWORK: MARKET PLAIN TALK
Write a grounded, plain-English market post. No hype, no jargon. FIXED beats (voice only at HOOK, TAKE, CTA verb):

1. HOOK (voice slot, 1–2 sentences): a plain-talk opener about the local market in the agent's voice.
2. THE NUMBER (1 short paragraph): use THIS listing as the concrete example — a {beds} bed / {baths} bath, {sqft} sqft home in {neighborhood} at {price}. If sqft and price are both real numbers, you may note the rough price-per-square-foot in plain terms. Market facts only.
3. PLAIN-TALK CONTEXT (2–4 short paragraphs): explain, like you're talking to a neighbor, what that price point means in {city} / {neighborhood} right now — what a buyer gets, how it compares in factual terms, what's driving it (inventory, rates, days-on-market). NO demographic or steering language; describe the MARKET, not the people.
4. TAKE (voice slot, 1–2 sentences): your honest, grounded read on what this means for buyers or sellers watching.
5. COMPLIANCE LINE: "{agent_name} | {brokerage_name} | TREC License #{license_number}" on its own line.
6. CTA LEAD-IN (voice slot verb, final line): invite discussion ("curious what locals are seeing") AND point to the home's page. End with a colon. NO URL.

${fbComplianceBlock()}

${fbOutputFormatBlock(FRAMEWORK)}`;

const REQUIRED_VARS = [
  "agent_name", "tone_descriptors", "cta_style", "signature_phrases", "avoided_words",
  "license_number", "brokerage_name", "neighborhood", "city", "price", "beds", "baths", "sqft",
  "features", "market_angle",
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
    // listings.price is a free-text column; pass through with a neutral fallback.
    price: (listing.price && String(listing.price).trim()) || "(price not specified)",
    signature_phrases: signaturePhrases,
    market_angle: resolveOverride(extras, listing, "market_angle", "what this price point really gets you right now"),
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
  maxTokens:      4096,
  build,
};
