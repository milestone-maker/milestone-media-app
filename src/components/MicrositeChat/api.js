// API client for /api/microsite-chat.
// Handles: JSON encode/decode, single retry with exponential backoff
// for 5xx, RateLimitError for 429.

export class RateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class ChatApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ChatApiError";
    this.status = status;
  }
}

const ENDPOINT = "/api/microsite-chat";
const RETRY_DELAYS_MS = [400, 1200]; // first retry after 400ms

export async function sendChatMessage({ slug, sessionId, message, leadInfo }) {
  const body = {
    microsite_slug: slug,
    visitor_session_id: sessionId,
    message,
    ...(leadInfo ? { lead_info: leadInfo } : {}),
  };

  let lastErr;
  // attempt 0 = initial, attempt 1 = retry after RETRY_DELAYS_MS[0]
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    }
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        throw new RateLimitError(data.message || "You're sending messages too quickly.");
      }

      // 5xx → retry. Throw to fall through to the catch + delay loop.
      if (res.status >= 500) {
        const data = await res.json().catch(() => ({}));
        lastErr = new ChatApiError(data.error || "Server error", res.status);
        if (attempt < RETRY_DELAYS_MS.length) continue;
        throw lastErr;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new ChatApiError(data.error || "Request failed", res.status);
      }
      return data;
    } catch (err) {
      // RateLimit and 4xx-other are not retriable.
      if (err instanceof RateLimitError) throw err;
      if (err instanceof ChatApiError && err.status && err.status < 500) throw err;
      lastErr = err;
      // network errors → retry until budget exhausted
      if (attempt >= RETRY_DELAYS_MS.length) throw err;
    }
  }
  throw lastErr || new Error("Unknown chat error");
}
