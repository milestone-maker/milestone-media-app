// Lead capture form. Required fields driven by mode.

import { useState } from "react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LeadCaptureForm({ agentName, requiredFields, onSubmit, submitting }) {
  const wantPhone = requiredFields.includes("phone");
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  const setField = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => ({ ...e, [k]: "" }));
  };

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = "Required";
    if (!form.email.trim() || !EMAIL_RE.test(form.email.trim())) e.email = "Valid email required";
    if (wantPhone) {
      const digits = form.phone.replace(/\D/g, "");
      if (digits.length !== 10) e.phone = "10-digit US phone required";
    }
    return e;
  }

  function onBlur(field) {
    setTouched(t => ({ ...t, [field]: true }));
    const e = validate();
    setErrors(prev => ({ ...prev, [field]: e[field] || "" }));
  }

  function submit() {
    const e = validate();
    setTouched({ name: true, email: true, phone: true });
    if (Object.keys(e).length) { setErrors(e); return; }
    onSubmit({
      name: form.name.trim(),
      email: form.email.trim(),
      phone: wantPhone ? form.phone.replace(/\D/g, "") : undefined,
    });
  }

  const fieldStyle = (hasErr) => ({
    width: "100%",
    padding: "10px 12px",
    border: `1px solid ${hasErr ? "#b91c1c" : "#ddd"}`,
    borderRadius: 8,
    fontFamily: "'Jost', sans-serif",
    fontSize: 14,
    outline: "none",
    background: "#fff",
    color: "#111",
  });
  const labelStyle = { display: "block", fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(0,0,0,0.65)", marginBottom: 4, fontWeight: 500 };
  const errStyle = { fontFamily: "'Jost', sans-serif", fontSize: 11, color: "#b91c1c", marginTop: 3 };

  const displayName = agentName || "The listing agent";

  return (
    <div style={{
      flex: 1, overflowY: "auto", padding: "18px 18px 12px", background: "#fff",
    }}>
      <div style={{
        fontFamily: "'Cormorant Garamond', serif",
        fontSize: 20, fontWeight: 600, color: "#0f0f1a", marginBottom: 6,
      }}>
        Before we chat, can you share a few quick details?
      </div>
      <div style={{
        fontFamily: "'Jost', sans-serif", fontSize: 13,
        color: "rgba(0,0,0,0.6)", marginBottom: 18, lineHeight: 1.5,
      }}>
        {displayName} will follow up to answer your questions personally.
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setField("name", e.target.value)}
          onBlur={() => onBlur("name")}
          style={fieldStyle(touched.name && errors.name)}
        />
        {touched.name && errors.name ? <div style={errStyle}>{errors.name}</div> : null}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Email</label>
        <input
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => setField("email", e.target.value)}
          onBlur={() => onBlur("email")}
          style={fieldStyle(touched.email && errors.email)}
        />
        {touched.email && errors.email ? <div style={errStyle}>{errors.email}</div> : null}
      </div>

      {wantPhone ? (
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Phone</label>
          <input
            type="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => setField("phone", e.target.value)}
            onBlur={() => onBlur("phone")}
            placeholder="(555) 123-4567"
            style={fieldStyle(touched.phone && errors.phone)}
          />
          {touched.phone && errors.phone ? <div style={errStyle}>{errors.phone}</div> : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        style={{
          width: "100%",
          padding: "12px 14px",
          background: submitting ? "#666" : "#0f0f1a",
          color: "#fff",
          border: "1.5px solid #C9A84C",
          borderRadius: 10,
          fontFamily: "'Jost', sans-serif",
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: 0.3,
          cursor: submitting ? "wait" : "pointer",
        }}
      >
        {submitting ? "Starting..." : "Start chatting"}
      </button>
    </div>
  );
}
