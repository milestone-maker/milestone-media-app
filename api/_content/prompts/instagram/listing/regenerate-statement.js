// Single-card statement regeneration — the prompt for ONE "statement-then-reveal"
// headline card. Used by api/content-regenerate-slide.js after an agent swaps the
// photo on one carousel slide in the Stage 2 lightbox: the new photo's room
// (category + features) is fed in and the model returns one fresh statement so
// the card matches the new photo.
//
// This is NOT a registry framework — it emits a single { statement } object, not
// the universal carousel/caption contract, so it is intentionally kept out of
// api/_content/registry.js and is imported directly by its endpoint.
//
// REUSE: the room string is built with subjectWithFeatures() from
// walkthrough-carousel.js so it is phrased EXACTLY like the full carousel prompt
// phrases each subject ("Kitchen — marble waterfall island, white cabinetry").
// Voice mapping reuses mapVoiceProfileToPromptVars(); the system prompt is the
// shared INSTAGRAM_CAPTION_SYSTEM_PROMPT.

import {
  mapVoiceProfileToPromptVars,
  substituteTemplate,
  requirePromptVars,
  INSTAGRAM_CAPTION_SYSTEM_PROMPT,
} from "../../_helpers.js";
import { subjectWithFeatures } from "./walkthrough-carousel.js";

const TEMPLATE = `You are writing ONE "statement-then-reveal" headline card for an Instagram real-estate walk-through carousel by {agent_name}.

VOICE PROFILE
- Tone descriptors: {tone_descriptors}
- CTA style: {cta_style}
- Words to avoid: {avoided_words}
- Brokerage: {brokerage_name}

ROOM (this single card only)
- {room}

TASK
Write ONE "statement-then-reveal" line for THIS room: a single polished, brand-voiced sentence (about 6–14 words) that names the room and teases what its photo shows, so the photo that follows feels earned. Use the room's listed features when they help. This card is regenerated on its own — do NOT reference other slides, a swipe sequence, or an overall narrative arc.

RULES
- Never use words in the avoided_words list.
- Exactly one sentence. No emojis unless the voice profile explicitly enables them.
- Do NOT include hashtags, the agent's name, a license number, or a call-to-action — return only the room statement.

OUTPUT FORMAT (return only valid JSON, no other text):
{"statement": "<the one-sentence statement>"}`;

const REQUIRED_VARS = [
  "agent_name",
  "tone_descriptors",
  "cta_style",
  "avoided_words",
  "brokerage_name",
  "room",
];

/**
 * Build {systemPrompt, userMessage} for a single-card statement regeneration.
 *
 * @param {object} ctx
 * @param {object} ctx.voiceProfile  Row from public.agent_voice_profiles.
 * @param {string} ctx.category      The swapped photo's photo_labels category.
 * @param {string[]} [ctx.features]  The swapped photo's features (string[]).
 * @returns {{ systemPrompt: string, userMessage: string }}
 */
export function buildRegenerateStatementPrompt({ voiceProfile, category, features = [] }) {
  if (!voiceProfile) throw new Error("regenerate-statement build: voiceProfile is required");
  if (!category || !String(category).trim()) {
    throw new Error("regenerate-statement build: category is required");
  }

  const vars = {
    ...mapVoiceProfileToPromptVars(voiceProfile),
    room: subjectWithFeatures({ category, features: Array.isArray(features) ? features : [] }),
  };

  requirePromptVars(vars, REQUIRED_VARS, "regenerate-statement");
  return {
    systemPrompt: INSTAGRAM_CAPTION_SYSTEM_PROMPT,
    userMessage: substituteTemplate(TEMPLATE, vars),
  };
}

export default { build: buildRegenerateStatementPrompt, template: TEMPLATE, requiredVars: REQUIRED_VARS };
