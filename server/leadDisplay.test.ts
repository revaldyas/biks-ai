import { describe, it, expect } from "vitest";
import {
  isValidCompanyName,
  parseNameFromTitle,
  deriveDomainName,
  deriveCompanyName,
  cleanEvidence,
  deriveDisplayLocation,
  displayDomain,
  normalizeLeadDisplay,
} from "./leadDisplay";

// Real failing strings captured from the production "Leads" screenshot.
const MORROW_SNIPPET =
  'cover, and build lasting habits with a like-minded community. MORROW Health brings advanced recovery technology and expert coaching under one roof in Singapore. published: "Jun 17, 2026, 1:32 AM UTC" — [About Us] [Longevity & Recovery]';
const REVA_TITLE =
  "Home - Reva Social Wellness # REVA REVA is Singapore's social wellness club for hot-cold contrast therapy, featuring twin ice baths, a hot pool, and a sauna.";
const WILLOW_TITLE =
  "Willow Stream Spa Singapore | Luxury Massages, Wellness & Facilities # Swissôtel The Stamford - Luxury hotel - Wellness & Spa";

describe("isValidCompanyName", () => {
  it("accepts real company names, including long/hyphenated ones", () => {
    expect(isValidCompanyName("MORROW Health")).toBe(true);
    expect(isValidCompanyName("Reva Social Wellness")).toBe(true);
    expect(isValidCompanyName("Mandapa, a Ritz-Carlton Reserve")).toBe(true);
    expect(isValidCompanyName("COMO Shambhala Estate")).toBe(true);
  });

  it("accepts abbreviation-brand names (St. / Mt. / Dr.)", () => {
    expect(isValidCompanyName("The St. Regis Singapore")).toBe(true);
    expect(isValidCompanyName("Mt. Faber Spa")).toBe(true);
    expect(isValidCompanyName("Dr. Wong Wellness")).toBe(true);
  });

  it("rejects scraped snippets, prose, urls and markdown", () => {
    expect(isValidCompanyName(MORROW_SNIPPET)).toBe(false);      // prose + published: + markdown
    expect(isValidCompanyName(REVA_TITLE)).toBe(false);          // markdown # + sentence prose
    expect(isValidCompanyName("https://www.swissotel.com/")).toBe(false);
    expect(isValidCompanyName("www.morrowhealth.com")).toBe(false);
    expect(isValidCompanyName("")).toBe(false);
    expect(isValidCompanyName("   ")).toBe(false);
  });
});

describe("parseNameFromTitle", () => {
  it("takes the first clean segment before a title separator", () => {
    expect(parseNameFromTitle(WILLOW_TITLE)).toBe("Willow Stream Spa Singapore");
  });

  it("strips nav prefixes like 'Home - '", () => {
    expect(parseNameFromTitle(REVA_TITLE)).toBe("Reva Social Wellness");
    expect(parseNameFromTitle("Welcome to | AMO Spa")).toBe("AMO Spa");
  });

  it("never splits on a hyphen inside a real name", () => {
    expect(parseNameFromTitle("Mandapa, a Ritz-Carlton Reserve")).toBe("Mandapa, a Ritz-Carlton Reserve");
  });
});

describe("deriveDomainName", () => {
  it("derives an honest capitalized core from the domain", () => {
    expect(deriveDomainName("https://www.morrowhealth.com")).toBe("Morrowhealth");
    expect(deriveDomainName("revasocialwellness.com/")).toBe("Revasocialwellness");
  });

  it("returns '' for junk", () => {
    expect(deriveDomainName("")).toBe("");
    expect(deriveDomainName("not a url")).toBe("");
  });
});

describe("deriveCompanyName (the ladder)", () => {
  it("prefers a valid Manus candidate name", () => {
    const r = deriveCompanyName("MORROW Health", MORROW_SNIPPET, "https://www.morrowhealth.com");
    expect(r).toEqual({ name: "MORROW Health", source: "manus" });
  });

  it("parses the title when Manus name is missing", () => {
    const r = deriveCompanyName("", REVA_TITLE, "https://revasocialwellness.com");
    expect(r).toEqual({ name: "Reva Social Wellness", source: "title" });
  });

  it("falls back to the domain when title is unsalvageable prose", () => {
    const r = deriveCompanyName("", MORROW_SNIPPET, "https://www.morrowhealth.com");
    expect(r).toEqual({ name: "Morrowhealth", source: "domain" });
  });

  it("quarantines (source 'none') when name AND domain are unusable", () => {
    const r = deriveCompanyName("", MORROW_SNIPPET, "");
    expect(r).toEqual({ name: "", source: "none" });
  });
});

describe("cleanEvidence", () => {
  it("strips markdown, urls and 'published:' chrome", () => {
    const dirty = '#### Therapies Hot immersion pool published: "Jun 17" [About](https://x.com/about) https://y.com/p';
    const clean = cleanEvidence(dirty);
    expect(clean).not.toMatch(/https?:\/\//);
    expect(clean).not.toMatch(/####|\|/);
    expect(clean.toLowerCase()).not.toContain("published:");
    expect(clean).toContain("Therapies Hot immersion pool");
    expect(clean).toContain("About"); // markdown link text preserved
  });

  it("caps length with an ellipsis", () => {
    const out = cleanEvidence("x ".repeat(300), 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("deriveDisplayLocation", () => {
  it("keeps short clean addresses", () => {
    expect(deriveDisplayLocation("Orchard Road, Singapore")).toBe("Orchard Road, Singapore");
  });

  it("hides long or noisy location evidence (the overflow bug)", () => {
    expect(deriveDisplayLocation(MORROW_SNIPPET)).toBe("");
    expect(deriveDisplayLocation("a".repeat(120))).toBe("");
  });
});

describe("displayDomain", () => {
  it("returns a short scheme/path-free domain", () => {
    expect(displayDomain("https://www.swissotel.com/singapore-stamford/spa")).toBe("swissotel.com");
  });
});

describe("normalizeLeadDisplay (final gate)", () => {
  it("passes a clean lead through and is not quarantined", () => {
    const out = normalizeLeadDisplay({
      title: "MORROW Health",
      url: "https://www.morrowhealth.com",
      verifiedAddress: "1 Raffles Place, Singapore",
      evidenceQuote: "Hot immersion pool (40°C to 42°C), cold plunge",
    });
    expect(out.displayName).toBe("MORROW Health");
    expect(out.displayDomain).toBe("morrowhealth.com");
    expect(out.displayLocation).toBe("1 Raffles Place, Singapore");
    expect(out.quarantined).toBe(false);
  });

  it("salvages a polluted title via the domain, no garbage in display fields", () => {
    const out = normalizeLeadDisplay({
      title: MORROW_SNIPPET,
      url: "https://www.morrowhealth.com",
      verifiedAddress: MORROW_SNIPPET,
      evidenceQuote: "#### Cold plunge (6°C to 8°C) https://x.com",
    });
    expect(out.displayName).toBe("Morrowhealth");
    expect(out.displayLocation).toBe("");                 // noisy address hidden
    expect(out.cleanEvidence).not.toMatch(/https?:\/\/|####/);
    expect(out.quarantined).toBe(false);
  });

  it("quarantines a lead with no clean name and no domain", () => {
    const out = normalizeLeadDisplay({ title: MORROW_SNIPPET, url: "" });
    expect(out.displayName).toBe("");
    expect(out.quarantined).toBe(true);
    expect(out.quarantineReason).toBe("no-clean-name");
  });
});
