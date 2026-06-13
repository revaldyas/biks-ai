import { useState } from "react";
import type { BusinessProfile, Lead, MemoryItem, Contact } from "../App";

interface Props {
  business: BusinessProfile;
  memories: MemoryItem[];
  setMemories: (m: MemoryItem[]) => void;
  leads: Lead[];
  setLeads: (l: Lead[]) => void;
  contacts: Contact[];
  setContacts: (c: Contact[]) => void;
  onSelectLead: (lead: Lead) => void;
  onBack: () => void;
  initialCategory?: number;
}

export default function AccountsStep({
  business, memories, setMemories, leads, setLeads, contacts, setContacts, onSelectLead, onBack, initialCategory = 0
}: Props) {
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [city, setCity] = useState("Singapore");
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");

  const cityOptions = [
    "Singapore",
    "Jakarta",
    "Bali",
    "Kuala Lumpur",
    "Bangkok",
    "Ho Chi Minh City",
    "Manila",
    "Hong Kong",
    "Tokyo",
    "Sydney",
    "Dubai",
    "London",
    "New York",
  ];
  const [rejectModal, setRejectModal] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [deletingMemId, setDeletingMemId] = useState<string | null>(null);

  const searchLeads = async () => {
    setSearching(true);
    const cat = business.expansionCategories[selectedCategory];
    const baseQuery = cat.searchQueries?.[0] || `${cat.name} premium`;
    const query = `${baseQuery} in ${city}`;

    try {
      setSearchMessage("");
      const res = await fetch("/api/exa-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, city, numResults: 8 }),
      });
      const data = await res.json();
      if (data.message) {
        setSearchMessage(data.message);
      }
      const scored = (data.results || []).map((r: any) => ({
        ...r,
        name: r.title,
        email: r.email || null,
        linkedinUrl: r.linkedinUrl || null,
        fitScore: scoreResult(r, cat.name, city, memories),
        category: cat.name,
        city,
        status: "pending" as const,
      }));
      scored.sort((a: Lead, b: Lead) => b.fitScore - a.fitScore);
      setLeads(scored);
    } catch {}
    setSearching(false);
  };

  const handleReject = async (idx: number) => {
    if (!rejectReason.trim()) return;
    const updated = [...leads];
    updated[idx] = { ...updated[idx], status: "rejected", rejectionReason: rejectReason };
    setLeads(updated);

    try {
      const res = await fetch("/api/mem0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `Rejected lead "${leads[idx].name}": ${rejectReason}` }),
      });
      const data = await res.json();
      if (data.ok) {
        setMemories([...memories, { id: data.id, text: `Rejected: ${rejectReason}` }]);
      }
    } catch {}

    const reScored = updated.map(l => ({
      ...l,
      fitScore: l.status === "rejected" ? l.fitScore : scoreResult(l, l.category, l.city, [...memories, { id: "tmp", text: rejectReason }]),
    }));
    reScored.sort((a, b) => {
      if (a.status === "rejected" && b.status !== "rejected") return 1;
      if (b.status === "rejected" && a.status !== "rejected") return -1;
      return b.fitScore - a.fitScore;
    });
    setLeads(reScored);
    setRejectModal(null);
    setRejectReason("");
  };

  const handleAccept = (idx: number) => {
    const updated = [...leads];
    updated[idx] = { ...updated[idx], status: "accepted" };
    setLeads(updated);
  };

  const deleteMemory = async (id: string) => {
    setDeletingMemId(id);
    try {
      await fetch(`/api/mem0?id=${id}`, { method: "DELETE" });
      setMemories(memories.filter(m => m.id !== id));
    } catch {}
    setDeletingMemId(null);
  };

  return (
    <div style={{ display: "flex", height: "calc(100vh - 57px)", overflow: "hidden" }}>
      {/* Sidebar */}
      <div style={{
        width: 264, flexShrink: 0, background: "#111",
        borderRight: "1px solid #1e1e1e", height: "100%",
        overflowY: "auto", padding: "28px 20px",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>
          STEP 2
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#f0f0f0", marginBottom: 20 }}>
          Target Accounts
        </div>

        {/* Category selector */}
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>
          CATEGORY
        </div>
        {business.expansionCategories.map((cat, i) => (
          <button key={i} onClick={() => setSelectedCategory(i)} style={{
            width: "100%", textAlign: "left",
            background: selectedCategory === i ? "#1a2540" : "#1a1a1a",
            border: `1px solid ${selectedCategory === i ? "#5b8af5" : "#2a2a2a"}`,
            borderRadius: 8, padding: "9px 12px", marginBottom: 6,
            fontSize: 13, color: selectedCategory === i ? "#5b8af5" : "#777",
            cursor: "pointer", fontFamily: "'Inter', sans-serif",
          }}>
            {cat.name}
          </button>
        ))}

        <div style={{ height: 1, background: "#1e1e1e", margin: "16px 0" }} />

        {/* City dropdown */}
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>
          CITY
        </div>
        <select
          value={city}
          onChange={(e) => setCity(e.target.value)}
          style={{
            width: "100%",
            background: "#1a1a1a", border: "1px solid #2a2a2a",
            borderRadius: 8, padding: "9px 12px",
            fontSize: 13, color: "#f0f0f0", outline: "none",
            fontFamily: "'Inter', sans-serif",
            cursor: "pointer",
            appearance: "none",
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 12px center",
          }}
        >
          {cityOptions.map(c => (
            <option key={c} value={c} style={{ background: "#1a1a1a", color: "#f0f0f0" }}>
              {c}
            </option>
          ))}
        </select>

        <div style={{ height: 1, background: "#1e1e1e", margin: "16px 0" }} />

        {/* Active Memories with delete */}
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>
          ACTIVE MEMORIES ({memories.length})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {memories.map(m => (
            <div key={m.id} style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "#0e1e16", border: "1px solid #2a4a37",
              borderRadius: 16, padding: "6px 10px",
              opacity: deletingMemId === m.id ? 0.5 : 1,
              transition: "opacity 0.2s ease",
            }}>
              <span style={{
                flex: 1, fontSize: 11, color: "#3ecf8e",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {m.text}
              </span>
              <button
                onClick={() => deleteMemory(m.id)}
                disabled={deletingMemId === m.id}
                style={{
                  background: "none", border: "none", color: "#3ecf8e",
                  cursor: deletingMemId === m.id ? "not-allowed" : "pointer",
                  fontSize: 14, padding: "0 2px",
                  opacity: 0.6, lineHeight: 1, flexShrink: 0,
                  display: "flex", alignItems: "center",
                }}
              >
                {deletingMemId === m.id ? (
                  <span style={{
                    display: "inline-block", width: 10, height: 10,
                    border: "1.5px solid rgba(62,207,142,0.3)",
                    borderTopColor: "#3ecf8e", borderRadius: "50%",
                    animation: "spin 0.6s linear infinite",
                  }} />
                ) : "×"}
              </button>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "auto", paddingTop: 20, borderTop: "1px solid #1e1e1e" }}>
          <button onClick={onBack} style={{
            background: "none", border: "none", color: "#3a3a3a", fontSize: 13, cursor: "pointer",
          }}>← Back to Analysis</button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, height: "100%", overflowY: "auto", padding: "32px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: "#f0f0f0" }}>
              {business.expansionCategories[selectedCategory]?.name}
            </h2>
            <p style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
              Searching in {city}
            </p>
          </div>
          <button
            onClick={searchLeads}
            disabled={searching}
            style={{
              background: "#5b8af5",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: searching ? "not-allowed" : "pointer",
              opacity: searching ? 0.5 : 1,
              fontFamily: "'Inter', sans-serif",
            }}
          >
            {searching ? "Searching..." : "Search Leads"}
          </button>
        </div>

        {/* Leads */}
        {leads.length === 0 && !searching && (
          <div style={{
            background: "#161616", border: "1px solid #2a2a2a", borderRadius: 12, padding: 40,
            textAlign: "center",
          }}>
            {searchMessage ? (
              <p style={{ color: "#f5a623", fontSize: 14 }}>{searchMessage}</p>
            ) : (
              <p style={{ color: "#555", fontSize: 14 }}>Select a category and city, then click "Search Leads" to find target accounts.</p>
            )}
          </div>
        )}

        {searching && (
          <div style={{ textAlign: "center", padding: 40 }}>
            <div style={{
              display: "inline-block", width: 15, height: 15,
              border: "2px solid rgba(255,255,255,0.25)",
              borderTopColor: "#fff", borderRadius: "50%",
              animation: "spin 0.7s linear infinite",
            }} />
            <p style={{ color: "#666", fontSize: 13, marginTop: 12 }}>Searching with Exa...</p>
          </div>
        )}

        {/* Simplified lead cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {leads.map((lead, idx) => (
            <div key={idx} style={{
              background: lead.status === "accepted" ? "#0d1f17" : "#161616",
              border: `1px solid ${lead.status === "rejected" ? "#4a2a2a" : lead.status === "accepted" ? "#2a4a37" : "#2a2a2a"}`,
              borderRadius: 10, padding: "14px 16px",
              opacity: lead.status === "rejected" ? 0.45 : 1,
              animation: "fadeIn 0.3s ease",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {/* Score badge */}
                <ScoreBadge score={lead.fitScore} />

                {/* Name + URL + Location */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {lead.name}
                    </span>
                    {lead.city && (
                      <span style={{ fontSize: 10, color: "#888", background: "#1e1e1e", padding: "2px 6px", borderRadius: 4, flexShrink: 0 }}>
                        📍 {lead.city}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                    <a href={lead.url} target="_blank" rel="noopener" style={{ fontSize: 11, color: "#666", textDecoration: "none" }}>
                      {lead.url?.replace(/^https?:\/\//, "").slice(0, 35)}
                    </a>
                    <a
                      href={lead.linkedinUrl || `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(lead.name)}`}
                      target="_blank"
                      rel="noopener"
                      style={{ fontSize: 10, color: "#5b8af5", textDecoration: "none", background: "#1a2540", padding: "2px 6px", borderRadius: 4, border: "1px solid #2a3f6a" }}
                    >
                      LinkedIn {lead.linkedinUrl ? "↗" : "🔍"}
                    </a>
                  </div>
                </div>

                {/* Actions */}
                {lead.status === "pending" && (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button onClick={() => handleAccept(idx)} style={{
                      background: "none", border: "1px solid #2a4a37", color: "#3ecf8e",
                      borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}>
                      Accept
                    </button>
                    <button onClick={() => setRejectModal(idx)} style={{
                      background: "none", border: "1px solid #4a2a2a", color: "#f5454a",
                      borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}>
                      Reject
                    </button>
                  </div>
                )}

                {lead.status === "accepted" && (
                  <button onClick={() => onSelectLead(lead)} style={{
                    background: "#f0f0f0", color: "#0f0f0f", border: "none",
                    borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                    flexShrink: 0,
                  }}>
                    Generate Brief →
                  </button>
                )}

                {lead.status === "rejected" && (
                  <span style={{ fontSize: 11, color: "#f5454a", flexShrink: 0 }}>Rejected</span>
                )}
              </div>

              {/* Summary */}
              {lead.summary && (
                <div style={{ marginTop: 8, paddingLeft: 50, fontSize: 12, color: "#888", lineHeight: 1.5 }}>
                  {lead.summary.slice(0, 150)}{lead.summary.length > 150 ? "..." : ""}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Reject Modal */}
        {rejectModal !== null && (
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.7)", display: "flex",
            alignItems: "center", justifyContent: "center", zIndex: 1000,
          }}>
            <div style={{
              background: "#161616", border: "1px solid #2a2a2a",
              borderRadius: 12, padding: 24, width: 400, maxWidth: "90%",
            }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#f0f0f0", marginBottom: 12 }}>
                Reject Lead
              </h3>
              <p style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>
                Why are you rejecting "{leads[rejectModal]?.name}"? This feedback will be saved to memory.
              </p>
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleReject(rejectModal); }}
                placeholder="e.g., Too small, no visible water facilities"
                autoFocus
                style={{
                  width: "100%", background: "#1c1c1c", border: "1px solid #2a2a2a",
                  borderRadius: 8, padding: "11px 14px", fontSize: 14, color: "#f0f0f0",
                  outline: "none", fontFamily: "'Inter', sans-serif", marginBottom: 16,
                }}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => { setRejectModal(null); setRejectReason(""); }} style={{
                  background: "#1c1c1c", color: "#f0f0f0", border: "1px solid #2a2a2a",
                  borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}>
                  Cancel
                </button>
                <button onClick={() => handleReject(rejectModal)} disabled={!rejectReason.trim()} style={{
                  background: "#f5454a", color: "#fff", border: "none",
                  borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600,
                  cursor: !rejectReason.trim() ? "not-allowed" : "pointer",
                  opacity: !rejectReason.trim() ? 0.4 : 1,
                }}>
                  Reject & Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const isHigh = score >= 4;
  const isMid = score === 3;
  return (
    <div style={{
      width: 36, height: 36, borderRadius: 8, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 13, fontWeight: 700,
      background: isHigh ? "#1a2e24" : isMid ? "#2e2614" : "#2e1a1a",
      color: isHigh ? "#3ecf8e" : isMid ? "#f5a623" : "#f5454a",
      border: `1px solid ${isHigh ? "#2a4a37" : isMid ? "#4a3a1a" : "#4a2a2a"}`,
    }}>
      {score}
    </div>
  );
}

function scoreResult(result: any, category: string, city: string, memories: any[]): number {
  let score = 0;
  const text = ((result.title || result.name || "") + " " + (result.url || "") + " " + (result.highlights?.join(" ") || "") + " " + (result.summary || "")).toLowerCase();

  if (text.includes(city.toLowerCase())) score += 1;
  if (["cold plunge", "wellness", "spa", "pool", "sauna", "recovery", "hydrotherapy"].some(k => text.includes(k))) score += 1;
  if (["premium", "luxury", "boutique", "members"].some(k => text.includes(k))) score += 1;
  if (!(result.url || "").includes("blog") && !(result.url || "").includes("directory")) score += 1;
  if (["gym", "fitness", "studio", "club", "resort", "hotel"].some(k => text.includes(k))) score += 1;

  const memTexts = memories.map((m: any) => (typeof m === "string" ? m : m.text || "").toLowerCase());
  const avoidSmall = memTexts.some(m => m.includes("deprioritize") || m.includes("avoid") || m.includes("small"));
  if (avoidSmall && text.includes("boutique") && !text.includes("pool")) score -= 1;

  return Math.max(1, Math.min(5, score));
}
