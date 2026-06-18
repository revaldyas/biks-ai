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
});
