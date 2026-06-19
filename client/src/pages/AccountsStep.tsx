import { useState, type CSSProperties } from "react";
import type { BusinessProfile, Lead, MemoryItem, Contact } from "../App";
import { useIsMobile } from "../hooks/useMobile";
import { apiFetch } from "../lib/api";
import Tooltip from "../components/Tooltip";

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
  const isMobile = useIsMobile();
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [city, setCity] = useState("Singapore");
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [searchAudit, setSearchAudit] = useState<{
    candidatesDiscovered: number;
    candidatesRetrievedByExa: number;
    uniqueCompanies: number;
    companiesEvaluated: number;
    eligibilityRejections: number;
    verifiedFacilities: number;
    leadsWithTimelySignals: number;
    finalLeadsReturned: number;
  } | null>(null);

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

  const readApiData = async (response: Response, fallbackMessage: string) => {
    const text = await response.text();
    if (!text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch {
      const message = text.replace(/\s+/g, " ").trim().slice(0, 240);
      throw new Error(`${fallbackMessage}${response.status ? ` (${response.status})` : ""}: ${message || "Server returned a non-JSON response."}`);
    }
  };

  const searchLeads = async () => {
    setSearching(true);
    const cat = business.expansionCategories[selectedCategory];

    try {
      setSearchAudit(null);
      setLeads([]);
      setSearchMessage("Manus is planning the buyer search and evidence criteria...");
      const startRes = await apiFetch("/api/lead-research/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city,
          business,
          category: cat,
          memories: memories.map(m => m.text),
        }),
      });
      const startData = await readApiData(startRes, "Lead research failed to start");
      if (!startRes.ok) throw new Error(startData.error || "Lead research failed to start");

      let discovery: any = null;
      let initPolls = 0;
      for (let attempt = 0; attempt < 240; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const pollRes = await apiFetch(`/api/lead-research/poll?id=${encodeURIComponent(startData.taskId)}`);
        const pollData = await readApiData(pollRes, "Manus search planning failed");
        if (!pollRes.ok || pollData.error) throw new Error(pollData.error || "Manus search planning failed");
        if (pollData.status === "error") throw new Error(pollData.message || "Manus search planning failed");
        if (pollData.status === "done") { discovery = pollData.result; break; }
        // A task stuck "initializing" (persistent 404) is dead — bail after ~45s.
        if (pollData.phase === "initializing") {
          if (++initPolls >= 15) throw new Error("Manus task did not start (no response after 45s). Please try again.");
        } else initPolls = 0;
        setSearchMessage(pollData.message || "Manus is planning the buyer search...");
      }
      if (!discovery) throw new Error("Manus search planning timed out before completing");

      setSearchMessage("Exa is corroborating facilities, locations, and expansion signals...");
      const corroborateRes = await apiFetch("/api/lead-research/corroborate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discovery,
          city,
          numResults: 8,
          business,
          category: cat,
          memories: memories.map(m => m.text),
        }),
      });
      const corroborateData = await readApiData(corroborateRes, "Evidence corroboration failed");
      if (!corroborateRes.ok) throw new Error(corroborateData.error || "Evidence corroboration failed");

      setSearchMessage("Manus is comparing verified candidates and ranking why-now opportunities...");
      let rankingResult: any = null;
      let rankInitPolls = 0;
      for (let attempt = 0; attempt < 240; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const rankPollRes = await apiFetch(`/api/lead-research/poll?id=${encodeURIComponent(corroborateData.taskId)}`);
        const rankPollData = await readApiData(rankPollRes, "Strategic ranking failed");
        if (!rankPollRes.ok || rankPollData.error) throw new Error(rankPollData.error || "Strategic ranking failed");
        if (rankPollData.status === "error") throw new Error(rankPollData.message || "Strategic ranking failed");
        if (rankPollData.status === "done") { rankingResult = rankPollData.result; break; }
        // A task stuck "initializing" (persistent 404) is dead — bail after ~45s.
        if (rankPollData.phase === "initializing") {
          if (++rankInitPolls >= 15) throw new Error("Manus ranking did not start (no response after 45s). Please try again.");
        } else rankInitPolls = 0;
        setSearchMessage(rankPollData.message || "Manus is ranking verified opportunities...");
      }
      if (!rankingResult) throw new Error("Strategic ranking timed out before completing");
      const finalRes = await apiFetch("/api/lead-research/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rankingResult,
          evidenceBundles: corroborateData.evidenceBundles,
          partialAudit: corroborateData.partialAudit,
          numResults: 8,
          memories: memories.map(m => m.text),
        }),
      });
      const data = await readApiData(finalRes, "Lead finalization failed");
      if (!finalRes.ok || data.error) throw new Error(data.error || "Lead finalization failed");
      setSearchAudit(data.audit || null);
      setSearchMessage(data.results?.length ? "" : "No companies passed every facility, location, operating, and buyer verification check.");
      const scored = (data.results || []).map((r: any) => ({
        ...r,
        name: r.displayName || r.title,
        email: r.email || null,
        linkedinUrl: r.linkedinUrl || null,
        fitScore: Number.isFinite(r.fitScore) ? r.fitScore : 1,
        category: cat.name,
        city,
        status: "pending" as const,
      }));
      scored.sort((a: Lead, b: Lead) => b.fitScore - a.fitScore);
      setLeads(scored);
    } catch (error) {
      setSearchMessage(error instanceof Error ? error.message : "Lead search failed");
    }
    setSearching(false);
  };

  const handleReject = async (idx: number) => {
    if (!rejectReason.trim()) return;
    const updated = [...leads];
    updated[idx] = { ...updated[idx], status: "rejected", rejectionReason: rejectReason };
    setLeads(updated);

    try {
      const res = await apiFetch("/api/mem0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `Rejected lead "${leads[idx].name}" for ${business.companyName}: ${rejectReason}`, scope: business.website || business.companyName }),
      });
      const data = await res.json();
      if (data.ok) {
        setMemories([...memories, { id: data.id, text: `Rejected: ${rejectReason}` }]);
      }
    } catch {}

    updated.sort((a, b) => {
      if (a.status === "rejected" && b.status !== "rejected") return 1;
      if (b.status === "rejected" && a.status !== "rejected") return -1;
      return b.fitScore - a.fitScore;
    });
    setLeads(updated);
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
      await apiFetch(`/api/mem0?id=${id}`, { method: "DELETE" });
      setMemories(memories.filter(m => m.id !== id));
    } catch {}
    setDeletingMemId(null);
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: isMobile ? "column" : "row",
      height: isMobile ? "auto" : "calc(100vh - 57px)",
      minHeight: isMobile ? "calc(100vh - 57px)" : undefined,
      overflow: isMobile ? "visible" : "hidden",
    }}>
      {/* Sidebar */}
      <div style={{
        width: isMobile ? "100%" : 264, flexShrink: 0, background: "var(--bg)",
        borderRight: isMobile ? undefined : "1px solid var(--line)",
        borderBottom: isMobile ? "1px solid var(--line)" : undefined,
        height: isMobile ? "auto" : "100%",
        overflowY: isMobile ? "visible" : "auto",
        padding: isMobile ? "20px 16px" : "28px 20px",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 8 }}>
          STEP 2
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)", marginBottom: 20 }}>
          Leads
        </div>

        {/* Target market selector */}
        <div style={{ display: "flex", alignItems: "center", fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 8 }}>
          TARGET MARKET
          <Tooltip text="The market segment Biks will search for prospects in." />
        </div>
        {business.expansionCategories.slice(0, 3).map((cat, i) => (
          <button key={i} onClick={() => setSelectedCategory(i)} style={{
            width: "100%", textAlign: "left",
            background: selectedCategory === i ? "var(--sage-wash)" : "var(--surface)",
            border: `1px solid ${selectedCategory === i ? "var(--sage)" : "var(--line)"}`,
            borderRadius: "var(--radius-md)", padding: "9px 12px", marginBottom: 6,
            minHeight: isMobile ? 44 : undefined,
            fontSize: 13, color: selectedCategory === i ? "var(--sage-strong)" : "var(--ink-3)",
            cursor: "pointer", fontFamily: "var(--font-sans)",
          }}>
            {cat.name}
          </button>
        ))}

        <div style={{ height: 1, background: "var(--line)", margin: "16px 0" }} />

        {/* City dropdown */}
        <div style={{ fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 8 }}>
          CITY
        </div>
        <select
          value={city}
          onChange={(e) => setCity(e.target.value)}
          style={{
            width: "100%",
            background: "var(--surface-2)", border: "1px solid var(--line)",
            borderRadius: "var(--radius-md)", padding: "9px 12px",
            fontSize: isMobile ? 16 : 13, color: "var(--ink)", outline: "none",
            fontFamily: "var(--font-sans)",
            cursor: "pointer",
            appearance: "none",
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 12px center",
          }}
        >
          {cityOptions.map(c => (
            <option key={c} value={c} style={{ background: "var(--surface-2)", color: "var(--ink)" }}>
              {c}
            </option>
          ))}
        </select>

        {/* Primary action — directly under City */}
        <button
          onClick={searchLeads}
          disabled={searching}
          style={{
            width: "100%", marginTop: 16,
            minHeight: isMobile ? 44 : undefined,
            background: "var(--action)", color: "var(--action-fg)", border: "none",
            borderRadius: "var(--radius-md)", padding: "11px 16px", fontSize: 14, fontWeight: 600,
            cursor: searching ? "not-allowed" : "pointer", opacity: searching ? 0.5 : 1,
            fontFamily: "var(--font-sans)",
          }}
        >
          {searching ? "Generating..." : "Generate Leads"}
        </button>

        <div style={{ marginTop: "auto", paddingTop: 20, borderTop: "1px solid var(--line)" }}>
          <button onClick={onBack} style={{
            background: "none", border: "none", color: "var(--ink-3)", fontSize: 13, cursor: "pointer",
          }}>← Back to Company Analysis</button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{
        flex: 1,
        height: isMobile ? "auto" : "100%",
        overflowY: isMobile ? "visible" : "auto",
        padding: isMobile ? "20px 16px" : "32px 40px",
      }}>
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--ink)" }}>Leads</h2>
          <p style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>
            Selected market: {business.expansionCategories[selectedCategory]?.name} · {city}
          </p>
          {searchAudit && (
            <div style={{ marginTop: 10, fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5 }}>
              {searchAudit.candidatesDiscovered} discovered · {searchAudit.uniqueCompanies} unique · {searchAudit.companiesEvaluated} evaluated · {searchAudit.verifiedFacilities} verified · {searchAudit.leadsWithTimelySignals} timely signals · {searchAudit.finalLeadsReturned} returned
            </div>
          )}
        </div>

        {/* Leads */}
        {leads.length === 0 && !searching && (
          <div style={{
            background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-md)", padding: 40,
            textAlign: "center",
          }}>
            {searchMessage ? (
              <p style={{ color: "var(--warning-text)", fontSize: 14 }}>{searchMessage}</p>
            ) : (
              <p style={{ color: "var(--ink-3)", fontSize: 14 }}>Choose a target market and city, then generate leads.</p>
            )}
          </div>
        )}

        {searching && (
          <div style={{ textAlign: "center", padding: 40 }}>
            <div style={{
              display: "inline-block", width: 15, height: 15,
              border: "2px solid var(--line-strong)",
              borderTopColor: "var(--sage)", borderRadius: "50%",
              animation: "spin 0.7s linear infinite",
            }} />
            <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 12 }}>{searchMessage || "Researching and verifying leads..."}</p>
          </div>
        )}

        {/* Lead cards with labeled fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {leads.map((lead, idx) => (
            <div key={idx} style={{
              background: lead.status === "accepted" ? "var(--success-wash)" : "var(--surface)",
              border: `1px solid ${lead.status === "rejected" ? "var(--danger)" : lead.status === "accepted" ? "var(--success)" : "var(--line)"}`,
              borderRadius: "var(--radius-md)", padding: "16px 18px",
              opacity: lead.status === "rejected" ? 0.45 : 1,
              animation: "fadeIn 0.3s ease",
            }}>
              <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 12 : 20, alignItems: "flex-start" }}>
                {/* Left: company + evidence */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={fieldLabel}>Company Name</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, marginBottom: 12 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, maxWidth: "60%" }}>
                      {lead.name}
                    </span>
                    {lead.displayLocation && (
                      <span style={{ fontSize: 10, color: "var(--ink-3)", background: "var(--surface-sunk)", padding: "2px 6px", borderRadius: 4, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>
                        {lead.displayLocation}
                      </span>
                    )}
                    <a href={lead.url} target="_blank" rel="noopener" style={{ fontSize: 11, color: "var(--ink-3)", textDecoration: "none" }}>
                      {lead.url?.replace(/^https?:\/\//, "").slice(0, 30)}
                    </a>
                    <a
                      href={lead.linkedinUrl || `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(lead.name)}`}
                      target="_blank"
                      rel="noopener"
                      style={{ fontSize: 10, color: "var(--sage-strong)", textDecoration: "none", background: "var(--sage-wash)", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--sage)" }}
                    >
                      LinkedIn {lead.linkedinUrl ? "↗" : "🔍"}
                    </a>
                  </div>
                  <div style={fieldLabel}>Evidence</div>
                  <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 2, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {(lead.cleanEvidence || lead.evidenceQuote || lead.evidence || lead.summary)
                      ? (lead.cleanEvidence || `${(lead.evidenceQuote || lead.evidence || lead.summary).slice(0, 220)}${(lead.evidenceQuote || lead.evidence || lead.summary).length > 220 ? "..." : ""}`)
                      : "No evidence text available."}
                  </div>
                  {lead.evidenceUrl && (
                    <a href={lead.evidenceUrl} target="_blank" rel="noopener" style={{ display: "inline-block", marginTop: 5, fontSize: 11, color: "var(--sage-strong)" }}>
                      View source evidence
                    </a>
                  )}
                  {lead.whyThisCompanyFits && (
                    <>
                      <div style={{ ...fieldLabel, marginTop: 10 }}>Why It Fits</div>
                      <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 2 }}>
                        {lead.whyThisCompanyFits}
                      </div>
                    </>
                  )}
                  {lead.whyNow && (
                    <>
                      <div style={{ ...fieldLabel, marginTop: 10 }}>
                        Why Now{lead.opportunityPriority ? ` · Priority ${lead.opportunityPriority}` : ""}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 2 }}>
                        {lead.whyNow}
                      </div>
                      {lead.opportunitySignalSource && (
                        <a href={lead.opportunitySignalSource} target="_blank" rel="noopener" style={{ display: "inline-block", marginTop: 5, fontSize: 11, color: "var(--sage-strong)" }}>
                          View opportunity signal{lead.opportunitySignalDate ? ` · ${lead.opportunitySignalDate}` : ""}
                        </a>
                      )}
                    </>
                  )}
                  {lead.disqualifiers && lead.disqualifiers.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                      {lead.disqualifiers.slice(0, 3).map((d, i) => (
                        <span key={i} style={{ fontSize: 10, color: "var(--danger-text)", background: "var(--danger-wash)", border: "1px solid var(--danger)", borderRadius: 999, padding: "2px 8px" }}>
                          {d}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right: relevance + decision */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: isMobile ? "flex-start" : "flex-end", gap: 4, flexShrink: 0 }}>
                  <div style={{ ...fieldLabel, display: "flex", alignItems: "center" }}>
                    Relevance
                    <Tooltip text="How well this lead fits, based on segment, location, and your saved preferences. High / Medium / Low." />
                  </div>
                  <RelevanceBadge label={getRelevanceLabel(lead.fitScore, lead.eligibilityPass)} />

                  <div style={{ ...fieldLabel, marginTop: 12, display: "flex", alignItems: "center" }}>
                    Decision
                    <Tooltip text="Accept a lead to generate its marketing kit, or reject it (Biks remembers why and improves future results)." />
                  </div>
                  {lead.status === "pending" && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => handleAccept(idx)} style={{
                        background: "none", border: "1px solid var(--success)", color: "var(--success)",
                        borderRadius: 6, padding: "5px 12px", minHeight: isMobile ? 40 : undefined, fontSize: 12, fontWeight: 600, cursor: "pointer",
                      }}>
                        Accept
                      </button>
                      <button onClick={() => setRejectModal(idx)} style={{
                        background: "none", border: "1px solid var(--danger)", color: "var(--danger-text)",
                        borderRadius: 6, padding: "5px 12px", minHeight: isMobile ? 40 : undefined, fontSize: 12, fontWeight: 600, cursor: "pointer",
                      }}>
                        Reject
                      </button>
                    </div>
                  )}
                  {lead.status === "accepted" && (
                    <button onClick={() => onSelectLead(lead)} style={{
                      background: "var(--action)", color: "var(--action-fg)", border: "none",
                      borderRadius: 6, padding: "7px 16px", minHeight: isMobile ? 40 : undefined, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}>
                      Generate Brief
                    </button>
                  )}
                  {lead.status === "rejected" && (
                    <span style={{ fontSize: 11, color: "var(--danger-text)" }}>Rejected</span>
                  )}
                </div>
              </div>
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
              background: "var(--surface)", border: "1px solid var(--line)",
              borderRadius: "var(--radius-xl)", padding: 24, width: 400, maxWidth: "90%",
            }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", marginBottom: 12 }}>
                Reject Lead
              </h3>
              <p style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 16 }}>
                Why are you rejecting "{leads[rejectModal]?.name}"? This feedback will be saved to memory.
              </p>
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleReject(rejectModal); }}
                placeholder="e.g., Too small, no visible water facilities"
                autoFocus
                style={{
                  width: "100%", background: "var(--surface-2)", border: "1px solid var(--line)",
                  borderRadius: "var(--radius-md)", padding: "11px 14px", fontSize: 14, color: "var(--ink)",
                  outline: "none", fontFamily: "var(--font-sans)", marginBottom: 16,
                }}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => { setRejectModal(null); setRejectReason(""); }} style={{
                  background: "var(--surface-2)", color: "var(--ink)", border: "1px solid var(--line)",
                  borderRadius: "var(--radius-md)", padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}>
                  Cancel
                </button>
                <button onClick={() => handleReject(rejectModal)} disabled={!rejectReason.trim()} style={{
                  background: "var(--danger)", color: "var(--action-fg)", border: "none",
                  borderRadius: "var(--radius-md)", padding: "10px 20px", fontSize: 14, fontWeight: 600,
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
const fieldLabel: CSSProperties = {
  fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)",
  letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-4)",
};

const getRelevanceLabel = (score: number, eligibilityPass?: boolean): "High" | "Medium" | "Low" => {
  if (!eligibilityPass) return "Low";
  if (score >= 4) return "High";
  if (score === 3) return "Medium";
  return "Low";
};

function RelevanceBadge({ label }: { label: "High" | "Medium" | "Low" }) {
  const palette = {
    High: { bg: "var(--success-wash)", color: "var(--success)", border: "var(--success)" },
    Medium: { bg: "var(--warning-wash)", color: "var(--warning-text)", border: "var(--warning)" },
    Low: { bg: "var(--danger-wash)", color: "var(--danger-text)", border: "var(--danger)" },
  }[label];
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.06em",
      padding: "3px 12px", borderRadius: 999,
      background: palette.bg, color: palette.color, border: `1px solid ${palette.border}`,
    }}>
      {label}
    </span>
  );
}
