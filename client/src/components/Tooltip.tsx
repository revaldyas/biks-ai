import { useState, type ReactNode } from "react";

// Lightweight explainer tooltip. Renders a small "?" affordance by default
// (hover on desktop, tap on mobile), or wraps custom children.
export default function Tooltip({ text, children }: { text: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {children ?? (
        <span
          role="button"
          tabIndex={0}
          aria-label={text}
          onClick={() => setOpen((o) => !o)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 16, height: 16, borderRadius: "50%", border: "1px solid var(--line-strong)",
            color: "var(--ink-3)", fontSize: 10, fontWeight: 700, cursor: "help",
            marginLeft: 6, fontFamily: "var(--font-sans)", flexShrink: 0,
          }}
        >
          ?
        </span>
      )}
      {open && (
        <span
          style={{
            position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
            zIndex: 200, width: 220, maxWidth: "70vw",
            background: "var(--ink)", color: "var(--action-fg)", fontSize: 12, lineHeight: 1.5, fontWeight: 400,
            padding: "8px 11px", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-2)",
            textAlign: "left", fontFamily: "var(--font-sans)", textTransform: "none", letterSpacing: "normal",
            pointerEvents: "none",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
