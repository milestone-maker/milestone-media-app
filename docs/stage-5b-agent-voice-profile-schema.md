# Stage 5b — Agent Voice Profile Schema

## 1. Preamble

### Purpose

This document defines the shape of an agent voice profile in Milestone. A voice profile is the structured input that the content engine consumes to generate posts that sound like a specific real estate agent, in a specific market, for a specific audience.

### What this schema is the source of truth for

- The Supabase table that stores agent voice profiles (table: `agent_voice_profiles`).
- The input contract for `@milestone-maker/content-engine`'s `generatePosts` call from Milestone's serverless functions.
- The structure of the agent-facing voice settings UI (in the Content tab of the Milestone app).

### What this schema does not define

- The actual prompt templates that consume voice profiles. Those are written in Stage 5c.
- The framework sets and weight mappings for Facebook, Threads, and LinkedIn. Only Instagram is mapped here.
- The internals of the content engine package. Voice profiles are passed through as opaque `brandVoice` objects.

### Stability and change control

Once Stage 5c begins consuming this schema, breaking changes become costly. Additive changes (new optional fields) remain safe. Any change to fields marked **required** or **enum-constrained** after Stage 5c kicks off requires a migration path for any voice profiles already in the database.

This document locks at the end of Stage 5b review.

---

## 2. Agent identity

| Field | Type | Required | Notes |
|---|---|---|---|
| `display_name` | string | required | Casual form used in copy. "Tyshawn" not "Tyshawn Miles." |
| `full_name` | string | required | Formal form. Used in signatures and legal footers. |
| `brokerage_name` | string | required | The brokerage the agent works under. |
| `brokerage_tagline` | string | optional | If the brokerage has one. |
| `license_number` | string | required for TX | TREC requires this in social posts. May be optional outside Texas; enforce per-state if Milestone expands. |
| `headshot_url` | string (URL) | optional | For cover slides and sign-off frames. Stored as a Supabase storage URL. |

---

## 3. Market focus

| Field | Type | Required | Notes |
|---|---|---|---|
| `primary_metro` | string | required | Umbrella term — "DFW", "Austin Metro", "Houston Metro". One value. |
| `primary_neighborhoods` | string[] | required, 1-5 entries | Day-to-day markets. |
| `secondary_neighborhoods` | string[] | optional, 0-5 entries | Occasional markets. |
| `property_type_focus` | enum[] | required, at least 1 | Values: `residential`, `luxury`, `new-construction`, `investment`, `commercial`, `ranch-land`. |

---

## 4. Specialization tags

Agent picks 1-3 tags. Drives inferred framework weights.

| Tag | Definition |
|---|---|
| `luxury` | High-end residential, typically $1M+ price points. |
| `first-time-buyer` | Buyers entering the market for the first time. |
| `relocation` | Clients moving in from out of state, military transfers, executive moves. |
| `investor` | Buyers acquiring property for rental income or flips. |
| `new-construction` | Builder partnerships, pre-construction sales. |
| `downsizers` | Empty nesters, retirees moving to smaller homes. |
| `military-va` | VA loan specialization, military relocation. |
| `divorce` | Sales triggered by divorce, includes mediation context. |
| `executive-transfers` | Corporate relocation packages. |
| `commercial` | Non-residential property. |
| `ranch-land` | Rural acreage, ranches, raw land. |

**Schema field:** `specialization_tags: string[]`, required, 1-3 entries, values constrained to the enum above.

---

## 5. Reference accounts

Agent picks 1-2 accounts whose style they want to emulate. Drives inferred framework weights.

| Reference | Style Notes |
|---|---|
| `serhant` | Ryan Serhant — luxury polish + family/silly BTS mix. |
| `coffee-and-contracts` | Texas husband-wife — "POV: The Grind Finally Paid Off" energy. Geographically relevant for DFW. |
| `krishnan` | The Krishnan Team — contrarian hook captions ("Stop Falling For This"). |
| `jade-mills` | Educational without preachy, branded hashtag series. |
| `elmes` | The Elmes Group — drone + closeup luxury aerial. |

**Schema field:** `reference_accounts: { account: string, weight?: number }[]`, required, 1-2 entries. Optional per-reference `weight` from 0.5 to 1.5, default 1.0 — lets an agent indicate "lots of this" vs "just a touch."

---

## 6. Voice profile — the three slots

Voice injects at three places in every framework: hook line, take/lesson line, CTA verb. The structural beats of each framework stay fixed; only these three slots vary by agent.

