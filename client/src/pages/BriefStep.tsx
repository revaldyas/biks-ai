import { useState, useEffect } from "react";
import type { BusinessProfile, Lead, MemoryItem, MeetingBrief, Contact, SalesKit } from "../App";

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
  onBack: () => void;
}

export default function BriefStep({ business, lead, memories, brief, setBrief, contacts, setContacts, salesKit, setSalesKit, onBack }: Props) {
  const [tab, setTab] = useState<"account" | "email" | "meeting" | "kit">("account");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ pct: 0, message: "", detail: "" });
  const emailTo = "ngurah.linggih@gmail.com";
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [kitLoading, setKitLoading] = useState(false);
  const [kitProgress, setKitProgress] = useState({ pct: 0, message: "", detail: "" });
  const [kitEmailSending, setKitEmailSending] = useState(false);
  const [kitEmailSent, setKitEmailSent] = useState(false);
  const [kitEmailError, setKitEmailError] = useState("");

  useEffect(() => {
    if (!brief) generateBrief();
    // Always fetch contacts for the current lead
    fetchContacts();
  }, [lead.name]);

  const fetchContacts = async () => {
    try {
      const res = await fetch("/api/find-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadName: lead.name, city: lead.city }),
      });
      const data = await res.json();
      if (data.contacts && data.contacts.length > 0) {
        setContacts(data.contacts);
      }
    } catch {}
  };

  const generateBrief = async () => {
    setLoading(true);
    setProgress({ pct: 0, message: "Starting...", detail: "" });

    try {
      const res = await fetch("/api/generate-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business,
          lead: { name: lead.name, url: lead.url, summary: lead.summary, category: lead.category, city: lead.city },
          memories: memories.map(m => m.text),
        }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "progress") {
              setProgress({ pct: evt.pct, message: evt.message, detail: evt.detail || "" });
            }
            if (evt.type === "complete") {
              setBrief(evt.result);
              setLoading(false);
              return;
            }
            if (evt.type === "error") {
              setLoading(false);
              return;
            }
          } catch {}
        }
      }
    } catch {}
    setLoading(false);
  };

  const generateSalesKit = async () => {
    setKitLoading(true);
    setKitProgress({ pct: 0, message: "Starting sales kit...", detail: "" });

    try {
      const res = await fetch("/api/generate-sales-kit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business,
          lead: { name: lead.name, url: lead.url, summary: lead.summary, category: lead.category, city: lead.city },
          memories: memories.map(m => m.text),
        }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "progress") {
              setKitProgress({ pct: evt.pct, message: evt.message, detail: evt.detail || "" });
            }
            if (evt.type === "complete") {
              setSalesKit(evt.result);
              setKitLoading(false);
              return;
            }
            if (evt.type === "error") {
              setKitLoading(false);
              return;
            }
          } catch {}
        }
      }
    } catch {}
    setKitLoading(false);
  };

  const sendEmail = async () => {
    if (!brief) return;
    setEmailSending(true);
    setEmailError("");
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
      const res = await fetch("/api/send-kit-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business,
          lead,
          salesKit,
          contacts,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setKitEmailSent(true);
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
    { key: "email" as const, label: "Outreach Email" },
    { key: "meeting" as const, label: "Meeting Prep" },
    { key: "kit" as const, label: "Marketing Kit" },
  ];

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
          STEP 3
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#f0f0f0", marginBottom: 20 }}>
          Sales Kit
        </div>

        {/* Target account */}
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>
          TARGET ACCOUNT
        </div>
        <div style={{
          background: "#1a1a1a", border: "1px solid #2a2a2a",
          borderRadius: 8, padding: "10px 12px", marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f0" }}>{lead.name}</div>
          <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{lead.category} • {lead.city}</div>
          {lead.url && (
            <a href={lead.url} target="_blank" rel="noopener" style={{ fontSize: 10, color: "#5b8af5", textDecoration: "none", display: "block", marginTop: 4 }}>
              {lead.url.replace(/^https?:\/\//, "").slice(0, 35)}
            </a>
          )}
          {lead.email && (
            <div style={{ fontSize: 10, color: "#3ecf8e", marginTop: 3 }}>✉ {lead.email}</div>
          )}
          {lead.summary && (
            <div style={{ fontSize: 11, color: "#888", marginTop: 6, lineHeight: 1.4 }}>
              {lead.summary.slice(0, 120)}{lead.summary.length > 120 ? "..." : ""}
            </div>
          )}
        </div>

        {/* Contacts */}
        {contacts.length > 0 && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>
              CONTACTS
            </div>
            {contacts.map((c, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 0", borderBottom: i < contacts.length - 1 ? "1px solid #1e1e1e" : "none",
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: "50%",
                  background: "linear-gradient(135deg, #5b8af5, #3ecf8e)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700, color: "#fff",
                }}>
                  {c.name.charAt(0)}
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#f0f0f0" }}>{c.name}</div>
                  <div style={{ fontSize: 10, color: "#666" }}>{c.title}</div>
                </div>
              </div>
            ))}
          </>
        )}

        <div style={{ height: 1, background: "#1e1e1e", margin: "16px 0" }} />

        {/* Memories used */}
        {brief?.memoriesUsed && brief.memoriesUsed.length > 0 && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>
              MEMORIES USED
            </div>
            {brief.memoriesUsed.map((m, i) => (
              <div key={i} style={{
                fontSize: 11, color: "#3ecf8e", padding: "3px 8px",
                background: "#0e1e16", border: "1px solid #2a4a37",
                borderRadius: 10, marginBottom: 4,
              }}>
                {m}
              </div>
            ))}
          </>
        )}

        <div style={{ marginTop: "auto", paddingTop: 20, borderTop: "1px solid #1e1e1e" }}>
          <button onClick={onBack} style={{
            background: "none", border: "none", color: "#3a3a3a", fontSize: 13, cursor: "pointer",
          }}>← Back to Target Accounts</button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, height: "100%", overflowY: "auto", padding: "32px 40px" }}>
        {loading ? (
          <div style={{ textAlign: "center", paddingTop: 80 }}>
            <div style={{
              display: "inline-block", width: 20, height: 20,
              border: "2px solid rgba(255,255,255,0.25)",
              borderTopColor: "#fff", borderRadius: "50%",
              animation: "spin 0.7s linear infinite",
              marginBottom: 16,
            }} />
            <p style={{ fontSize: 15, color: "#f0f0f0", marginBottom: 8 }}>{progress.message}</p>
            <p style={{ fontSize: 12, color: "#555" }}>{progress.detail}</p>
            <div style={{ maxWidth: 300, margin: "16px auto", height: 2, background: "#222", borderRadius: 2 }}>
              <div style={{
                height: "100%", background: "#f0f0f0", borderRadius: 2,
                width: `${progress.pct}%`, transition: "width 0.6s ease",
              }} />
            </div>
          </div>
        ) : brief ? (
          <>
            {/* Tabs */}
            <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "1px solid #2a2a2a" }}>
              {tabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{
                    background: "none", border: "none",
                    padding: "12px 20px", fontSize: 14, fontWeight: 500,
                    color: tab === t.key ? "#f0f0f0" : "#666",
                    borderBottom: tab === t.key ? "2px solid #f0f0f0" : "2px solid transparent",
                    cursor: "pointer", fontFamily: "'Inter', sans-serif",
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
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 12 }}>
                    COMPANY CONTACTS
                  </div>
                  {contacts.length > 0 ? (
                    <div style={{ background: "#1c1c1c", border: "1px solid #2a2a2a", borderRadius: 8, padding: 16 }}>
                      {contacts.map((c, i) => (
                        <div key={i} style={{
                          display: "flex", alignItems: "center", gap: 12,
                          padding: "10px 0",
                          borderBottom: i < contacts.length - 1 ? "1px solid #222" : "none",
                        }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: "50%",
                            background: "linear-gradient(135deg, #5b8af5, #3ecf8e)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0,
                          }}>
                            {(c.name || "?").charAt(0)}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 500, color: "#f0f0f0" }}>{c.name}</div>
                            <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{c.title}</div>
                          </div>
                          {c.linkedinUrl && (
                            <a
                              href={c.linkedinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                fontSize: 11, color: "#5b8af5", textDecoration: "none",
                                padding: "4px 10px", border: "1px solid #5b8af533",
                                borderRadius: 4, fontWeight: 500,
                              }}
                            >
                              LinkedIn ↗
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{
                      background: "#1c1c1c", border: "1px solid #2a2a2a",
                      borderRadius: 8, padding: "20px", textAlign: "center",
                    }}>
                      <div style={{ fontSize: 13, color: "#555" }}>Searching for decision makers...</div>
                      <div style={{
                        width: 16, height: 16, border: "2px solid #5b8af5",
                        borderTopColor: "transparent", borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                        margin: "10px auto 0",
                      }} />
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === "email" && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>
                    SUBJECT
                  </div>
                  <div style={{
                    background: "#1c1c1c", border: "1px solid #2a2a2a",
                    borderRadius: 8, padding: "12px 16px", fontSize: 14, color: "#f0f0f0",
                  }}>
                    {brief.outreachEmailSubject}
                  </div>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>
                    BODY
                  </div>
                  <div style={{
                    background: "#1c1c1c", border: "1px solid #2a2a2a",
                    borderRadius: 8, padding: "16px 20px", fontSize: 14, color: "#ccc",
                    lineHeight: 1.7, whiteSpace: "pre-wrap",
                  }}>
                    {brief.outreachEmailBody}
                  </div>
                </div>

                {/* Send email */}
                <div style={{
                  background: "#161616", border: "1px solid #2a2a2a",
                  borderRadius: 10, padding: "16px 20px", marginTop: 24,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 10 }}>
                    SEND VIA RESEND
                  </div>
                  {emailSent ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "#3ecf8e", fontSize: 16 }}>✓</span>
                      <span style={{ fontSize: 14, color: "#3ecf8e" }}>Email sent successfully!</span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div style={{
                        flex: 1, background: "#1c1c1c", border: "1px solid #2a2a2a",
                        borderRadius: 8, padding: "10px 14px", fontSize: 14, color: "#f0f0f0",
                        fontFamily: "'Inter', sans-serif",
                      }}>
                        To: {emailTo}
                      </div>
                      <button
                        onClick={sendEmail}
                        disabled={emailSending}
                        style={{
                          background: "#5b8af5", color: "#fff", border: "none",
                          borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600,
                          cursor: emailSending ? "not-allowed" : "pointer",
                          opacity: emailSending ? 0.5 : 1,
                          fontFamily: "'Inter', sans-serif", whiteSpace: "nowrap",
                        }}
                      >
                        {emailSending ? "Sending..." : "Send Email"}
                      </button>
                    </div>
                  )}
                  {emailError && (
                    <p style={{ fontSize: 12, color: "#f5454a", marginTop: 8 }}>{emailError}</p>
                  )}
                </div>
              </div>
            )}

            {tab === "meeting" && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <Section title="Meeting Preparation" content={brief.meetingPrep} />

                <div style={{ marginTop: 24 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 12 }}>
                    DISCOVERY QUESTIONS
                  </div>
                  {brief.discoveryQuestions.map((q, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "flex-start", gap: 10,
                      padding: "10px 0", borderBottom: i < brief.discoveryQuestions.length - 1 ? "1px solid #1e1e1e" : "none",
                    }}>
                      <span style={{ color: "#5b8af5", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                      <span style={{ fontSize: 14, color: "#ccc", lineHeight: 1.5 }}>{q}</span>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 24 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 12 }}>
                    OBJECTIONS & RESPONSES
                  </div>
                  {brief.objectionsAndResponses.map((item, i) => (
                    <div key={i} style={{
                      background: "#1c1c1c", border: "1px solid #2a2a2a",
                      borderRadius: 8, padding: "14px 16px", marginBottom: 8,
                    }}>
                      <div style={{ fontSize: 13, color: "#f5454a", fontWeight: 600, marginBottom: 6 }}>
                        Objection: {item.objection}
                      </div>
                      <div style={{ fontSize: 13, color: "#3ecf8e", lineHeight: 1.5 }}>
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
                      border: "2px solid rgba(255,255,255,0.25)",
                      borderTopColor: "#fff", borderRadius: "50%",
                      animation: "spin 0.7s linear infinite",
                      marginBottom: 16,
                    }} />
                    <p style={{ fontSize: 15, color: "#f0f0f0", marginBottom: 8 }}>{kitProgress.message}</p>
                    <p style={{ fontSize: 12, color: "#555" }}>{kitProgress.detail}</p>
                    <div style={{ maxWidth: 300, margin: "16px auto", height: 2, background: "#222", borderRadius: 2 }}>
                      <div style={{
                        height: "100%", background: "linear-gradient(90deg, #5b8af5, #3ecf8e)", borderRadius: 2,
                        width: `${kitProgress.pct}%`, transition: "width 0.6s ease",
                      }} />
                    </div>
                  </div>
                ) : salesKit ? (
                  <>
                    {/* Account Brief */}
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>
                        ACCOUNT BRIEF
                      </div>
                      <div style={{
                        background: "#1c1c1c", border: "1px solid #2a2a2a",
                        borderRadius: 8, padding: "16px 20px", fontSize: 14, color: "#ccc", lineHeight: 1.7,
                      }}>
                        {salesKit.accountBrief}
                      </div>
                    </div>

                    {/* Sales Kit Results */}
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>
                        WHY RELEVANT NOW
                      </div>
                      <div style={{
                        background: "#1c1c1c", border: "1px solid #2a2a2a",
                        borderRadius: 8, padding: "16px 20px", fontSize: 14, color: "#ccc", lineHeight: 1.7,
                      }}>
                        {salesKit.whyRelevantNow}
                      </div>
                    </div>

                    <div style={{ marginBottom: 24 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>
                        SUGGESTED BD ANGLE
                      </div>
                      <div style={{
                        background: "#0e1e16", border: "1px solid #2a4a37",
                        borderRadius: 8, padding: "12px 16px", fontSize: 14, color: "#3ecf8e", fontWeight: 500,
                      }}>
                        {salesKit.suggestedAngle}
                      </div>
                    </div>

                    {/* Synergies Table */}
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 12 }}>
                        TOP SYNERGIES
                      </div>
                      <div style={{ border: "1px solid #2a2a2a", borderRadius: 8, overflow: "hidden" }}>
                        <div style={{
                          display: "grid", gridTemplateColumns: "1fr 1fr 1.5fr",
                          background: "#161616", padding: "10px 14px",
                          borderBottom: "1px solid #2a2a2a",
                        }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#5b8af5" }}>Seller Product</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#f5454a" }}>Prospect Pain</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#3ecf8e" }}>Evidence</span>
                        </div>
                        {salesKit.synergies.map((s, i) => (
                          <div key={i} style={{
                            display: "grid", gridTemplateColumns: "1fr 1fr 1.5fr",
                            padding: "10px 14px", background: "#1c1c1c",
                            borderBottom: i < salesKit.synergies.length - 1 ? "1px solid #222" : "none",
                          }}>
                            <span style={{ fontSize: 12, color: "#ccc" }}>{s.sellerProduct}</span>
                            <span style={{ fontSize: 12, color: "#ccc" }}>{s.prospectPain}</span>
                            <span style={{ fontSize: 12, color: "#888", fontStyle: "italic" }}>{s.evidence}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* HTML One-Pager Preview */}
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444" }}>
                          HTML MARKETING ONE-PAGER
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <a
                            href={salesKit.onePagerUrl}
                            target="_blank"
                            rel="noopener"
                            style={{
                              background: "#5b8af5", color: "#fff", border: "none",
                              borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600,
                              textDecoration: "none", display: "inline-block",
                            }}
                          >
                            Open Full Page ↗
                          </a>
                          <a
                            href={salesKit.onePagerUrl}
                            download={`${business.companyName}-${lead.name}-kit.html`}
                            style={{
                              background: "#3ecf8e", color: "#0a0d14", border: "none",
                              borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600,
                              textDecoration: "none", display: "inline-block",
                            }}
                          >
                            Download HTML
                          </a>
                        </div>
                      </div>
                      <div style={{
                        border: "1px solid #2a2a2a", borderRadius: 8, overflow: "hidden",
                        background: "#fff", height: 500,
                      }}>
                        <iframe
                          src={salesKit.onePagerUrl}
                          style={{ width: "100%", height: "100%", border: "none" }}
                          title="Marketing One-Pager Preview"
                        />
                      </div>
                    </div>

                    {/* Kit-generated Outreach Email */}
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>
                        KIT OUTREACH EMAIL
                      </div>
                      <div style={{
                        background: "#1c1c1c", border: "1px solid #2a2a2a",
                        borderRadius: 8, padding: "16px 20px", marginBottom: 12,
                      }}>
                        <div style={{ fontSize: 12, color: "#5b8af5", fontWeight: 600, marginBottom: 8 }}>
                          Subject: {salesKit.outreachEmailSubject}
                        </div>
                        <div style={{ fontSize: 14, color: "#ccc", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                          {salesKit.outreachEmailBody}
                        </div>
                      </div>

                      {/* Send Kit Email */}
                      <div style={{
                        background: "#161616", border: "1px solid #2a2a2a",
                        borderRadius: 10, padding: "16px 20px", marginTop: 16,
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 10 }}>
                          SEND KIT EMAIL + ONE-PAGER LINK
                        </div>
                        {kitEmailSent ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ color: "#3ecf8e", fontSize: 16 }}>✓</span>
                            <span style={{ fontSize: 14, color: "#3ecf8e" }}>Kit email sent to {emailTo}!</span>
                          </div>
                        ) : (
                          <div>
                            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                              <div style={{
                                flex: 1, background: "#1c1c1c", border: "1px solid #2a2a2a",
                                borderRadius: 8, padding: "10px 14px", fontSize: 14, color: "#f0f0f0",
                                fontFamily: "'Inter', sans-serif",
                              }}>
                                To: {emailTo}
                              </div>
                              <button
                                onClick={sendKitEmail}
                                disabled={kitEmailSending}
                                style={{
                                  background: "linear-gradient(135deg, #5b8af5, #3ecf8e)", color: "#fff", border: "none",
                                  borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600,
                                  cursor: kitEmailSending ? "not-allowed" : "pointer",
                                  opacity: kitEmailSending ? 0.5 : 1,
                                  fontFamily: "'Inter', sans-serif", whiteSpace: "nowrap",
                                }}
                              >
                                {kitEmailSending ? "Sending..." : "Send Kit Email"}
                              </button>
                            </div>
                            <p style={{ fontSize: 11, color: "#555", marginTop: 8 }}>
                              Sends a branded native HTML email with synergies, contacts, and proposal link
                            </p>
                            {kitEmailError && (
                              <p style={{ fontSize: 12, color: "#f5454a", marginTop: 8 }}>{kitEmailError}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ textAlign: "center", paddingTop: 60 }}>
                    <div style={{ marginBottom: 16 }}>
                      <div style={{
                        width: 56, height: 56, margin: "0 auto 16px",
                        background: "linear-gradient(135deg, #5b8af5, #3ecf8e)",
                        borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 24,
                      }}>
                        📄
                      </div>
                      <h3 style={{ fontSize: 18, fontWeight: 600, color: "#f0f0f0", marginBottom: 8 }}>
                        Generate Marketing Kit
                      </h3>
                      <p style={{ fontSize: 14, color: "#666", maxWidth: 400, margin: "0 auto 24px", lineHeight: 1.6 }}>
                        Create a branded HTML one-pager with synergy analysis, proof points, and a personalized pitch — styled to match {business.companyName}'s brand.
                      </p>
                    </div>
                    <button
                      onClick={generateSalesKit}
                      style={{
                        background: "linear-gradient(135deg, #5b8af5, #3ecf8e)",
                        color: "#fff", border: "none",
                        borderRadius: 8, padding: "12px 28px", fontSize: 15, fontWeight: 600,
                        cursor: "pointer", fontFamily: "'Inter', sans-serif",
                      }}
                    >
                      Generate Sales Kit
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: "center", paddingTop: 80 }}>
            <p style={{ color: "#555" }}>Brief generation failed. Please try again.</p>
            <button onClick={generateBrief} style={{
              marginTop: 16, background: "#f0f0f0", color: "#0f0f0f", border: "none",
              borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer",
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
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>
        {title.toUpperCase()}
      </div>
      <div style={{
        background: "#1c1c1c", border: "1px solid #2a2a2a",
        borderRadius: 8, padding: "16px 20px", fontSize: 14, color: "#ccc", lineHeight: 1.7,
      }}>
        {content}
      </div>
    </div>
  );
}
