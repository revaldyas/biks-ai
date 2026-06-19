import { describe, expect, it } from "vitest";
import {
  hostMatchesBlocklist,
  lowQualitySourceReason,
  matchMandatoryEvidence,
  selectStrongestQueries,
  splitMemoryPolarity,
  stripLocationTerms,
  wordPresent,
} from "./leadDiscovery";

describe("hostMatchesBlocklist (fix A: precise host filtering)", () => {
  const list = ["facebook.com", "clutch.co", "yellowpages"]; // dotted + bare token

  it("blocks exact and subdomain matches of dotted entries", () => {
    expect(hostMatchesBlocklist("facebook.com", list)).toBe(true);
    expect(hostMatchesBlocklist("m.facebook.com", list)).toBe(true);
    expect(hostMatchesBlocklist("clutch.co", list)).toBe(true);
  });

  it("does NOT reject a real site that merely contains a blocked token", () => {
    expect(hostMatchesBlocklist("clutch.com", list)).toBe(false);   // the headline bug
    expect(hostMatchesBlocklist("notfacebook.com", list)).toBe(false);
  });

  it("blocks a bare token only on a whole domain label", () => {
    expect(hostMatchesBlocklist("yellowpages.com", list)).toBe(true);
    expect(hostMatchesBlocklist("sg.yellowpages.com", list)).toBe(true);
    expect(hostMatchesBlocklist("myyellowpages.com", list)).toBe(false);
  });
});

describe("lowQualitySourceReason does not drop clutch.com (fix A integration)", () => {
  it("passes a real .com that contains a blocked .co token", () => {
    expect(lowQualitySourceReason("https://clutch.com/profile/acme", "Acme")).toBeNull();
  });
  it("still blocks the actual directory host", () => {
    expect(lowQualitySourceReason("https://clutch.co/profile/acme", "Acme")).not.toBeNull();
  });
});

describe("wordPresent (fix B: whole-word, plural-tolerant matching)", () => {
  it("rejects coincidental substrings", () => {
    expect(wordPresent("our product categories", "cat")).toBe(false);
    expect(wordPresent("we sell a plunger tool", "plunge")).toBe(false);
    expect(wordPresent("he was scolded", "cold")).toBe(false);
  });
  it("matches whole words and simple plurals, including hyphen compounds", () => {
    expect(wordPresent("cold-plunge pool", "plunge")).toBe(true);
    expect(wordPresent("two saunas and spas", "spa")).toBe(true);
    expect(wordPresent("heated pools onsite", "pool")).toBe(true);
  });
  it("handles accented words (ASCII \\b would fail)", () => {
    expect(wordPresent("our lovely café corner", "café")).toBe(true);
    expect(wordPresent("café lounge", "caf")).toBe(false);  // not a partial of café
  });
});

describe("lead discovery query selection", () => {
  it("prioritizes mem0 and required-evidence queries while keeping diversity", () => {
    const selected = selectStrongestQueries(
      [
        "wellness businesses",
        "premium recovery clubs with cold plunge facilities",
        "luxury hotels",
        "small fitness studios",
        "recovery centers requiring low chemical water treatment",
      ],
      {
        memories: ["Prioritize premium buyers and avoid small operators"],
        requiredEvidence: ["visible cold plunge facilities"],
        capabilities: ["low chemical water treatment"],
        opportunity: ["recovery centers", "wellness clubs"],
      }
    );

    expect(selected).toHaveLength(4);
    expect(selected[0].query).toContain("premium recovery clubs");
    expect(
      selected.some(item => item.query.includes("low chemical water treatment"))
    ).toBe(true);
    expect(
      selected.some(item => item.query.includes("small fitness studios"))
    ).toBe(false);
    expect(selected[0].reasons.join(" ")).toContain("mem0");
  });

  it("caps selection at four queries", () => {
    const selected = selectStrongestQueries(
      ["one buyer", "two buyer", "three buyer", "four buyer", "five buyer"],
      {
        memories: [],
        requiredEvidence: [],
        capabilities: [],
        opportunity: [],
      }
    );
    expect(selected).toHaveLength(4);
  });
});

describe("lead source filtering", () => {
  it("rejects directories, aggregators, and editorial pages", () => {
    expect(
      lowQualitySourceReason("https://www.yelp.com/biz/example", "Example")
    ).toBeTruthy();
    expect(
      lowQualitySourceReason(
        "https://example.com/blog/top-10-spas",
        "Top 10 Spas"
      )
    ).toBeTruthy();
    expect(
      lowQualitySourceReason(
        "https://example.com/directory/spas",
        "Spa Directory"
      )
    ).toBeTruthy();
  });

  it("keeps a normal company website", () => {
    expect(
      lowQualitySourceReason(
        "https://example.com/services",
        "Example Recovery Club"
      )
    ).toBeNull();
  });
});

describe("industry-agnostic eligibility", () => {
  it.each([
    ["Water", "The recovery club has a cold plunge and hydrotherapy pool.", ["cold plunge", "aquatic recovery facility"], "cold plunge"],
    ["Manufacturing", "Our production site operates ammonia refrigeration and cold storage.", ["industrial refrigeration", "cold storage"], "cold storage"],
    ["Compliance", "The company publishes SOC 2 compliance and enterprise audit controls.", ["SOC 2 compliance", "regulated audit program"], "SOC 2 compliance"],
  ])("matches mandatory evidence for %s buyers", (_industry, page, signals, expected) => {
    expect(matchMandatoryEvidence(page, signals)).toContain(expected);
  });

  it("removes seller locations without removing buyer intent", () => {
    expect(stripLocationTerms("premium recovery operators in Jakarta", ["Jakarta", "Indonesia"]))
      .toBe("premium recovery operators");
  });

  it("keeps preferences and disqualifiers separate", () => {
    const result = splitMemoryPolarity([
      "Prioritize premium operators; avoid small studios without facilities",
    ]);
    expect(result.positive.join(" ")).toContain("premium operators");
    expect(result.negativeTokens).toContain("small");
  });
});
