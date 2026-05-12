import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { StatusBadge } from "../../lib/ui";

function AnalyticsView() {
  const [analyticsListings, setAnalyticsListings] = useState([]);
  useEffect(() => {
    const fetchListings = async () => {
      const { data: rows } = await supabase.from("listings").select("*").order("created_at", { ascending: false });
      if (rows) setAnalyticsListings(rows);
    };
    fetchListings();
  }, []);
  const total = { views: 5164, leads: 40, shares: 210 };
  const bars = [
    { label: "Mon", v: 320 }, { label: "Tue", v: 540 }, { label: "Wed", v: 410 },
    { label: "Thu", v: 780 }, { label: "Fri", v: 920 }, { label: "Sat", v: 680 }, { label: "Sun", v: 514 },
  ];
  const max = Math.max(...bars.map(b => b.v));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 32, color: "#fff", marginBottom: 4 }}>Analytics</div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>All listings · Last 30 days</div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        {[
          { label: "Total Views", value: total.views.toLocaleString(), change: "+18%" },
          { label: "Leads", value: total.leads, change: "+32%" },
          { label: "Shares", value: total.shares, change: "+9%" },
        ].map(k => (
          <div key={k.label} style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: 18,
          }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>{k.label}</div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 32, color: "#fff", fontWeight: 700, marginBottom: 4 }}>{k.value}</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "#4ade80" }}>{k.change} this month</div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "rgba(255,255,255,0.7)", marginBottom: 20 }}>Views This Week</div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 120 }}>
          {bars.map(b => (
            <div key={b.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{
                width: "100%", height: `${(b.v / max) * 100}px`,
                background: b.v === max
                  ? "linear-gradient(to top, #c9a84c, #e5c97e)"
                  : "rgba(201,168,76,0.25)",
                borderRadius: "4px 4px 0 0", transition: "height 0.5s ease",
              }} />
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.05em" }}>{b.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Per listing */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "rgba(255,255,255,0.7)" }}>By Listing</div>
        {analyticsListings.map((l, i) => (
          <div key={l.id} style={{
            display: "flex", alignItems: "center", gap: 14, padding: "14px 20px",
            borderBottom: i < analyticsListings.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
          }}>
            <img src={l.hero_img || ""} alt="" style={{ width: 44, height: 36, borderRadius: 6, objectFit: "cover" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#fff" }}>{l.address}</div>
              <StatusBadge status={l.status || "In Production"} />
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#c9a84c" }}>{(l.views || 0).toLocaleString()}</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>views</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AnalyticsView;