| Field | Type | Required | Notes |
|---|---|---|---|
| `hook_lines` | string[] | required, 5-10 entries | Opening lines in the agent's voice. Engine generates a starter set at onboarding, agent edits. |
| `take_lines` | string[] | required, 5-10 entries | "Here's what this means" or "here's why this matters" lines. The agent's actual perspective. |
| `cta_verbs` | string[] | required, 3-8 entries | How the agent invites action ("DM me," "comment AREA," "tap the link"). |
| `tone_descriptors` | string[] | required, 3-5 entries | Free-form. E.g., "plainspoken, dry, no-nonsense" or "warm, story-driven, generous with detail." |
| `phrases_to_avoid` | string[] | optional | Agent-specific avoid list. The engine filters output for these. |

---

## 7. Hashtag pools

Four composable pools. Engine assembles fresh per-post combos from these, never a fixed wall of 30.

| Field | Type | Required | Size | Notes |
|---|---|---|---|---|
| `hashtag_pool_hyper_local` | string[] | required | 5-15 entries | E.g., `FriscoHomes`, `ProsperTX`, `CelinaRealEstate`. |
| `hashtag_pool_niche_feature` | string[] | required | 5-15 entries | E.g., `WaterfrontHome`, `LuxuryListing`, `NewConstruction`. |
| `hashtag_pool_broad_industry` | string[] | required | 3-8 entries | E.g., `Realtor`, `DallasRealtor`, `RealEstate`. |
| `hashtag_pool_action` | string[] | required | 3-8 entries | E.g., `JustListed`, `OpenHouse`, `PriceImprovement`. |

**Format:** No `#` prefix in stored values. Engine adds `#` at render time.

**Per-post selection rules (Instagram):** 1-2 broad + 3-4 hyper-local + 2-3 niche + 1-2 action = 8-12 hashtags total.

**Per-post selection rules (Facebook):** 1-3 hashtags total, pulled from any pool. Facebook hashtags are largely irrelevant in 2026.

**Per-post selection rules (Threads, LinkedIn):** Deferred to Stage 5c.

---

## 8. Framework weights

### 8.1 Storage shape

| Field | Type | Required | Notes |
|---|---|---|---|
| `framework_weights_inferred` | `{ [framework_id]: number }` | computed | Inferred from specialization_tags and reference_accounts. Cached. Re-computed when tags or references change. |
| `framework_weights_override` | `{ [framework_id]: number } \| null` | optional | If non-null, replaces inferred for sampling. If null, inferred is used. |

### 8.2 Instagram framework IDs

| ID | Framework |
|---|---|
| `ig_story` | Hook → Story → Lesson → CTA |
| `ig_stat` | Question → Stat → Take → CTA |
| `ig_bold` | Bold claim → Proof → Soft pitch |
| `ig_lifestyle` | Address tease → Lifestyle → Specs → CTA |
| `ig_pov` | Confession/POV → Insight → Permission |

### 8.3 Inference math

- Every framework starts at base weight **1.0**.
- Each selected specialization tag adds contributions per the table in 8.4.
- Each selected reference account adds contributions per the table in 8.5.
- Reference account weights (from §5) multiply that account's contributions before summing.
- After summing, **cap at 1.5** and **floor at 0.5**.
- Final values are stored in `framework_weights_inferred`.
- Engine treats weights as relative probabilities when sampling rotation; totals do not need to sum to a fixed value.

### 8.4 Specialization tag → IG framework contributions

| Tag | ig_story | ig_stat | ig_bold | ig_lifestyle | ig_pov |
|---|---|---|---|---|---|
| `luxury` | +0.3 | — | +0.1 | +0.5 | — |
| `first-time-buyer` | +0.2 | +0.3 | — | — | +0.5 |
| `relocation` | +0.4 | +0.2 | — | — | +0.3 |
| `investor` | — | +0.5 | +0.3 | — | — |
| `new-construction` | +0.2 | +0.1 | — | +0.3 | — |
| `downsizers` | +0.3 | — | — | +0.2 | +0.3 |
| `military-va` | +0.3 | +0.2 | — | — | +0.4 |
| `divorce` | +0.3 | — | — | — | +0.4 |
| `executive-transfers` | +0.3 | +0.3 | — | +0.2 | — |
| `commercial` | +0.1 | +0.5 | +0.3 | — | — |
| `ranch-land` | +0.3 | +0.1 | — | +0.4 | — |

### 8.5 Reference account → IG framework contributions

| Reference | ig_story | ig_stat | ig_bold | ig_lifestyle | ig_pov |
|---|---|---|---|---|---|
| `serhant` | +0.4 | — | — | +0.3 | +0.2 |
| `coffee-and-contracts` | +0.3 | — | — | — | +0.5 |
| `krishnan` | — | +0.3 | +0.5 | — | — |
| `jade-mills` | +0.3 | +0.4 | — | — | +0.1 |
| `elmes` | +0.3 | — | — | +0.4 | — |

