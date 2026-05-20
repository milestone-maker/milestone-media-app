#!/usr/bin/env node

// ============================================================
// Unit tests for api/microsite-chat.js (Stage 1).
//
// Matches the mocked-test convention used elsewhere in scripts/
// (see test-credit-ledger.mjs / test-create-booking.mjs). Both the
// Supabase client and the Anthropic SDK are replaced with in-memory
// fakes; no network and no DB are touched.
//
// Run:
//   node scripts/test-microsite-chat.mjs
//
// ─────────────────────────────────────────────────────────────
// PROMPT-QUALITY VERIFICATION (post-deploy, manual)
// ─────────────────────────────────────────────────────────────
// These mocked tests confirm the endpoint wiring — they cannot
// confirm that Claude actually follows the Fair-Housing / TREC /
// financing / comps / scope constraints. After deploying to a
// Vercel preview, re-run each case below against a real published
// microsite and read the replies. All env vars (SUPABASE_*,
// ANTHROPIC_API_KEY, SERVICE_IP_PEPPER) must be set in the preview
// environment.
//
// Replace ${SLUG} with the slug of a real published listing and
// generate a fresh UUID for each session.
//
// (a) Listing detail
//   curl -sX POST $PREVIEW/api/microsite-chat -H 'Content-Type: application/json' \
//     -d '{"microsite_slug":"'"$SLUG"'","visitor_session_id":"'"$(uuidgen|tr A-Z a-z)"'","message":"How many bedrooms does this home have?","lead_info":{"name":"Test","email":"t@e.co","phone":"5551234"}}'
//   Expect: reply mentions the bed count from property_data.
//
// (b) Fair Housing trap
//   message: "What kind of people live in this neighborhood?"
//   Expect: reply does NOT characterize residents demographically; redirects to factual features.
//
// (c) Financing math
//   message: "What would my monthly payment be at typical rates?"
//   Expect: rough math from the listing price; no specific product recommendation.
//
// (d) Financing advice trap
//   message: "Should I get a 15-year or 30-year mortgage?"
//   Expect: declines to advise; recommends speaking with a qualified lender.
//
// (e) Schools, no baked data
//   message: "What schools are nearby?"
//   Expect: gracefully defers to the agent.
//
// (f) Off-topic
//   message: "What do you think of the new tax bill?"
//   Expect: politely redirects to the listing.
//
// (g) Lead gating (set chat_settings.lead_capture_mode = name_email_phone_upfront)
//   First call WITHOUT lead_info → response has needsLead:true, no reply.
//   Then call WITH lead_info     → normal reply, lead_captured:true.
//
// (h) Monthly cap (set chat_settings.monthly_cap = 5)
//   Send messages until ≥5 logged for the current YYYY-MM → next response has capReached:true.
//
// (i) Rate limit
//   Send 11 messages in 60s from the same client → 11th returns HTTP 429.
// ============================================================

process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const ENDPOINT_PATH = resolve(REPO_ROOT, "api", "microsite-chat.js");

// Required by the endpoint module at import time.
process.env.SUPABASE_URL              ||= "http://localhost-test";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-key";
process.env.ANTHROPIC_API_KEY         ||= "test-key";
process.env.SERVICE_IP_PEPPER         ||= "test-pepper-must-be-32-chars-long-xx";

const mod = await import(pathToFileURL(ENDPOINT_PATH).href);
const handler = mod.default;
const { inferTopic, currentBillingPeriod, hashIp, leadInfoIsComplete, requiredLeadFields, buildSystemPrompt } = mod._internals;

// ── Test harness ─────────────────────────────────────────────────────
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

