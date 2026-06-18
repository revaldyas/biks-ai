const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "business",
  "company",
  "for",
  "from",
  "into",
  "located",
  "market",
  "near",
  "that",
  "the",
  "their",
  "this",
  "with",
]);

function tokens(value: string): string[] {
  return Array.from(
    new Set(
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter(token => token.length > 2 && !STOP_WORDS.has(token))
    )
  );
}

function overlap(queryTokens: Set<string>, values: string[]): string[] {
  const matches = new Set<string>();
  for (const value of values) {
    for (const token of tokens(value)) {
      if (queryTokens.has(token)) matches.add(token);
    }
  }
  return Array.from(matches);
}

export function splitMemoryPolarity(memories: string[], protectedValues: string[] = []) {
  const positive: string[] = [];
  const negative: string[] = [];
  const negativeMarker = /\b(avoid|deprioritize|exclude|reject|never|not|without)\b/i;
  for (const memory of memories) {
    const clauses = String(memory || "")
      .split(/\s+(?:and|but)\s+|[;,]/i)
      .filter(Boolean);
    for (const clause of clauses) {
      (negativeMarker.test(clause) ? negative : positive).push(clause);
    }
  }

  const protectedTokens = new Set(protectedValues.flatMap(tokens));
  const negativeTokens = negative
    .flatMap(tokens)
    .filter(token => !negativeMarker.test(token) && !protectedTokens.has(token));
  return { positive, negativeTokens };
}

export function stripLocationTerms(query: string, locations: string[]): string {
  let cleaned = String(query || "");
  for (const location of locations.filter(Boolean).sort((a, b) => b.length - a.length)) {
    cleaned = cleaned.replace(new RegExp(`\\b(?:in|near|around|located in)?\\s*${location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
  }
  return cleaned.replace(/\s+/g, " ").replace(/[,;-]+\s*$/, "").trim();
}

export function matchMandatoryEvidence(pageText: string, signals: string[]): string[] {
  const normalized = String(pageText || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ");
  return Array.from(new Set(signals.filter(signal => {
    const words = tokens(signal);
    if (!words.length) return false;
    const exact = normalized.includes(String(signal).toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim());
    const overlapCount = words.filter(word => normalized.includes(word)).length;
    return exact || overlapCount >= Math.ceil(words.length * 0.75);
  })));
}

export interface QuerySelectionContext {
  memories: string[];
  requiredEvidence: string[];
  capabilities: string[];
  opportunity: string[];
}

export interface SelectedQuery {
  query: string;
  score: number;
  reasons: string[];
}

export function selectStrongestQueries(
  queries: string[],
  context: QuerySelectionContext,
  limit = 4
): SelectedQuery[] {
  const unique = Array.from(
    new Set(queries.map(query => String(query || "").trim()).filter(Boolean))
  );
  const memoryPolarity = splitMemoryPolarity(context.memories, [
    ...context.requiredEvidence,
    ...context.capabilities,
    ...context.opportunity,
  ]);
  const ranked = unique
    .map((query, index) => {
      const queryTokens = new Set(tokens(query));
      const memoryHits = overlap(queryTokens, memoryPolarity.positive);
      const memoryConflicts = Array.from(queryTokens).filter(token =>
        memoryPolarity.negativeTokens.includes(token)
      );
      const evidenceHits = overlap(queryTokens, context.requiredEvidence);
      const capabilityHits = overlap(queryTokens, context.capabilities);
      const opportunityHits = overlap(queryTokens, context.opportunity);
      const intentHits = overlap(queryTokens, [
        "operator provider facility organization enterprise buyer headquarters",
      ]);
      const reasons: string[] = [];

      if (memoryHits.length) reasons.push(`mem0: ${memoryHits.join(", ")}`);
      if (memoryConflicts.length)
        reasons.push(`conflicts with mem0: ${memoryConflicts.join(", ")}`);
      if (evidenceHits.length)
        reasons.push(`required evidence: ${evidenceHits.join(", ")}`);
      if (capabilityHits.length)
        reasons.push(`capability: ${capabilityHits.join(", ")}`);
      if (opportunityHits.length)
        reasons.push(`opportunity: ${opportunityHits.join(", ")}`);
      if (!memoryHits.length && context.memories.length)
        reasons.push("mem0 applied in contextual variant");

      return {
        query,
        index,
        queryTokens,
        score:
          memoryHits.length * 12 +
          memoryConflicts.length * -18 +
          evidenceHits.length * 7 +
          capabilityHits.length * 4 +
          opportunityHits.length * 3 +
          intentHits.length * 2 +
          Math.min(queryTokens.size, 8) * 0.25,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected: typeof ranked = [];
  while (ranked.length && selected.length < limit) {
    let bestIndex = 0;
    let bestAdjustedScore = -Infinity;
    for (let i = 0; i < ranked.length; i++) {
      const candidate = ranked[i];
      const maxSimilarity = selected.reduce((max, chosen) => {
        const intersection = Array.from(candidate.queryTokens).filter(token =>
          chosen.queryTokens.has(token)
        ).length;
        const union =
          new Set(
            Array.from(candidate.queryTokens).concat(
              Array.from(chosen.queryTokens)
            )
          ).size || 1;
        return Math.max(max, intersection / union);
      }, 0);
      const adjustedScore = candidate.score - maxSimilarity * 6;
      if (adjustedScore > bestAdjustedScore) {
        bestAdjustedScore = adjustedScore;
        bestIndex = i;
      }
    }
    selected.push(ranked.splice(bestIndex, 1)[0]);
  }

  return selected.map(({ query, score, reasons }) => ({
    query,
    score: Number(score.toFixed(2)),
    reasons: reasons.length ? reasons : ["specific, diverse opportunity query"],
  }));
}

const REJECTED_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "medium.com",
  "substack.com",
  "wikipedia.org",
  "yelp.com",
  "tripadvisor.com",
  "yellowpages",
  "zoominfo.com",
  "crunchbase.com",
  "clutch.co",
  "goodfirms.co",
  "google.com",
  "bing.com",
];

export function lowQualitySourceReason(
  urlValue: string,
  titleValue = ""
): string | null {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return "invalid URL";
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.toLowerCase();
  const title = titleValue.toLowerCase();
  if (
    REJECTED_HOSTS.some(
      rejected =>
        host === rejected ||
        host.endsWith(`.${rejected}`) ||
        host.includes(rejected)
    )
  ) {
    return "directory, social, or aggregator host";
  }
  if (
    /\/(blog|news|article|articles|directory|directories|list|lists|category|tag)(\/|$)/i.test(
      path
    )
  ) {
    return "editorial or directory page";
  }
  if (
    /\b(top|best)\s+\d+|\blist of\b|\bdirectory\b|\bnews\b|\barticle\b/i.test(
      title
    )
  ) {
    return "editorial or directory title";
  }
  return null;
}
