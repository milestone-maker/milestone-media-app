// Vercel Serverless Function — read back the agent's social connections.
// GET /api/social-status
//   Headers: Authorization: Bearer <supabase access token>
//   Query:   ?platform=instagram | facebook   (optional; default 'instagram')
//   Returns: { status, username, platform, platforms: [ { platform, status,
//              username, connected_at } ] }
//
// Purpose: the Connected Accounts view polls this after the agent returns from
// bundle's hosted portal. Loads the agent's per-platform rows from
// agent_platform_connections; for the QUERIED platform, asks bundle whether an
// account of that type is connected and, when it is, persists
// status='connected' + username + connected_at so later loads are instant. The
// `platforms` array reports every platform's stored state in one call.
//
// Back-compat: a call with no ?platform returns the Instagram state at the top
// level ({ status, username }) exactly as the Instagram-only version did, so
// existing callers keep working unchanged.
//
// Instagram MIRROR: when Instagram flips to connected we also update the legacy
// agent_social_connections row (still read by api/social-post.js) so the posting
// path sees the connection.
//
// Auth + gating mirror api/social-connect.js. Never throws to the client on a
// bundle hiccup: a failed bundle lookup returns the last-known stored status.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BUNDLE_API_KEY.

import { createClient } from "@supabase/supabase-js";
import { hasFeatureAccess } from "./_lib/subscription.js";
import {
  getSocialAccountByType as bundleGetAccount,
  platformToBundleType,
} from "./_lib/bundle.js";
import { withSentry } from "./_lib/sentry.js";

