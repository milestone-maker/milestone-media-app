// Vercel Serverless Function — Public microsite AI chat.
// POST /api/microsite-chat
//   Body: { microsite_slug, visitor_session_id, message, lead_info? }
//
// Anonymous, unauthenticated endpoint. All DB access goes through the
// service-role client (RLS is defense-in-depth, not the primary gate).
//
// Flow (full detail in Stage 1 spec):
//   1.  Validate body (slug, uuid session id, message ≤2000 chars).
//   2.  Load microsite by slug → 404 if missing or unpublished.
//   3.  Load chat_settings (fall back to defaults if no row).
//   4.  chat_enabled=false → return { chatDisabled:true }.
//   5.  Hash the visitor IP with SERVICE_IP_PEPPER (never store raw IP).
//   6.  Rate limit: ≥10 messages from this ip_hash in the last 60s → 429.
//   7.  Find or create the conversation (billing_period = US Central YYYY-MM).
//   8.  Monthly cap: if total messages for this microsite this month
//       already ≥ cap, return the degraded "I've reached my answer
//       limit" message and skip the Anthropic call.
//   9.  Lead-mode gating (upfront vs after-first-message vs never).
//   10. If lead_info supplied, capture it on the conversation.
//   11. Load property_data, agent_voice_profile, comps, last 20 messages.
//   12. Build system prompt + call Anthropic (claude-sonnet-4-6).
//   13. Infer flagged_topic via keyword scan.
//   14. Persist user + assistant messages, bump message_count.
//   15. Return { reply, conversation_id, lead_captured,
//                needs_lead_next, monthly_cap_status }.
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY        — already configured for content-generate
//   SERVICE_IP_PEPPER        — NEW. 32+ char random string. Used only here.

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";

// ── constants ────────────────────────────────────────────────────────
const MODEL                 = "claude-sonnet-4-6";
const MAX_TOKENS            = 1000;
const MAX_MESSAGE_CHARS     = 2000;
const RATE_LIMIT_WINDOW_SEC = 60;
const RATE_LIMIT_MAX        = 10;
const HISTORY_LIMIT         = 20;
const APPROACHING_CAP_RATIO = 0.8;

