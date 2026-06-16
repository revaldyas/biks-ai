import { useEffect, useState } from "react";
import { useIsMobile } from "../hooks/useMobile";
import { listHistory, type HistoryRow, type HistoryKind } from "../lib/history";

const KIND_LABEL: Record<HistoryKind, string> = {
  analysis: "Company Analysis",
  leads: "Leads",
  kit: "Marketing Kit",
};

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return `${d}d ago`;
}

export default function HistoryPanel({ open, onClose, onOpenItem }: {
  open: boolean;
  onClose: () => void;
  onOpenItem: (row: HistoryRow) => void;
}) {
  const isMobile = useIsMobile();
  const [items, setItems] = useState<HistoryRow[] | null>(null);

  useEffect(() => {
    if (open) { setItems(null); listHistory().then(setItems); }
  }, [open]);

  if (!open) return null;

  // Only surface Company Analysis entries — each is a saved session the user can reopen.
  const analyses = items === null ? null : items.filter((r) => r.kind === "analysis");

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "var(--scrim)", display: "flex", justifyContent: "flex-end", animation: "fadeIn 0.15s ease" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: isMobile ? "100%" : 420, height: "100%", background: "var(--surface)",
          borderLeft: "1px solid var(--line)", boxShadow: "var(--shadow-pop)",
          display: "flex", flexDirection: "column", padding: isMobile ? "20px 16px" : "24px 22px",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)", margin: 0, letterSpacing: "-0.02em" }}>Your history</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 20, color: "var(--ink-3)", cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {analyses === null ? (
          <div style={{ textAlign: "center", paddingTop: 40 }}>
            <div style={{ display: "inline-block", width: 18, height: 18, border: "2px solid var(--line-strong)", borderTopColor: "var(--sage)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
          </div>
        ) : analyses.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.6, marginTop: 8 }}>
            Nothing saved yet. Analyze a website and it'll show up here — reopen it anytime to pick up where you left off.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {analyses.map((row) => (
              <button
                key={row.id}
                onClick={() => { onOpenItem(row); onClose(); }}
                style={{
                  textAlign: "left", width: "100%",
                  background: "var(--surface-2)", border: "1px solid var(--line)",
                  borderRadius: "var(--radius-md)", padding: "12px 14px", cursor: "pointer",
                  fontFamily: "var(--font-sans)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--line-strong)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--sage-strong)" }}>
                    {KIND_LABEL[row.kind] || row.kind}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--ink-4)" }}>{timeAgo(row.created_at)}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.title || "Untitled"}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
