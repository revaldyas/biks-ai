/**
 * Lead display hygiene — pure functions (no I/O) that turn raw Exa/Manus
 * scrape output into trustworthy, renderable lead fields.
 *
 * Why this exists: the lead `name` was falling back to the raw Exa snippet
 * (a whole sentence, markdown, URLs), which then polluted the Exa evidence
 * searches, the Manus evaluation, the summaries, AND the UI. These helpers
 * are deliberately pure so the exact failing strings from production can be
 * pinned as regression fixtures in leadDisplay.test.ts.
 */

// ---- structural "this is NOT a clean company name" signals -----------------

const URL_LIKE = /https?:\/\/|www\.|\.(com|net|org|io|co|ai|sg|id|asia)\b|\/\s*\S/i;
const MARKDOWN_NOISE = /[#|>*`]|\]\(|\[[^\]]*\]/;          // #### , | , [text](url) , [text]
const SCRAPE_NOISE = /\bpublished\s*:|\bUTC\b|####/i;       // scraped page chrome
// ". " mid-string => a sentence, not a name. Require a >=4-letter word before the
// period so abbreviation-brands survive ("St. Regis", "Mt. Faber", "Dr. Wong", "A.O.").
const SENTENCE_PROSE = /[a-z]{4,}[.!?]\s+\S/i;

/**
 * Is this a plausible company name (vs. a scraped snippet)?
 * Leans on structural signals, not length, to avoid false-rejecting real
 * long names like "Mandapa, a Ritz-Carlton Reserve".
 */
export function isValidCompanyName(input: string | undefined | null): boolean {
  const t = String(input ?? "").trim();
  if (!t) return false;
  if (t.length > 70) return false;            // generous cap; last-resort signal
  if (URL_LIKE.test(t)) return false;
  if (MARKDOWN_NOISE.test(t)) return false;
  if (SCRAPE_NOISE.test(t)) return false;
  if (SENTENCE_PROSE.test(t)) return false;
  if (t.split(/\s+/).length > 10) return false;
  return true;
}

const NAV_PREFIX = /^(home|welcome to|welcome|about us|about|contact|official site of|the official site of)\s*[-–—:|]\s*/i;

/**
 * Pull a clean company name out of a noisy page title.
 *   "Willow Stream Spa Singapore | Luxury Massages…" -> "Willow Stream Spa Singapore"
 *   "Home - Reva Social Wellness # REVA REVA is…"     -> "Reva Social Wellness"
 * Splits on real title separators only ( | # · — : ); never on bare "-" so
 * hyphenated names ("Ritz-Carlton") survive. Returns "" if nothing clean.
 */
export function parseNameFromTitle(title: string | undefined | null): string {
  let t = String(title ?? "").trim();
  if (!t) return "";
  // strip a leading nav prefix FIRST — it may be separated from the brand by a
  // title separator ("Welcome to | AMO Spa"), so splitting first loses the brand.
  t = t.replace(NAV_PREFIX, "").trim();
  // then take the first segment before a real title separator
  t = t.split(/\s*[|#·—:]\s*/)[0].trim();
  // strip once more in case the chosen segment still carries a "Home - " prefix
  t = t.replace(NAV_PREFIX, "").trim();
  t = t.replace(/^home\s*[-–—]\s*/i, "").trim();
  return t;
}

/**
 * Honest domain-derived name — last resort. We do NOT pretend to word-split:
 *   "https://www.morrowhealth.com" -> "Morrowhealth"
 * A slightly-plain real name beats dropping a real lead.
 */
export function deriveDomainName(url: string | undefined | null): string {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
    const core = host.split(".")[0];
    if (!core || core.length < 2) return "";
    return core.charAt(0).toUpperCase() + core.slice(1);
  } catch {
    return "";
  }
}

export type DerivedName = { name: string; source: "manus" | "title" | "domain" | "none" };

/**
 * The name ladder: Manus candidate name -> parsed from title -> domain core.
 * Returns { name: "", source: "none" } when nothing is salvageable (quarantine).
 */
export function deriveCompanyName(
  manusName: string | undefined | null,
  title: string | undefined | null,
  url: string | undefined | null,
): DerivedName {
  const m = String(manusName ?? "").trim();
  if (isValidCompanyName(m)) return { name: m, source: "manus" };

  const parsed = parseNameFromTitle(title);
  if (isValidCompanyName(parsed)) return { name: parsed, source: "title" };

  const dom = deriveDomainName(url);
  if (dom) return { name: dom, source: "domain" };

  return { name: "", source: "none" };
}

/**
 * Strip scraped noise out of an evidence excerpt: URLs, markdown, "published:"
 * chrome, repeated whitespace; cap length. May legitimately return "".
 */
export function cleanEvidence(raw: string | undefined | null, maxLen = 240): string {
  let t = String(raw ?? "");
  t = t.replace(/https?:\/\/\S+/g, " ");          // bare URLs
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");   // [text](url) -> text
  t = t.replace(/[#>*`|]+/g, " ");                 // markdown symbols
  t = t.replace(/\bpublished\s*:\s*"?[^"]*"?/gi, " ");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > maxLen) t = `${t.slice(0, maxLen).trim()}…`;
  return t;
}

/**
 * A short, renderable location chip — or "" when the input is long/noisy prose
 * (in which case the UI shows no chip rather than overflowing).
 */
export function deriveDisplayLocation(loc: string | undefined | null, maxLen = 80): string {
  const t = String(loc ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length > maxLen) return "";
  if (URL_LIKE.test(t) || SENTENCE_PROSE.test(t) || MARKDOWN_NOISE.test(t)) return "";
  return t;
}

/** Short, clean domain for a secondary row: "morrowhealth.com" (no scheme/path). */
export function displayDomain(url: string | undefined | null): string {
  return String(url ?? "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .slice(0, 40);
}

export type RawLead = {
  title?: string;
  url?: string;
  verifiedAddress?: string;
  evidenceQuote?: string;
  evidence?: string;
  summary?: string;
  [k: string]: unknown;
};

export type NormalizedLead = RawLead & {
  displayName: string;
  displayDomain: string;
  displayLocation: string;
  cleanEvidence: string;
  quarantined: boolean;
  quarantineReason: string;
};

/**
 * Final display-layer gate. By the time a lead reaches here its `title` should
 * already be a clean name (cleaned at source), but we re-validate and, if it is
 * still unusable, try the ladder again and quarantine if nothing is salvageable.
 * Raw fields are preserved; only the display* fields are guaranteed clean.
 */
export function normalizeLeadDisplay(lead: RawLead): NormalizedLead {
  const title = String(lead.title ?? "").trim();
  const url = String(lead.url ?? "");

  const displayName = isValidCompanyName(title)
    ? title
    : deriveCompanyName(title, title, url).name;

  const quarantined = !displayName;

  return {
    ...lead,
    displayName,
    displayDomain: displayDomain(url),
    displayLocation: deriveDisplayLocation(lead.verifiedAddress),
    cleanEvidence: cleanEvidence(lead.evidenceQuote || lead.evidence || lead.summary || ""),
    quarantined,
    quarantineReason: quarantined ? "no-clean-name" : "",
  };
}
