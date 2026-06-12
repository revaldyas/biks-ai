import { useState } from "react";
import type { BusinessProfile, Lead, MemoryItem, Contact } from "../App";

type ReviewOpportunity = {
  businessName: string;
  location: string;
  sourceUrl: string;
  rating: number | null;
  reviewCount: number | null;
  problemDetected: string;
  painPointCategory: string;
  matchedKeywords: string[];
  reviewEvidence: string[];
  moncolOpportunity: string;
  opportunityScore: number;
  memoriesUsed: string[];
};

type ReviewOpportunityResponse = {
  sourceMode: "live" | "fallback";
  results: ReviewOpportunity[];
};

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
}

export default function AccountsStep({
  business, memories, setMemories, leads, setLeads, contacts, setContacts, onSelectLead, onBack
}: Props) {
  const [selectedCategory, setSelectedCategory] = useState(0);
  const [city, setCity] = useState("Singapore");
  const [searching, setSearching] = useState(false);
  const [rejectModal, setRejectModal] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [findingContacts, setFindingContacts] = useState<number | null>(null);
  const [reviewOpportunityLoading, setReviewOpportunityLoading] = useState(false);
  const [reviewOpportunityError, setReviewOpportunityError] = useState("");
  const [reviewOpportunityData, setReviewOpportunityData] = useState<ReviewOpportunityResponse | null>(null);

  const searchLeads = async () => {
    setSearching(true);
    const cat = business.expansionCategories[selectedCategory];
    const query = cat.searchQueries?.[0] || `${cat.name} ${city} premium`;

    try {
      const res = await fetch("/api/exa-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: `${query} ${city}`, numResults: 5 }),
      });
      const data = await res.json();
      const scored = (data.results || []).map((r: any) => ({
        ...r,
        name: r.title,
        email: r.email || null,
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

    // Save rejection to Mem0
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

    // Re-score remaining leads
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

  const findContacts = async (lead: Lead, idx: number) => {
    setFindingContacts(idx);
    try {
      const res = await fetch("/api/find-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadName: lead.name, city: lead.city }),
      });
      const data = await res.json();
      if (data.contacts) setContacts(data.contacts);
    } catch {}
    setFindingContacts(null);
  };

  const findReviewOpportunities = async () => {
    setReviewOpportunityLoading(true);
    setReviewOpportunityError("");

    try {
      const res = await fetch("/api/review-opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: "Singapore",
          businessTypes: ["spa", "wellness", "medical spa", "recovery center", "athletic recovery club", "resort spa"],
          memories: memories.map(memory => memory.text),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to discover opportunities");
      }
      setReviewOpportunityData(data);
    } catch (error: any) {
      setReviewOpportunityError(error.message || "Failed to discover opportunities");
    }

    setReviewOpportunityLoading(false);
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
          STEP 4
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

        {/* City input */}
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>
          CITY
        </div>
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          style={{
            width: "100%",
            background: "#1a1a1a", border: "1px solid #2a2a2a",
            borderRadius: 8, padding: "9px 12px",
            fontSize: 13, color: "#f0f0f0", outline: "none",
            fontFamily: "'Inter', sans-serif",
          }}
        />

        <div style={{ height: 1, background: "#1e1e1e", margin: "16px 0" }} />

        {/* Memories */}
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>
          ACTIVE MEMORIES ({memories.length})
        </div>
        {memories.slice(0, 5).map(m => (
          <div key={m.id} style={{
            fontSize: 11, color: "#3ecf8e", padding: "3px 8px",
            background: "#0e1e16", border: "1px solid #2a4a37",
            borderRadius: 10, marginBottom: 4, overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {m.text}
          </div>
        ))}

        <div style={{ marginTop: "auto", paddingTop: 20, borderTop: "1px solid #1e1e1e" }}>
          <button onClick={onBack} style={{
            background: "none", border: "none", color: "#3a3a3a", fontSize: 13, cursor: "pointer",
          }}>← Back to Memory</button>
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

        <div style={{
          background: "#131925",
          border: "1px solid #22304d",
          borderRadius: 12,
          padding: "18px 20px",
          marginBottom: 24,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7d97d9", marginBottom: 6 }}>
                Review-Based Opportunity Discovery
              </div>
              <div style={{ fontSize: 13, color: "#b9c8e8", lineHeight: 1.5, maxWidth: 720 }}>
                Search Google Maps businesses, inspect public review complaints, and detect Moncol opportunities from water, dirty, and filter signals.
              </div>
            </div>
            <button
              onClick={findReviewOpportunities}
              disabled={reviewOpportunityLoading}
              style={{
                background: "#d9e6ff",
                color: "#10203a",
                border: "none",
                borderRadius: 8,
                padding: "10px 16px",
                fontSize: 13,
                fontWeight: 700,
                cursor: reviewOpportunityLoading ? "not-allowed" : "pointer",
                opacity: reviewOpportunityLoading ? 0.65 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {reviewOpportunityLoading ? "Scanning..." : "Find Review-Based Opportunities"}
            </button>
          </div>

          {reviewOpportunityLoading && (
            <p style={{ marginTop: 12, fontSize: 13, color: "#d9e6ff" }}>
              Scanning public reviews for water, dirty, and filter signals...
            </p>
          )}

          {reviewOpportunityError && (
            <p style={{ marginTop: 12, fontSize: 13, color: "#f88a8a" }}>
              {reviewOpportunityError}
            </p>
          )}
        </div>

        {reviewOpportunityData && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7d97d9", marginBottom: 4 }}>
                  Review-Based Opportunities
                </div>
                <div style={{ fontSize: 12, color: "#7f8ca8" }}>
                  Source mode: {reviewOpportunityData.sourceMode}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#7f8ca8" }}>
                {reviewOpportunityData.results.length} opportunities
              </div>
            </div>

            {reviewOpportunityData.results.length === 0 ? (
              <div style={{ background: "#161616", border: "1px solid #2a2a2a", borderRadius: 12, padding: 24 }}>
                <p style={{ color: "#777", fontSize: 14, margin: 0 }}>
                  No review-based opportunities found for the current search.
                </p>
              </div>
            ) : (
              reviewOpportunityData.results.map((opportunity, idx) => (
                <div key={`${opportunity.businessName}-${idx}`} style={{
                  background: "#121823",
                  border: "1px solid #24324f",
                  borderRadius: 12,
                  padding: "18px 20px",
                  marginBottom: 10,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#f0f4ff", marginBottom: 4 }}>
                        {opportunity.businessName}
                      </div>
                      <div style={{ fontSize: 12, color: "#7f8ca8" }}>
                        {opportunity.location}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <ScoreBadge score={opportunity.opportunityScore} />
                      <span style={{ fontSize: 11, color: "#7f8ca8" }}>
                        {opportunity.rating ? `${opportunity.rating.toFixed(1)} stars` : "Rating n/a"}
                        {typeof opportunity.reviewCount === "number" ? ` • ${opportunity.reviewCount} reviews` : ""}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                    <OpportunityInfo label="Problem Detected" value={opportunity.problemDetected} />
                    <OpportunityInfo label="Pain Point" value={opportunity.painPointCategory} />
                    <OpportunityInfo label="Moncol Opportunity" value={opportunity.moncolOpportunity} />
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7d97d9", marginBottom: 8 }}>
                      Matched Keywords
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {opportunity.matchedKeywords.map((keyword) => (
                        <span key={keyword} style={{
                          fontSize: 11, color: "#d9e6ff", padding: "4px 8px",
                          background: "#1b2740", border: "1px solid #2c3b5f", borderRadius: 999,
                        }}>
                          {keyword}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7d97d9", marginBottom: 8 }}>
                      Review Evidence
                    </div>
                    {opportunity.reviewEvidence.map((evidence, evidenceIdx) => (
                      <div key={evidenceIdx} style={{
                        fontSize: 12, color: "#dbe6ff", lineHeight: 1.5,
                        background: "#182133", border: "1px solid #24324f", borderRadius: 8,
                        padding: "8px 10px", marginBottom: 6,
                      }}>
                        "{evidence}"
                      </div>
                    ))}
                  </div>

                  {opportunity.memoriesUsed.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7d97d9", marginBottom: 8 }}>
                        Memories Used
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {opportunity.memoriesUsed.map((memory, memoryIdx) => (
                          <span key={memoryIdx} style={{
                            fontSize: 11, color: "#d9e6ff", padding: "4px 8px",
                            background: "#1b2740", border: "1px solid #2c3b5f", borderRadius: 999,
                          }}>
                            {memory}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <a href={opportunity.sourceUrl} target="_blank" rel="noopener" style={{
                    display: "inline-block",
                    marginTop: 12,
                    fontSize: 12,
                    color: "#8db4ff",
                    textDecoration: "none",
                  }}>
                    Open Source →
                  </a>
                </div>
              ))
            )}
          </div>
        )}

        {/* Leads */}
        {leads.length === 0 && !searching && (
          <div style={{
            background: "#161616", border: "1px solid #2a2a2a", borderRadius: 12, padding: 40,
            textAlign: "center",
          }}>
            <p style={{ color: "#555", fontSize: 14 }}>Select a category and city, then click "Search Leads" to find target accounts.</p>
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

        {leads.map((lead, idx) => (
          <div key={idx} style={{
            background: lead.status === "accepted" ? "#0d1f17" : "#161616",
            border: `1px solid ${lead.status === "rejected" ? "#f5454a" : lead.status === "accepted" ? "#3ecf8e" : "#2a2a2a"}`,
            borderRadius: 10, padding: "18px 20px", marginBottom: 10,
            opacity: lead.status === "rejected" ? 0.45 : 1,
            display: "flex", alignItems: "flex-start", gap: 16,
            animation: "fadeIn 0.3s ease",
          }}>
            {/* Icon */}
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: "#1e1e1e", border: "1px solid #2a2a2a",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
              </svg>
            </div>

            {/* Content */}
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#f0f0f0" }}>{lead.name}</span>
                <ScoreBadge score={lead.fitScore} />
              </div>
              <p style={{ fontSize: 13, color: "#666", marginBottom: 8, lineHeight: 1.5 }}>{lead.summary}</p>
              <a href={lead.url} target="_blank" rel="noopener" style={{ fontSize: 11, color: "#5b8af5", textDecoration: "none" }}>
                {lead.url}
              </a>
              {lead.email && (
                <div style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: "#3ecf8e" }}>✉ {lead.email}</span>
                </div>
              )}

              {/* Actions */}
              {lead.status === "pending" && (
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button onClick={() => { handleAccept(idx); findContacts(lead, idx); }} style={{
                    background: "#3ecf8e", color: "#0a0d14", border: "none",
                    borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}>
                    Accept
                  </button>
                  <button onClick={() => setRejectModal(idx)} style={{
                    background: "#f5454a", color: "#fff", border: "none",
                    borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}>
                    Reject
                  </button>
                  <button onClick={() => findContacts(lead, idx)} disabled={findingContacts === idx} style={{
                    background: "#1c1c1c", color: "#f0f0f0", border: "1px solid #2a2a2a",
                    borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}>
                    {findingContacts === idx ? "Finding..." : "Find Contacts"}
                  </button>
                </div>
              )}

              {lead.status === "accepted" && (
                <div style={{ marginTop: 12 }}>
                  <button onClick={() => onSelectLead(lead)} style={{
                    background: "#f0f0f0", color: "#0f0f0f", border: "none",
                    borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer",
                  }}>
                    Generate Sales Kit →
                  </button>
                </div>
              )}

              {lead.status === "rejected" && lead.rejectionReason && (
                <p style={{ fontSize: 11, color: "#f5454a", marginTop: 8 }}>
                  Rejected: {lead.rejectionReason}
                </p>
              )}
            </div>
          </div>
        ))}

        {/* Contacts section */}
        {contacts.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 12 }}>
              KEY CONTACTS FOUND
            </div>
            {contacts.map((c, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 12px", background: "#1c1c1c",
                border: "1px solid #2a2a2a", borderRadius: 8, marginBottom: 6,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: "linear-gradient(135deg, #5b8af5, #3ecf8e)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 700, color: "#fff",
                }}>
                  {c.name.charAt(0)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f0" }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: "#666" }}>{c.title}</div>
                </div>
                {c.linkedinUrl && (
                  <a href={c.linkedinUrl} target="_blank" rel="noopener" style={{
                    fontSize: 11, color: "#5b8af5", padding: "2px 8px",
                    borderRadius: 4, background: "#1a2540", border: "1px solid #2a3f6a",
                    textDecoration: "none",
                  }}>
                    LinkedIn
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

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
    <span style={{
      padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
      background: isHigh ? "#1a2e24" : isMid ? "#2e2614" : "#2e1a1a",
      color: isHigh ? "#3ecf8e" : isMid ? "#f5a623" : "#f5454a",
      border: `1px solid ${isHigh ? "#2a4a37" : isMid ? "#4a3a1a" : "#4a2a2a"}`,
    }}>
      {score}/5
    </span>
  );
}

function OpportunityInfo({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#182133", border: "1px solid #24324f", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7d97d9", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: "#dbe6ff", lineHeight: 1.5 }}>
        {value}
      </div>
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
