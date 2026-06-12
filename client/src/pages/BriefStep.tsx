import { useState, useEffect } from "react";
import type { BusinessProfile, Lead, MemoryItem, MeetingBrief, Contact } from "../App";

interface Props {
  business: BusinessProfile;
  lead: Lead;
  memories: MemoryItem[];
  brief: MeetingBrief | null;
  setBrief: (b: MeetingBrief | null) => void;
  contacts: Contact[];
  onBack: () => void;
}

export default function BriefStep({ business, lead, memories, brief, setBrief, contacts, onBack }: Props) {
  const [tab, setTab] = useState<"account" | "email" | "meeting">("account");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ pct: 0, message: "", detail: "" });
  const emailTo = "ngurah.linggih@gmail.com";
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState("");

  useEffect(() => {
    if (!brief) generateBrief();
  }, []);

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

  const tabs = [
    { key: "account" as const, label: "Account Brief" },
    { key: "email" as const, label: "Outreach Email" },
    { key: "meeting" as const, label: "Meeting Prep" },
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
          STEP 5
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
          }}>← Back to Accounts</button>
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
