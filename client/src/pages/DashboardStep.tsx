import { useState, useEffect } from "react";
import type { BusinessProfile, MemoryItem } from "../App";
import { useIsMobile } from "../hooks/useMobile";
import Tooltip from "../components/Tooltip";

interface Props {
  business: BusinessProfile;
  memories: MemoryItem[];
  setMemories: (m: MemoryItem[]) => void;
  onSelectCategory: (index: number) => void;
}

export default function DashboardStep({ business, memories, setMemories, onSelectCategory }: Props) {
  const isMobile = useIsMobile();
  const [memoryInput, setMemoryInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [fetching, setFetching] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchMemories();
  }, []);

  const fetchMemories = async () => {
    setFetching(true);
    try {
      const res = await fetch("/api/mem0");
      const data = await res.json();
      if (data.available && Array.isArray(data.items)) {
        setMemories(data.items);
      }
    } catch {}
    setFetching(false);
  };

  const addMemory = async () => {
    if (!memoryInput.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/mem0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: memoryInput.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setMemories([...memories, { id: data.id, text: memoryInput.trim() }]);
        setSavedMsg(memoryInput.trim());
        setMemoryInput("");
        setTimeout(() => setSavedMsg(""), 3000);
      }
    } catch {}
    setSaving(false);
  };

  const deleteMemory = async (id: string) => {
    setDeletingId(id);
    try {
      await fetch(`/api/mem0?id=${id}`, { method: "DELETE" });
      setMemories(memories.filter(m => m.id !== id));
    } catch {}
    setDeletingId(null);
  };

  return (
    <div style={{ minHeight: "calc(100vh - 57px)", display: "flex", flexDirection: "column", animation: "fadeIn 0.3s ease" }}>
      {/* Main content */}
      <div style={{ flex: 1, padding: isMobile ? "16px 14px 220px" : "28px 32px 120px", overflowY: "auto" }}>
        {/* 4-panel grid */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 16 }}>
          {/* Company Summary */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-xl)",
            padding: isMobile ? "20px 18px 22px" : "28px 28px 32px", minHeight: isMobile ? "auto" : 220,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M7 7h10M7 12h10M7 17h6" />
              </svg>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", margin: 0 }}>Company Summary</h3>
              <Tooltip text="What this company does, who it serves, and why it's commercially relevant — read only from its website." />
            </div>
            <p style={{ fontSize: 14, color: "var(--ink-3)", lineHeight: 1.7, margin: 0 }}>{business.summary}</p>
          </div>

          {/* Core Value Proposition */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-xl)",
            padding: isMobile ? "20px 18px 22px" : "28px 28px 32px", minHeight: isMobile ? "auto" : 220,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", margin: 0 }}>Core Value Proposition</h3>
              <Tooltip text="The strongest reasons customers buy from this company." />
            </div>
            {business.valuePropositions && business.valuePropositions.length > 0 ? (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                {business.valuePropositions.slice(0, 3).map((vp, i) => (
                  <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ color: "var(--sage)", fontSize: 14, lineHeight: 1.6, flexShrink: 0 }}>•</span>
                    <span style={{ fontSize: 14, color: "var(--ink-3)", lineHeight: 1.6 }}>
                      <span style={{ color: "var(--ink)", fontWeight: 600 }}>{vp.valueLabel}:</span> {vp.valueCopy}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                {business.valueProposition.split(/(?:\n|(?<=\.)\s+(?=[A-Z]))/).map(s => s.trim()).filter(Boolean).slice(0, 3).map((s, i) => (
                  <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ color: "var(--sage)", fontSize: 14, lineHeight: 1.6, flexShrink: 0 }}>•</span>
                    <span style={{ fontSize: 14, color: "var(--ink-3)", lineHeight: 1.6 }}>{s}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Current Customer Segments */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-xl)",
            padding: isMobile ? "20px 18px 22px" : "28px 28px 32px", minHeight: isMobile ? "auto" : 220,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", margin: 0 }}>Current Customer Segments</h3>
              <Tooltip text="Buyer groups this company already serves, with any client names found on its site." />
            </div>
            {business.customerSegments && business.customerSegments.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {business.customerSegments.slice(0, 4).map((seg, i) => (
                  <div key={i}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", marginBottom: 2 }}>{seg.segmentLabel}</div>
                    <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 }}>
                      {seg.clientNames && seg.clientNames.length > 0
                        ? seg.clientNames.join(", ")
                        : (seg.segmentDescription || "No named clientele found on website.")}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {business.currentSegments.map((s, i) => (
                  <li key={i} style={{
                    fontSize: 14, color: "var(--ink-3)", padding: "8px 0",
                    display: "flex", alignItems: "center", gap: 10,
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--ink-3)", flexShrink: 0 }} />
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* New Business Opportunities */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-xl)",
            padding: isMobile ? "20px 18px 22px" : "28px 28px 32px", minHeight: isMobile ? "auto" : 220,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", margin: 0 }}>New Business Opportunities</h3>
              <Tooltip text="Adjacent markets this company could expand into. Pick one on the Leads page to find prospects." />
            </div>
            <p style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 16, marginLeft: 30 }}>
              Review possible markets, then generate leads.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {business.expansionCategories.slice(0, 3).map((cat, i) => (
                <div
                  key={i}
                  style={{
                    padding: "12px 14px",
                    background: "var(--surface-2)", border: "1px solid var(--line)",
                    borderRadius: "var(--radius-md)",
                  }}
                >
                  <div style={{ fontSize: 14, color: "var(--ink)", fontWeight: 600, marginBottom: 2 }}>{cat.name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>{cat.whyRelevant}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Primary CTA — market selection happens on the Leads page */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
          <button
            onClick={() => onSelectCategory(0)}
            style={{
              background: "var(--action)", color: "var(--action-fg)",
              border: "none", borderRadius: "var(--radius-md)",
              padding: "13px 32px", fontSize: 15, fontWeight: 600,
              cursor: "pointer", fontFamily: "var(--font-sans)",
            }}
          >
            Generate Leads →
          </button>
        </div>

        {/* Memory chips display */}
        {memories.length > 0 && (
          <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {memories.map(m => (
              <span key={m.id} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                borderRadius: 20, padding: "5px 12px",
                fontSize: 11, fontWeight: 500,
                background: "var(--success-wash)", border: "1px solid var(--success)", color: "var(--success)",
                opacity: deletingId === m.id ? 0.5 : 1,
                transition: "opacity 0.2s ease",
              }}>
                Saved: {m.text}
                <button
                  onClick={() => deleteMemory(m.id)}
                  disabled={deletingId === m.id}
                  style={{
                    background: "none", border: "none", color: "var(--success)",
                    cursor: deletingId === m.id ? "not-allowed" : "pointer",
                    fontSize: 14, padding: "0 2px",
                    opacity: 0.6, lineHeight: 1,
                    display: "flex", alignItems: "center",
                  }}
                >
                  {deletingId === m.id ? (
                    <span style={{
                      display: "inline-block", width: 10, height: 10,
                      border: "1.5px solid var(--line-strong)",
                      borderTopColor: "var(--sage)", borderRadius: "50%",
                      animation: "spin 0.6s linear infinite",
                    }} />
                  ) : "×"}
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Sticky bottom memory bar */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "var(--surface)", borderTop: "1px solid var(--line)",
        padding: isMobile ? "12px 14px" : "16px 32px",
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "stretch" : "center",
        gap: isMobile ? 10 : 16,
        zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: "var(--sage)", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>Add Business Context</span>
              <Tooltip text="Tell Biks preferences (e.g. ideal customers to target or avoid). It uses these to sharpen lead search and outreach." />
            </div>
            {!isMobile && (
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Tell Biks what to remember about your company for lead search and sales material.</div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10 }}>
          <input
            value={memoryInput}
            onChange={(e) => setMemoryInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !saving) addMemory(); }}
            placeholder="e.g. Prioritize premium wellness operators; avoid small studios without visible water facilities"
            style={{
              flex: 1,
              background: "var(--surface-2)", border: "1px solid var(--line)",
              borderRadius: "var(--radius-md)", padding: "11px 14px",
              fontSize: isMobile ? 16 : 13, color: "var(--ink)", outline: "none",
              fontFamily: "var(--font-sans)",
            }}
          />
          <button
            onClick={addMemory}
            disabled={saving || !memoryInput.trim()}
            style={{
              background: "var(--action)", color: "var(--action-fg)",
              border: "none", borderRadius: "var(--radius-md)",
              padding: "10px 20px", fontSize: 14, fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving || !memoryInput.trim() ? 0.5 : 1,
              fontFamily: "var(--font-sans)",
              whiteSpace: "nowrap",
              flexShrink: 0,
              minHeight: isMobile ? 44 : undefined,
              width: isMobile ? "100%" : undefined,
            }}
          >
            {saving ? "Saving..." : "Save to Memory"}
          </button>
        </div>

        {/* Saved notification */}
        {savedMsg && (
          <div style={{
            position: "absolute", top: -40, right: 32,
            background: "var(--success-wash)", border: "1px solid var(--success)",
            borderRadius: 20, padding: "6px 14px",
            fontSize: 12, color: "var(--success)",
            animation: "fadeIn 0.2s ease",
          }}>
            Saved to memory.
          </div>
        )}
      </div>
    </div>
  );
}
