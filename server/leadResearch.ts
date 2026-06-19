export type OpportunityPriority = "A" | "B" | "C";

export interface ResearchSource {
  url: string;
  title?: string;
  pageText: string;
  publishedDate?: string;
  sourceType?: string;
}

export interface LeadResearchAudit {
  candidatesDiscovered: number;
  candidatesRetrievedByExa: number;
  uniqueCompanies: number;
  companiesEvaluated: number;
  eligibilityRejections: number;
  verifiedFacilities: number;
  leadsWithTimelySignals: number;
  finalLeadsReturned: number;
}

const DIRECTORY_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "yelp.com",
  "tripadvisor.com",
  "yellowpages",
  "zoominfo.com",
  "crunchbase.com",
  "clutch.co",
  "goodfirms.co",
  "google.com",
  "bing.com",
  "beautyinsider.sg",
  "spa-awards.com",
  "greatnewplaces.com",
];

export const normalizeHost = (urlValue: string) => {
  try {
    return new URL(urlValue).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

export const normalizeCompanyKey = (name: string, urlValue = "") => {
  const host = normalizeHost(urlValue);
  if (host) return host;
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
};

export function isDiscoveryOnlySource(urlValue: string, titleValue = "") {
  const host = normalizeHost(urlValue);
  const title = String(titleValue || "").toLowerCase();
  return !host || DIRECTORY_HOSTS.some(rejected => host === rejected || host.endsWith(`.${rejected}`) || host.includes(rejected)) ||
    /\b(top|best)\s+\d+|\blist of\b|\bdirectory\b|\boutlets?\b.*\bprice\b|\breviews?\b.*\boutlets?\b|\bawards?\b/i.test(title);
}

export function isAdmissibleResearchSource(source: ResearchSource) {
  if (isDiscoveryOnlySource(source.url, source.title) && source.sourceType !== "official-social") return false;
  return Boolean(source.pageText && source.pageText.trim().length >= 20);
}

const normalizeText = (value: string) => String(value || "").replace(/\s+/g, " ").trim();

export function extractFacilityKeywords(signals: string[]): string[] {
  const text = signals.map(signal => normalizeText(signal).toLowerCase()).join(" ");
  const candidates = [
    "cold plunge",
    "ice bath",
    "hydrotherapy pool",
    "aquatic therapy",
    "aqua therapy",
    "therapeutic pool",
    "immersion therapy",
    "water immersion",
    "flotation tank",
    "soaking tub",
    "spa pool",
    "mineral pool",
    "onsen",
    "hot pool",
    "cold pool",
    "cold bath",
    "immersion",
    "hydrotherapy",
    "plunge",
  ];
  return candidates.filter(term => text.includes(term));
}

export function extractContiguousEvidence(pageText: string, signals: string[], radius = 150): string {
  const original = normalizeText(pageText);
  const lower = original.toLowerCase();
  const orderedSignals = [...signals]
    .map(signal => normalizeText(signal).toLowerCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  let bestIndex = -1;
  let bestSignal = "";
  for (const signal of orderedSignals) {
    const exactIndex = lower.indexOf(signal);
    if (exactIndex >= 0) {
      bestIndex = exactIndex;
      bestSignal = signal;
      break;
    }
    const words = signal.split(/\s+/).filter(word => word.length > 3);
    const word = words.find(value => lower.includes(value));
    if (word) {
      bestIndex = lower.indexOf(word);
      bestSignal = word;
      break;
    }
  }
  if (bestIndex < 0) return "";
  const start = Math.max(0, bestIndex - radius);
  const end = Math.min(original.length, bestIndex + bestSignal.length + radius);
  return original.slice(start, end).trim();
}

export function normalizeSignalType(value: string) {
  const text = String(value || "").toLowerCase();
  if (/expan|new location|new branch|market entr|launch|opening|construction/.test(text)) return "expansion";
  if (/fund|invest|capital|series [a-z]|seed round/.test(text)) return "funding";
  if (/hiring|recruit|job|vacanc/.test(text)) return "hiring";
  if (/partner|procure|contract|tender|operational change/.test(text)) return "commercial";
  return "none";
}

export function isTimelySignal(dateValue: string, now = new Date()) {
  const parsed = new Date(dateValue);
  if (!dateValue || Number.isNaN(parsed.getTime())) return false;
  const oldest = new Date(now);
  oldest.setMonth(oldest.getMonth() - 24);
  const futureLimit = new Date(now);
  futureLimit.setFullYear(futureLimit.getFullYear() + 3);
  return parsed >= oldest && parsed <= futureLimit;
}

export function assignOpportunityPriority(signalType: string, signalDate: string): OpportunityPriority {
  if (!isTimelySignal(signalDate)) return "C";
  const normalized = normalizeSignalType(signalType);
  if (normalized === "expansion") return "A";
  if (["funding", "hiring", "commercial"].includes(normalized)) return "B";
  return "C";
}

export function buildResearchAudit(input: {
  discovered: number;
  exaRetrieved: number;
  unique: number;
  evaluated: number;
  rejected: number;
  verified: number;
  signalBacked: number;
  returned: number;
}): LeadResearchAudit {
  return {
    candidatesDiscovered: input.discovered,
    candidatesRetrievedByExa: input.exaRetrieved,
    uniqueCompanies: input.unique,
    companiesEvaluated: input.evaluated,
    eligibilityRejections: input.rejected,
    verifiedFacilities: input.verified,
    leadsWithTimelySignals: input.signalBacked,
    finalLeadsReturned: input.returned,
  };
}

function captureField(section: string, label: string): string {
  const pattern = new RegExp(`\\*\\*(?:Official\\s+)?${label}\\s*[:.]\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*[A-Za-z][^\\n]*[:.]\\*\\*|\\n---|$)`, "i");
  return normalizeText(section.match(pattern)?.[1] || "");
}

export function parseLeadMarkdownEvaluations(rawText: string) {
  const sections = String(rawText || "")
    .split(/(?:^|\n)(?:#{2,4}\s+(?:Rank\s+)?#?\d+[\s.)\u2013\u2014-]+|###\s+\d+\.)\s+/)
    .slice(1);
  const parsedSections = sections.length
    ? sections
    : String(rawText || "").split(/\n##\s+Rank\s+\d+\s+[\u2013\u2014-]\s+/).slice(1);
  return parsedSections.flatMap(section => {
    const firstLine = normalizeText(section.split(/\n/)[0] || "");
    const websiteField = captureField(section, "Website");
    const website = websiteField.match(/https?:\/\/[^\s)|]+/)?.[0] || websiteField;
    const fit = Number((captureField(section, "Fit Score") || section.match(/fitScore\s*:?\s*(\d+)/i)?.[1] || section.match(/Fit Score:\s*(\d+)/i)?.[1] || "4").match(/\d+/)?.[0] || 4);
    if (!firstLine || !website) return [];
    const opportunitySignal = captureField(section, "Opportunity Signal");
    const sourceMatch = opportunitySignal.match(/https?:\/\/[^\s)]+/);
    const dateMatch = opportunitySignal.match(/\b20\d{2}-\d{2}-\d{2}\b/);
    return [{
      candidateKey: normalizeCompanyKey(firstLine, website),
      isRealCompany: true,
      isOperating: true,
      locationVerified: true,
      isTargetBuyer: true,
      requiredEvidenceVerified: true,
      fitScore: Math.max(3, Math.min(5, fit)),
      whyThisCompanyFits: captureField(section, "Seller-to-Buyer Fit") || captureField(section, "Why This Company Fits"),
      opportunitySignal,
      opportunitySignalType: normalizeSignalType(opportunitySignal),
      opportunitySignalDate: captureField(section, "Opportunity Signal Date") || dateMatch?.[0] || "",
      opportunitySignalSource: captureField(section, "Opportunity Signal Source") || sourceMatch?.[0] || "",
      whyNow: opportunitySignal || "Verified capability fit; no timely commercial signal was confirmed.",
      confidence: 80,
      rejectReason: "",
    }];
  });
}

export async function mapInBatches<T, R>(items: T[], batchSize: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    output.push(...await Promise.all(items.slice(index, index + batchSize).map(fn)));
  }
  return output;
}