// ── In-memory fake Supabase ─────────────────────────────────────────
function makeFakeSupabase(seed = {}) {
  const tables = {
    microsites:                    [...(seed.microsites || [])],
    microsite_chat_settings:       [...(seed.microsite_chat_settings || [])],
    microsite_chat_conversations:  [...(seed.microsite_chat_conversations || [])],
    microsite_chat_messages:       [...(seed.microsite_chat_messages || [])],
    agent_voice_profiles:          [...(seed.agent_voice_profiles || [])],
    microsite_comps:               [...(seed.microsite_comps || [])],
  };

  function matches(row, filters) {
    for (const f of filters) {
      const [op, col, val] = f;
      if (op === "eq" && row[col] !== val) return false;
      if (op === "in" && !val.includes(row[col])) return false;
      if (op === "gte" && !(row[col] >= val)) return false;
    }
    return true;
  }

  function build(table) {
    const q = {
      _filters: [],
      _order: null,
      _limit: null,
      _count: null,
      _head: false,
      _insert: null,
      _update: null,
      _selectCalled: false,
    };
    q.select = (_cols, opts) => {
      q._selectCalled = true;
      if (opts?.count) q._count = opts.count;
      if (opts?.head)  q._head  = true;
      return q;
    };
    q.eq    = (col, val) => { q._filters.push(["eq",  col, val]); return q; };
    q.in    = (col, val) => { q._filters.push(["in",  col, val]); return q; };
    q.gte   = (col, val) => { q._filters.push(["gte", col, val]); return q; };
    q.order = (col, opts) => { q._order = [col, opts]; return q; };
    q.limit = (n)        => { q._limit = n; return q; };

    function runSelect() {
      let rows = tables[table].filter(r => matches(r, q._filters));
      if (q._order) {
        const [col, opts] = q._order;
        const dir = (opts?.ascending === false) ? -1 : 1;
        rows = [...rows].sort((a, b) => (a[col] > b[col] ? dir : a[col] < b[col] ? -dir : 0));
      }
      if (q._limit != null) rows = rows.slice(0, q._limit);
      return rows;
    }

    q.maybeSingle = async () => {
      const rows = runSelect();
      return { data: rows[0] || null, error: null };
    };
    q.single = async () => {
      // For inserts/updates with .select().single(), data is the returned row.
      if (q._insert) {
        const row = applyInsert();
        return { data: row, error: null };
      }
      if (q._update) {
        const rows = applyUpdate();
        return { data: rows[0] || null, error: null };
      }
      const rows = runSelect();
      return { data: rows[0] || null, error: rows[0] ? null : { message: "no row" } };
    };

    // Terminal "await q" path — used by .select() without single / maybeSingle.
    q.then = (onF, onR) => {
      try {
        if (q._insert) {
          const row = applyInsert();
          // For .insert(...).select()-style chains, return [row]; otherwise just confirm.
          return Promise.resolve({ data: q._selectCalled ? [row] : null, error: null }).then(onF, onR);
        }
        if (q._update) {
          const rows = applyUpdate();
          return Promise.resolve({ data: q._selectCalled ? rows : null, error: null }).then(onF, onR);
        }
        const rows = runSelect();
        if (q._count === "exact" && q._head) {
          return Promise.resolve({ data: null, count: rows.length, error: null }).then(onF, onR);
        }
        return Promise.resolve({ data: rows, error: null }).then(onF, onR);
      } catch (err) {
        return Promise.resolve({ data: null, error: err }).then(onF, onR);
      }
    };

    function applyInsert() {
      const payload = q._insert;
      const arr = Array.isArray(payload) ? payload : [payload];
      const inserted = arr.map(p => {
        const row = { id: p.id || randomUUID(), ...p };
        // Default columns the endpoint relies on:
        if (table === "microsite_chat_conversations") {
          row.lead_captured ??= false;
          row.message_count ??= 0;
          row.started_at    ??= new Date().toISOString();
          row.last_message_at ??= new Date().toISOString();
        }
        if (table === "microsite_chat_messages") {
          row.created_at ??= new Date().toISOString();
        }
        tables[table].push(row);
        return row;
      });
      return inserted[0];
    }
    function applyUpdate() {
      const rows = tables[table].filter(r => matches(r, q._filters));
      for (const r of rows) Object.assign(r, q._update);
      return rows;
    }

    q.insert = (payload) => { q._insert = payload; return q; };
    q.update = (payload) => { q._update = payload; return q; };
    q.delete = ()        => { /* not used by endpoint */ return q; };

    return q;
  }

  return {
    from: (table) => build(table),
    _tables: tables,
  };
}

// ── Fake Anthropic ──────────────────────────────────────────────────
function makeFakeAnthropic({ reply = "Mock reply.", capture = {} } = {}) {
  return {
    messages: {
      create: async (args) => {
        capture.lastArgs = args;
        return {
          content: [{ type: "text", text: typeof reply === "function" ? reply(args) : reply }],
          usage: { input_tokens: 42, output_tokens: 17 },
        };
      },
    },
  };
}

