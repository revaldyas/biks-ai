import { describe, expect, it } from "vitest";
import {
  assignOpportunityPriority,
  buildResearchAudit,
  extractContiguousEvidence,
  extractFacilityKeywords,
  isAdmissibleResearchSource,
  isDiscoveryOnlySource,
  mapInBatches,
  parseLeadMarkdownEvaluations,
} from "./leadResearch";

describe("lead research evidence", () => {
  it("extracts a contiguous source excerpt instead of composing a quote", () => {
    const page = "Recovery services are available daily. Our River Valley venue has two cold plunge pools and a traditional sauna. Book online today.";
    const quote = extractContiguousEvidence(page, ["cold plunge"]);
    expect(page).toContain(quote);
    expect(quote).toContain("cold plunge");
  });

  it("extracts concrete facility terms from prose requirements", () => {
    const keywords = extractFacilityKeywords([
      "Website or listing mentions cold plunge, ice bath, hydrotherapy pool, or flotation tank",
      "Facility advertises water-based wellness treatments or immersion therapy",
    ]);
    expect(keywords).toContain("cold plunge");
    expect(keywords).toContain("ice bath");
    expect(keywords).toContain("hydrotherapy pool");
    expect(keywords).not.toContain("website");
  });

  it("does not treat cookie banner text as facility evidence", () => {
    const cookieText = "By clicking Accept All Cookies, you agree to storing cookies to enhance site navigation and assist in our marketing efforts.";
    const keywords = extractFacilityKeywords(["Website or listing mentions cold plunge, ice bath, hydrotherapy pool, or flotation tank"]);
    expect(extractContiguousEvidence(cookieText, keywords)).toBe("");
  });

  it("keeps reputable research sources but excludes directories", () => {
    expect(isDiscoveryOnlySource("https://www.yelp.com/biz/example")).toBe(true);
    expect(isDiscoveryOnlySource("https://www.spa-awards.com/spa/example")).toBe(true);
    expect(isDiscoveryOnlySource("https://www.beautyinsider.sg/example", "Example ION Singapore Review, Outlets & Price")).toBe(true);
    expect(isAdmissibleResearchSource({
      url: "https://business.example.com/news/company-expands",
      title: "Company expands to Jakarta",
      pageText: "The company will open a Jakarta location in September 2026.",
    })).toBe(true);
  });

  it("parses live Manus finalist output with official website labels", () => {
    const parsed = parseLeadMarkdownEvaluations(`Below are the qualifying leads.

### 1. The Ice Bath Club - fitScore 5
**Official website:** https://theicebathclubs.com/

**Facility evidence.** The Ice Bath Club operates large communal cold plunge pools maintained at 3-10C across multiple Singapore locations.

**Seller-to-buyer fit.** Communal cold plunge pools at high daily throughput create exactly the chemical cost and hygiene compliance pain that Moncol's ozone AOP system resolves.

**Opportunity signal.** A new Alexandra location at Anchorpoint is currently in pre-sale.

**opportunitySignalDate:** Not an explicit ISO date in the evidence; left blank per rules.
`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].candidateKey).toBe("theicebathclubs.com");
    expect(parsed[0].fitScore).toBe(5);
    expect(parsed[0].whyThisCompanyFits).toContain("Communal cold plunge");
  });

  it("parses live Manus qualified-lead headings with markdown website links", () => {
    const raw = `#### #1 — The Ice Bath Club
**Website:** [theicebathclubs.com](https://www.theicebathclubs.com/) | **fitScore: 5**

**Facility Evidence:** Three confirmed Singapore locations operate large communal cold plunge pools.

**Location Evidence:** Singapore addresses confirmed across three active club pages.

**Seller-to-Buyer Fit:** Communal cold plunge pools at high daily throughput create exactly the chemical cost and hygiene compliance pain that Moncol's ozone AOP system resolves.

**Opportunity Signal:** Bangkok founding memberships are live and Jakarta is on waitlist. [[Source]](https://www.theicebathclubs.com/)

**opportunitySignalDate:** Not a single ISO date; ongoing expansion programme active as of evidence retrieval.
`;
    const parsed = parseLeadMarkdownEvaluations(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].candidateKey).toBe("theicebathclubs.com");
    expect(parsed[0].fitScore).toBe(5);
    expect(parsed[0].whyThisCompanyFits).toContain("Communal cold plunge");
  });
});

describe("lead research ranking and audit", () => {
  it("assigns priority only to dated, timely signals", () => {
    const now = new Date("2026-06-01T00:00:00Z");  // fixed clock so the test never expires
    expect(assignOpportunityPriority("new market expansion", "2026-05-01", now)).toBe("A");
    expect(assignOpportunityPriority("hiring", "2026-03-01", now)).toBe("B");
    expect(assignOpportunityPriority("expansion", "", now)).toBe("C");
    expect(assignOpportunityPriority("expansion", "2020-01-01", now)).toBe("C");  // too old → not timely
  });

  it("reports evaluated and rejected counts without treating untouched candidates as rejected", () => {
    expect(buildResearchAudit({ discovered: 20, exaRetrieved: 18, unique: 25, evaluated: 12, rejected: 4, verified: 8, signalBacked: 2, returned: 8 }))
      .toEqual({ candidatesDiscovered: 20, candidatesRetrievedByExa: 18, uniqueCompanies: 25, companiesEvaluated: 12, eligibilityRejections: 4, verifiedFacilities: 8, leadsWithTimelySignals: 2, finalLeadsReturned: 8 });
  });

  it("processes every item in bounded batches", async () => {
    const seen: number[] = [];
    const output = await mapInBatches([1, 2, 3, 4, 5, 6, 7], 3, async value => { seen.push(value); return value * 2; });
    expect(output).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(seen).toHaveLength(7);
  });

  it("parses Manus markdown finalist output into structured evaluations", () => {
    const parsed = parseLeadMarkdownEvaluations(`Below are the qualifying leads.

## Rank 1 — The Ice Bath Club Singapore
**Website:** https://www.theicebathclubs.com/ | **Fit Score:** 5 / 5
**Facility Evidence:** Operates cold plunge pools.
**Location Evidence:** Singapore locations are listed.
**Seller-to-Buyer Fit:** Multi-location cold plunge operator needs water treatment.
**Opportunity Signal:** Jakarta founding membership waitlist is live. *(Source: https://www.theicebathclubs.com/jakarta — 2026-06-01)*
`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].candidateKey).toBe("theicebathclubs.com");
    expect(parsed[0].fitScore).toBe(5);
    expect(parsed[0].opportunitySignal).toContain("Jakarta");
  });
});
