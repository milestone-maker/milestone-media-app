import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { presetRange, sortListings, formatInt, formatPct, formatPosition } from "./helpers";

// Admin-only Search Console monitor. GETs /api/search-console with the bearer
// token (same authed-fetch pattern as the other views) and renders one of:
// loading · not_configured · no_access · connected-but-empty · connected-with-data
// · error. Never shows a raw error blob; never crashes on missing fields.

const PRESETS = [7, 28, 90];

// Shared card chrome (matches AnalyticsView).
const cardStyle = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: 24,
};
const headingFont = "'Cormorant Garamond', serif";
const bodyFont = "'Jost', sans-serif";

function MessageCard({ title, body, action }) {
  return (
    <div style={{ ...cardStyle, padding: 32, textAlign: "center" }}>
      <div style={{ fontFamily: headingFont, fontSize: 24, color: "#fff", marginBottom: 10 }}>{title}</div>
      <div style={{ fontFamily: bodyFont, fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.6, maxWidth: 520, margin: "0 auto" }}>{body}</div>
      {action}
    </div>
  );
}

function SearchConsoleView() {
  const [days, setDays] = useState(28);
  const [range, setRange] = useState(() => presetRange(28));
  const [status, setStatus] = useState("loading"); // loading | done | error
  const [errCode, setErrCode] = useState(null);
  const [data, setData] = useState(null);
  const [sort, setSort] = useState({ key: "impressions", dir: "desc" });

  const load = useCallback(async () => {
    setStatus("loading");
    setErrCode(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      const res = await fetch(
        `/api/search-console?startDate=${encodeURIComponent(range.startDate)}&endDate=${encodeURIComponent(range.endDate)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        setErrCode(res.status);
        setStatus("error");
        return;
      }
      const json = await res.json();
      setData(json);
      setStatus("done");
    } catch (e) {
      setErrCode(0);
      setStatus("error");
    }
  }, [range.startDate, range.endDate]);

  useEffect(() => { load(); }, [load]);

  function selectPreset(d) {
    setDays(d);
    setRange(presetRange(d));
  }

  function toggleSort(key) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "label" ? "asc" : "desc" },
    );
  }

  // ── body by state ──────────────────────────────────────────────────
  let body;
  if (status === "loading") {
    body = <MessageCard title="Loading…" body="Fetching search performance from Google Search Console." />;
  } else if (status === "error") {
    body = (
      <MessageCard
        title="Couldn't load Search Console"
        body={errCode ? `The request failed (status ${errCode}). This is usually temporary.` : "A network error occurred. Check your connection and try again."}
        action={
          <button
            onClick={load}
            style={{
              marginTop: 18, padding: "9px 22px", borderRadius: 8, cursor: "pointer",
              background: "rgba(201,168,76,0.15)", border: "1px solid rgba(201,168,76,0.4)",
              color: "#e5c97e", fontFamily: bodyFont, fontSize: 12, letterSpacing: "0.05em",
            }}
          >
            Retry
          </button>
        }
      />
    );
  } else if (data && data.connected === false && data.reason === "not_configured") {
    body = (
      <MessageCard
        title="Search Console isn't connected yet"
        body="Once the Google Search Console credentials are configured for this site, per-listing search performance will appear here."
      />
    );
  } else if (data && data.connected === false && data.reason === "no_access") {
    body = (
      <MessageCard
        title="Google account can't access this property"
        body="The connected Google account doesn't have access to this Search Console property — re-authorize with the account that owns it."
      />
    );
  } else if (data && data.connected === false) {
    // Defensive: unknown not-connected reason.
    body = (
      <MessageCard
        title="Search Console isn't available"
        body="The Search Console connection isn't returning data right now. Try again shortly."
        action={<RetryButton onClick={load} />}
      />
    );
  } else if (data && data.connected === true && (!Array.isArray(data.listings) || data.listings.length === 0)) {
    body = (
      <MessageCard
        title="Connected — no data yet"
        body="Google hasn't gathered data for these pages yet. Collection started recently and lags ~2–3 days; check back in a few days."
      />
    );
  } else if (data && data.connected === true) {
    const totals = data.totals || {};
    const rows = sortListings(data.listings, sort.key, sort.dir);
    body = (
      <>
        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
          {[
            { label: "Impressions", value: formatInt(totals.impressions) },
            { label: "Clicks", value: formatInt(totals.clicks) },
            { label: "CTR", value: formatPct(totals.ctr) },
            { label: "Avg Position", value: formatPosition(totals.position) },
          ].map((k) => (
            <div key={k.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 18 }}>
              <div style={{ fontFamily: bodyFont, fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>{k.label}</div>
              <div style={{ fontFamily: headingFont, fontSize: 32, color: "#fff", fontWeight: 700 }}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {[
                  { key: "label", label: "Listing", align: "left" },
                  { key: "impressions", label: "Impressions", align: "right" },
                  { key: "clicks", label: "Clicks", align: "right" },
                  { key: "ctr", label: "CTR", align: "right" },
                  { key: "position", label: "Avg Position", align: "right" },
                ].map((col) => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    style={{
                      textAlign: col.align, padding: "14px 20px", cursor: "pointer", userSelect: "none",
                      fontFamily: bodyFont, fontSize: 10, color: "rgba(255,255,255,0.5)",
                      letterSpacing: "0.1em", textTransform: "uppercase",
                      borderBottom: "1px solid rgba(255,255,255,0.08)", whiteSpace: "nowrap",
                    }}
                  >
                    {col.label}{sort.key === col.key ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.slug || r.listing_id || i}>
                  <td style={{ textAlign: "left", padding: "13px 20px", borderBottom: i < rows.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: bodyFont, fontSize: 12, color: "#e5c97e", textDecoration: "none" }}>
                        {r.label || r.slug || "—"}
                      </a>
                    ) : (
                      <span style={{ fontFamily: bodyFont, fontSize: 12, color: "#fff" }}>{r.label || r.slug || "—"}</span>
                    )}
                  </td>
                  <td style={cellStyle(rows, i)}>{formatInt(r.impressions)}</td>
                  <td style={cellStyle(rows, i)}>{formatInt(r.clicks)}</td>
                  <td style={cellStyle(rows, i)}>{formatPct(r.ctr)}</td>
                  <td style={cellStyle(rows, i)}>{formatPosition(r.position)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  } else {
    // Should not happen — defensive fallback so we never render nothing.
    body = <MessageCard title="No data" body="Nothing to show for this range." action={<RetryButton onClick={load} />} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontFamily: headingFont, fontSize: 32, color: "#fff", marginBottom: 4 }}>Search Console</div>
          <div style={{ fontFamily: bodyFont, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
            Listing pages · {range.startDate} → {range.endDate}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {PRESETS.map((d) => (
            <button
              key={d}
              onClick={() => selectPreset(d)}
              style={{
                padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontFamily: bodyFont, fontSize: 12,
                background: days === d ? "rgba(201,168,76,0.18)" : "rgba(255,255,255,0.03)",
                border: days === d ? "1px solid rgba(201,168,76,0.45)" : "1px solid rgba(255,255,255,0.1)",
                color: days === d ? "#e5c97e" : "rgba(255,255,255,0.6)",
              }}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>
      {body}
    </div>
  );
}

function cellStyle(rows, i) {
  return {
    textAlign: "right", padding: "13px 20px", fontFamily: bodyFont, fontSize: 12, color: "rgba(255,255,255,0.85)",
    borderBottom: i < rows.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
  };
}

function RetryButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        marginTop: 18, padding: "9px 22px", borderRadius: 8, cursor: "pointer",
        background: "rgba(201,168,76,0.15)", border: "1px solid rgba(201,168,76,0.4)",
        color: "#e5c97e", fontFamily: bodyFont, fontSize: 12, letterSpacing: "0.05em",
      }}
    >
      Retry
    </button>
  );
}

export default SearchConsoleView;
