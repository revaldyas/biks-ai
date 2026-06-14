import { useState, type CSSProperties } from "react";
import { supabase } from "../lib/supabase";
import { useIsMobile } from "../hooks/useMobile";

export default function LoginPage() {
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
        const { error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        // If "Confirm email" is off in Supabase, the user is signed in immediately;
        // otherwise they must confirm via email.
        setInfo("Account created. If sign-in doesn't proceed, check your email to confirm.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (e: any) {
      setError(e?.message || "Something went wrong. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "var(--bg)", padding: isMobile ? "24px 16px" : "24px",
    }}>
      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
        <span style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 18, color: "var(--ink)", letterSpacing: "-0.01em" }}>Biks<span style={{ color: "var(--sage-strong)" }}>.ai</span></span>
      </div>

      <div style={{
        width: "100%", maxWidth: 380,
        background: "var(--surface)", border: "1px solid var(--line)",
        borderRadius: "var(--radius-xl)", padding: isMobile ? "24px 20px" : "32px 28px",
        boxShadow: "var(--shadow-1)",
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.18em",
          textTransform: "uppercase", color: "var(--sage-strong)", marginBottom: 8,
        }}>
          {mode === "signin" ? "Welcome back" : "Get started"}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "var(--ink)", margin: "0 0 6px", letterSpacing: "-0.02em" }}>
          {mode === "signin" ? "Sign in to Biks.ai" : "Create your account"}
        </h1>
        <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 22px", lineHeight: 1.5 }}>
          {mode === "signup" ? "Start your 7-day free trial — no card required." : "Continue to your sales agent."}
        </p>

        <label style={labelStyle}>Email</label>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="you@company.com" autoComplete="email"
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
        {info && <p style={{ fontSize: 12, color: "var(--sage-strong)", margin: "12px 0 0" }}>{info}</p>}

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

        <div style={{ textAlign: "center", marginTop: 18, fontSize: 13, color: "var(--ink-3)" }}>
          {mode === "signin" ? "New to Biks.ai? " : "Already have an account? "}
          <button
            onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setInfo(""); }}
            style={{ background: "none", border: "none", color: "var(--sage-strong)", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13, padding: 0 }}
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 24, textAlign: "center" }}>
        Powered by Manus, Exa and Mem0
      </p>
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: "block", fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)",
  letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 6,
};

const inputStyle: CSSProperties = {
  width: "100%", background: "var(--surface-2)", border: "1px solid var(--line)",
  borderRadius: "var(--radius-md)", padding: "12px 14px", fontSize: 16, color: "var(--ink)",
  outline: "none", fontFamily: "var(--font-sans)",
};
