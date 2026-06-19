import { describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "http";
import { readFileSync } from "fs";
import apiRoutes, { normalizeCompanyAnalysisResult, normalizeOpportunityResult } from "./api";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(apiRoutes);
  return app;
}

function startServer(app: express.Express): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, () => {
      const addr = server.address() as any;
      resolve({ port: addr.port, close: () => server.close() });
    });
  });
}

describe("API route handlers", () => {
  it("normalizes opportunities returned with the company profile", () => {
    const result = normalizeCompanyAnalysisResult({
      companyName: "Example Water Systems",
      capabilityModel: { capabilities: ["Closed-loop water treatment"] },
      expansionCategories: [{
        name: "Aquatic Rehabilitation Facilities",
        whyRelevant: "Therapy pools require controlled water treatment.",
        whyNonObvious: "The seller currently serves industrial facilities.",
        sharedPain: "Maintaining safe water with fewer chemicals.",
        salesAngle: "Apply closed-loop treatment to therapy pools.",
        painPoints: ["Chemical exposure"],
        disqualifiers: ["No on-site aquatic facility"],
        confidence: 82,
        searchQueries: ["rehabilitation facility hydrotherapy pool"],
        mustHaveEvidence: [{
          requirement: "Operates a hydrotherapy pool",
          acceptableSignals: ["hydrotherapy pool"],
          sellerCapability: "Closed-loop water treatment",
          sourceType: "website",
          sourceEvidence: "Closed-loop treatment systems",
          confidence: 88,
        }],
      }],
    });

    expect(result.companyName).toBe("Example Water Systems");
    expect(result.expansionCategories).toHaveLength(1);
    expect(result.expansionCategories[0].requiredEvidence).toEqual(["Operates a hydrotherapy pool"]);
    expect(result.expansionCategories[0].memoriesUsed).toEqual([]);
  });

  it("normalizes schema-less Manus opportunity fields", () => {
    const categories = normalizeOpportunityResult({
      expansionCategories: [{
        marketLabel: "Aquatic Therapy Facilities",
        marketDescription: "Clinical facilities with treated-water installations.",
        adjacencyRationale: "The seller's low-chemical treatment transfers to patient pools.",
        transferableCapability: {
          capability: "Low-chemical water treatment",
          capabilitySource: "websiteEvidence",
          sourceEvidence: [{ quote: "90 percent fewer chemicals" }],
        },
        buyerPains: [{ pain: "Chemical exposure for sensitive patients" }],
        mandatoryBuyerPrerequisites: [{
          prerequisiteLabel: "Operates an aquatic therapy pool",
          acceptableWebsiteSignals: ["aquatic therapy", "hydrotherapy pool"],
          disqualifyingSignals: ["no on-site pool"],
          confidence: 0.82,
        }],
        suggestedSearchQueries: ["rehabilitation center aquatic therapy pool"],
        opportunityStrength: "HIGH",
      }],
    });

    expect(categories).toHaveLength(1);
    expect(categories[0].name).toBe("Aquatic Therapy Facilities");
    expect(categories[0].mustHaveEvidence[0]).toMatchObject({
      requirement: "Operates an aquatic therapy pool",
      sellerCapability: "Low-chemical water treatment",
      sourceType: "website",
      confidence: 82,
    });
    expect(categories[0].searchQueries).toEqual(["rehabilitation center aquatic therapy pool"]);
  });
  it("GET /api/mem0 returns unavailable when key is missing", async () => {
    const origKey = process.env.MEM0_API_KEY;
    delete process.env.MEM0_API_KEY;

    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/mem0`);
      const data = await res.json();
      expect(data.available).toBe(false);
      expect(data.items).toEqual([]);
    } finally {
      close();
      if (origKey) process.env.MEM0_API_KEY = origKey;
    }
  });

  it("POST /api/exa-search requires query", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/exa-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("query is required");
    } finally {
      close();
    }
  });

  it("POST /api/send-email requires subject and html", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: "test" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("subject and html are required");
    } finally {
      close();
    }
  });

  it("POST /api/find-contacts requires leadName", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/find-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("leadName is required");
    } finally {
      close();
    }
  });

  it("POST /api/analyze-website requires url", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/analyze-website`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const text = await res.text();
      // SSE response should contain error event
      expect(text).toContain("URL is required");
    } finally {
      close();
    }
  });

  it("POST /api/generate-sales-kit requires business and lead", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/generate-sales-kit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const text = await res.text();
      // SSE response should contain error event about missing fields
      expect(text).toContain("business and lead are required");
    } finally {
      close();
    }
  });

  it("POST /api/scrape-reviews requires leadName", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/scrape-reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("leadName is required");
    } finally {
      close();
    }
  });

  it("POST /api/analyze-website starts one combined Manus task without memory context", async () => {
    const originalFetch = globalThis.fetch;
    const originalManus = process.env.MANUS_API_KEY;
    process.env.MANUS_API_KEY = "test-manus-key";
    const taskBodies: any[] = [];
    const websiteText = `Example Water Systems provides closed-loop filtration and industrial water treatment. ${"Verified operating capability. ".repeat(20)}`;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      if (String(input).includes("api.manus.ai/v2/task.create")) {
        taskBodies.push(JSON.parse(String(init?.body || "{}")));
        return new Response(JSON.stringify({ ok: true, task_id: "combined-analysis-task" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(input).startsWith("https://example-water.test")) {
        return new Response(`<html><body>${websiteText}</body></html>`, { status: 200 });
      }
      return originalFetch(input, init);
    });

    const app = createTestApp();
    const { port, close } = await startServer(app);
    try {
      const res = await fetch(`http://localhost:${port}/api/analyze-website`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example-water.test" }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).taskId).toBe("combined-analysis-task");
      expect(taskBodies).toHaveLength(1);
      expect(taskBodies[0].agent_profile).toBe("manus-1.6");
      expect(taskBodies[0].message.content).toContain("expansionCategories");
      expect(taskBodies[0].message.content).toContain("own or control the relevant facility");
      expect(taskBodies[0].message.content).toContain("pet or animal services");
      expect(taskBodies[0].message.content).not.toContain("prioritize premium buyers");
      expect(taskBodies[0].message.content).not.toContain("mem0 business context");
    } finally {
      close();
      fetchSpy.mockRestore();
      if (originalManus) process.env.MANUS_API_KEY = originalManus;
      else delete process.env.MANUS_API_KEY;
    }
  });

  it("keeps one Generate Leads action and no separate opportunity flow in the UI", () => {
    const dashboard = readFileSync(new URL("../client/src/pages/DashboardStep.tsx", import.meta.url), "utf8");
    const accounts = readFileSync(new URL("../client/src/pages/AccountsStep.tsx", import.meta.url), "utf8");
    const combined = `${dashboard}\n${accounts}`;

    expect(combined).not.toContain("/api/generate-opportunities");
    expect(combined).not.toContain("/api/poll-opportunities");
    expect(dashboard).not.toContain("Find Opportunities");
    expect(dashboard).toContain("Choose Market and Location");
    expect(combined.match(/Generate Leads/g)).toHaveLength(1);
  });

  it("does not expose a separate opportunity-generation endpoint", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);
    try {
      const res = await fetch(`http://localhost:${port}/api/generate-opportunities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business: { companyName: "Example" } }),
      });
      expect(res.status).toBe(404);
    } finally {
      close();
    }
  });

  it("POST /api/exa-search selects four strong queries and filters directory results", async () => {
    const origExa = process.env.EXA_API_KEY;
    const origManus = process.env.MANUS_API_KEY;
    process.env.EXA_API_KEY = "test-exa-key";
    delete process.env.MANUS_API_KEY;
    const originalFetch = globalThis.fetch;
    const exaRequests: any[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      if (String(input).startsWith("https://api.exa.ai/search")) {
        exaRequests.push(JSON.parse(String(init?.body || "{}")));
        return new Response(JSON.stringify({
          results: [
            { title: "Example Recovery Club", url: "https://recovery.example.com", text: "Premium recovery club with visible cold plunge facilities. Address: 12 Orchard Road, Singapore 123456.", summary: "Operating premium recovery club." },
            { title: "Top 10 Recovery Clubs Singapore", url: "https://www.yelp.com/biz/recovery", text: "Directory listing at 10 Singapore Street.", summary: "Directory listing" },
          ],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(input, init);
    });

    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/exa-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: [
            "wellness businesses",
            "premium recovery clubs with cold plunge facilities",
            "luxury hotels",
            "small fitness studios",
            "recovery centers requiring low chemical water treatment",
            "sports performance facilities",
          ],
          memories: ["Prioritize premium buyers and avoid small operators"],
          city: "Singapore",
          category: {
            name: "Recovery centers",
            requiredEvidence: ["visible cold plunge facilities"],
            disqualifiers: ["directory"],
          },
          business: {
            capabilityModel: { capabilities: ["low chemical water treatment"] },
          },
        }),
      });
      const data = await res.json();
      expect(data.querySelection).toHaveLength(4);
      expect(data.querySelection[0].contextApplied).toContain("mem0");
      expect(data.querySelection.map((item: any) => item.query)).not.toContain(
        "small fitness studios"
      );
      expect(data.exaRequestCount).toBeLessThanOrEqual(12);
      expect(exaRequests).toHaveLength(data.exaRequestCount);
      expect(data.validationStatus).toBe("failed");
      expect(data.results).toEqual([]);
      expect(data.message).toContain("No unverified leads were shown");
    } finally {
      close();
      fetchSpy.mockRestore();
      if (origExa) process.env.EXA_API_KEY = origExa;
      else delete process.env.EXA_API_KEY;
      if (origManus) process.env.MANUS_API_KEY = origManus;
      else delete process.env.MANUS_API_KEY;
    }
  });

  it("POST /api/scrape-reviews returns empty analysis when no review providers are configured", async () => {
    const origGooglePlaces = process.env.GOOGLE_PLACES_API_KEY;
    const origGoogleMaps = process.env.GOOGLE_MAPS_API_KEY;
    const origExa = process.env.EXA_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.EXA_API_KEY;

    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/scrape-reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadName: "Example Company" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.taskId).toBeUndefined();
      expect(data.reviews).toEqual([]);
      expect(data.painPoints).toEqual([]);
      expect(data.solutionMapping).toEqual([]);
      expect(data.relevanceKeywords).toEqual([]);
      expect(data.summary).toBe("No genuine customer reviews found for this company.");
    } finally {
      close();
      if (origGooglePlaces) process.env.GOOGLE_PLACES_API_KEY = origGooglePlaces;
      if (origGoogleMaps) process.env.GOOGLE_MAPS_API_KEY = origGoogleMaps;
      if (origExa) process.env.EXA_API_KEY = origExa;
    }
  });

  it("corroborates selected candidates with production-safe Exa calls and starts comparative ranking", async () => {
    const originalExa = process.env.EXA_API_KEY;
    const originalManus = process.env.MANUS_API_KEY;
    process.env.EXA_API_KEY = "test-exa-key";
    process.env.MANUS_API_KEY = "test-manus-key";
    const originalFetch = globalThis.fetch;
    const taskBodies: any[] = [];
    const exaRequests: any[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      const url = String(input);
      if (url === "https://api.exa.ai/search") {
        const request = JSON.parse(String(init?.body || "{}"));
        exaRequests.push(request);
        return new Response(JSON.stringify({ results: [{
          title: "Example Recovery Club",
          url: "https://example.test/locations/singapore",
          text: "Example Recovery Club operates two cold plunge pools in Singapore. Book recovery services online.",
          highlights: [],
        }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === "https://api.manus.ai/v2/task.create") {
        taskBodies.push(JSON.parse(String(init?.body || "{}")));
        return new Response(JSON.stringify({ ok: true, task_id: "ranking-task" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(input, init);
    });
    const app = createTestApp();
    const { port, close } = await startServer(app);
    try {
      const response = await fetch(`http://localhost:${port}/api/lead-research/corroborate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discovery: {
            discoveryQueries: ["recovery club cold plunge Singapore"],
            evidenceSignals: ["cold plunge"],
            disqualifiers: ["equipment seller"],
            signalQueries: ["expansion new location"],
            buyerDefinition: "An operator of recovery facilities",
          },
          business: { companyName: "Seller", capabilityModel: { capabilities: ["water treatment"] } },
          category: { name: "Recovery Clubs", searchQueries: ["recovery club cold plunge"], mustHaveEvidence: [{ requirement: "Operates a cold plunge", acceptableSignals: ["cold plunge"] }] },
          city: "Singapore",
          numResults: 8,
          memories: [],
        }),
      });
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.taskId).toBe("ranking-task");
      expect(data.evidenceBundles).toHaveLength(1);
      expect(data.evidenceBundles[0].facilityEvidence).toContain("cold plunge");
      expect(data.evidenceBundles[0].locationEvidence).toContain("Singapore");
      expect(data.companySearchQuery).toContain("Return operators or owners");
      expect(exaRequests[0]).toMatchObject({
        category: "company",
        type: "auto",
        numResults: 50,
        contents: expect.objectContaining({ highlights: true }),
      });
      expect(exaRequests.slice(1, 4)).toHaveLength(3);
      expect(exaRequests.slice(1, 4).every((request: any) => !("category" in request))).toBe(true);
      expect(exaRequests.slice(1, 4).every((request: any) => request.type === "auto")).toBe(true);
      expect(exaRequests.slice(1, 4).every((request: any) => /official|booking|address|location|membership|opening hours/i.test(request.query))).toBe(true);
      expect(exaRequests.slice(1, 4).every((request: any) => !/site:/i.test(request.query))).toBe(true);
      expect(exaRequests[0]).not.toHaveProperty("excludeDomains");
      expect(exaRequests[0]).not.toHaveProperty("startPublishedDate");
      expect(exaRequests.some((request: any) => String(request.query).includes("expansion OR"))).toBe(false);
      expect(taskBodies[0].message.content).toContain("Evaluate the complete supplied set before selecting finalists");
      expect(taskBodies[0].message.content).toContain("Return up to 12 candidates");
      expect(taskBodies[0].message.content).toContain("Example Recovery Club operates two cold plunge pools in Singapore");
    } finally {
      close();
      fetchSpy.mockRestore();
      if (originalExa) process.env.EXA_API_KEY = originalExa; else delete process.env.EXA_API_KEY;
      if (originalManus) process.env.MANUS_API_KEY = originalManus; else delete process.env.MANUS_API_KEY;
    }
  });

  it("caps corroboration candidates to avoid Vercel function timeouts", async () => {
    const originalExa = process.env.EXA_API_KEY;
    const originalManus = process.env.MANUS_API_KEY;
    process.env.EXA_API_KEY = "test-exa-key";
    process.env.MANUS_API_KEY = "test-manus-key";
    const originalFetch = globalThis.fetch;
    const exaRequests: any[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      const url = String(input);
      if (url === "https://api.exa.ai/search") {
        const request = JSON.parse(String(init?.body || "{}"));
        exaRequests.push(request);
        const results = request.category === "company"
          ? Array.from({ length: 20 }, (_, index) => ({
            title: `Recovery Club ${index + 1}`,
            url: `https://recovery-club-${index + 1}.example/singapore`,
            text: `Recovery Club ${index + 1} operates a cold plunge facility in Singapore with online booking.`,
            highlights: [],
          }))
          : [];
        return new Response(JSON.stringify({ results }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === "https://api.manus.ai/v2/task.create") {
        return new Response(JSON.stringify({ ok: true, task_id: "ranking-task" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(input, init);
    });
    const app = createTestApp();
    const { port, close } = await startServer(app);
    try {
      const response = await fetch(`http://localhost:${port}/api/lead-research/corroborate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discovery: {
            discoveryQueries: ["recovery club cold plunge Singapore"],
            evidenceSignals: ["cold plunge"],
            disqualifiers: ["equipment seller"],
            signalQueries: ["expansion new location"],
            buyerDefinition: "An operator of recovery facilities",
          },
          business: { companyName: "Seller", capabilityModel: { capabilities: ["water treatment"] } },
          category: { name: "Recovery Clubs", mustHaveEvidence: [{ requirement: "Operates a cold plunge", acceptableSignals: ["cold plunge"] }] },
          city: "Singapore",
          numResults: 8,
          memories: [],
        }),
      });
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.evidenceBundles).toHaveLength(12);
      expect(data.partialAudit).toMatchObject({ candidatesDiscovered: 12, uniqueCompanies: 12 });
      expect(exaRequests).toHaveLength(4);
      expect(exaRequests.some((request: any) => String(request.query).includes("expansion OR"))).toBe(false);
    } finally {
      close();
      fetchSpy.mockRestore();
      if (originalExa) process.env.EXA_API_KEY = originalExa; else delete process.env.EXA_API_KEY;
      if (originalManus) process.env.MANUS_API_KEY = originalManus; else delete process.env.MANUS_API_KEY;
    }
  });

  it("runs official-domain location verification when a facility-positive candidate lacks location evidence", async () => {
    const originalExa = process.env.EXA_API_KEY;
    const originalManus = process.env.MANUS_API_KEY;
    process.env.EXA_API_KEY = "test-exa-key";
    process.env.MANUS_API_KEY = "test-manus-key";
    const originalFetch = globalThis.fetch;
    const exaRequests: any[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      const url = String(input);
      if (url === "https://api.exa.ai/search") {
        const request = JSON.parse(String(init?.body || "{}"));
        exaRequests.push(request);
        if (request.category === "company") {
          return new Response(JSON.stringify({ results: [{
            title: "Sona Wellness",
            url: "https://sona.example/sweat-chill",
            text: "Sona Wellness offers contrast therapy with infrared sauna and cold plunge sessions.",
            highlights: [],
          }] }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (String(request.query).includes("expansion OR")) {
          return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (Array.isArray(request.includeDomains) && request.includeDomains.includes("sona.example") && /address location opening hours contact/i.test(request.query)) {
          return new Response(JSON.stringify({ results: [{
            title: "Contact Sona Wellness",
            url: "https://sona.example/contact",
            text: "Visit Sona Wellness at 10 Orchard Road, Singapore. Opening hours and contact details are available.",
            highlights: [],
          }] }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (Array.isArray(request.includeDomains) && request.includeDomains.includes("sona.example")) {
          return new Response(JSON.stringify({ results: [{
            title: "Sweat + Chill",
            url: "https://sona.example/sweat-chill",
            text: "Sweat + Chill uses an infrared sauna and cold plunge for contrast therapy. Single sessions and packages are available.",
            highlights: [],
          }] }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === "https://api.manus.ai/v2/task.create") {
        return new Response(JSON.stringify({ ok: true, task_id: "ranking-task" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(input, init);
    });
    const app = createTestApp();
    const { port, close } = await startServer(app);
    try {
      const response = await fetch(`http://localhost:${port}/api/lead-research/corroborate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discovery: {
            discoveryQueries: ["Singapore cold plunge recovery club"],
            evidenceSignals: ["cold plunge", "contrast therapy"],
            disqualifiers: ["equipment seller"],
            signalQueries: ["expansion new location"],
            buyerDefinition: "An operator of recovery facilities",
          },
          business: { companyName: "Seller", capabilityModel: { capabilities: ["water treatment"] } },
          category: { name: "Recovery Clubs", mustHaveEvidence: [{ requirement: "Operates a cold plunge", acceptableSignals: ["cold plunge"] }] },
          city: "Singapore",
          numResults: 8,
          memories: [],
        }),
      });
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.evidenceBundles).toHaveLength(1);
      expect(data.evidenceBundles[0].facilityEvidence).toContain("cold plunge");
      expect(data.evidenceBundles[0].locationEvidence).toContain("Singapore");
      expect(exaRequests.some((request: any) => /address location opening hours contact/i.test(request.query))).toBe(true);
    } finally {
      close();
      fetchSpy.mockRestore();
      if (originalExa) process.env.EXA_API_KEY = originalExa; else delete process.env.EXA_API_KEY;
      if (originalManus) process.env.MANUS_API_KEY = originalManus; else delete process.env.MANUS_API_KEY;
    }
  });

  it("finalizes only verified buyers and assigns dated expansion priority", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: any, init?: any) => originalFetch(input, init));
    const rankingResult = { evaluations: [{
            candidateKey: "example.test",
            isRealCompany: true,
            isOperating: true,
            locationVerified: true,
            isTargetBuyer: true,
            requiredEvidenceVerified: true,
            fitScore: 5,
            whyThisCompanyFits: "The operator runs treated-water recovery facilities.",
            opportunitySignal: "The company announced a new Jakarta location.",
            opportunitySignalType: "expansion",
            opportunitySignalDate: "2026-05-01",
            opportunitySignalSource: "https://news.example.test/example-expands",
            whyNow: "The new location creates a near-term water-treatment requirement.",
            confidence: 94,
            rejectReason: "",
          }] };
    const app = createTestApp();
    const { port, close } = await startServer(app);
    try {
      const response = await fetch(`http://localhost:${port}/api/lead-research/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rankingResult,
          partialAudit: { candidatesDiscovered: 1, candidatesRetrievedByExa: 3, uniqueCompanies: 1 },
          evidenceBundles: [{
            candidateKey: "example.test",
            name: "Example Recovery Club",
            officialWebsite: "https://example.test",
            facilityEvidence: "The club operates two cold plunge pools.",
            facilityEvidenceUrl: "https://example.test/facilities",
            locationEvidence: "Visit our Singapore recovery club.",
            operatingEvidence: "Book recovery services online.",
            sources: [{
              url: "https://news.example.test/example-expands",
              title: "Example expands",
              pageText: "Example Recovery Club announced an expansion and a new Jakarta location on 1 May 2026.",
              publishedDate: "2026-05-01",
              sourceType: "independent",
            }],
          }],
          numResults: 8,
          memories: ["Prioritize regional expansion"],
        }),
      });
      const data = await response.json();
      expect(data.status).toBe("done");
      expect(data.results).toHaveLength(1);
      expect(data.results[0].opportunityPriority).toBe("High");
      expect(data.results[0].opportunitySignal).toContain("new Jakarta location");
      expect(data.audit).toMatchObject({ companiesEvaluated: 1, verifiedFacilities: 1, leadsWithTimelySignals: 1, finalLeadsReturned: 1 });
    } finally {
      close();
      fetchSpy.mockRestore();
    }
  });

  it("finalizes top-level Manus evaluation arrays", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);
    try {
      const response = await fetch(`http://localhost:${port}/api/lead-research/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rankingResult: [{
            candidateKey: "coldplunge.example",
            fitScore: 5,
            explanation: "The operator runs a Singapore cold plunge facility that needs treated water.",
            opportunitySignal: "",
            opportunitySignalDate: "",
            rejectReason: "",
          }],
          partialAudit: { candidatesDiscovered: 1, candidatesRetrievedByExa: 2, uniqueCompanies: 1 },
          evidenceBundles: [{
            candidateKey: "coldplunge.example",
            name: "Cold Plunge Example",
            officialWebsite: "https://coldplunge.example",
            facilityEvidence: "Cold plunge facilities are available daily.",
            facilityEvidenceUrl: "https://coldplunge.example",
            locationEvidence: "Located in Singapore.",
            operatingEvidence: "Book recovery services online.",
            sources: [],
          }],
          numResults: 8,
        }),
      });
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.results).toHaveLength(1);
      expect(data.results[0].title).toBe("Cold Plunge Example");
      expect(data.results[0].whyThisCompanyFits).toContain("Singapore cold plunge");
      expect(data.audit).toMatchObject({ verifiedFacilities: 1, finalLeadsReturned: 1 });
    } finally {
      close();
    }
  });

  it("does not fabricate fallback leads when final Manus ranking is empty", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);
    try {
      const response = await fetch(`http://localhost:${port}/api/lead-research/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rankingResult: { evaluations: [], fallbackReason: "Agent stopped but returned no parseable output" },
          partialAudit: { candidatesDiscovered: 2, candidatesRetrievedByExa: 5, uniqueCompanies: 2 },
          evidenceBundles: [{
            candidateKey: "verified.example",
            name: "Verified Recovery Club",
            officialWebsite: "https://verified.example",
            requiredEvidenceSignals: ["cold plunge"],
            facilityEvidence: "Cold plunge pools are available daily.",
            facilityEvidenceUrl: "https://verified.example/facilities",
            locationEvidence: "Located in Singapore.",
            operatingEvidence: "Book recovery services online.",
            sources: [],
          }, {
            candidateKey: "generic-physio.example",
            name: "Generic Physio Clinic",
            officialWebsite: "https://generic-physio.example",
            requiredEvidenceSignals: ["hydrotherapy pool"],
            facilityEvidence: "Physiotherapy services are available daily.",
            facilityEvidenceUrl: "https://generic-physio.example",
            locationEvidence: "Located in Singapore.",
            operatingEvidence: "Book physiotherapy services online.",
            sources: [],
          }, {
            candidateKey: "seller.example",
            name: "Ice Bath Seller",
            officialWebsite: "https://seller.example",
            requiredEvidenceSignals: ["cold plunge"],
            facilityEvidence: "Designed specifically for cold plunge with water quality systems.",
            facilityEvidenceUrl: "https://seller.example",
            locationEvidence: "Located in Singapore.",
            operatingEvidence: "Contact us for a quote. Shipping available. Warranty covers all components.",
            sources: [],
          }, {
            candidateKey: "product-page.example",
            name: "Hydro Product Company",
            officialWebsite: "https://product-page.example",
            requiredEvidenceSignals: ["plunge pool"],
            facilityEvidence: "Recovery plunge pool products are available.",
            facilityEvidenceUrl: "https://product-page.example",
            locationEvidence: "Afghanistan Albania Singapore Slovakia Slovenia country*",
            operatingEvidence: "I am interested in products or service for an existing pool.",
            sources: [],
          }, {
            candidateKey: "pool-user.example",
            name: "Pool User Club",
            officialWebsite: "https://pool-user.example",
            requiredEvidenceSignals: ["hydrotherapy"],
            facilityEvidence: "Hydrotherapy for recovery in third-party pools.",
            facilityEvidenceUrl: "https://pool-user.example",
            locationEvidence: "Classes at JW Marriott Singapore.",
            operatingEvidence: "Swimming lessons and kids pool party services.",
            sources: [],
          }, {
            candidateKey: "canine.example",
            name: "Hydro Canine",
            officialWebsite: "https://canine.example",
            requiredEvidenceSignals: ["hydrotherapy pool"],
            facilityEvidence: "Dog hydrotherapy in a heated indoor swimming pool.",
            facilityEvidenceUrl: "https://canine.example",
            locationEvidence: "Located in Singapore.",
            operatingEvidence: "Appointment booking for dog swimming and canine rehabilitation.",
            sources: [],
          }, {
            candidateKey: "petphysio.example",
            name: "The Pet Physio",
            officialWebsite: "https://petphysio.example",
            requiredEvidenceSignals: ["hydrotherapy"],
            facilityEvidence: "Hydrotherapy water-based exercises enhance your pet's joint flexibility.",
            facilityEvidenceUrl: "https://petphysio.example",
            locationEvidence: "Located in Singapore.",
            operatingEvidence: "Personalized care for your pet's needs.",
            sources: [],
          }],
          numResults: 8,
        }),
      });
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.results).toEqual([]);
      expect(data.audit).toMatchObject({ companiesEvaluated: 7, eligibilityRejections: 7, verifiedFacilities: 0, finalLeadsReturned: 0 });
    } finally {
      close();
    }
  });

  it("rejects vendor and consultant bundles even when Manus marks them eligible", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);
    try {
      const response = await fetch(`http://localhost:${port}/api/lead-research/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rankingResult: { evaluations: [{
            candidateKey: "consultant.example",
            isRealCompany: true,
            isOperating: true,
            locationVerified: true,
            isTargetBuyer: true,
            requiredEvidenceVerified: true,
            fitScore: 5,
            whyThisCompanyFits: "Manus thinks this candidate has relevant hydrotherapy evidence.",
            opportunitySignal: "",
            opportunitySignalType: "none",
            opportunitySignalDate: "",
            opportunitySignalSource: "",
            whyNow: "",
            confidence: 90,
            rejectReason: "",
          }, {
            candidateKey: "buyer.example",
            isRealCompany: true,
            isOperating: true,
            locationVerified: true,
            isTargetBuyer: true,
            requiredEvidenceVerified: true,
            fitScore: 5,
            whyThisCompanyFits: "The operator runs a cold plunge facility in Singapore.",
            opportunitySignal: "",
            opportunitySignalType: "none",
            opportunitySignalDate: "",
            opportunitySignalSource: "",
            whyNow: "",
            confidence: 90,
            rejectReason: "",
          }] },
          partialAudit: { candidatesDiscovered: 2, candidatesRetrievedByExa: 5, uniqueCompanies: 2 },
          evidenceBundles: [{
            candidateKey: "consultant.example",
            name: "Wellness Design Consultant",
            officialWebsite: "https://consultant.example",
            requiredEvidenceSignals: ["hydrotherapy pool"],
            facilityEvidence: "Wellness architects and operational consultants designed a hydrotherapy pool for a client.",
            facilityEvidenceUrl: "https://consultant.example",
            locationEvidence: "Projects include Singapore.",
            operatingEvidence: "We are wellness architects and operational consultants.",
            sources: [],
          }, {
            candidateKey: "buyer.example",
            name: "Buyer Recovery Club",
            officialWebsite: "https://buyer.example",
            requiredEvidenceSignals: ["cold plunge"],
            facilityEvidence: "Our Singapore recovery club operates cold plunge pools daily.",
            facilityEvidenceUrl: "https://buyer.example",
            locationEvidence: "Located in Singapore.",
            operatingEvidence: "Book recovery sessions online.",
            sources: [],
          }],
          numResults: 8,
        }),
      });
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.results.map((lead: any) => lead.title)).toEqual(["Buyer Recovery Club"]);
      expect(data.evaluationAudit).toEqual(expect.arrayContaining([
        expect.objectContaining({ candidateKey: "consultant.example", eligible: false }),
        expect.objectContaining({ candidateKey: "buyer.example", eligible: true }),
      ]));
    } finally {
      close();
    }
  });
});