const ALLOWED_PLATFORMS = ["instagram", "facebook", "threads", "linkedin"];
const DEFAULT_PLATFORM = "instagram";

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _supabaseSingleton = null;
function defaultSupabase() {
  if (!_supabaseSingleton) {
    _supabaseSingleton = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabaseSingleton;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function bearerFrom(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

function usernameFrom(account) {
  return account?.username || account?.displayName || account?.userUsername || null;
}

// Shape a stored row into the per-platform summary the `platforms` array uses.
function summarize(platform, row) {
  return {
    platform,
    status:       row?.connection_status || "none",
    username:     row?.connected_username || null,
    connected_at: row?.connected_at || null,
  };
}

async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase   = depsOverride?.supabase   || defaultSupabase();
  const getAccount = depsOverride?.getAccount || bundleGetAccount;

  try {
    // ── 1. Auth ──
    const token = bearerFrom(req);
    if (!token) return res.status(401).json({ error: "missing Authorization header" });

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: "invalid or expired session" });
    }
    const authUser = authData.user;

    // ── 1b. Subscription gate (admins exempt) ──
    const { data: agentRow, error: agentErr } = await supabase
      .from("agents")
      .select("role, subscription_status, is_beta, beta_expires_at")
      .eq("id", authUser.id)
      .maybeSingle();
    if (agentErr) {
      console.error("[social-status] agent lookup error:", agentErr);
      return res.status(500).json({ error: "agent lookup failed", details: agentErr.message });
    }
    if (!agentRow) {
      return res.status(401).json({ error: "no agent profile for this user" });
    }
    if (agentRow.role !== "admin" && !hasFeatureAccess(agentRow)) {
      return res.status(402).json({ error: "subscription_required" });
    }

    // ── 1c. Resolve + validate the queried platform (default instagram) ──
    const queried = req.query?.platform ?? DEFAULT_PLATFORM;
    if (!ALLOWED_PLATFORMS.includes(queried)) {
      return res.status(400).json({ error: `platform must be one of: ${ALLOWED_PLATFORMS.join(", ")}` });
    }

    // ── 2. Load all of the agent's per-platform rows ──
    // bundle_channel_id is meaningful only for the linkedin row (sticky target).
    const { data: rows, error: rowsErr } = await supabase
      .from("agent_platform_connections")
      .select("platform, bundle_team_id, connection_status, connected_username, connected_at, bundle_channel_id")
      .eq("agent_id", authUser.id);
    if (rowsErr) {
      console.error("[social-status] connections lookup error:", rowsErr);
      return res.status(500).json({ error: "connection lookup failed", details: rowsErr.message });
    }
    const agentRows = Array.isArray(rows) ? rows : [];
    const byPlatform = new Map(agentRows.map((r) => [r.platform, r]));
    const queriedRow = byPlatform.get(queried) || null;

    // The fresh summary for the queried platform — starts from stored state and
    // is overwritten below if bundle reports a (new) connected account.
    let queriedSummary = summarize(queried, queriedRow);
    // LinkedIn extras: the channels[] from the live bundle account + the agent's
    // sticky channel id. Only attached for platform=linkedin (kept off other
    // platforms to keep the response shape stable for IG/FB).
    let queriedChannels = null;
    let queriedChannelId = queried === "linkedin" ? (queriedRow?.bundle_channel_id || null) : null;
    // The CURRENTLY-BOUND LinkedIn channel id (which channel bundle will
    // actually post to). Computed below from bundle's account response.
    // Null when not connected, not LinkedIn, or no match found.
    let queriedActiveChannelId = null;

    // ── 3. Live-check the queried platform against bundle (if it has a team) ──
    if (queriedRow?.bundle_team_id) {
      let account;
      try {
        account = await getAccount({
          teamId: queriedRow.bundle_team_id,
          type:   platformToBundleType(queried),
        });
      } catch (e) {
        // Degrade gracefully: keep the stored summary on a bundle error.
        console.error("[social-status] bundle by-type lookup failed:", e?.status, e?.message);
        account = undefined; // sentinel: "could not check" → leave stored state
      }

      if (account) {
        const username = usernameFrom(account);
        const nowIso = new Date().toISOString();
        // Persist connected state on the per-platform row.
        const { error: upErr } = await supabase
          .from("agent_platform_connections")
          .update({
            connection_status:  "connected",
            connected_username: username,
            connected_at:       nowIso,
            updated_at:         nowIso,
          })
          .eq("agent_id", authUser.id)
          .eq("platform", queried);
        if (upErr) console.error("[social-status] connected update error:", upErr);

        // Instagram MIRROR → legacy agent_social_connections (api/social-post.js).
        if (queried === "instagram") {
          const { error: legacyErr } = await supabase
            .from("agent_social_connections")
            .update({
              connection_status:  "connected",
              connected_username: username,
              connected_at:       nowIso,
              updated_at:         nowIso,
            })
            .eq("agent_id", authUser.id);
          if (legacyErr) console.error("[social-status] legacy mirror update error (continuing):", legacyErr);
        }

        // LinkedIn extras: surface bundle's channels[] so the UI's "Post as"
        // picker has the personal-profile + admined-pages list without a
        // second call. Keep ALL channels — admin filtering is deferred; if
        // the agent picks a target they cannot post to, bundle/LinkedIn
        // rejects it and we surface that error.
        if (queried === "linkedin") {
          queriedChannels = Array.isArray(account.channels) ? account.channels : [];
          // Detect which channel is CURRENTLY ACTIVE (bound). bundle.social's
          // social-account top-level fields (externalId / username /
          // displayName) reflect the active channel; we match them against
          // the channels[] entries to find the one bound right now. Used by
          // the UI to preselect the active row in the "Post as" picker and
          // gray the others ("reconnect to switch"). Falls back to null if
          // no match — UI then preselects the first channel.
          const externalId = account.externalId || null;
          const acctUser   = account.username || null;
          const acctName   = account.displayName || null;
          const matchByExt  = externalId && queriedChannels.find((c) => c?.id === externalId);
          const matchByUser = !matchByExt && acctUser && queriedChannels.find((c) => c?.username === acctUser);
          const matchByName = !matchByExt && !matchByUser && acctName && queriedChannels.find((c) => c?.name === acctName);
          queriedActiveChannelId = (matchByExt && matchByExt.id)
            || (matchByUser && matchByUser.id)
            || (matchByName && matchByName.id)
            || null;
          // Diagnostic so we can confirm in Vercel logs how bundle returns
          // LinkedIn channels + which is active. Counts + ids only, no PII.
          try {
            console.log("[social-status][LINKEDIN_DIAG]", JSON.stringify({
              agent: authUser.id.slice(0, 8),
              channelCount: queriedChannels.length,
              channelIds: queriedChannels.map((c) => c?.id).filter(Boolean),
              hasNames: queriedChannels.map((c) => !!(c?.name || c?.username)).filter(Boolean).length,
              accountExternalId: externalId,
              accountUsername:   acctUser,
              accountDisplayName: acctName,
              activeChannelId:    queriedActiveChannelId,
            }));
          } catch { /* never let a log throw */ }
        }

        queriedSummary = { platform: queried, status: "connected", username, connected_at: nowIso };
      } else if (account === null) {
        // bundle definitively reports no account yet → team exists but pending.
        // (account === undefined means the lookup failed; keep stored state.)
        queriedSummary = {
          platform: queried,
          status:   queriedRow.connection_status === "connected" ? "pending" : (queriedRow.connection_status || "pending"),
          username: null,
          connected_at: null,
        };
      }
    }

    // ── 4. Build the response: per-platform summaries + back-compat top level ──
    const platforms = ALLOWED_PLATFORMS.map((p) =>
      p === queried ? queriedSummary : summarize(p, byPlatform.get(p) || null)
    );

    // LinkedIn-only extras on the response root: channels[] from the live
    // bundle account (or null if not connected / lookup failed) + the sticky
    // bundle_channel_id from the stored row, so the "Post as" picker can
    // render targets and preselect the agent's default without a 2nd call.
    const response = {
      status:   queriedSummary.status,
      username: queriedSummary.username,
      platform: queried,
      platforms,
    };
    if (queried === "linkedin") {
      response.channels = queriedChannels;                   // null when not connected / unknown
      response.channelId = queriedChannelId;                 // sticky default (last picked)
      response.activeChannelId = queriedActiveChannelId;     // channel bundle will actually post to
    }
    return res.status(200).json(response);
  } catch (err) {
    console.error("[social-status] fatal:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}

export default withSentry(handler);
