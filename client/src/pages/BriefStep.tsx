import { useState, useEffect } from "react";
import type { BusinessProfile, Lead, MemoryItem, MeetingBrief, Contact, SalesKit, ReviewAnalysis } from "../App";
import { useIsMobile } from "../hooks/useMobile";
import Tooltip from "../components/Tooltip";
import { apiFetch } from "../lib/api";

interface Props {
  business: BusinessProfile;
  lead: Lead;
  memories: MemoryItem[];
  brief: MeetingBrief | null;
  setBrief: (b: MeetingBrief | null) => void;
  contacts: Contact[];
  setContacts: (c: Contact[]) => void;
  salesKit: SalesKit | null;
  setSalesKit: (k: SalesKit | null) => void;
  reviewAnalysis: ReviewAnalysis | null;
  setReviewAnalysis: (r: ReviewAnalysis | null) => void;
  onBack: () => void;
}

export default function BriefStep({ business, lead, memories, brief, setBrief, contacts, setContacts, salesKit, setSalesKit, reviewAnalysis, setReviewAnalysis, onBack }: Props) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<"account" | "email" | "meeting" | "kit">("account");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ pct: 0, message: "", detail: "" });
  // Recipient is editable: defaults to the prospect's email, but the user can type,
  // override, or add a new address before sending.
  const [emailTo, setEmailTo] = useState(lead.email || "");
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo.trim());
  const hasEmail = isValidEmail;
  const emailToDisplay = emailTo.trim() || "No recipient set";
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [kitLoading, setKitLoading] = useState(false);
  const [kitProgress, setKitProgress] = useState({ pct: 0, message: "", detail: "" });
  const [kitError, setKitError] = useState("");
  const [kitEmailSending, setKitEmailSending] = useState(false);
  const [kitEmailSent, setKitEmailSent] = useState(false);
  const [kitSentTo, setKitSentTo] = useState("");
  const [kitEmailError, setKitEmailError] = useState("");
  const [contactsLoading, setContactsLoading] = useState(true);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState("");
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [emailPreviewHtml, setEmailPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadEmailPreview = async () => {
    if (!salesKit || !business || !lead) return;
    if (showEmailPreview) {
      setShowEmailPreview(false);
      return;
    }
    setPreviewLoading(true);
    setShowEmailPreview(true);
    try {
      const res = await apiFetch("/api/preview-kit-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business, lead, salesKit, contacts, painPoints: reviewAnalysis?.painPoints || [] }),
      });
      const data = await res.json();
      setEmailPreviewHtml(data.html || "");
    } catch {
      setEmailPreviewHtml("<p style='color:#f5454a;padding:20px;'>Failed to load preview</p>");
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    // Reset the editable recipient to this lead's email
    setEmailTo(lead.email || "");
    // Contacts use Exa (not Manus), so fire immediately.
    fetchContacts();
    // The Account Brief is the default view, so generate it first.
    if (!brief) generateBrief();
    // Stagger the remaining Manus calls so the marketing kit + review analysis don't
    // all hit task.create at the same instant as the brief (avoids Manus rate limits).
    const tReviews = setTimeout(() => fetchReviews(), 2000);
    const tKit = setTimeout(() => { if (!salesKit && !kitLoading) generateSalesKit(); }, 4000);
    return () => { clearTimeout(tReviews); clearTimeout(tKit); };
  }, [lead.name]);

  const fetchContacts = async () => {
    setContactsLoading(true);
    try {
      const res = await apiFetch("/api/find-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadName: lead.name, city: lead.city, leadUrl: lead.url }),
      });
      const data = await res.json();
      // Always reflect the latest result — including an empty list — so stale/wrong
      // contacts from a previous lead don't linger when verification returns none.
      setContacts(Array.isArray(data.contacts) ? data.contacts : []);
    } catch {
      setContacts([]);
    }
    setContactsLoading(false);
  };

  const fetchReviews = async () => {
    if (reviewAnalysis) return; // Already fetched
    setReviewsLoading(true);
    setReviewsError("");
    try {
      const res = await apiFetch("/api/scrape-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadName: lead.name,
          leadUrl: lead.url,
          city: lead.city,
          sellerProducts: business.products,
          sellerSummary: business.summary,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setReviewsError(data.error);
        setReviewsLoading(false);
        return;
      }
      const { taskId } = data;
      const realReviews = data.googleReviews || []; // genuine Google reviews to display
      const startTime = Date.now();
      while (true) {
        if (Date.now() - startTime > 120_000) {
          setReviewsError("Review analysis timed out");
          break;
        }
        await new Promise(r => setTimeout(r, 3000));
        const pollRes = await apiFetch(`/api/poll-task?id=${taskId}`);
        const status = await pollRes.json();
        if (status.status === "done") {
          const result = status.result as ReviewAnalysis;
          // Show the real Google reviews, not the LLM's reinterpretation.
          if (realReviews.length > 0) result.reviews = realReviews;
          setReviewAnalysis(result);
          break;
        }
        if (status.status === "error") {
          setReviewsError(status.message || "Review analysis failed");
          break;
        }
      }
    } catch (e: any) {
      setReviewsError(e.message || "Failed to fetch reviews");
    }
    setReviewsLoading(false);
  };

  const generateBrief = async () => {
    setLoading(true);
    setProgress({ pct: 0, message: "Starting...", detail: "" });

    try {
      const res = await apiFetch("/api/generate-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business,
          lead: { name: lead.name, url: lead.url, summary: lead.summary, category: lead.category, city: lead.city },
          memories: memories.map(m => m.text),
        }),
      });

      if (!res.ok) { setLoading(false); return; }
      const { taskId } = await res.json();
      setProgress({ pct: 30, message: "AI generating brief...", detail: "Processing with Manus" });

      const startTime = Date.now();
      while (true) {
        if (Date.now() - startTime > 150_000) { setLoading(false); break; }
        await new Promise(r => setTimeout(r, 3000));
        const pollRes = await apiFetch(`/api/poll-task?id=${taskId}`);
        const status = await pollRes.json();
        if (status.status === "done") { setBrief(status.result); setLoading(false); return; }
        if (status.status === "error") { setLoading(false); break; }
        setProgress({ pct: status.pct || 50, message: status.message || "Processing...", detail: status.detail || "" });
      }
    } catch {}
    setLoading(false);
  };

  const MAX_KIT_ATTEMPTS = 3;

  // Runs one generation attempt. Returns true on success, false on any failure
  // (server error event, dropped stream, or network error) so the caller can retry.
  const runSalesKitAttempt = async (): Promise<boolean> => {
    const res = await apiFetch("/api/generate-sales-kit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business,
        lead: { name: lead.name, url: lead.url, summary: lead.summary, category: lead.category, city: lead.city },
        memories: memories.map(m => m.text),
        reviewPainPoints: reviewAnalysis?.painPoints || [],
      }),
    });

    if (!res.ok) return false;
    const data = await res.json();
    if (data.error) return false;
    const { taskId } = data;

    setKitProgress({ pct: 30, message: "Generating sales kit...", detail: "AI analyzing synergies" });

    const startTime = Date.now();
    while (true) {
      if (Date.now() - startTime > 180_000) return false;
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await apiFetch(`/api/poll-task?id=${taskId}`);
      const status = await pollRes.json();
      if (status.status === "done") { setSalesKit(status.result); return true; }
      if (status.status === "error") return false;
      setKitProgress({ pct: status.pct || 50, message: status.message || "Processing...", detail: status.detail || "" });
    }
  };

  // Generate the kit, auto-retrying transient failures so it succeeds without the
  // user pressing anything. Only after all attempts fail do we surface a retry.
  const generateSalesKit = async () => {
    setKitLoading(true);
    setKitError("");
    setKitProgress({ pct: 0, message: "Starting marketing kit...", detail: "" });

    for (let attempt = 0; attempt < MAX_KIT_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        setKitProgress({ pct: 10, message: "Retrying…", detail: `Attempt ${attempt + 1} of ${MAX_KIT_ATTEMPTS}` });
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
      try {
        const ok = await runSalesKitAttempt();
        if (ok) {
          setKitLoading(false);
          return;
        }
      } catch {
        // network/parse error — fall through to retry
      }
    }

    setKitLoading(false);
    setKitError("Couldn't generate the marketing kit after several tries.");
  };

  const sendEmail = async () => {
    if (!brief) return;
    setEmailSending(true);
    setEmailError("");
    try {
      const res = await apiFetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: emailTo,
          subject: brief.outreachEmailSubject,
          html: brief.outreachEmailBody.replace(/\n/g, "<br/>"),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setEmailSent(true);
      } else {
        setEmailError(data.error || "Failed to send");
      }
    } catch (e: any) {
      setEmailError(e.message);
    }
    setEmailSending(false);
  };

  const sendKitEmail = async () => {
    if (!salesKit) return;
    setKitEmailSending(true);
    setKitEmailError("");
    try {
      const res = await apiFetch("/api/send-kit-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: emailTo,
          business,
          lead,
          salesKit,
          contacts,
          painPoints: reviewAnalysis?.painPoints || [],
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setKitEmailSent(true);
        setKitSentTo(emailTo);
        setEmailTo(""); // clear so the user can enter another recipient
      } else {
        setKitEmailError(data.error || "Failed to send");
      }
    } catch (e: any) {
      setKitEmailError(e.message);
    }
    setKitEmailSending(false);
  };

  const tabs = [
    { key: "account" as const, label: "Account Brief" },
    { key: "kit" as const, label: "Marketing Kit" },
  ];

  const severityColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case "high": return { bg: "var(--danger-wash)", border: "var(--danger)", text: "var(--danger-text)" };
      case "medium": return { bg: "var(--warning-wash)", border: "var(--warning)", text: "var(--warning-text)" };
      default: return { bg: "var(--surface)", border: "var(--line)", text: "var(--ink-3)" };
    }
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
        borderRight: isMobile ? "none" : "1px solid var(--line)",
        borderBottom: isMobile ? "1px solid var(--line)" : undefined,
        height: isMobile ? "auto" : "100%",
        overflowY: isMobile ? "visible" : "auto",
        padding: isMobile ? "20px 16px" : "28px 20px",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 8 }}>
          STEP 3
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)", marginBottom: 20 }}>
          Marketing Kit
        </div>

        {/* Target account */}
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 8 }}>
          TARGET ACCOUNT
        </div>
        <div style={{
          background: "var(--surface)", border: "1px solid var(--line)",
          borderRadius: "var(--radius-md)", padding: "10px 12px", marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{lead.name}</div>
          <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{lead.category} • {lead.city}</div>
          {lead.url && (
            <a href={lead.url} target="_blank" rel="noopener" style={{ fontSize: 10, color: "var(--sage-strong)", textDecoration: "none", display: "block", marginTop: 4 }}>
              {lead.url.replace(/^https?:\/\//, "").slice(0, 35)}
            </a>
          )}
          {lead.email && (
            <div style={{ fontSize: 10, color: "var(--success)", marginTop: 3 }}>✉ {lead.email}</div>
          )}
          {lead.summary && (
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 6, lineHeight: 1.4 }}>
              {lead.summary.slice(0, 120)}{lead.summary.length > 120 ? "..." : ""}
            </div>
          )}
        </div>

        {/* Contacts */}
        {contacts.length > 0 && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 8 }}>
              CONTACTS
            </div>
            {contacts.map((c, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 0", borderBottom: i < contacts.length - 1 ? "1px solid var(--line)" : "none",
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: "50%",
                  background: "var(--sage)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700, color: "var(--ink)",
                }}>
                  {c.name.charAt(0)}
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "var(--ink)" }}>{c.name}</div>
                  <div style={{ fontSize: 10, color: "var(--ink-3)" }}>{c.title}</div>
                </div>
              </div>
            ))}
          </>
        )}

        <div style={{ height: 1, background: "var(--line)", margin: "16px 0" }} />

        <div style={{ marginTop: "auto", paddingTop: 20, borderTop: "1px solid var(--line)" }}>
          <button onClick={onBack} style={{
            background: "none", border: "none", color: "var(--ink-3)", fontSize: 13, cursor: "pointer",
          }}>← Back to Target Accounts</button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{
        flex: 1,
        height: isMobile ? "auto" : "100%",
        overflowY: isMobile ? "visible" : "auto",
        padding: isMobile ? "20px 16px" : "32px 40px",
      }}>
        {loading ? (
          <div style={{ textAlign: "center", paddingTop: 80 }}>
            <div style={{
              display: "inline-block", width: 20, height: 20,
              border: "2px solid var(--line-strong)",
              borderTopColor: "var(--sage)", borderRadius: "50%",
              animation: "spin 0.7s linear infinite",
              marginBottom: 16,
            }} />
            <p style={{ fontSize: 15, color: "var(--ink)", marginBottom: 8 }}>{progress.message}</p>
            <p style={{ fontSize: 12, color: "var(--ink-3)" }}>{progress.detail}</p>
            <div style={{ maxWidth: 300, margin: "16px auto", height: 2, background: "var(--surface-sunk)", borderRadius: 2 }}>
              <div style={{
                height: "100%", background: "var(--action)", borderRadius: 2,
                width: `${progress.pct}%`, transition: "width 0.6s ease",
              }} />
            </div>
          </div>
        ) : brief ? (
          <>
            {/* Tabs */}
            <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "1px solid var(--line)" }}>
              {tabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{
                    background: "none", border: "none",
                    padding: isMobile ? "12px 14px" : "12px 20px", fontSize: 14, fontWeight: 500,
                    color: tab === t.key ? "var(--ink)" : "var(--ink-3)",
                    borderBottom: tab === t.key ? "2px solid var(--ink)" : "2px solid transparent",
                    cursor: "pointer", fontFamily: "var(--font-sans)",
                    marginBottom: -1,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {tab === "account" && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <Section title="Account Brief" content={brief.accountBrief} />
                <Section title="Fit Rationale" content={brief.fitRationale} />
                {/* Company Contacts - Decision Makers */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 12 }}>
                    COMPANY CONTACTS
                  </div>
                  {contacts.length > 0 ? (
                    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-md)", padding: 16 }}>
                      {contacts.map((c, i) => (
                        <div key={i} style={{
                          display: "flex", alignItems: "center", gap: 12,
                          padding: "10px 0",
                          borderBottom: i < contacts.length - 1 ? "1px solid var(--line)" : "none",
                        }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: "50%",
                            background: "var(--sage)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 12, fontWeight: 700, color: "var(--ink)", flexShrink: 0,
                          }}>
                            {(c.name || "?").charAt(0)}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>{c.name}</div>
                            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{c.title}</div>
                          </div>
                          {c.linkedinUrl && (
                            <a
                              href={c.linkedinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                fontSize: 11, color: "var(--sage-strong)", textDecoration: "none",
                                padding: "4px 10px", border: "1px solid var(--sage)",
                                borderRadius: 4, fontWeight: 500,
                              }}
                            >
                              LinkedIn ↗
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : contactsLoading ? (
                    <div style={{
                      background: "var(--surface)", border: "1px solid var(--line)",
                      borderRadius: "var(--radius-md)", padding: "20px", textAlign: "center",
                    }}>
                      <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Searching for decision makers...</div>
                      <div style={{
                        width: 16, height: 16, border: "2px solid var(--sage)",
                        borderTopColor: "transparent", borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                        margin: "10px auto 0",
                      }} />
                    </div>
                  ) : (
                    <div style={{
                      background: "var(--surface)", border: "1px solid var(--line)",
                      borderRadius: "var(--radius-md)", padding: "20px", textAlign: "center",
                    }}>
                      <div style={{ fontSize: 13, color: "var(--ink-3)" }}>No decision makers found for this company</div>
                    </div>
                  )}
                </div>

                {/* Prospect Pain Points — Review Analysis */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 12 }}>
                    PROSPECT PAIN POINTS
                  </div>
                  {reviewsLoading ? (
                    <div style={{
                      background: "var(--surface)", border: "1px solid var(--line)",
                      borderRadius: "var(--radius-md)", padding: "24px", textAlign: "center",
                    }}>
                      <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 8 }}>Analyzing customer reviews...</div>
                      <div style={{
                        width: 16, height: 16, border: "2px solid var(--sage)",
                        borderTopColor: "transparent", borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                        margin: "0 auto",
                      }} />
                    </div>
                  ) : reviewAnalysis && (reviewAnalysis.painPoints.length > 0 || reviewAnalysis.reviews.length > 0 || reviewAnalysis.solutionMapping.length > 0) ? (
                    <div>
                      {/* Filter lens — the keywords we judged review relevance against */}
                      {reviewAnalysis.relevanceKeywords && reviewAnalysis.relevanceKeywords.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 12 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)", marginRight: 2 }}>Filtered for</span>
                          {reviewAnalysis.relevanceKeywords.map((k, i) => (
                            <span key={i} style={{ fontSize: 11, color: "var(--sage-strong)", background: "var(--sage-wash)", border: "1px solid var(--line)", borderRadius: 999, padding: "2px 9px" }}>{k}</span>
                          ))}
                        </div>
                      )}
                      {/* Summary */}
                      {reviewAnalysis.summary && (
                        <div style={{
                          background: "var(--sage-wash)", border: "1px solid var(--sage)",
                          borderRadius: "var(--radius-md)", padding: "14px 18px", marginBottom: 16,
                          fontSize: 13, color: "var(--sage-strong)", lineHeight: 1.6,
                        }}>
                          {reviewAnalysis.summary}
                        </div>
                      )}

                      {/* Pain Points List */}
                      <div style={{ marginBottom: 16 }}>
                        {reviewAnalysis.painPoints.map((pp, i) => {
                          const colors = severityColor(pp.severity);
                          return (
                            <div key={i} style={{
                              background: "var(--surface)", border: "1px solid var(--line)",
                              borderRadius: "var(--radius-md)", padding: "14px 16px", marginBottom: 8,
                              borderLeft: `3px solid ${colors.text}`,
                            }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", flex: 1 }}>
                                  {pp.issue}
                                </span>
                                <span style={{
                                  fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
                                  textTransform: "uppercase",
                                  padding: "3px 8px", borderRadius: 4,
                                  background: colors.bg, border: `1px solid ${colors.border}`,
                                  color: colors.text,
                                }}>
                                  {pp.severity}
                                </span>
                                <span style={{
                                  fontSize: 10, color: "var(--ink-3)",
                                  padding: "3px 8px", background: "var(--surface)",
                                  borderRadius: 4, border: "1px solid var(--line)",
                                }}>
                                  {pp.frequency}
                                </span>
                              </div>
                              <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5, fontStyle: "italic" }}>
                                "{pp.evidence}"
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Solution Mapping Table */}
                      {reviewAnalysis.solutionMapping.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 8 }}>
                            SOLUTION MAPPING
                          </div>
                          <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
                            {!isMobile && (
                            <div style={{
                              display: "grid", gridTemplateColumns: "1fr 1fr 1.5fr",
                              background: "var(--surface)", padding: "10px 14px",
                              borderBottom: "1px solid var(--line)",
                            }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-2)" }}>Their Need</span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--sage-strong)" }}>Our Solution</span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--sage-strong)" }}>Talking Point</span>
                            </div>
                            )}
                            {reviewAnalysis.solutionMapping.map((sm, i) => (
                              <div key={i} style={{
                                display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1.5fr",
                                gap: isMobile ? 4 : undefined,
                                padding: "10px 14px", background: "var(--surface)",
                                borderBottom: i < reviewAnalysis.solutionMapping.length - 1 ? "1px solid var(--line)" : "none",
                              }}>
                                <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{sm.painPoint}</span>
                                <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{sm.ourSolution}</span>
                                <span style={{ fontSize: 12, color: "var(--ink-3)", fontStyle: "italic" }}>{sm.talkingPoint}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Review Snippets */}
                      {reviewAnalysis.reviews.length > 0 && (
                        <div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
                              CUSTOMER REVIEWS
                            </div>
                            {reviewAnalysis.reviews[0]?.source?.includes("google") && (
                              <a
                                href={reviewAnalysis.reviews[0].source}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: 11, fontWeight: 600, color: "var(--sage-strong)", textDecoration: "none" }}
                              >
                                View on Google ↗
                              </a>
                            )}
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
                            {reviewAnalysis.reviews
                        .sort((a, b) => (a.sentiment === "negative" ? -1 : 1) - (b.sentiment === "negative" ? -1 : 1))
                        .slice(0, 6).map((rev, i) => (
                              <div key={i} style={{
                                background: "var(--surface)", border: "1px solid var(--line)",
                                borderRadius: "var(--radius-md)", padding: "12px 14px",
                              }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                                  <span style={{ fontSize: 11, color: rev.sentiment === "negative" ? "var(--danger)" : rev.sentiment === "positive" ? "var(--success)" : "var(--ink-3)" }}>
                                    {rev.sentiment === "negative" ? "▼" : rev.sentiment === "positive" ? "▲" : "—"}
                                  </span>
                                  {rev.rating > 0 && (
                                    <span style={{ fontSize: 11, color: "var(--gold)" }}>
                                      {"★".repeat(rev.rating)}{"☆".repeat(5 - rev.rating)}
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
                                  "{rev.text.slice(0, 120)}{rev.text.length > 120 ? "..." : ""}"
                                </div>
                                <a
                                  href={rev.source}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ fontSize: 10, color: "var(--sage-strong)", textDecoration: "none", marginTop: 6, display: "block" }}
                                >
                                  Source ↗
                                </a>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{
                      background: "var(--surface)", border: "1px solid var(--line)",
                      borderRadius: "var(--radius-md)", padding: "20px", textAlign: "center",
                    }}>
                      <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
                        {reviewAnalysis?.summary || "No customer reviews found for this company"}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === "email" && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 8 }}>
                    SUBJECT
                  </div>
                  <div style={{
                    background: "var(--surface)", border: "1px solid var(--line)",
                    borderRadius: "var(--radius-md)", padding: "12px 16px", fontSize: 14, color: "var(--ink)",
                  }}>
                    {brief.outreachEmailSubject}
                  </div>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 8 }}>
                    BODY
                  </div>
                  <div style={{
                    background: "var(--surface)", border: "1px solid var(--line)",
                    borderRadius: "var(--radius-md)", padding: isMobile ? "14px 16px" : "16px 20px", fontSize: 14, color: "var(--ink-2)",
                    lineHeight: 1.7, whiteSpace: "pre-wrap",
                  }}>
                    {brief.outreachEmailBody}
                  </div>
                </div>

                {/* Send email */}
                <div style={{
                  background: "var(--surface)", border: "1px solid var(--line)",
                  borderRadius: "var(--radius-md)", padding: isMobile ? "14px 16px" : "16px 20px", marginTop: 24,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 10 }}>
                    SEND VIA RESEND
                  </div>
                  {emailSent ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--success)", fontSize: 16 }}>✓</span>
                      <span style={{ fontSize: 14, color: "var(--success)" }}>Email sent successfully!</span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10, alignItems: isMobile ? "stretch" : "center" }}>
                      <input
                        type="email"
                        value={emailTo}
                        onChange={(e) => setEmailTo(e.target.value)}
                        placeholder="Enter recipient email"
                        style={{
                          flex: 1, background: "var(--surface-2)", border: "1px solid var(--line)",
                          borderRadius: "var(--radius-md)", padding: "10px 14px", fontSize: isMobile ? 16 : 14, color: "var(--ink)",
                          outline: "none", fontFamily: "var(--font-sans)",
                        }}
                      />
                      <button
                        onClick={sendEmail}
                        disabled={emailSending || !hasEmail}
                        style={{
                          background: "var(--action)", color: "var(--action-fg)", border: "none",
                          borderRadius: "var(--radius-md)", padding: "10px 20px", fontSize: 14, fontWeight: 600,
                          cursor: (emailSending || !hasEmail) ? "not-allowed" : "pointer",
                          opacity: (emailSending || !hasEmail) ? 0.5 : 1,
                          fontFamily: "var(--font-sans)", whiteSpace: "nowrap",
                          minHeight: isMobile ? 44 : undefined,
                        }}
                      >
                        {emailSending ? "Sending..." : "Send Email"}
                      </button>
                    </div>
                  )}
                  {emailError && (
                    <p style={{ fontSize: 12, color: "var(--danger-text)", marginTop: 8 }}>{emailError}</p>
                  )}
                </div>
              </div>
            )}

            {tab === "meeting" && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <Section title="Meeting Preparation" content={brief.meetingPrep} />

                <div style={{ marginTop: 24 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 12 }}>
                    DISCOVERY QUESTIONS
                  </div>
                  {brief.discoveryQuestions.map((q, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "flex-start", gap: 10,
                      padding: "10px 0", borderBottom: i < brief.discoveryQuestions.length - 1 ? "1px solid var(--line)" : "none",
                    }}>
                      <span style={{ color: "var(--sage-strong)", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                      <span style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5 }}>{q}</span>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 24 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 12 }}>
                    OBJECTIONS & RESPONSES
                  </div>
                  {brief.objectionsAndResponses.map((item, i) => (
                    <div key={i} style={{
                      background: "var(--surface)", border: "1px solid var(--line)",
                      borderRadius: "var(--radius-md)", padding: "14px 16px", marginBottom: 8,
                    }}>
                      <div style={{ fontSize: 13, color: "var(--danger-text)", fontWeight: 600, marginBottom: 6 }}>
                        Objection: {item.objection}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--sage-strong)", lineHeight: 1.5 }}>
                        Response: {item.response}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "kit" && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                {kitLoading ? (
                  <div style={{ textAlign: "center", paddingTop: 60 }}>
                    <div style={{
                      display: "inline-block", width: 20, height: 20,
                      border: "2px solid var(--line-strong)",
                      borderTopColor: "var(--sage)", borderRadius: "50%",
                      animation: "spin 0.7s linear infinite",
                      marginBottom: 16,
                    }} />
                    <p style={{ fontSize: 15, color: "var(--ink)", marginBottom: 8 }}>{kitProgress.message}</p>
                    <p style={{ fontSize: 12, color: "var(--ink-3)" }}>{kitProgress.detail}</p>
                    <div style={{ maxWidth: 300, margin: "16px auto", height: 2, background: "var(--surface-sunk)", borderRadius: 2 }}>
                      <div style={{
                        height: "100%", background: "var(--sage)", borderRadius: 2,
                        width: `${kitProgress.pct}%`, transition: "width 0.6s ease",
                      }} />
                    </div>
                  </div>
                ) : salesKit ? (
                  <>
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ display: "flex", alignItems: "center", fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 8 }}>
                        SUGGESTED BD / SALES ANGLE
                        <Tooltip text="A one-line pitch angle tailored to this prospect." />
                      </div>
                      <div style={{
                        background: "var(--success-wash)", border: "1px solid var(--success)",
                        borderRadius: "var(--radius-md)", padding: "12px 16px", fontSize: 14, color: "var(--success)", fontWeight: 500,
                      }}>
                        {salesKit.suggestedAngle}
                      </div>
                    </div>

                    {/* Synergies Table */}
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ display: "flex", alignItems: "center", fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 12 }}>
                        TOP SYNERGIES
                        <Tooltip text="How this seller's products map to the prospect's likely needs." />
                      </div>
                      <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
                        {!isMobile && (
                        <div style={{
                          display: "grid", gridTemplateColumns: "1fr 1fr 1.5fr",
                          background: "var(--surface)", padding: "10px 14px",
                          borderBottom: "1px solid var(--line)",
                        }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--sage-strong)" }}>Seller Product</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--danger-text)" }}>Prospect Pain</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--sage-strong)" }}>Evidence</span>
                        </div>
                        )}
                        {salesKit.synergies.map((s, i) => (
                          <div key={i} style={{
                            display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1.5fr",
                            gap: isMobile ? 4 : undefined,
                            padding: "10px 14px", background: "var(--surface)",
                            borderBottom: i < salesKit.synergies.length - 1 ? "1px solid var(--line)" : "none",
                          }}>
                            <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{s.sellerProduct}</span>
                            <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{s.prospectPain}</span>
                            <span style={{ fontSize: 12, color: "var(--ink-3)", fontStyle: "italic" }}>{s.evidence}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Outreach Email Draft */}
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ display: "flex", alignItems: "center", fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 8 }}>
                        OUTREACH EMAIL DRAFT
                        <Tooltip text="A ready-to-send email personalized to this prospect." />
                      </div>
                      <div style={{
                        background: "var(--surface)", border: "1px solid var(--line)",
                        borderRadius: "var(--radius-md)", padding: isMobile ? "14px 16px" : "16px 20px", marginBottom: 12,
                      }}>
                        <div style={{ fontSize: 12, color: "var(--sage-strong)", fontWeight: 600, marginBottom: 8 }}>
                          Subject: {salesKit.outreachEmailSubject}
                        </div>
                        <div style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                          {salesKit.outreachEmailBody}
                        </div>
                      </div>

                      {/* Email Preview */}
                      <div style={{ marginTop: 16, marginBottom: 16 }}>
                        <button
                          onClick={loadEmailPreview}
                          disabled={previewLoading}
                          style={{
                            background: "none", border: "1px solid var(--line)",
                            borderRadius: "var(--radius-md)", padding: "10px 16px", fontSize: 13, fontWeight: 600,
                            color: "var(--sage-strong)", cursor: previewLoading ? "wait" : "pointer", fontFamily: "var(--font-sans)",
                            width: "100%", textAlign: "left",
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                          }}
                        >
                          <span>{previewLoading ? "Loading..." : `${showEmailPreview ? "Hide" : "Preview"} Email and PDF`}</span>
                          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{showEmailPreview ? "\u25B2" : "\u25BC"}</span>
                        </button>
                        {showEmailPreview && (
                          <div style={{
                            marginTop: 12, border: "1px solid var(--line)", borderRadius: "var(--radius-md)",
                            overflow: "hidden", background: "var(--bg)",
                          }}>
                            <div style={{
                              padding: "8px 14px", background: "var(--surface)", borderBottom: "1px solid var(--line)",
                              display: "flex", alignItems: "center", justifyContent: "space-between",
                            }}>
                              <span style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600 }}>EMAIL PREVIEW</span>
                              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>To: {emailToDisplay}</span>
                            </div>
                            {previewLoading ? (
                              <div style={{ padding: 40, textAlign: "center" }}>
                                <div style={{ width: 24, height: 24, border: "2px solid var(--line-strong)", borderTopColor: "var(--sage)", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
                              </div>
                            ) : (
                              <iframe
                                srcDoc={emailPreviewHtml}
                                style={{
                                  width: "100%", height: isMobile ? 360 : 500, border: "none",
                                  background: "var(--bg)",
                                }}
                                sandbox="allow-same-origin"
                                title="Email Preview"
                              />
                            )}
                          </div>
                        )}
                      </div>

                      {/* Send Kit Email */}
                      <div style={{
                        background: "var(--surface)", border: "1px solid var(--line)",
                        borderRadius: "var(--radius-md)", padding: isMobile ? "14px 16px" : "16px 20px", marginTop: 16,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 10 }}>
                          SEND MARKETING EMAIL
                          <Tooltip text="Sends the branded email to the recipient. Edit the address or add another before sending." />
                        </div>
                        <div>
                          {/* Success line — stays visible while still allowing another send */}
                          {kitEmailSent && kitSentTo && (
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                              <span style={{ color: "var(--success)", fontSize: 16 }}>✓</span>
                              <span style={{ fontSize: 14, color: "var(--success)" }}>Sent to {kitSentTo}. Add another recipient below to send again.</span>
                            </div>
                          )}
                          <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10, alignItems: isMobile ? "stretch" : "center" }}>
                            <input
                              type="email"
                              value={emailTo}
                              onChange={(e) => setEmailTo(e.target.value)}
                              placeholder="Enter recipient email"
                              style={{
                                flex: 1, background: "var(--surface-2)", border: "1px solid var(--line)",
                                borderRadius: "var(--radius-md)", padding: "10px 14px", fontSize: isMobile ? 16 : 14, color: "var(--ink)",
                                outline: "none", fontFamily: "var(--font-sans)",
                              }}
                            />
                            <button
                              onClick={sendKitEmail}
                              disabled={kitEmailSending || !hasEmail}
                              style={{
                                background: "var(--action)", color: "var(--action-fg)", border: "none",
                                borderRadius: "var(--radius-md)", padding: "10px 20px", fontSize: 14, fontWeight: 600,
                                cursor: (kitEmailSending || !hasEmail) ? "not-allowed" : "pointer",
                                opacity: (kitEmailSending || !hasEmail) ? 0.5 : 1,
                                fontFamily: "var(--font-sans)", whiteSpace: "nowrap",
                                minHeight: isMobile ? 44 : undefined,
                              }}
                            >
                              {kitEmailSending ? "Sending..." : kitEmailSent ? "Send to Another" : "Send Marketing Email"}
                            </button>
                          </div>
                          <p style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 8 }}>
                            Sends a branded native HTML email with outreach message, synergies, and CTA
                          </p>
                          {kitEmailError && (
                            <p style={{ fontSize: 12, color: "var(--danger-text)", marginTop: 8 }}>{kitEmailError}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                ) : kitError ? (
                  <div style={{ textAlign: "center", paddingTop: 60 }}>
                    <p style={{ fontSize: 15, color: "var(--ink)", marginBottom: 8 }}>{kitError}</p>
                    <p style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 20 }}>The AI service may be busy. Please try again.</p>
                    <button
                      onClick={generateSalesKit}
                      style={{
                        background: "var(--action)", color: "var(--action-fg)", border: "none",
                        borderRadius: "var(--radius-md)", padding: "12px 28px", fontSize: 15, fontWeight: 600,
                        cursor: "pointer", fontFamily: "var(--font-sans)",
                      }}
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <div style={{ textAlign: "center", paddingTop: 60 }}>
                    <div style={{
                      display: "inline-block", width: 20, height: 20,
                      border: "2px solid var(--line-strong)",
                      borderTopColor: "var(--sage)", borderRadius: "50%",
                      animation: "spin 0.7s linear infinite",
                      marginBottom: 16,
                    }} />
                    <p style={{ fontSize: 15, color: "var(--ink)", marginBottom: 8 }}>Generating marketing kit…</p>
                    <p style={{ fontSize: 12, color: "var(--ink-3)" }}>Analyzing synergies and drafting your outreach email</p>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: "center", paddingTop: 80 }}>
            <p style={{ color: "var(--ink-3)" }}>Brief generation failed. Please try again.</p>
            <button onClick={generateBrief} style={{
              marginTop: 16, background: "var(--action)", color: "var(--action-fg)", border: "none",
              borderRadius: "var(--radius-md)", padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, content }: { title: string; content: string }) {
  const isMobile = useIsMobile();
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 8 }}>
        {title.toUpperCase()}
      </div>
      <div style={{
        background: "var(--surface)", border: "1px solid var(--line)",
        borderRadius: "var(--radius-md)", padding: isMobile ? "14px 16px" : "16px 20px", fontSize: 14, color: "var(--ink-2)", lineHeight: 1.7,
      }}>
        {content}
      </div>
    </div>
  );
}
