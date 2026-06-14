import { useIsMobile } from "../hooks/useMobile";

export default function TrialEndedPage({ email, onSignOut }: { email?: string; onSignOut: () => void }) {
  const isMobile = useIsMobile();
  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "var(--bg)", padding: isMobile ? "24px 16px" : "24px", textAlign: "center",
    }}>
      <div style={{
        width: "100%", maxWidth: 440,
        background: "var(--surface)", border: "1px solid var(--line)",
        borderRadius: "var(--radius-xl)", padding: isMobile ? "28px 22px" : "40px 36px",
        boxShadow: "var(--shadow-1)",
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.18em",
          textTransform: "uppercase", color: "var(--gold-text)", marginBottom: 12,
        }}>
          Trial ended
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--ink)", margin: "0 0 12px", letterSpacing: "-0.02em" }}>
          Your 7-day free trial has ended
        </h1>
        <p style={{ fontSize: 14, color: "var(--ink-3)", lineHeight: 1.6, margin: "0 0 28px" }}>
          Thanks for trying Biks.ai. Upgrade to keep generating company analyses, leads, and marketing kits.
        </p>

        <button
          disabled
          title="Coming soon"
          style={{
            width: "100%", minHeight: 46,
            background: "var(--action)", color: "var(--action-fg)", border: "none",
            borderRadius: "var(--radius-md)", fontSize: 15, fontWeight: 600,
            opacity: 0.5, cursor: "not-allowed", fontFamily: "var(--font-sans)",
          }}
        >
          Upgrade — coming soon
        </button>
        <p style={{ fontSize: 12, color: "var(--ink-4)", margin: "12px 0 0" }}>
          Want early access? Reach out to the Biks.ai team.
        </p>

        <div style={{ borderTop: "1px solid var(--line)", marginTop: 24, paddingTop: 18 }}>
          {email && <div style={{ fontSize: 12, color: "var(--ink-4)", marginBottom: 8 }}>Signed in as {email}</div>}
          <button
            onClick={onSignOut}
            style={{ background: "none", border: "none", color: "var(--ink-3)", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "var(--font-sans)" }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