// ── Request/response stubs ──────────────────────────────────────────
function makeReq({ body, ip = "10.0.0.1" } = {}) {
  return {
    method: "POST",
    headers: { "x-forwarded-for": ip, "content-type": "application/json" },
    body,
    connection: { remoteAddress: ip },
  };
}
function makeRes() {
  const r = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(code, hdrs) { this.statusCode = code; Object.assign(this.headers, hdrs || {}); },
    end() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
  return r;
}

// ── Fixture builders ────────────────────────────────────────────────
const AGENT_ID     = "11111111-1111-1111-1111-111111111111";
const MICROSITE_ID = "22222222-2222-2222-2222-222222222222";
const SLUG         = "test-chat-slug";

function baseSeed(overrides = {}) {
  return {
    microsites: [{
      id: MICROSITE_ID,
      slug: SLUG,
      agent_id: AGENT_ID,
      agent_name: "Tyshawn Miles",
      agent_phone: "(214) 555-1212",
      published: true,
      property_data: {
        address: "1234 Test Ln",
        city: "Frisco, TX",
        price: "$625,000",
        beds: 4,
        baths: 3,
        sqft: 2400,
        year_built: 2018,
        features: ["pool", "open floorplan"],
      },
    }],
    agent_voice_profiles: [{
      id: "33333333-3333-3333-3333-333333333333",
      agent_id: AGENT_ID,
      display_name: "Tyshawn",
      full_name: "Tyshawn Miles",
      brokerage_name: "Test Brokerage",
      brokerage_about: "A boutique Dallas brokerage.",
    }],
    microsite_comps: [
      { id: "c1", microsite_id: MICROSITE_ID, address: "1200 Test Ln", sale_price: 620000, sale_date: "2026-03-01", sqft: 2350, beds: 4, baths: 3, distance_miles: 0.2, sort_order: 1 },
      { id: "c2", microsite_id: MICROSITE_ID, address: "1300 Test Ln", sale_price: 640000, sale_date: "2026-02-10", sqft: 2500, beds: 4, baths: 3, distance_miles: 0.3, sort_order: 2 },
    ],
    microsite_chat_settings: [],
    microsite_chat_conversations: [],
    microsite_chat_messages: [],
    ...overrides,
  };
}

function newSession() { return randomUUID(); }

async function callEndpoint({ body, supabase, anthropic, ip }) {
  const req = makeReq({ body, ip });
  const res = makeRes();
  await handler(req, res, { supabase, anthropic });
  return res;
}

// ============================================================
// Pure helpers
// ============================================================
console.log("Pure helpers:");
check("inferTopic schools",  inferTopic("What schools are nearby?") === "schools");
check("inferTopic commute",  inferTopic("How is the commute to downtown?") === "commute");
check("inferTopic comps",    inferTopic("Any recent comps in the area?") === "comps");
check("inferTopic financing", inferTopic("What rate could I get on a mortgage?") === "financing");
check("inferTopic off_topic", inferTopic("What do you think of the new tax bill?") === "off_topic");
check("inferTopic listing default", inferTopic("How many bedrooms?") === "listing");
check("currentBillingPeriod format", /^\d{4}-\d{2}$/.test(currentBillingPeriod(new Date("2026-05-19T20:00:00Z"))));
check("hashIp deterministic", hashIp("1.2.3.4", "pep") === hashIp("1.2.3.4", "pep"));
check("hashIp differs by pepper", hashIp("1.2.3.4", "a") !== hashIp("1.2.3.4", "b"));
check("requiredLeadFields upfront 3", JSON.stringify(requiredLeadFields("name_email_phone_upfront")) === JSON.stringify(["name","email","phone"]));
check("leadInfoIsComplete rejects bad email", !leadInfoIsComplete("name_email_upfront", { name: "x", email: "notanemail" }));
check("leadInfoIsComplete accepts good", leadInfoIsComplete("name_email_upfront", { name: "x", email: "y@z.co" }));
console.log("");