const DEFAULT_CHAT_SETTINGS = {
  chat_enabled: true,
  topics_enabled: {
    listing: true,
    schools: true,
    commute: true,
    comps: true,
    financing: true,
  },
  lead_capture_mode: "name_email_phone_upfront",
  monthly_cap: 500,
};

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── singletons (overridable for tests via depsOverride) ─────────────
let _supabaseSingleton = null;
function defaultSupabase() {
  if (!_supabaseSingleton) {
    _supabaseSingleton = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _supabaseSingleton;
}

let _anthropicSingleton = null;
function defaultAnthropic() {
  if (!_anthropicSingleton) {
    _anthropicSingleton = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropicSingleton;
}

// ── helpers ──────────────────────────────────────────────────────────
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function extractIp(req) {
  const fwd = req.headers?.["x-forwarded-for"] || req.headers?.["X-Forwarded-For"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return (
    req.headers?.["x-real-ip"] ||
    req.headers?.["X-Real-IP"] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    "0.0.0.0"
  );
}

function hashIp(ip, pepper) {
  return createHash("sha256").update(`${ip}::${pepper || ""}`).digest("hex");
}

// US Central YYYY-MM, DST-aware via Intl.
function currentBillingPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year:  "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year  = parts.find(p => p.type === "year")?.value;
  const month = parts.find(p => p.type === "month")?.value;
  return `${year}-${month}`;
}

function inferTopic(text) {
  const t = (text || "").toLowerCase();
  if (/\b(politic|election|tax bill|sport|war|religion|vaccin)\b/.test(t)) return "off_topic";
  if (/\bschool/.test(t)) return "schools";
  if (/\b(commute|drive|driving|distance|traffic)\b/.test(t)) return "commute";
  if (/\b(comp|comps|sold|value|worth)\b/.test(t)) return "comps";
  if (/\b(mortgage|loan|rate|payment|finance|financing|down\s*payment)\b/.test(t)) return "financing";
  return "listing";
}

function topicLabel(t) {
  return ({
    listing:   "the listing itself",
    schools:   "schools",
    commute:   "commute and drive times",
    comps:     "comparable sales",
    financing: "mortgage and financing",
  })[t] || t;
}

function topicGuidance(t) {
  return ({
    listing:   "factual answers drawn from the listing details above",
    schools:   "school district name and publicly available academic ratings only; if school data isn't included for this listing, defer to the agent",
    commute:   "factual driving distance and typical drive time when data is provided; if not, defer to the agent",
    comps:     "reference only the verified comps listed above; do not generate comparables from your own knowledge",
    financing: "typical current mortgage rate ranges and rough monthly payment math from the listing price; never recommend a specific product, lender, or whether to buy; always recommend speaking with a qualified lender; defer to the agent if specific rate data isn't available",
  })[t] || "";
}

function buildSystemPrompt({ agentDisplayName, brokerageName, brokerageAbout, propertyData, comps, topicsEnabled, visitor }) {
  const enabled  = Object.entries(topicsEnabled || {}).filter(([, v]) => v).map(([k]) => k);
  const disabled = Object.entries(topicsEnabled || {}).filter(([, v]) => !v).map(([k]) => k);

  const lines = [];
  lines.push(
    `You are ${agentDisplayName}'s AI assistant from ${brokerageName}. You help visitors learn about a specific real estate listing and decide whether to schedule a viewing or speak directly with ${agentDisplayName}.`
  );
  if (brokerageAbout) {
    lines.push("");
    lines.push(`About ${brokerageName}: ${brokerageAbout}`);
  }

  if (visitor && (visitor.name || visitor.email || visitor.phone)) {
    lines.push("");
    lines.push("VISITOR IDENTITY:");
    const parts = [`This visitor has identified themselves as ${visitor.name || "unknown"}`];
    if (visitor.email) parts.push(`reachable at ${visitor.email}`);
    if (visitor.phone) parts.push(`phone ${visitor.phone}`);
    lines.push(
      parts.join(", ") +
      `. You may address them by their first name when natural — once or twice per conversation maximum, not in every reply. ` +
      `Their contact info has been passed to ${agentDisplayName} for follow-up; do NOT ask the visitor for their name, email, or phone again.`
    );
  }

  lines.push("");
  lines.push("Your role:");
  lines.push("- Speak warmly, factually, and concisely (typically 2-4 sentences).");
  lines.push(`- Represent the agent and brokerage — not yourself as the agent.`);
  lines.push(`- Defer to ${agentDisplayName} for anything you don't know or can't answer.`);
  lines.push(`- Encourage serious visitors to share contact info so ${agentDisplayName} can follow up.`);
  lines.push("");
  lines.push("LISTING DETAILS:");
  const pd = propertyData || {};
  if (pd.address)     lines.push(`- Address: ${pd.address}${pd.city ? ", " + pd.city : ""}`);
  if (pd.price)       lines.push(`- Price: ${pd.price}`);
  if (pd.beds)        lines.push(`- Bedrooms: ${pd.beds}`);
  if (pd.baths)       lines.push(`- Bathrooms: ${pd.baths}`);
  if (pd.sqft)        lines.push(`- Square footage: ${pd.sqft}`);
  if (pd.year_built)  lines.push(`- Year built: ${pd.year_built}`);
  if (pd.description) lines.push(`- Description: ${pd.description}`);
  if (Array.isArray(pd.features) && pd.features.length) {
    lines.push(`- Features: ${pd.features.join(", ")}`);
  }
  // Surface anything else present in the JSON that we didn't render explicitly.
  const known = new Set([
    "address","city","price","beds","baths","sqft","year_built","description","features",
    "agent_name","agent_phone","agent_email","hero_img","hero_media_id","listing_id","booking_id",
    "source_type","matterport_url","video_url","floorplan_url","gallery_photos","media_types",
  ]);
  for (const [k, v] of Object.entries(pd)) {
    if (known.has(k) || v == null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    if (typeof v === "object") continue;
    lines.push(`- ${k}: ${v}`);
  }

  if (Array.isArray(comps) && comps.length) {
    lines.push("");
    lines.push("VERIFIED COMPS (provided by the agent):");
    for (const c of comps) {
      const parts = [c.address, `sold $${c.sale_price}`, `on ${c.sale_date}`];
      if (c.sqft)           parts.push(`${c.sqft} sqft`);
      if (c.beds)           parts.push(`${c.beds} bed`);
      if (c.baths)          parts.push(`${c.baths} bath`);
      if (c.distance_miles != null) parts.push(`${c.distance_miles} mi away`);
      lines.push(`- ${parts.join(" · ")}${c.notes ? ` (${c.notes})` : ""}`);
    }
  }

  if (enabled.length) {
    lines.push("");
    lines.push("TOPICS YOU CAN DISCUSS (per the agent's settings):");
    for (const t of enabled) lines.push(`- ${topicLabel(t)}: ${topicGuidance(t)}`);
  }

  if (disabled.length) {
    lines.push("");
    lines.push("TOPICS NOT AVAILABLE ON THIS LISTING:");
    for (const t of disabled) {
      lines.push(
        `- If asked about ${topicLabel(t)}, say: "I'm not able to discuss that on this listing — ${agentDisplayName} can share details directly. Want me to pass along a message?"`
      );
    }
  }

  lines.push("");
  lines.push("COMPLIANCE RULES — THESE OVERRIDE EVERYTHING ELSE:");
  lines.push("");
  lines.push("1. FAIR HOUSING. Never describe schools, neighborhoods, or the listing in ways that could indicate preference for or against any protected class — race, color, religion, sex, national origin, familial status, or disability. Do not characterize neighborhood feel, demographic composition, who would \"fit,\" or use coded language. Stick to factual, observable features.");
  lines.push("");
  lines.push(`2. TREC. You are not a licensed real estate agent. Do not represent yourself as one or provide brokerage services. Defer transactional, representation, contract, or negotiation questions to ${agentDisplayName} of ${brokerageName}.`);
  lines.push("");
  lines.push("3. FINANCING. You may share factual information about typical current mortgage rates and rough monthly payment math from the listing price. You may NOT recommend a loan product, lender, lock-in timing, or whether to buy. Always recommend speaking with a qualified lender before any decision.");
  lines.push("");
  lines.push("4. SCHOOLS. You may share school district name, school names, and publicly available academic ratings. Do NOT discuss school demographics or characterize the student body.");
  lines.push("");
  lines.push(`5. COMPS. You may reference only the verified comps listed above. Do not estimate market value, generate comparables from your own knowledge, or predict the sale price of this listing. If asked for a value estimate, defer to ${agentDisplayName}.`);
  lines.push("");
  lines.push("6. SCOPE. If a question is unrelated to this listing or real estate generally, politely redirect.");
  lines.push("");
  lines.push(`If a visitor signals strong interest (asks about tour scheduling, offer specifics, closing timelines), encourage them to share contact info and let them know ${agentDisplayName} will follow up promptly.`);
  lines.push("");
  lines.push("For Stage 1: schools, commute, and live financing rates may not yet have baked data. When asked and data isn't available, gracefully defer to the agent.");

  return lines.join("\n");
}

function requiredLeadFields(mode) {
  if (mode === "name_email_phone_upfront") return ["name", "email", "phone"];
  if (mode === "name_email_upfront")        return ["name", "email"];
  if (mode === "after_first_message")       return ["name", "email"];
  return [];
}

function leadInfoIsComplete(mode, info) {
  if (!info) return false;
  const fields = requiredLeadFields(mode);
  for (const f of fields) {
    if (!info[f] || String(info[f]).trim() === "") return false;
  }
  if (info.email && !EMAIL_RE.test(String(info.email).trim())) return false;
  return true;
}

// ── main handler ─────────────────────────────────────────────────────
export default async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase  = depsOverride?.supabase  || defaultSupabase();
  const anthropic = depsOverride?.anthropic || defaultAnthropic();
  const now       = depsOverride?.now       || (() => new Date());

  try {
    // ── 1. Validate body ──
    const body = req.body || {};
    const slug = typeof body.microsite_slug === "string" ? body.microsite_slug.trim() : "";
    const vsid = typeof body.visitor_session_id === "string" ? body.visitor_session_id.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const leadInfo = body.lead_info && typeof body.lead_info === "object" ? body.lead_info : null;

    if (!slug)                     return res.status(400).json({ error: "microsite_slug is required" });
    if (!vsid || !UUID_RE.test(vsid)) return res.status(400).json({ error: "visitor_session_id must be a uuid" });
    if (!message)                  return res.status(400).json({ error: "message is required" });
    if (message.length > MAX_MESSAGE_CHARS) {
      return res.status(400).json({ error: `message exceeds ${MAX_MESSAGE_CHARS} chars` });
    }
    if (leadInfo?.email && !EMAIL_RE.test(String(leadInfo.email).trim())) {
      return res.status(400).json({ error: "lead_info.email is not a valid email" });
    }

    // ── 2. Load microsite ──
    const { data: microsite, error: micErr } = await supabase
      .from("microsites")
      .select("id, slug, agent_id, agent_name, agent_phone, property_data, published")
      .eq("slug", slug)
      .maybeSingle();
    if (micErr) {
      console.error("microsite lookup error:", micErr);
      return res.status(500).json({ error: "Something went wrong. Please try again." });
    }
    if (!microsite || !microsite.published) {
      return res.status(404).json({ error: "microsite not found" });
    }

    // ── 3. Load chat settings (defaults if no row) ──
    const { data: settingsRow } = await supabase
      .from("microsite_chat_settings")
      .select("chat_enabled, topics_enabled, lead_capture_mode, monthly_cap")
      .eq("microsite_id", microsite.id)
      .maybeSingle();
    const settings = settingsRow || DEFAULT_CHAT_SETTINGS;

    // ── 4. Chat disabled ──
    if (settings.chat_enabled === false) {
      return res.status(200).json({
        chatDisabled: true,
        message: "Chat is not available for this listing. Please use the contact form to reach the agent.",
      });
    }

    // ── 5. IP hash ──
    const ipHash = hashIp(extractIp(req), process.env.SERVICE_IP_PEPPER);

    // ── 6. Rate limit ──
    const windowStart = new Date(now().getTime() - RATE_LIMIT_WINDOW_SEC * 1000).toISOString();
    const { data: recentConvs } = await supabase
      .from("microsite_chat_conversations")
      .select("id")
      .eq("visitor_ip_hash", ipHash);
    const recentConvIds = (recentConvs || []).map(c => c.id);
    if (recentConvIds.length > 0) {
      const { count: recentMsgCount } = await supabase
        .from("microsite_chat_messages")
        .select("id", { count: "exact", head: true })
        .in("conversation_id", recentConvIds)
        .eq("role", "user")
        .gte("created_at", windowStart);
      if ((recentMsgCount || 0) >= RATE_LIMIT_MAX) {
        return res.status(429).json({
          rateLimited: true,
          message: "You're sending messages too quickly. Please wait a moment.",
        });
      }
    }

    // ── 7. Find or create conversation ──
    const billingPeriod = currentBillingPeriod(now());

    let { data: conversation } = await supabase
      .from("microsite_chat_conversations")
      .select("*")
      .eq("microsite_id", microsite.id)
      .eq("visitor_session_id", vsid)
      .maybeSingle();

    if (!conversation) {
      const { data: inserted, error: convErr } = await supabase
        .from("microsite_chat_conversations")
        .insert({
          microsite_id:       microsite.id,
          visitor_session_id: vsid,
          billing_period:     billingPeriod,
          visitor_ip_hash:    ipHash,
        })
        .select()
        .single();
      if (convErr) {
        console.error("conversation insert error:", convErr);
        return res.status(500).json({ error: "Something went wrong. Please try again." });
      }
      conversation = inserted;
    }

    // ── 8. Monthly cap ──
    const { data: monthConvs } = await supabase
      .from("microsite_chat_conversations")
      .select("id")
      .eq("microsite_id", microsite.id)
      .eq("billing_period", billingPeriod);
    const monthConvIds = (monthConvs || []).map(c => c.id);
    let monthlyMsgCount = 0;
    if (monthConvIds.length > 0) {
      const { count } = await supabase
        .from("microsite_chat_messages")
        .select("id", { count: "exact", head: true })
        .in("conversation_id", monthConvIds);
      monthlyMsgCount = count || 0;
    }

    const agentDisplayName = microsite.agent_name || "the listing agent";

    if (monthlyMsgCount >= settings.monthly_cap) {
      // Persist the user's message so the agent sees it later, even
      // though we won't bill an Anthropic call for it.
      await supabase.from("microsite_chat_messages").insert({
        conversation_id: conversation.id,
        role:            "user",
        content:         message,
        flagged_topic:   inferTopic(message),
      });
      await supabase
        .from("microsite_chat_conversations")
        .update({ message_count: conversation.message_count + 1, last_message_at: new Date().toISOString() })
        .eq("id", conversation.id);
      return res.status(200).json({
        capReached: true,
        reply: `I've reached my answer limit for this listing this month. If you share your contact info, ${agentDisplayName} will follow up directly to answer your question.`,
      });
    }

    // ── 9. Lead-mode gating ──
    const mode = settings.lead_capture_mode;
    const leadComplete = leadInfoIsComplete(mode, leadInfo);
    const upfrontMode = (mode === "name_email_phone_upfront" || mode === "name_email_upfront");
    const afterFirstNeeded =
      mode === "after_first_message" &&
      !conversation.lead_captured &&
      conversation.message_count >= 2;

    if ((upfrontMode || afterFirstNeeded) && !conversation.lead_captured && !leadComplete) {
      return res.status(200).json({
        needsLead: true,
        requiredFields: requiredLeadFields(mode),
      });
    }

    // ── 10. Capture lead if provided ──
    let leadCaptured = conversation.lead_captured;
    if (leadInfo && !leadCaptured && (leadComplete || mode === "never")) {
      const update = {
        lead_captured: true,
        lead_name:  leadInfo.name  ? String(leadInfo.name).trim()  : null,
        lead_email: leadInfo.email ? String(leadInfo.email).trim() : null,
        lead_phone: leadInfo.phone ? String(leadInfo.phone).trim() : null,
      };
      const { data: updated } = await supabase
        .from("microsite_chat_conversations")
        .update(update)
        .eq("id", conversation.id)
        .select()
        .single();
      if (updated) {
        conversation = updated;
        leadCaptured = true;

        // Mirror into public.leads so the existing inbox sees it.
        // Dedup: uq_leads_chat_conversation_id makes re-inserts a no-op
        // (we swallow the unique-constraint error). listing_id is
        // optional — pulled from property_data if present.
        const listingId = microsite.property_data?.listing_id || null;
        const { error: leadErr } = await supabase
          .from("leads")
          .insert({
            listing_id: listingId,
            microsite_id: microsite.id,
            chat_conversation_id: conversation.id,
            source: "chat",
            name: update.lead_name || "",
            email: update.lead_email,
            phone: update.lead_phone,
            message: message,
          });
        if (leadErr && leadErr.code !== "23505") {
          // Log non-dedup failures but don't break the chat — agent
          // still has the row in microsite_chat_conversations.
          console.error("chat → leads mirror error:", leadErr);
        }
      }
    }

    // ── 11. Load voice profile + brokerage info + comps + history ──
    // display_name / brokerage_name still come from the voice profile
    // (Phase 5b). brokerage_about / brokerage_url moved to the agents
    // table in migration 020 — see EditProfileModal — because agents is
    // 1:1 with the user and has no NOT NULL wall to seed around.
    const { data: voiceProfile } = await supabase
      .from("agent_voice_profiles")
      .select("display_name, full_name, brokerage_name")
      .eq("agent_id", microsite.agent_id)
      .limit(1)
      .maybeSingle();

    const { data: agentRow } = await supabase
      .from("agents")
      .select("brokerage_about, brokerage_url")
      .eq("id", microsite.agent_id)
      .maybeSingle();

    const { data: comps } = await supabase
      .from("microsite_comps")
      .select("address, sale_price, sale_date, sqft, beds, baths, distance_miles, notes")
      .eq("microsite_id", microsite.id)
      .order("sort_order", { ascending: true });

    const { data: history } = await supabase
      .from("microsite_chat_messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(HISTORY_LIMIT);

    // ── 12. Build prompt + call Anthropic ──
    const displayName = voiceProfile?.display_name || agentDisplayName;
    const brokerageName = voiceProfile?.brokerage_name || "our brokerage";

    // Visitor identity for the prompt: this-request lead_info takes
    // priority (freshest), otherwise fall back to the conversation row.
    const visitor = (leadInfo && (leadInfo.name || leadInfo.email || leadInfo.phone))
      ? {
          name:  leadInfo.name  ? String(leadInfo.name).trim()  : null,
          email: leadInfo.email ? String(leadInfo.email).trim() : null,
          phone: leadInfo.phone ? String(leadInfo.phone).trim() : null,
        }
      : (conversation.lead_name || conversation.lead_email || conversation.lead_phone
          ? { name: conversation.lead_name, email: conversation.lead_email, phone: conversation.lead_phone }
          : null);

    const systemPrompt = buildSystemPrompt({
      agentDisplayName: displayName,
      brokerageName,
      brokerageAbout:   agentRow?.brokerage_about || null,
      propertyData:     microsite.property_data,
      comps:            comps || [],
      topicsEnabled:    settings.topics_enabled,
      visitor,
    });

    const apiMessages = (history || [])
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => ({ role: m.role, content: m.content }));
    apiMessages.push({ role: "user", content: message });

    let reply = "";
    let tokensIn = null, tokensOut = null;
    try {
      const apiResp = await anthropic.messages.create({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system:     systemPrompt,
        messages:   apiMessages,
      });
      const block = (apiResp?.content || []).find(b => b.type === "text");
      reply     = block?.text || "";
      tokensIn  = apiResp?.usage?.input_tokens  ?? null;
      tokensOut = apiResp?.usage?.output_tokens ?? null;
    } catch (apiErr) {
      console.error("anthropic call error:", apiErr);
      return res.status(500).json({ error: "Something went wrong. Please try again." });
    }

    // ── 13. Topic inference ──
    const userTopic = inferTopic(message);

    // ── 14. Persist messages + bump counter ──
    await supabase.from("microsite_chat_messages").insert([
      {
        conversation_id: conversation.id,
        role:            "user",
        content:         message,
        flagged_topic:   userTopic,
      },
      {
        conversation_id: conversation.id,
        role:            "assistant",
        content:         reply,
        tokens_input:    tokensIn,
        tokens_output:   tokensOut,
      },
    ]);

    const newCount = conversation.message_count + 2;
    await supabase
      .from("microsite_chat_conversations")
      .update({ message_count: newCount, last_message_at: new Date().toISOString() })
      .eq("id", conversation.id);

    // ── 15. Compose response ──
    const needsLeadNext =
      mode === "after_first_message" &&
      !leadCaptured &&
      newCount >= 2;

    const totalAfter = monthlyMsgCount + 2;
    const status = totalAfter >= Math.floor(settings.monthly_cap * APPROACHING_CAP_RATIO)
      ? "approaching"
      : "ok";

    return res.status(200).json({
      reply,
      conversation_id:     conversation.id,
      lead_captured:       leadCaptured,
      needs_lead_next:     needsLeadNext,
      monthly_cap_status:  status,
    });
  } catch (err) {
    console.error("microsite-chat error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}

// Exposed for tests.
export const _internals = {
  buildSystemPrompt,
  inferTopic,
  currentBillingPeriod,
  hashIp,
  leadInfoIsComplete,
  requiredLeadFields,
  DEFAULT_CHAT_SETTINGS,
};
