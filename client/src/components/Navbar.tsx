import React from "react";
import { useIsMobile } from "../hooks/useMobile";

interface NavbarProps {
  currentStep: number;
  maxStepReached: number;
  canNavigateToStep: (step: number) => boolean;
  onStepClick: (step: number) => void;
  onReset: () => void;
  website: string;
  onSignOut?: () => void;
  trialDaysLeft?: number | null;
  onOpenHistory?: () => void;
}

const steps = [
  { num: 2, label: "Company Analysis" },
  { num: 3, label: "Leads" },
  { num: 4, label: "Marketing Kit" },
];

export default function Navbar({ currentStep, maxStepReached, canNavigateToStep, onStepClick, onReset, website, onSignOut, trialDaysLeft, onOpenHistory }: NavbarProps) {
  const isMobile = useIsMobile();
  const domain = website ? website.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";

  return (
    <nav style={{
      display: "grid",
      gridTemplateColumns: "1fr auto 1fr",
      alignItems: "center",
      padding: isMobile ? "12px 14px" : "18px 32px",
      borderBottom: "1px solid var(--line)",
      background: "var(--bg)",
    }}>
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 17, color: "var(--ink)", letterSpacing: "-0.01em" }}>
          Biks<span style={{ color: "var(--sage-strong)" }}>.ai</span>
        </span>
      </div>

      {/* Step indicators */}
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 8 }}>
        {steps.map((s, i) => {
          const isDone = currentStep > s.num;
          const isActive = currentStep === s.num;
          const isPending = currentStep < s.num && s.num > maxStepReached;
          const isClickable = canNavigateToStep(s.num);

          return (
            <React.Fragment key={s.num}>
              {i > 0 && <span style={{ color: "var(--line)", fontSize: 12 }}>—</span>}
              <div
                onClick={() => { if (isClickable) onStepClick(s.num); }}
                onMouseEnter={(e) => { if (isClickable && !isActive) e.currentTarget.style.opacity = "0.7"; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = isPending ? "0.4" : "1"; }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: isClickable ? "pointer" : "default",
                  opacity: isPending ? 0.4 : 1,
                  transition: "opacity 0.15s",
                }}
              >
                <span style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 600,
                  background: isActive ? "var(--action)" : isDone ? "var(--surface-sunk)" : "transparent",
                  color: isActive ? "var(--action-fg)" : isDone ? "var(--ink-3)" : "var(--ink-3)",
                  border: isActive ? "none" : "1px solid var(--line)",
                }}>
                  {isDone ? "✓" : s.num - 1}
                </span>
                {!isMobile && (
                  <span style={{
                    fontSize: 13,
                    fontWeight: isActive ? 500 : 400,
                    color: isActive ? "var(--ink)" : isDone ? "var(--ink-3)" : "var(--ink-3)",
                  }}>
                    {s.label}
                  </span>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Right: trial + domain + reset + sign out */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: isMobile ? 8 : 12 }}>
        {typeof trialDaysLeft === "number" && (
          <span style={{
            fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.06em",
            color: "var(--gold-text)", background: "var(--surface)", border: "1px solid var(--line)",
            borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap",
          }}>
            {trialDaysLeft}d left
          </span>
        )}
        {!isMobile && domain && (
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{domain}</span>
        )}
        {onOpenHistory && (
          <button
            onClick={onOpenHistory}
            style={{ background: "none", border: "none", padding: "6px 0", fontSize: 13, fontWeight: 500, color: "var(--ink-3)", cursor: "pointer", fontFamily: "var(--font-sans)" }}
          >
            History
          </button>
        )}
        <button
          onClick={onReset}
          style={{ background: "none", border: "none", padding: "6px 0", fontSize: 13, fontWeight: 500, color: "var(--ink-3)", cursor: "pointer", fontFamily: "var(--font-sans)" }}
        >
          Reset
        </button>
        {onSignOut && (
          <button
            onClick={onSignOut}
            style={{ background: "none", border: "none", padding: "6px 0", fontSize: 13, fontWeight: 500, color: "var(--ink-3)", cursor: "pointer", fontFamily: "var(--font-sans)" }}
          >
            Sign out
          </button>
        )}
      </div>
    </nav>
  );
}
