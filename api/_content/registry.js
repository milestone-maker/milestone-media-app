// Stage 5c — prompt registry.
//
// Maps (platform, content_type, framework_name) → prompt module.
// Each prompt module conforms to the contract in
// api/_content/prompts/instagram/listing/story-driven.js:
//   { platform, content_type, framework_name, template, requiredVars, build }
//
// Adding a new framework = one import + one entry in PROMPTS. The
// register() helper validates the module's self-declared coordinates
// match the table cell it's slotted into, catching copy-paste errors.

import storyDrivenListing      from "./prompts/instagram/listing/story-driven.js";
import youHookListing          from "./prompts/instagram/listing/you-hook.js";
import walkthroughCarousel     from "./prompts/instagram/listing/walkthrough-carousel.js";
import behindTheScenesPrelist  from "./prompts/instagram/listing/behind-the-scenes-prelist.js";
import neighborhoodFirst       from "./prompts/instagram/listing/neighborhood-first.js";
import problemSolution         from "./prompts/instagram/listing/problem-solution.js";
import povDayInLife            from "./prompts/instagram/listing/pov-day-in-life.js";

// Facebook Stage 2 — FB-native frameworks (long-form, conversation-first).
import fbPropertyShowcase      from "./prompts/facebook/listing/property-showcase.js";
import fbInvestmentAngle       from "./prompts/facebook/listing/investment-angle.js";
import fbNeighborStory         from "./prompts/facebook/listing/neighbor-story.js";
import fbCommunityQuestion     from "./prompts/facebook/listing/community-question.js";
import fbMarketPlainTalk       from "./prompts/facebook/listing/market-plain-talk.js";
import fbWinShare              from "./prompts/facebook/listing/win-share.js";
import fbResourceDrop          from "./prompts/facebook/listing/resource-drop.js";

const PROMPTS = [
  storyDrivenListing,
  youHookListing,
  walkthroughCarousel,
  behindTheScenesPrelist,
  neighborhoodFirst,
  problemSolution,
  povDayInLife,
  // facebook/listing
  fbPropertyShowcase,
  fbInvestmentAngle,
  fbNeighborStory,
  fbCommunityQuestion,
  fbMarketPlainTalk,
  fbWinShare,
  fbResourceDrop,
];

const registry = Object.create(null);

function register(mod) {
  const { platform, content_type, framework_name } = mod;
  if (!platform || !content_type || !framework_name) {
    throw new Error(
      `prompt registry: module missing platform/content_type/framework_name (got ${JSON.stringify({ platform, content_type, framework_name })})`
    );
  }
  if (typeof mod.build !== "function") {
    throw new Error(`prompt registry: ${platform}/${content_type}/${framework_name} has no build() function`);
  }
  if (!registry[platform])                       registry[platform] = Object.create(null);
  if (!registry[platform][content_type])         registry[platform][content_type] = Object.create(null);
  if (registry[platform][content_type][framework_name]) {
    throw new Error(`prompt registry: duplicate registration for ${platform}/${content_type}/${framework_name}`);
  }
  registry[platform][content_type][framework_name] = mod;
}

for (const mod of PROMPTS) register(mod);

/**
 * Look up a prompt module by coordinates. Returns null when not found
 * so the caller can return a clean 400 instead of throwing.
 */
export function findPrompt(platform, content_type, framework_name) {
  return registry?.[platform]?.[content_type]?.[framework_name] || null;
}

/** List of all registered (platform, content_type, framework_name) triples — for diagnostics. */
export function listPrompts() {
  const out = [];
  for (const platform of Object.keys(registry)) {
    for (const content_type of Object.keys(registry[platform])) {
      for (const framework_name of Object.keys(registry[platform][content_type])) {
        out.push({ platform, content_type, framework_name });
      }
    }
  }
  return out;
}

export default registry;
