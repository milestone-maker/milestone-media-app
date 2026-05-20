// Visitor-facing AI chat for published microsites.
// Wires bubble + modal + lead form + thread + input + endpoint client.
//
// Pure presentational: parent supplies all data, no Supabase calls here.
//
// Props:
//   micrositeSlug    required (used for endpoint + sessionStorage scope)
//   agentName        used in disclosure + lead form copy
//   brokerageName    optional, added to disclosure when present
//   agentPhone       used by capReached "contact agent directly" CTA
//   agentEmail       same

import { useEffect, useRef, useState } from "react";
import ChatBubble from "./ChatBubble";
import ChatModal from "./ChatModal";
import LeadCaptureForm from "./LeadCaptureForm";
import MessageThread from "./MessageThread";
import MessageInput from "./MessageInput";
import { sendChatMessage, RateLimitError } from "./api";
import {
  getOrCreateSessionId, loadMessages, saveMessages,
  loadLead, saveLead, isChatDisabled, markChatDisabled,
} from "./sessionId";

const RATE_LIMIT_COOLDOWN_SEC = 60;

function useIsMobile() {
  const get = () => typeof window !== "undefined" && window.innerWidth < 768;
  const [m, setM] = useState(get);
  useEffect(() => {
    const onR = () => setM(get());
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  return m;
}

function buildDisclosure(agentName, brokerageName, leadName) {
  const a = agentName || "the listing agent";
  const firstName = leadName ? String(leadName).trim().split(/\s+/)[0] : "";
  const greeting = firstName ? `Hi ${firstName}!` : "Hi!";
  const fromBrokerage = brokerageName ? ` from ${brokerageName}` : "";
  return `${greeting} I'm an AI assistant for ${a}${fromBrokerage}. I can answer questions about this listing. For the actual agent, contact info is on this page.`;
}

export default function MicrositeChat({
  micrositeSlug,
  agentName,
  brokerageName,
  agentPhone,
  agentEmail,
}) {
  const isMobile = useIsMobile();
  const slug = micrositeSlug;

  const [modalOpen, setModalOpen] = useState(false);
  const [bubbleVisible, setBubbleVisible] = useState(() => !isChatDisabled(slug));

  // Per-modal-open state, hydrated from sessionStorage on open.
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]); // {role, content, ts}
  const [lead, setLead] = useState(null);       // {captured, name, email, phone}
  const [requestInFlight, setRequestInFlight] = useState(false);
  const [needsLead, setNeedsLead] = useState(false);
  const [requiredFields, setRequiredFields] = useState(["name", "email", "phone"]);
  const [pendingMessage, setPendingMessage] = useState(null); // queued user msg awaiting lead capture
  const [errorBanner, setErrorBanner] = useState("");
  const [rateLimitUntil, setRateLimitUntil] = useState(0);
  const [capReached, setCapReached] = useState(false);
  const [chatDisabled, setChatDisabled] = useState(false);
  const [, forceTick] = useState(0); // re-render for countdown

  // Tick once a second while rate-limited so the countdown updates.
  useEffect(() => {
    if (!rateLimitUntil) return;
    const id = setInterval(() => forceTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [rateLimitUntil]);

  // Hydrate when the modal opens.
  function openModal() {
    if (!slug) return;
    const sid = getOrCreateSessionId(slug);
    const msgs = loadMessages(slug);
    const ld = loadLead(slug);
    setSessionId(sid);
    setMessages(msgs);
    setLead(ld);
    // Show the lead form upfront if no captured lead yet. This matches
    // the default lead_capture_mode (name_email_phone_upfront). If the
    // agent's mode is actually "never" or "after_first_message", the
    // user fills it once anyway — small UX deviation, but ensures the
    // upfront-mode test path works without a config round-trip first.
    setNeedsLead(!ld || !ld.captured);
    setPendingMessage(null);
    setErrorBanner("");
    setCapReached(false);
    setChatDisabled(false);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    // If we just disabled the chat, hide the bubble for the rest of the session.
    if (chatDisabled) setBubbleVisible(false);
  }

  // Persist messages whenever they change while the modal is open.
  useEffect(() => {
    if (modalOpen && slug) saveMessages(slug, messages);
  }, [messages, modalOpen, slug]);

  async function performSend(userText, withLead) {
    setRequestInFlight(true);
    setErrorBanner("");
    try {
      const resp = await sendChatMessage({
        slug,
        sessionId,
        message: userText,
        leadInfo: withLead || undefined,
      });

      if (resp.chatDisabled) {
        setChatDisabled(true);
        markChatDisabled(slug);
        setMessages(curr => [...curr, { role: "assistant", content: resp.message, ts: Date.now() }]);
        return;
      }
      if (resp.needsLead) {
        setNeedsLead(true);
        setRequiredFields(resp.requiredFields || ["name", "email", "phone"]);
        setPendingMessage(userText);
        // user message NOT appended yet — endpoint didn't store it either
        return;
      }

      // Append the user message NOW (we held it until we knew it wasn't gated).
      const userMsg = { role: "user", content: userText, ts: Date.now() };
      const assistantMsg = { role: "assistant", content: resp.reply, ts: Date.now() };
      setMessages(curr => [...curr, userMsg, assistantMsg]);

      if (resp.lead_captured && withLead) {
        const newLead = { captured: true, ...withLead };
        setLead(newLead);
        saveLead(slug, newLead);
      }

      if (resp.capReached) {
        setCapReached(true);
      }
      if (resp.needs_lead_next) {
        setNeedsLead(true);
      }
    } catch (err) {
      if (err instanceof RateLimitError) {
        const until = Date.now() + RATE_LIMIT_COOLDOWN_SEC * 1000;
        setRateLimitUntil(until);
        setErrorBanner(err.message);
      } else {
        setErrorBanner("Something went wrong. Please try again.");
        // Re-queue so the user can retry without retyping.
        setPendingMessage(userText);
      }
    } finally {
      setRequestInFlight(false);
    }
  }

  function handleLeadSubmit(info) {
    const li = { name: info.name, email: info.email, phone: info.phone };
    if (pendingMessage) {
      const queued = pendingMessage;
      setPendingMessage(null);
      setNeedsLead(false);
      performSend(queued, li);
    } else {
      // No queued message — stash the lead and reveal the chat thread.
      // The first send will include lead_info so the endpoint can
      // mark lead_captured = true.
      setLead({ captured: false, ...li });
      setNeedsLead(false);
    }
  }

  // Wrap handleUserSend so it includes lead_info if we have stashed but not-yet-captured lead.
  function sendOrPass(text) {
    if (rateLimitUntil && Date.now() < rateLimitUntil) return;
    if (lead && !lead.captured && (lead.name || lead.email)) {
      performSend(text, { name: lead.name, email: lead.email, phone: lead.phone });
    } else {
      performSend(text);
    }
  }

  if (!slug || !bubbleVisible) return null;

  const disclosure = buildDisclosure(agentName, brokerageName, lead?.name);
  const cooldownLeft = rateLimitUntil ? Math.max(0, Math.ceil((rateLimitUntil - Date.now()) / 1000)) : 0;
  const inputDisabled = requestInFlight || cooldownLeft > 0 || capReached || chatDisabled;
  const inputHint = cooldownLeft > 0
    ? `Please wait ${cooldownLeft}s before sending again.`
    : null;

  // Footer swap when capped.
  const capCta = capReached ? (
    <div style={{
      padding: "12px 14px", borderTop: "1px solid #ececec", background: "#fff",
      fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#0f0f1a",
    }}>
      <div style={{ marginBottom: 6, fontWeight: 600 }}>
        Contact {agentName || "the agent"} directly:
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {agentPhone ? <a href={`tel:${agentPhone}`} style={{ color: "#0f0f1a", textDecoration: "underline" }}>{agentPhone}</a> : null}
        {agentEmail ? <a href={`mailto:${agentEmail}`} style={{ color: "#0f0f1a", textDecoration: "underline" }}>{agentEmail}</a> : null}
      </div>
    </div>
  ) : null;

  // chatDisabled overlay
  const chatDisabledBlock = chatDisabled ? (
    <div style={{
      flex: 1, padding: 24, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", textAlign: "center",
      fontFamily: "'Jost', sans-serif", color: "#1a1a1a", gap: 12,
    }}>
      <div style={{ fontSize: 14, lineHeight: 1.6 }}>
        Chat isn't available for this listing — contact{" "}
        <strong>{agentName || "the agent"}</strong> directly.
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        {agentPhone ? <a href={`tel:${agentPhone}`} style={{ color: "#0f0f1a" }}>{agentPhone}</a> : null}
        {agentEmail ? <a href={`mailto:${agentEmail}`} style={{ color: "#0f0f1a" }}>{agentEmail}</a> : null}
      </div>
      <button
        type="button"
        onClick={closeModal}
        style={{
          marginTop: 10, padding: "10px 18px", borderRadius: 8,
          background: "#0f0f1a", color: "#fff", border: "1.5px solid #C9A84C",
          fontFamily: "'Jost', sans-serif", fontSize: 13, cursor: "pointer",
        }}
      >
        Close
      </button>
    </div>
  ) : null;

  return (
    <>
      {!modalOpen ? <ChatBubble onClick={openModal} isMobile={isMobile} /> : null}
      {modalOpen ? (
        <ChatModal
          isMobile={isMobile}
          onClose={closeModal}
          title="Ask about this home"
          badge="AI assistant"
        >
          {chatDisabled ? (
            chatDisabledBlock
          ) : needsLead ? (
            <LeadCaptureForm
              agentName={agentName}
              requiredFields={requiredFields}
              onSubmit={handleLeadSubmit}
              submitting={requestInFlight}
            />
          ) : (
            <>
              <MessageThread
                disclosure={disclosure}
                messages={messages}
                isTyping={requestInFlight}
                errorBanner={errorBanner}
              />
              {capCta ? capCta : (
                <MessageInput
                  disabled={inputDisabled}
                  hint={inputHint}
                  onSend={sendOrPass}
                />
              )}
            </>
          )}
        </ChatModal>
      ) : null}
    </>
  );
}
