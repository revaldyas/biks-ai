import { useState, type CSSProperties } from "react";
import { supabase } from "../lib/supabase";
import { useIsMobile } from "../hooks/useMobile";

export default function LoginModal({ onClose }: { onClose: () => void }) {
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const submit = async () => {
    if (!email.trim() || !password) return;
    setLoading(true); setError(""); setInfo("");
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        // Fire-and-forget admin notification — never block or break the signup flow.
        fetch("/api/notify-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim() }),
        }).catch(() => {});
        setInfo("Check your inbox to confirm your email, then come back and sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        // Parent closes the modal on the auth state change.
      }
    } catch (e: any) {
      setError(e?.message || "Something went wrong. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "var(--scrim)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: isMobile ? "16px" : "24px",
        animation: "fadeIn 0.15s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative", width: "100%", maxWidth: 400,
          background: "var(--surface-2)", border: "1px solid var(--line)",
          borderRadius: "var(--radius-xl)", padding: isMobile ? "26px 20px" : "32px 28px",
          boxShadow: "var(--shadow-pop)",
        }}
      >
        <button
          onClick={onClose} aria-label="Close"
          style={{
            position: "absolute", top: 14, right: 16, background: "none", border: "none",
            fontSize: 20, lineHeight: 1, color: "var(--ink-3)", cursor: "pointer",
          }}
        >×</button>

        <div style={{ fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--sage-strong)", marginBottom: 8 }}>
          {mode === "signin" ? "Welcome back" : "Get started"}
        </div>
        <h2 style={{ fontSize: 21, fontWeight: 600, color: "var(--ink)", margin: "0 0 6px", letterSpacing: "-0.02em" }}>
          {mode === "signin" ? "Sign in to continue" : "Create your account"}
        </h2>
        <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 22px", lineHeight: 1.5 }}>
          {mode === "signup" ? "Start your 7-day free trial — no card required." : "Sign in to analyze a website and save your work."}
        </p>

        <label style={labelStyle}>Email</label>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="you@company.com" autoComplete="email" autoFocus
          style={inputStyle}
        />
        <div style={{ height: 12 }} />
        <label style={labelStyle}>Password</label>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          style={inputStyle}
        />

        {error && <p style={{ fontSize: 12, color: "var(--danger-text)", margin: "12px 0 0" }}>{error}</p>}
        {info && <p style={{ fontSize: 12, color: "var(--sage-strong)", margin: "12px 0 0", lineHeight: 1.5 }}>{info}</p>}

        <button
          onClick={submit}
          disabled={loading || !email.trim() || !password}
          style={{
            width: "100%", marginTop: 20, minHeight: 46,
            background: "var(--action)", color: "var(--action-fg)", border: "none",
            borderRadius: "var(--radius-md)", fontSize: 15, fontWeight: 600,
            cursor: (loading || !email.trim() || !password) ? "not-allowed" : "pointer",
            opacity: (loading || !email.trim() || !password) ? 0.5 : 1,
            fontFamily: "var(--font-sans)",
          }}
        >
          {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "var(--ink-3)" }}>
          {mode === "signin" ? "New to Biks.ai? " : "Already have an account? "}
          <button
            onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setInfo(""); }}
            style={{ background: "none", border: "none", color: "var(--sage-strong)", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13, padding: 0 }}
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: "block", fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)",
  letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 6,
};
const inputStyle: CSSProperties = {
  width: "100%", background: "var(--surface)", border: "1px solid var(--line)",
  borderRadius: "var(--radius-md)", padding: "12px 14px", fontSize: 16, color: "var(--ink)",
  outline: "none", fontFamily: "var(--font-sans)",
};