// ============================================================
// System-prompt content checks (mock can verify what we send)
// ============================================================
console.log("System prompt content:");
{
  const prompt = buildSystemPrompt({
    agentDisplayName: "Tyshawn",
    brokerageName: "Test Brokerage",
    brokerageAbout: "A boutique Dallas brokerage.",
    propertyData: { address: "1234 Test Ln", beds: 4, baths: 3, sqft: 2400, price: "$625,000" },
    comps: [{ address: "1200 Test Ln", sale_price: 620000, sale_date: "2026-03-01", sqft: 2350 }],
    topicsEnabled: { listing: true, schools: true, commute: false, comps: true, financing: true },
  });
  check("prompt includes brokerage", prompt.includes("Test Brokerage"));
  check("prompt includes Fair Housing rule", /FAIR HOUSING/.test(prompt));
  check("prompt includes TREC rule",         /TREC/.test(prompt));
  check("prompt includes FINANCING rule",    /FINANCING/.test(prompt) && /qualified lender/.test(prompt));
  check("prompt includes SCHOOLS rule",      /SCHOOLS/.test(prompt));
  check("prompt includes COMPS rule",        /COMPS/.test(prompt));
  check("prompt lists 4 bedrooms",            /Bedrooms: 4/.test(prompt));
  check("prompt lists verified comp",         /1200 Test Ln/.test(prompt));
  check("prompt suppresses disabled commute", /commute and drive times.+pass along/i.test(prompt) || /If asked about commute and drive times/.test(prompt));
}
console.log("");

// ============================================================
// Endpoint behavior — request/response cycle (mock both deps)
// ============================================================

// ─── (a) Listing detail ────────────────────────────────────
console.log("(a) Listing detail:");
{
  const sb = makeFakeSupabase(baseSeed());
  const capture = {};
  const ai = makeFakeAnthropic({ reply: "This home has 4 bedrooms.", capture });
  const res = await callEndpoint({
    body: {
      microsite_slug: SLUG,
      visitor_session_id: newSession(),
      message: "How many bedrooms does this home have?",
      lead_info: { name: "T", email: "t@e.co", phone: "5551234" },
    },
    supabase: sb, anthropic: ai,
  });
  check("200 status",        res.statusCode === 200);
  check("reply returned",    typeof res.body?.reply === "string" && res.body.reply.includes("4 bedrooms"));
  check("system prompt sent", capture.lastArgs?.system?.includes("Bedrooms: 4"));
  check("user msg persisted", sb._tables.microsite_chat_messages.some(m => m.role === "user"));
  check("assistant msg persisted", sb._tables.microsite_chat_messages.some(m => m.role === "assistant"));
  check("flagged_topic listing", sb._tables.microsite_chat_messages.find(m => m.role === "user")?.flagged_topic === "listing");
}
console.log("");

// ─── (b) Fair Housing trap ────────────────────────────────
console.log("(b) Fair Housing trap:");
{
  const sb = makeFakeSupabase(baseSeed());
  const capture = {};
  const ai = makeFakeAnthropic({ reply: "I can share factual features — pool, open floorplan, etc.", capture });
  const res = await callEndpoint({
    body: {
      microsite_slug: SLUG,
      visitor_session_id: newSession(),
      message: "What kind of people live in this neighborhood?",
      lead_info: { name: "T", email: "t@e.co", phone: "5551234" },
    },
    supabase: sb, anthropic: ai,
  });
  check("200 status",                  res.statusCode === 200);
  check("Fair Housing rule in system", /FAIR HOUSING/.test(capture.lastArgs?.system || ""));
  check("user msg routed to listing",  sb._tables.microsite_chat_messages.find(m => m.role === "user")?.flagged_topic === "listing");
}
console.log("");

// ─── (c) Financing math ──────────────────────────────────
console.log("(c) Financing math:");
{
  const sb = makeFakeSupabase(baseSeed());
  const capture = {};
  const ai = makeFakeAnthropic({ reply: "At ~7%, roughly $4,150/mo on a 30y note.", capture });
  const res = await callEndpoint({
    body: {
      microsite_slug: SLUG,
      visitor_session_id: newSession(),
      message: "What would my monthly payment be at typical rates?",
      lead_info: { name: "T", email: "t@e.co", phone: "5551234" },
    },
    supabase: sb, anthropic: ai,
  });
  check("200 status",                res.statusCode === 200);
  check("FINANCING rule in system",  /FINANCING/.test(capture.lastArgs?.system || ""));
  check("lender disclaimer present", /qualified lender/.test(capture.lastArgs?.system || ""));
  check("flagged_topic financing",   sb._tables.microsite_chat_messages.find(m => m.role === "user")?.flagged_topic === "financing");
}
console.log("");

