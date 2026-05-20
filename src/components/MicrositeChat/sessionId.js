// Visitor session ID + scoped sessionStorage helpers.
// Keys are per-microsite-slug so two open microsites don't collide.

const SESSION_KEY = (slug) => `milestone_chat_session_${slug}`;
const MESSAGES_KEY = (slug) => `milestone_chat_messages_${slug}`;
const LEAD_KEY    = (slug) => `milestone_chat_lead_${slug}`;

const MESSAGE_CAP = 20;

function safeUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for very old browsers (RFC4122 v4-ish).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getOrCreateSessionId(slug) {
  try {
    const key = SESSION_KEY(slug);
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = safeUuid();
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    // sessionStorage blocked (private mode + tracking protection edge case).
    // Generate a per-pageload id so the chat still works in-session.
    return safeUuid();
  }
}

export function loadMessages(slug) {
  try {
    const raw = sessionStorage.getItem(MESSAGES_KEY(slug));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveMessages(slug, messages) {
  try {
    const trimmed = messages.slice(-MESSAGE_CAP);
    sessionStorage.setItem(MESSAGES_KEY(slug), JSON.stringify(trimmed));
  } catch {
    // ignore quota / disabled storage
  }
}

export function loadLead(slug) {
  try {
    const raw = sessionStorage.getItem(LEAD_KEY(slug));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveLead(slug, lead) {
  try {
    sessionStorage.setItem(LEAD_KEY(slug), JSON.stringify(lead));
  } catch {
    // ignore
  }
}

export function clearChatDisabled(slug) {
  try { sessionStorage.removeItem(`milestone_chat_disabled_${slug}`); } catch { /* noop */ }
}
export function markChatDisabled(slug) {
  try { sessionStorage.setItem(`milestone_chat_disabled_${slug}`, "1"); } catch { /* noop */ }
}
export function isChatDisabled(slug) {
  try { return sessionStorage.getItem(`milestone_chat_disabled_${slug}`) === "1"; } catch { return false; }
}
