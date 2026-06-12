import { useState, useEffect } from "react";
import type { BusinessProfile, MemoryItem } from "../App";

interface Props {
  business: BusinessProfile;
  memories: MemoryItem[];
  setMemories: (m: MemoryItem[]) => void;
  onSelectCategory: (index: number) => void;
}

export default function DashboardStep({ business, memories, setMemories, onSelectCategory }: Props) {
  const [memoryInput, setMemoryInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [fetching, setFetching] = useState(true);

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

  return (
    <div style={{ minHeight: "calc(100vh - 57px)", display: "flex", flexDirection: "column", animation: "fadeIn 0.3s ease" }}>
      {/* Main content */}
      <div style={{ flex: 1, padding: "28px 32px 120px", overflowY: "auto" }}>
        {/* 4-panel grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Company Summary */}
          <div style={{
            background: "#161616", border: "1px solid #2a2a2a", borderRadius: 14,
            padding: "28px 28px 32px", minHeight: 220,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M7 7h10M7 12h10M7 17h6" />
              </svg>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#f0f0f0", margin: 0 }}>Company Summary</h3>
            </div>
            <p style={{ fontSize: 14, color: "#999", lineHeight: 1.7, margin: 0 }}>{business.summary}</p>
          </div>

          {/* Core Value Proposition */}
          <div style={{
            background: "#161616", border: "1px solid #2a2a2a", borderRadius: 14,
            padding: "28px 28px 32px", minHeight: 220,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#f0f0f0", margin: 0 }}>Core Value Proposition</h3>
            </div>
            <p style={{ fontSize: 14, color: "#999", lineHeight: 1.7, margin: 0 }}>{business.valueProposition}</p>
          </div>

          {/* Current Customer Segments */}
          <div style={{
            background: "#161616", border: "1px solid #2a2a2a", borderRadius: 14,
            padding: "28px 28px 32px", minHeight: 220,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#f0f0f0", margin: 0 }}>Current Customer Segments</h3>
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {business.currentSegments.map((s, i) => (
                <li key={i} style={{
                  fontSize: 14, color: "#999", padding: "8px 0",
                  display: "flex", alignItems: "center", gap: 10,
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#555", flexShrink: 0 }} />
                  {s}
                </li>
              ))}
            </ul>
          </div>

          {/* New Business Opportunities */}
          <div style={{
            background: "#161616", border: "1px solid #2a2a2a", borderRadius: 14,
            padding: "28px 28px 32px", minHeight: 220,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#f0f0f0", margin: 0 }}>New Business Opportunities</h3>
            </div>
            <p style={{ fontSize: 12, color: "#666", marginBottom: 16, marginLeft: 30 }}>
              Select one opportunity to generate target accounts
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {business.expansionCategories.map((cat, i) => (
                <button
                  key={i}
                  onClick={() => onSelectCategory(i)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    width: "100%", textAlign: "left",
                    padding: "12px 14px",
                    background: "#1c1c1c", border: "1px solid #2a2a2a",
                    borderRadius: 8, cursor: "pointer",
                    transition: "border-color 0.15s ease, background 0.15s ease",
                    fontFamily: "'Inter', sans-serif",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#3a3a3a"; e.currentTarget.style.background = "#222"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.background = "#1c1c1c"; }}
                >
                  <span style={{ fontSize: 14, color: "#ccc", fontWeight: 400 }}>{cat.name}</span>
                  <span style={{ color: "#555", fontSize: 16 }}>→</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Memory chips display */}
        {memories.length > 0 && (
          <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {memories.map(m => (
              <span key={m.id} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                borderRadius: 20, padding: "4px 12px",
                fontSize: 11, fontWeight: 500,
                background: "#1a2e24", border: "1px solid #2a4a37", color: "#3ecf8e",
              }}>
                {m.text}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Sticky bottom memory bar */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "#161616", borderTop: "1px solid #2a2a2a",
        padding: "16px 32px",
        display: "flex", alignItems: "center", gap: 16,
        zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: "#2a2a2a", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f0f0f0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#f0f0f0" }}>Add Business Context to Memory</div>
            <div style={{ fontSize: 12, color: "#666" }}>Optional: add preferences, ICP notes, past customers, excluded segments, or sales context</div>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", gap: 10 }}>
          <input
            value={memoryInput}
            onChange={(e) => setMemoryInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !saving) addMemory(); }}
            placeholder="e.g. Prefer premium wellness operators; avoid small studios without water facilities"
            style={{
              flex: 1,
              background: "#1c1c1c", border: "1px solid #2a2a2a",
              borderRadius: 8, padding: "11px 14px",
              fontSize: 13, color: "#f0f0f0", outline: "none",
              fontFamily: "'Inter', sans-serif",
            }}
          />
          <button
            onClick={addMemory}
            disabled={saving || !memoryInput.trim()}
            style={{
              background: "#f0f0f0", color: "#0f0f0f",
              border: "none", borderRadius: 8,
              padding: "10px 20px", fontSize: 14, fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving || !memoryInput.trim() ? 0.5 : 1,
              fontFamily: "'Inter', sans-serif",
              whiteSpace: "nowrap",
            }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>

        {/* Saved notification */}
        {savedMsg && (
          <div style={{
            position: "absolute", top: -40, right: 32,
            background: "#1a2e24", border: "1px solid #2a4a37",
            borderRadius: 20, padding: "6px 14px",
            fontSize: 12, color: "#3ecf8e",
            animation: "fadeIn 0.2s ease",
          }}>
            Memory saved: {savedMsg.length > 30 ? savedMsg.slice(0, 30) + "..." : savedMsg}
          </div>
        )}
      </div>
    </div>
  );
}
