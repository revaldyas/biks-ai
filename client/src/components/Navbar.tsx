import React from "react";

interface NavbarProps {
  currentStep: number;
  onStepClick: (step: number) => void;
  onReset: () => void;
  website: string;
}

const steps = [
  { num: 2, label: "Analysis" },
  { num: 3, label: "Accounts" },
  { num: 4, label: "Brief" },
];

export default function Navbar({ currentStep, onStepClick, onReset, website }: NavbarProps) {
  const domain = website ? website.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";

  return (
    <nav style={{
      display: "grid",
      gridTemplateColumns: "1fr auto 1fr",
      alignItems: "center",
      padding: "18px 32px",
      borderBottom: "1px solid #1e1e1e",
      background: "#0f0f0f",
    }}>
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, width: 18, height: 18 }}>
          <span style={{ background: "#f0f0f0", borderRadius: 1, display: "block" }} />
          <span style={{ background: "#f0f0f0", borderRadius: 1, display: "block" }} />
          <span style={{ background: "#f0f0f0", borderRadius: 1, display: "block" }} />
          <span style={{ background: "#f0f0f0", borderRadius: 1, display: "block" }} />
        </div>
        <span style={{ fontFamily: "'DM Serif Display', serif", fontWeight: 700, fontSize: 16, color: "#f0f0f0" }}>
          Biks.ai
        </span>
      </div>

      {/* Step indicators */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {steps.map((s, i) => {
          const isDone = currentStep > s.num;
          const isActive = currentStep === s.num;
          const isPending = currentStep < s.num;

          return (
            <React.Fragment key={s.num}>
              {i > 0 && <span style={{ color: "#2a2a2a", fontSize: 12 }}>—</span>}
              <div
                onClick={() => { if (isDone) onStepClick(s.num); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: isDone ? "pointer" : "default",
                  opacity: isPending ? 0.4 : 1,
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
                  background: isActive ? "#f0f0f0" : isDone ? "#2a2a2a" : "transparent",
                  color: isActive ? "#0f0f0f" : isDone ? "#555" : "#333",
                  border: isActive ? "none" : "1px solid #2a2a2a",
                }}>
                  {isDone ? "✓" : s.num - 1}
                </span>
                <span style={{
                  fontSize: 13,
                  fontWeight: isActive ? 500 : 400,
                  color: isActive ? "#f0f0f0" : isDone ? "#888" : "#333",
                }}>
                  {s.label}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Right: domain + reset */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12 }}>
        {domain && (
          <span style={{ fontSize: 12, color: "#666" }}>{domain}</span>
        )}
        <button
          onClick={onReset}
          style={{
            background: "none",
            border: "none",
            padding: "6px 0",
            fontSize: 13,
            fontWeight: 500,
            color: "#888",
            cursor: "pointer",
            fontFamily: "'Inter', sans-serif",
          }}
        >
          Reset
        </button>
      </div>
    </nav>
  );
}