### 8.6 Worked example

Agent picks specializations `[luxury, relocation]` and references `[{account: serhant, weight: 1.0}, {account: coffee-and-contracts, weight: 1.0}]`.

Starting from base 1.0:
- `ig_story`: 1.0 + 0.3 + 0.4 + 0.4 + 0.3 = 2.4 → **1.5** (capped)
- `ig_stat`: 1.0 + 0.2 = **1.2**
- `ig_bold`: 1.0 = **1.0**
- `ig_lifestyle`: 1.0 + 0.5 + 0.3 = **1.8** → **1.5** (capped)
- `ig_pov`: 1.0 + 0.3 + 0.2 + 0.5 = 2.0 → **1.5** (capped)

Final `framework_weights_inferred`: `{ ig_story: 1.5, ig_stat: 1.2, ig_bold: 1.0, ig_lifestyle: 1.5, ig_pov: 1.5 }`.

---

## 9. Social handles

At least one social handle is required to publish content.

| Field | Type | Required | Notes |
|---|---|---|---|
| `social_instagram` | string | optional | Handle without `@`. |
| `social_facebook_url` | string (URL) | optional | Full URL to FB page. |
| `social_threads` | string | optional | Handle without `@`. |
| `social_linkedin_url` | string (URL) | optional | Full URL to LinkedIn profile. |

**Validation rule:** At least one of the four must be present at publish time. Enforced server-side, not in schema.

---

## 10. UI translation rules

The agent never sees raw numeric weights. The UI translates `framework_weights_inferred` (or `framework_weights_override`, whichever is active) into plain English.

### 10.1 Plain-English framework names

| Framework ID | Plain-English label |
|---|---|
| `ig_story` | narrative-driven property stories |
| `ig_stat` | market data and stats |
| `ig_bold` | bold or contrarian takes |
| `ig_lifestyle` | lifestyle and address-tease showcases |
| `ig_pov` | relatable POV and behind-the-scenes |

### 10.2 Summary generation rules

Sort frameworks by active weight, descending. Then:

- **Top 1-2** (weight ≥ 1.3): "leans toward {labels}"
- **Mid** (weight 0.9-1.2): "with some {labels} mixed in"
- **Bottom 1-2** (weight ≤ 0.8): "{labels} are quieter in your mix"

**Template:**

> Your content is set to lean toward {top}. {mid optional}. {bottom optional}.

**Worked example** for the inferred map above (`{ig_story: 1.5, ig_stat: 1.2, ig_bold: 1.0, ig_lifestyle: 1.5, ig_pov: 1.5}`):

> Your content is set to lean toward narrative-driven property stories, lifestyle and address-tease showcases, and relatable POV and behind-the-scenes. With some market data and stats mixed in.

### 10.3 More/less control mapping

When agent picks frameworks to boost or dampen:

- "I want more of X" → multiply current weight of X by **1.3**, then re-cap at 1.5.
- "I want less of X" → multiply current weight of X by **0.7**, then re-floor at 0.5.
- If agent picks 2 to boost simultaneously: each gets **1.2x** (not 1.3x) to prevent cumulative blow-past.
- The same applies for 2 to dampen: each gets **0.8x**.

After applying, results are saved to `framework_weights_override`, and the UI summary re-renders.

### 10.4 Reset behavior

"Reset to engine defaults" sets `framework_weights_override` to `null`. The UI reverts to displaying `framework_weights_inferred`. Inferred map continues to be computed from tags and references.

---

## 11. Deferred to Stage 5c

The following are explicitly out of scope for Stage 5b and will be drafted alongside Stage 5c prompt template work:

- **Facebook framework set and contribution tables.** Memory holds the FB framework list (Neighbor Story, Community Question, Market Plain-Talk, Win Share, Resource Drop). Schema fields will follow the same pattern as IG: `fb_neighbor_story`, `fb_community_question`, etc.
- **Threads framework set and contribution tables.** Closer to IG in tone but more conversational. Likely a subset or variant of IG frameworks.
- **LinkedIn framework set and contribution tables.** Professional breakdown style. Different from IG/FB/Threads entirely.
- **Prompt templates per platform per content type.** The actual prompt-builder functions that consume voice profiles.
- **Engine-generated starter content for `hook_lines`, `take_lines`, and `cta_verbs`.** The onboarding flow that produces the initial 5-10 entries per slot for agent review and editing.
- **Per-post hashtag selection rules for Threads and LinkedIn.**

The framework_weights schema is intentionally generic (`{ [framework_id]: number }`), so adding new platform framework IDs in 5c does not require a schema migration — only a new mapping table per platform.