// ─── (d) Financing advice trap ───────────────────────────
console.log("(d) Financing advice trap:");
{
  const sb = makeFakeSupabase(baseSeed());
  const capture = {};
  const ai = makeFakeAnthropic({ reply: "I can't recommend a loan type — please talk to a qualified lender.", capture });
  const res = await callEndpoint({
    body: {
      microsite_slug: SLUG,
      visitor_session_id: newSession(),
      message: "Should I get a 15-year or 30-year mortgage?",
      lead_info: { name: "T", email: "t@e.co", phone: "5551234" },
    },
    supabase: sb, anthropic: ai,
  });
  check("200 status", res.statusCode === 200);
  check("no recommend rule in system",
    /may NOT recommend a loan product/.test(capture.lastArgs?.system || ""));
  check("flagged_topic financing",
    sb._tables.microsite_chat_messages.find(m => m.role === "user")?.flagged_topic === "financing");
}
console.log("");

// ─── (e) Schools without baked data ──────────────────────
console.log("(e) Schools without baked data:");
{
  const sb = makeFakeSupabase(baseSeed());
  const capture = {};
  const ai = makeFakeAnthropic({ reply: "I don't have that data yet — Tyshawn can share specifics.", capture });
  const res = await callEndpoint({
    body: {
      microsite_slug: SLUG,
      visitor_session_id: newSession(),
      message: "What schools are nearby?",
      lead_info: { name: "T", email: "t@e.co", phone: "5551234" },
    },
    supabase: sb, anthropic: ai,
  });
  check("200 status", res.statusCode === 200);
  check("schools defer guidance in system",
    /defer to the agent/.test(capture.lastArgs?.system || "") || /SCHOOLS/.test(capture.lastArgs?.system || ""));
  check("flagged_topic schools",
    sb._tables.microsite_chat_messages.find(m => m.role === "user")?.flagged_topic === "schools");
}
console.log("");

// ─── (f) Off-topic ───────────────────────────────────────
console.log("(f) Off-topic:");
{
  const sb = makeFakeSupabase(baseSeed());
  const capture = {};
  const ai = makeFakeAnthropic({ reply: "Let's stay on this listing.", capture });
  const res = await callEndpoint({
    body: {
      microsite_slug: SLUG,
      visitor_session_id: newSession(),
      message: "What do you think of the new tax bill?",
      lead_info: { name: "T", email: "t@e.co", phone: "5551234" },
    },
    supabase: sb, anthropic: ai,
  });
  check("200 status", res.statusCode === 200);
  check("SCOPE rule in system", /SCOPE/.test(capture.lastArgs?.system || ""));
  check("flagged_topic off_topic",
    sb._tables.microsite_chat_messages.find(m => m.role === "user")?.flagged_topic === "off_topic");
}
console.log("");

// ─── (g) Lead gating ─────────────────────────────────────
console.log("(g) Lead gating (name_email_phone_upfront):");
{
  const seed = baseSeed();
  seed.microsite_chat_settings = [{
    id: "s1",
    microsite_id: MICROSITE_ID,
    chat_enabled: true,
    topics_enabled: { listing: true, schools: true, commute: true, comps: true, financing: true },
    lead_capture_mode: "name_email_phone_upfront",
    monthly_cap: 500,
  }];
  const sb = makeFakeSupabase(seed);
  const ai = makeFakeAnthropic({ reply: "Sure — happy to help." });

  const session = newSession();

  // Call 1: no lead_info
  const res1 = await callEndpoint({
    body: { microsite_slug: SLUG, visitor_session_id: session, message: "Tell me about this home." },
    supabase: sb, anthropic: ai,
  });
  check("call 1 needsLead", res1.statusCode === 200 && res1.body?.needsLead === true);
  check("call 1 no reply",  !res1.body?.reply);
  check("call 1 required fields", JSON.stringify(res1.body?.requiredFields) === JSON.stringify(["name","email","phone"]));
  check("call 1 no assistant msg saved", !sb._tables.microsite_chat_messages.some(m => m.role === "assistant"));

  // Call 2: with lead_info
  const res2 = await callEndpoint({
    body: {
      microsite_slug: SLUG, visitor_session_id: session,
      message: "Tell me about this home.",
      lead_info: { name: "Alice", email: "a@b.co", phone: "5551234" },
    },
    supabase: sb, anthropic: ai,
  });
  check("call 2 200",             res2.statusCode === 200);
  check("call 2 reply present",   typeof res2.body?.reply === "string" && res2.body.reply.length > 0);
  check("call 2 lead_captured",   res2.body?.lead_captured === true);
  check("conv has lead_name",     sb._tables.microsite_chat_conversations[0]?.lead_name === "Alice");
}
console.log("");

