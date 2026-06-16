import { useState, useEffect } from "react";
import type { BusinessProfile } from "../App";
import { useIsMobile } from "../hooks/useMobile";
import Reveal from "../components/Reveal";
import { apiFetch } from "../lib/api";

interface Props {
  onComplete: (data: BusinessProfile) => void;
  onSignOut?: () => void;
  trialDaysLeft?: number | null;
  authed?: boolean;
  onRequireAuth?: () => void;
  onOpenHistory?: () => void;
}

export default function HeroStep({ onComplete, onSignOut, trialDaysLeft, authed = true, onRequireAuth, onOpenHistory }: Props) {
  const isMobile = useIsMobile();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ pct: 0, message: "", detail: "" });
  const [error, setError] = useState("");
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    setReduceMotion(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  }, []);

  const handleAnalyze = async () => {
    if (!url.trim()) return;
    // Gate the first real action behind login (landing stays public).
    if (!authed) { onRequireAuth?.(); return; }
    setLoading(true);
    setError("");
    setProgress({ pct: 0, message: "Starting analysis...", detail: "" });

    try {
      const res = await apiFetch("/api/analyze-website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}` }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Analysis failed");
        setLoading(false);
        return;
      }

      const { taskId } = await res.json();
      setProgress({ pct: 30, message: "AI agent started...", detail: "Generating business profile" });

      const startTime = Date.now();
      while (true) {
        if (Date.now() - startTime > 180_000) {
          setError("Analysis timed out after 3 minutes. Please try again.");
          setLoading(false);
          break;
        }
        await new Promise(r => setTimeout(r, 3000));
        try {
          const pollRes = await apiFetch(`/api/poll-task?id=${taskId}`);
          const status = await pollRes.json();
          if (status.status === "done") {
            onComplete(status.result);
            return;
          }
          if (status.status === "error") {
            setError(status.message || "Analysis failed");
            setLoading(false);
            break;
          }
          setProgress({ pct: status.pct || 50, message: status.message || "Processing...", detail: status.detail || "" });
        } catch {}
      }
    } catch (e: any) {
      setError(e.message || "Analysis failed");
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      background: "var(--bg)",
    }}>
      {/* Navbar */}
      <div style={{ padding: isMobile ? "18px 16px" : "28px 36px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 17, color: "var(--ink)", letterSpacing: "-0.01em" }}>
            Biks.ai
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12 }}>
          {typeof trialDaysLeft === "number" && (
            <span style={{
              fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.06em",
              color: "var(--gold-text)", background: "var(--surface)", border: "1px solid var(--line)",
              borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap",
            }}>
              {trialDaysLeft}d left
            </span>
          )}
          {onOpenHistory && (
            <button
              onClick={onOpenHistory}
              style={{ background: "none", border: "none", fontSize: 13, fontWeight: 500, color: "var(--ink-3)", cursor: "pointer", fontFamily: "var(--font-sans)" }}
            >
              History
            </button>
          )}
          {onSignOut ? (
            <button
              onClick={onSignOut}
              style={{ background: "none", border: "none", fontSize: 13, fontWeight: 500, color: "var(--ink-3)", cursor: "pointer", fontFamily: "var(--font-sans)" }}
            >
              Sign out
            </button>
          ) : !authed && (
            <button
              onClick={() => onRequireAuth?.()}
              style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: "var(--radius-md)", padding: "6px 14px", fontSize: 13, fontWeight: 600, color: "var(--ink)", cursor: "pointer", fontFamily: "var(--font-sans)" }}
            >
              Sign in
            </button>
          )}
        </div>
      </div>

      {/* Hero — full-bleed video with parchment overlay + floating capability chips */}
      <section style={{ position: "relative", width: "100%", overflow: "hidden", minHeight: isMobile ? 600 : 680, display: "flex", alignItems: "center" }}>
        {/* Background video */}
        <video
          autoPlay={!reduceMotion} muted loop playsInline preload="metadata"
          poster="/hero-woman-poster.jpg?v=5"
          aria-hidden="true"
          disablePictureInPicture
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: isMobile ? "center 32%" : "center 34%" }}
        >
          <source src="/hero-woman.webm?v=5" type="video/webm" />
          <source src="/hero-woman.mp4?v=5" type="video/mp4" />
        </video>

        {/* Parchment legibility overlay — keeps the left copy readable, lets her show on the right */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 1,
          background: isMobile
            ? "linear-gradient(to bottom, rgba(237,232,223,0.90) 0%, rgba(237,232,223,0.66) 42%, rgba(237,232,223,0.40) 100%)"
            : "linear-gradient(to right, var(--bg) 0%, rgba(237,232,223,0.92) 30%, rgba(237,232,223,0.42) 52%, rgba(237,232,223,0.06) 78%, rgba(237,232,223,0) 100%)",
        }} />


        {/* Content */}
        <div style={{ position: "relative", zIndex: 3, width: "100%", maxWidth: 1180, margin: "0 auto", padding: isMobile ? "44px 16px 40px" : "72px 24px" }}>
          <div style={{ maxWidth: isMobile ? "100%" : 560, margin: isMobile ? "0 auto" : 0, display: "flex", flexDirection: "column", alignItems: isMobile ? "center" : "flex-start", textAlign: isMobile ? "center" : "left" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--sage-strong)", marginBottom: 16, fontFamily: "var(--font-mono)" }}>
              Biks.AI Sales Agent
            </div>
            <RotatingHero isMobile={isMobile} />
            <p style={{ fontSize: isMobile ? 15 : 18, color: "var(--ink-2)", lineHeight: 1.5, marginBottom: isMobile ? 24 : 32, maxWidth: 460 }}>
              Turn your website into your next sales pipeline.
            </p>

            {/* Input */}
            <div style={{ maxWidth: 460, width: "100%", position: "relative" }}>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !loading) handleAnalyze(); }}
                placeholder="Enter your website URL"
                disabled={loading}
                style={{
                  width: "100%",
                  background: "var(--surface-2)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-md)",
                  padding: isMobile ? "16px 110px 16px 16px" : "16px 120px 16px 18px",
                  fontSize: 16,
                  color: "var(--ink)",
                  outline: "none",
                  fontFamily: "var(--font-sans)",
                  boxShadow: "var(--shadow-2)",
                }}
              />
              <button
                onClick={handleAnalyze}
                disabled={loading || !url.trim()}
                style={{
                  position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)",
                  background: "var(--action)", color: "var(--action-fg)", border: "none",
                  borderRadius: "var(--radius-md)", padding: isMobile ? "10px 16px" : "11px 20px",
                  fontSize: 14, fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading || !url.trim() ? 0.4 : 1,
                  fontFamily: "var(--font-sans)", transition: "opacity 0.15s",
                }}
              >
                {loading ? "Analyzing..." : "Analyze"}
              </button>
            </div>

            <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 12, fontFamily: "var(--font-sans)" }}>
              Start free · 7-day trial · no card required
            </p>


            {/* Progress */}
            {loading && (
              <div style={{ maxWidth: 460, width: "100%", marginTop: 22, animation: "fadeIn 0.3s ease" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: "var(--ink)" }}>{progress.message}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{progress.pct}%</span>
                </div>
                <div style={{ height: 2, background: "var(--surface-sunk)", borderRadius: 2 }}>
                  <div style={{ height: "100%", background: "var(--action)", borderRadius: 2, width: `${progress.pct}%`, transition: "width 0.6s ease" }} />
                </div>
                {progress.detail && <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>{progress.detail}</p>}
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{ maxWidth: 460, width: "100%", marginTop: 16, padding: "12px 16px", background: "var(--danger-wash)", border: "1px solid var(--danger)", borderRadius: "var(--radius-md)" }}>
                <span style={{ fontSize: 13, color: "var(--danger-text)" }}>{error}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Capability flow — the five steps, below the video */}
      <CapabilityFlow isMobile={isMobile} />

      {/* How it works */}
      <Reveal>
      <div style={{ width: "100%", maxWidth: 1040, margin: "0 auto", padding: isMobile ? "28px 16px 8px" : "56px 24px 24px" }}>
        <div style={{ textAlign: "center", marginBottom: isMobile ? 24 : 40 }}>
          <div style={{ fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--sage-strong)", marginBottom: 12 }}>
            How it works
          </div>
          <h2 style={{ fontSize: isMobile ? 24 : 30, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.02em", margin: 0 }}>
            From homepage to outreach in three steps
          </h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 12 : 16 }}>
          {[
            { n: "01", label: "Analyze", title: "Understand your business", desc: "Biks reads your website and builds a sharp profile — what you sell, who buys, and three adjacent markets to expand into." },
            { n: "02", label: "Find leads", title: "Surface real prospects", desc: "In-market companies in your chosen city, each with a relevance read and verified decision-makers — no guessed names." },
            { n: "03", label: "Marketing kit", title: "Send the right message", desc: "A personalized outreach email and angle for each prospect, grounded in their actual site and pain points." },
          ].map(s => (
            <div key={s.n} style={{
              background: "var(--surface)", border: "1px solid var(--line)",
              borderRadius: "var(--radius-xl)", padding: isMobile ? "20px 18px" : "26px 24px",
            }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--sage-strong)", fontFamily: "var(--font-mono)", lineHeight: 1 }}>{s.n}</div>
              <div style={{ fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)", margin: "14px 0 6px" }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>{s.title}</div>
              <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.6 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      </Reveal>

      {/* Showcase — feature cards with imagery */}
      <Reveal>
        <div style={{ width: "100%", maxWidth: 1040, margin: "0 auto", padding: isMobile ? "28px 16px 8px" : "56px 24px 24px" }}>
          <div style={{ textAlign: "center", marginBottom: isMobile ? 24 : 40 }}>
            <div style={{ fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--sage-strong)", marginBottom: 12 }}>
              Clarity and control
            </div>
            <h2 style={{ fontSize: isMobile ? 24 : 30, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.02em", margin: 0 }}>
              Every part of your pipeline, in one place
            </h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 12 : 16 }}>
            {[
              { img: "/showcase-1.jpg", title: "Total market visibility", desc: "Your whole expansion picture: company profile, three adjacent markets, and where the demand is." },
              { img: "/showcase-2.jpg", title: "Verified prospects", desc: "Real companies and decision-makers in your target city — verified or omitted, never fabricated." },
              { img: "/showcase-3.jpg", title: "Outreach ready to send", desc: "A personalized email and angle for each prospect, grounded in their actual website." },
            ].map((c, i) => (
              <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-xl)", overflow: "hidden" }}>
                <div style={{ height: 150, background: "var(--sage-wash)" }}>
                  <img
                    src={c.img} alt="" loading="lazy"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    style={{ width: "100%", height: "100%", objectFit: "cover", filter: "saturate(1.03) contrast(1.01)" }}
                  />
                </div>
                <div style={{ padding: isMobile ? "18px 18px" : "22px 22px" }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>{c.title}</div>
                  <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.6 }}>{c.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      {/* Impact */}
      <Reveal>
      <div style={{ width: "100%", background: "var(--surface)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", marginTop: isMobile ? 24 : 44, padding: isMobile ? "32px 16px" : "48px 24px" }}>
        <div style={{ maxWidth: 1040, margin: "0 auto" }}>
          <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--sage-strong)", marginBottom: isMobile ? 22 : 32 }}>
            What you get
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: isMobile ? 12 : 16 }}>
            {[
              { n: "3", l: "adjacent markets per analysis" },
              { n: "~2 min", l: "from URL to company brief" },
              { n: "0", l: "fabricated leads or contacts" },
              { n: "1 click", l: "from accepted lead to outreach email" },
            ].map((s, i) => (
              <div key={i} style={{ textAlign: "center", padding: isMobile ? "8px 4px" : "8px" }}>
                <div style={{ fontSize: isMobile ? 26 : 34, fontWeight: 700, color: "var(--ink)", letterSpacing: "-0.02em" }}>{s.n}</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.4, marginTop: 6 }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      </Reveal>

      {/* Why it's different */}
      <Reveal>
      <div style={{ width: "100%", maxWidth: 1040, margin: "0 auto", padding: isMobile ? "32px 16px 8px" : "56px 24px 24px" }}>
        <div style={{ textAlign: "center", marginBottom: isMobile ? 24 : 40 }}>
          <div style={{ fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--sage-strong)", marginBottom: 12 }}>
            Why it's different
          </div>
          <h2 style={{ fontSize: isMobile ? 24 : 30, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.02em", margin: 0 }}>
            Built to be trusted, not just fast
          </h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 12 : 16 }}>
          {[
            { icon: "shield", tint: "var(--sage-wash)", title: "Grounded, not guessed", desc: "Verified-or-omitted: Biks shows real companies and contacts, or nothing — never fabricated data." },
            { icon: "compass", tint: "rgba(154, 123, 69, 0.10)", title: "Finds markets you're missing", desc: "It doesn't just list your current customers; it surfaces adjacent segments you can win next." },
            { icon: "spark", tint: "var(--surface)", title: "Learns your taste", desc: "Reject a lead and Biks remembers why, sharpening every future search to your ideal customer." },
          ].map((c, i) => (
            <div key={i} style={{ background: c.tint, border: "1px solid var(--line)", borderRadius: "var(--radius-xl)", padding: isMobile ? "22px 20px" : "28px 24px" }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16, color: "var(--sage-strong)" }}>
                <CardIcon name={c.icon} />
              </div>
              <div style={{ fontSize: 17, fontWeight: 600, color: "var(--ink)", marginBottom: 8 }}>{c.title}</div>
              <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.6 }}>{c.desc}</div>
            </div>
          ))}
        </div>
      </div>

      </Reveal>

      {/* Final CTA */}
      <Reveal>
      <div style={{ width: "100%", maxWidth: 720, margin: "0 auto", textAlign: "center", padding: isMobile ? "32px 16px 8px" : "56px 24px 24px" }}>
        <h2 style={{ fontSize: isMobile ? 26 : 36, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.02em", margin: "0 0 12px", lineHeight: 1.1 }}>
          See what your website is worth.
        </h2>
        <p style={{ fontSize: isMobile ? 15 : 16, color: "var(--ink-3)", lineHeight: 1.6, margin: "0 0 24px" }}>
          Paste your URL and get markets, leads, and outreach in minutes.
        </p>
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          style={{
            background: "var(--action)", color: "var(--action-fg)", border: "none",
            borderRadius: "var(--radius-md)", padding: "14px 28px", fontSize: 15, fontWeight: 600,
            cursor: "pointer", fontFamily: "var(--font-sans)", minHeight: 46,
          }}
        >
          Analyze my website
        </button>
      </div>

      </Reveal>

      {/* Footer */}
      <div style={{
        textAlign: "center",
        padding: "40px 16px 28px",
        fontSize: 12,
        color: "var(--ink-3)",
        fontFamily: "var(--font-sans)",
      }}>
        Powered by Manus, Exa and Mem0
      </div>
    </div>
  );
}

// Main hero: "For business owners who" stays fixed; only the clause below rotates.
const PAINS = [
  "need more leads",
  "want to grow faster",
  "are tired of cold lists",
  "have run out of customers",
  "want warmer outreach",
];

// The five Biks capabilities, in pipeline order. Rendered as a horizontal
// flow bar directly below the hero video (desktop) / a clean numbered list (mobile).
const HERO_STEPS = [
  { label: "Analyze your website" },
  { label: "Discover new markets" },
  { label: "Find real leads" },
  { label: "Verify decision-makers" },
  { label: "Draft outreach" },
];

function BadgeNum({ n }: { n: number }) {
  return (
    <span style={{
      flexShrink: 0,
      width: 26, height: 26, borderRadius: "50%",
      background: "var(--sage-wash)", color: "var(--sage-strong)",
      border: "1px solid var(--line)",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
    }}>
      {String(n).padStart(2, "0")}
    </span>
  );
}

// The capability "flow bar" — sits under the hero, not over the video.
// Desktop: one horizontal strip of numbered steps joined by arrows.
// Mobile: a tidy numbered list.
function CapabilityFlow({ isMobile }: { isMobile: boolean }) {
  const labelStyle = {
    fontSize: isMobile ? 13 : 12, fontWeight: 700, fontFamily: "var(--font-mono)",
    letterSpacing: "0.04em", textTransform: "uppercase" as const, color: "var(--ink-2)",
    whiteSpace: "nowrap" as const,
  };

  if (isMobile) {
    return (
      <Reveal>
        <div style={{ width: "100%", maxWidth: 460, margin: "0 auto", padding: "20px 16px 4px" }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-xl)", overflow: "hidden" }}>
            {HERO_STEPS.map((s, i) => (
              <div key={s.label} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "13px 16px",
                borderBottom: i === HERO_STEPS.length - 1 ? "none" : "1px solid var(--line)",
              }}>
                <BadgeNum n={i + 1} />
                <span style={labelStyle}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    );
  }

  // Desktop: a horizontal stepper — five equal columns, each a numbered badge
  // over a centered label, joined by a connector line. Always one tidy row.
  return (
    <Reveal>
      <div style={{ width: "100%", maxWidth: 1040, margin: "0 auto", padding: "40px 24px 8px" }}>
        <div style={{
          display: "flex", alignItems: "flex-start",
          background: "var(--surface)", border: "1px solid var(--line)",
          borderRadius: "var(--radius-xl)", padding: "22px 24px", boxShadow: "var(--shadow-1)",
        }}>
          {HERO_STEPS.map((s, i) => (
            <div key={s.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
              {/* badge + connector line */}
              <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
                <span style={{ flex: 1, height: 1.5, background: i === 0 ? "transparent" : "var(--line-strong)" }} />
                <BadgeNum n={i + 1} />
                <span style={{ flex: 1, height: 1.5, background: i === HERO_STEPS.length - 1 ? "transparent" : "var(--line-strong)" }} />
              </div>
              <span style={{ ...labelStyle, marginTop: 12, whiteSpace: "normal", maxWidth: 130, lineHeight: 1.35 }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

function RotatingHero({ isMobile }: { isMobile: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI(p => (p + 1) % PAINS.length), 1600);
    return () => clearInterval(id);
  }, []);
  const big = isMobile ? "30px" : "clamp(36px, 5.5vw, 60px)";
  return (
    <h1 style={{ margin: "0 0 16px", maxWidth: 900 }}>
      {/* Fixed line — never moves */}
      <span style={{ display: "block", fontSize: big, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.02em", lineHeight: 1.05 }}>
        For business owners who
      </span>
      {/* Rotating clause — FIXED two-line box. Height is in `em` relative to the
          headline font (fontSize set here), so it always reserves exactly two lines
          regardless of phrase length. The title above and everything below never move;
          only this text changes. */}
      <span style={{ display: "block", fontSize: big, height: "2.2em", overflow: "hidden" }}>
        <span
          key={i}
          style={{
            display: "inline-block", fontSize: big, fontWeight: 600, color: "var(--sage-strong)",
            letterSpacing: "-0.02em", lineHeight: 1.1, opacity: 1, animation: "rise 0.5s ease both",
          }}
        >
          {PAINS[i]}
        </span>
      </span>
    </h1>
  );
}

// Simple stroke icons for the "why it's different" cards.
function CardIcon({ name }: { name: string }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "shield") return (<svg {...common}><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" /></svg>);
  if (name === "compass") return (<svg {...common}><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" /></svg>);
  return (<svg {...common}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" /></svg>);
}

// Stylized product window — gives the hero a real "this is an app" anchor
// without shipping live data. Pure CSS, on the parchment palette.
function HeroMockup({ isMobile }: { isMobile: boolean }) {
  const chips = ["Wellness & spa", "Boutique hotels", "Corporate retreats"];
  const leads = [
    { name: "Aurora Retreats", meta: "Singapore · 42 staff", score: "High" },
    { name: "Sundara Wellness", meta: "Bali · 80 staff", score: "High" },
    { name: "Meridian Hotels", meta: "Bangkok · 120 staff", score: "Medium" },
  ];
  return (
    <div style={{
      background: "var(--surface-2)", border: "1px solid var(--line)",
      borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-3)",
      overflow: "hidden", maxWidth: 420, margin: "0 auto", width: "100%",
      animation: "rise 0.6s ease both",
    }}>
      {/* Window chrome */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "11px 14px", borderBottom: "1px solid var(--line)", background: "var(--surface)" }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--ink-4)", opacity: 0.5 }} />
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--ink-4)", opacity: 0.5 }} />
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--ink-4)", opacity: 0.5 }} />
        <span style={{ marginLeft: "auto", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-3)" }}>biks.ai</span>
      </div>

      {/* Body */}
      <div style={{ padding: isMobile ? "16px" : "18px 18px 20px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--sage-strong)", fontFamily: "var(--font-mono)", marginBottom: 6 }}>
          Company analysis
        </div>
        <div style={{ fontSize: 17, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.01em", marginBottom: 12 }}>
          Your business, decoded
        </div>

        {/* Market chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
          {chips.map((c) => (
            <span key={c} style={{ fontSize: 11, color: "var(--sage-strong)", background: "var(--sage-wash)", border: "1px solid var(--line)", borderRadius: 999, padding: "4px 10px", fontWeight: 500 }}>
              {c}
            </span>
          ))}
        </div>

        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 10 }}>
          Matched leads
        </div>

        {/* Lead rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {leads.map((l) => (
            <div key={l.name} style={{ display: "flex", alignItems: "center", gap: 11, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
              <span style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--sage-wash)", color: "var(--sage-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                {l.name[0]}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</span>
                <span style={{ display: "block", fontSize: 11, color: "var(--ink-3)" }}>{l.meta}</span>
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.04em",
                padding: "3px 8px", borderRadius: 999, flexShrink: 0,
                color: l.score === "High" ? "var(--sage-strong)" : "var(--ink-3)",
                background: l.score === "High" ? "var(--sage-wash)" : "var(--surface-2)",
                border: "1px solid var(--line)",
              }}>
                {l.score}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