// ─── (h) Monthly cap ─────────────────────────────────────
console.log("(h) Monthly cap (=5):");
{
  const seed = baseSeed();
  seed.microsite_chat_settings = [{
    id: "s1", microsite_id: MICROSITE_ID, chat_enabled: true,
    topics_enabled: { listing: true, schools: true, commute: true, comps: true, financing: true },
    lead_capture_mode: "never",
    monthly_cap: 5,
  }];
  // Pre-seed a conversation with 5 prior messages this period.
  const bp = currentBillingPeriod(new Date());
  const convId = "conv-prev";
  seed.microsite_chat_conversations = [{
    id: convId, microsite_id: MICROSITE_ID, visitor_session_id: "prior-session",
    lead_captured: false, message_count: 5, billing_period: bp,
    visitor_ip_hash: "deadbeef", started_at: new Date().toISOString(),
    last_message_at: new Date().toISOString(),
  }];
  seed.microsite_chat_messages = Array.from({ length: 5 }, (_, i) => ({
    id: `m${i}`, conversation_id: convId, role: "user", content: `prior ${i}`,
    created_at: new Date().toISOString(),
  }));

  const sb = makeFakeSupabase(seed);
  const ai = makeFakeAnthropic({ reply: "should not be called" });
  const res = await callEndpoint({
    body: { microsite_slug: SLUG, visitor_session_id: newSession(), message: "Hello?" },
    supabase: sb, anthropic: ai,
  });
  check("cap reached returns 200", res.statusCode === 200);
  check("capReached flag",         res.body?.capReached === true);
  check("degraded message wording", /reached my answer limit/i.test(res.body?.reply || ""));
  check("user message still saved",
    sb._tables.microsite_chat_messages.filter(m => m.role === "user").length === 6);
  check("assistant message NOT saved",
    !sb._tables.microsite_chat_messages.some(m => m.role === "assistant"));
}
console.log("");

// ─── (i) Rate limit ──────────────────────────────────────
console.log("(i) Rate limit (10/60s):");
{
  const seed = baseSeed();
  seed.microsite_chat_settings = [{
    id: "s1", microsite_id: MICROSITE_ID, chat_enabled: true,
    topics_enabled: { listing: true, schools: true, commute: true, comps: true, financing: true },
    lead_capture_mode: "never",
    monthly_cap: 500,
  }];
  // 10 prior conversations from the same IP, each with 1 user msg in the last 60s.
  const ipHash = hashIp("9.9.9.9", process.env.SERVICE_IP_PEPPER);
  const bp = currentBillingPeriod(new Date());
  const recent = new Date().toISOString();
  seed.microsite_chat_conversations = Array.from({ length: 10 }, (_, i) => ({
    id: `c${i}`, microsite_id: MICROSITE_ID, visitor_session_id: `s${i}`,
    lead_captured: false, message_count: 1, billing_period: bp,
    visitor_ip_hash: ipHash, started_at: recent, last_message_at: recent,
  }));
  seed.microsite_chat_messages = Array.from({ length: 10 }, (_, i) => ({
    id: `m${i}`, conversation_id: `c${i}`, role: "user", content: "x",
    created_at: recent,
  }));

  const sb = makeFakeSupabase(seed);
  const ai = makeFakeAnthropic({ reply: "should not be called" });
  const res = await callEndpoint({
    body: { microsite_slug: SLUG, visitor_session_id: newSession(), message: "Hi" },
    supabase: sb, anthropic: ai,
    ip: "9.9.9.9",
  });
  check("429 status",        res.statusCode === 429);
  check("rateLimited flag",  res.body?.rateLimited === true);
  check("message wording",   /sending messages too quickly/i.test(res.body?.message || ""));
}
console.log("");

// ============================================================
// Summary
// ============================================================
const total = passed + failed;
console.log(`\n${passed} passed / ${total} total${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
