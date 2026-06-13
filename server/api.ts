import { Router, Request, Response } from "express";
import { ENV } from "./_core/env";
import { invokeLLM } from "./_core/llm";

const api = Router();

// ============================================================
// SSE Helper
// ============================================================
function sseHeaders(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}

function sseSend(res: Response, data: object) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ============================================================
// POST /api/analyze-website — SSE streaming website analysis
// ============================================================
api.post("/api/analyze-website", async (req: Request, res: Response) => {
  sseHeaders(res);
  const { url } = req.body;

  if (!url) {
    sseSend(res, { type: "error", message: "URL is required" });
    res.end();
    return;
  }

  try {
    sseSend(res, { type: "progress", pct: 5, message: "Fetching website content...", detail: "Downloading page" });

    // Fetch website content with retry
    let html = "";
    const fetchWithTimeout = async (targetUrl: string, timeoutMs: number) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const fetchRes = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
          },
          signal: controller.signal,
          redirect: "follow",
        });
        return await fetchRes.text();
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      html = await fetchWithTimeout(url, 30000);
    } catch (e: any) {
      // Retry once with longer timeout
      sseSend(res, { type: "progress", pct: 10, message: "Retrying connection...", detail: "First attempt timed out, retrying" });
      try {
        html = await fetchWithTimeout(url, 45000);
      } catch (e2: any) {
        sseSend(res, { type: "error", message: `Failed to fetch website: ${e2.message}. The site may be slow or blocking automated requests.` });
        res.end();
        return;
      }
    }

    // Strip HTML tags
    const content = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);

    sseSend(res, { type: "progress", pct: 25, message: "Analyzing business...", detail: "AI is processing website content" });

    const prompt = `You are analyzing a business website for a B2B sales development tool.
All website content is already provided below — do NOT browse the web or visit any URLs.

URL: ${url}
Website content (extracted text, already fetched):
${content}

Based ONLY on the content above, return ONLY valid JSON (no markdown, no code blocks) with this exact structure:
{
  "companyName": "Company name",
  "website": "${url}",
  "summary": "2-3 sentence company description",
  "valueProposition": "What makes them uniquely valuable in 1-2 sentences",
  "currentSegments": ["Existing customer segment 1", "Segment 2"],
  "products": ["Product/service 1", "Product 2"],
  "proofPoints": ["Credibility indicator 1", "Indicator 2"],
  "expansionCategories": [
    {
      "name": "New Market Category Name",
      "whyRelevant": "Why this category needs their specific products",
      "salesAngle": "One-sentence pitch angle",
      "painPoints": ["Pain point 1", "Pain point 2"],
      "searchQueries": ["search query to find leads in this category and city"]
    }
  ]
}

Generate 4-5 expansion categories. Focus on premium B2B segments.`;

    sseSend(res, { type: "progress", pct: 40, message: "AI agent started...", detail: "Generating business profile" });

    const result = await invokeLLM({
      messages: [
        { role: "system", content: "You are a B2B market analysis expert. Return only valid JSON." },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "business_profile",
          strict: true,
          schema: {
            type: "object",
            properties: {
              companyName: { type: "string" },
              website: { type: "string" },
              summary: { type: "string" },
              valueProposition: { type: "string" },
              currentSegments: { type: "array", items: { type: "string" } },
              products: { type: "array", items: { type: "string" } },
              proofPoints: { type: "array", items: { type: "string" } },
              expansionCategories: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    whyRelevant: { type: "string" },
                    salesAngle: { type: "string" },
                    painPoints: { type: "array", items: { type: "string" } },
                    searchQueries: { type: "array", items: { type: "string" } },
                  },
                  required: ["name", "whyRelevant", "salesAngle", "painPoints", "searchQueries"],
                  additionalProperties: false,
                },
              },
            },
            required: ["companyName", "website", "summary", "valueProposition", "currentSegments", "products", "proofPoints", "expansionCategories"],
            additionalProperties: false,
          },
        },
      },
    });

    sseSend(res, { type: "progress", pct: 85, message: "Extracting results...", detail: "Parsing AI output" });

    const content_text = result.choices[0]?.message?.content;
    let parsed: any;
    if (typeof content_text === "string") {
      const cleaned = content_text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    } else {
      throw new Error("No content in LLM response");
    }

    sseSend(res, { type: "progress", pct: 95, message: "Complete!", detail: "Business profile ready" });
    sseSend(res, { type: "complete", result: parsed });
  } catch (e: any) {
    sseSend(res, { type: "error", message: e.message || "Analysis failed" });
  }
  res.end();
});

// ============================================================
// GET /api/mem0 — Fetch all memories
// ============================================================
api.get("/api/mem0", async (_req: Request, res: Response) => {
  const apiKey = process.env.MEM0_API_KEY;
  if (!apiKey) {
    return res.json({ available: false, items: [] });
  }

  try {
    const memRes = await fetch("https://api.mem0.ai/v1/memories/?user_id=biks_hackathon_demo", {
      headers: { Authorization: `Token ${apiKey}` },
    });
    if (!memRes.ok) {
      return res.json({ available: false, items: [] });
    }
    const data: any = await memRes.json();
    const items = Array.isArray(data)
      ? data.map((d: any) => ({ id: d.id, text: d.memory }))
      : [];
    return res.json({ available: true, items });
  } catch {
    return res.json({ available: false, items: [] });
  }
});

// ============================================================
// POST /api/mem0 — Add memory
// ============================================================
api.post("/api/mem0", async (req: Request, res: Response) => {
  const apiKey = process.env.MEM0_API_KEY;
  if (!apiKey) {
    return res.json({ ok: false, error: "Mem0 not configured" });
  }

  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ ok: false, error: "text is required" });
  }

  try {
    const memRes = await fetch("https://api.mem0.ai/v1/memories/", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: text }],
        user_id: "biks_hackathon_demo",
      }),
    });
    const data: any = await memRes.json();

    // Mem0 v2 returns async responses: [{"status":"PENDING","event_id":"..."}]
    // or sync responses: [{"id":"...","memory":"..."}] or {"results":[...]}
    let id = `local_${Date.now()}`;

    if (Array.isArray(data)) {
      // New async format or direct results array
      const first = data[0];
      if (first?.id) {
        id = first.id;
      } else if (first?.event_id) {
        // Async processing - poll for completion (up to 5 seconds)
        const eventId = first.event_id;
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const pollRes = await fetch(`https://api.mem0.ai/v1/memories/?user_id=biks_hackathon_demo`, {
            headers: { Authorization: `Token ${apiKey}` },
          });
          const memories: any = await pollRes.json();
          if (Array.isArray(memories) && memories.length > 0) {
            // Find the most recent memory that matches our text
            const match = memories.find((m: any) =>
              m.memory && m.memory.toLowerCase().includes(text.toLowerCase().slice(0, 20))
            );
            if (match) {
              id = match.id;
              break;
            }
            // If no exact match, use the most recent one
            id = memories[memories.length - 1]?.id || id;
            break;
          }
        }
      }
    } else if (data?.results?.[0]?.id) {
      id = data.results[0].id;
    }

    return res.json({ ok: true, id });
  } catch (e: any) {
    return res.json({ ok: false, error: e.message });
  }
});

// ============================================================
// DELETE /api/mem0 — Delete memory
// ============================================================
api.delete("/api/mem0", async (req: Request, res: Response) => {
  const apiKey = process.env.MEM0_API_KEY;
  if (!apiKey) {
    return res.json({ ok: false, error: "Mem0 not configured" });
  }

  const id = req.query.id as string;
  if (id) {
    // Delete single memory
    try {
      await fetch(`https://api.mem0.ai/v1/memories/${id}/`, {
        method: "DELETE",
        headers: { Authorization: `Token ${apiKey}` },
      });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.json({ ok: false, error: e.message });
    }
  } else {
    // Delete all memories
    try {
      await fetch("https://api.mem0.ai/v1/memories/", {
        method: "DELETE",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_id: "biks_hackathon_demo" }),
      });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.json({ ok: false, error: e.message });
    }
  }
});

// ============================================================
// POST /api/exa-search — Lead discovery via Exa
// ============================================================
api.post("/api/exa-search", async (req: Request, res: Response) => {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Exa not configured" });
  }

  const { query, city, numResults = 5 } = req.body;
  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  // City-to-country and domain mapping for strict filtering
  const cityMeta: Record<string, { country: string; domains: string[]; strictTerms: string[] }> = {
    "singapore": { country: "Singapore", domains: [".sg", ".com.sg"], strictTerms: ["singapore"] },
    "jakarta": { country: "Indonesia", domains: [".id", ".co.id"], strictTerms: ["jakarta", "jkt"] },
    "bali": { country: "Indonesia", domains: [".id", ".co.id"], strictTerms: ["bali", "denpasar", "seminyak", "ubud", "canggu", "kuta", "sanur", "nusa dua"] },
    "kuala lumpur": { country: "Malaysia", domains: [".my", ".com.my"], strictTerms: ["kuala lumpur", "kl ", "petaling jaya", "bangsar", "mont kiara"] },
    "bangkok": { country: "Thailand", domains: [".th", ".co.th"], strictTerms: ["bangkok", "bkk", "sukhumvit", "silom", "sathorn"] },
    "ho chi minh city": { country: "Vietnam", domains: [".vn", ".com.vn"], strictTerms: ["ho chi minh", "hcmc", "saigon", "district 1", "district 2", "district 7"] },
    "manila": { country: "Philippines", domains: [".ph", ".com.ph"], strictTerms: ["manila", "makati", "bgc", "taguig", "quezon city", "pasig"] },
    "hong kong": { country: "Hong Kong", domains: [".hk", ".com.hk"], strictTerms: ["hong kong", "hongkong", "central", "wan chai", "tsim sha tsui"] },
    "tokyo": { country: "Japan", domains: [".jp", ".co.jp"], strictTerms: ["tokyo", "shibuya", "shinjuku", "roppongi", "minato", "ginza"] },
    "sydney": { country: "Australia", domains: [".au", ".com.au"], strictTerms: ["sydney", "nsw", "bondi", "surry hills", "darling harbour"] },
    "dubai": { country: "UAE", domains: [".ae"], strictTerms: ["dubai", "jumeirah", "marina", "deira", "business bay"] },
    "london": { country: "United Kingdom", domains: [".uk", ".co.uk"], strictTerms: ["london", "mayfair", "shoreditch", "canary wharf", "soho"] },
    "new york": { country: "United States", domains: [".com"], strictTerms: ["new york", "nyc", "manhattan", "brooklyn", "queens"] },
  };

  const meta = cityMeta[city?.toLowerCase()] || { country: city || "", domains: [], strictTerms: [city?.toLowerCase() || ""] };

  try {
    // Strategy: Run TWO separate Exa queries for better city-specific results
    // Query 1: Explicit city-focused query
    // Query 2: Country domain-restricted query
    const cityQuery = city
      ? `${query} located in ${city}, ${meta.country}`
      : query;

    const fetchExa = async (q: string, includeDomains?: string[]) => {
      const body: any = {
        query: q,
        type: "auto",
        category: "company",
        numResults: numResults + 5, // fetch extra for post-filtering
        contents: {
          text: { maxCharacters: 2000 },
          highlights: true,
          summary: true,
        },
      };
      if (includeDomains && includeDomains.length > 0) {
        body.includeDomains = includeDomains.map(d => d.startsWith(".") ? `*${d}` : d);
      }
      const r = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify(body),
      });
      if (!r.ok) return [];
      const d: any = await r.json();
      return d.results || [];
    };

    // Run both queries in parallel
    const [results1, results2] = await Promise.all([
      fetchExa(cityQuery),
      meta.domains.length > 0 && meta.domains[0] !== ".com"
        ? fetchExa(query, meta.domains)
        : Promise.resolve([]),
    ]);

    // Merge and deduplicate by URL
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const r of [...results1, ...results2]) {
      const url = (r.url || "").toLowerCase().replace(/\/$/, "");
      if (!seen.has(url)) {
        seen.add(url);
        merged.push(r);
      }
    }

    // Process results
    const allResults = merged.map((r: any) => {
      const allText = [r.text || "", r.summary || "", ...(r.highlights || [])].join(" ");
      const emailMatch = allText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
      const linkedinMatch = allText.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-zA-Z0-9\-_]+/);
      return {
        title: r.title || "Unknown Business",
        url: r.url || "#",
        summary: r.summary || r.highlights?.[0] || "",
        highlights: r.highlights || [],
        email: emailMatch ? emailMatch[0] : null,
        linkedinUrl: linkedinMatch ? linkedinMatch[0] : null,
        _fullText: allText,
        _url: (r.url || "").toLowerCase(),
      };
    });

    // STRICT post-filter: company MUST mention the city explicitly in text, title, or URL
    // Domain-only match is NOT sufficient (e.g. .co.id could be any Indonesian city)
    let results = allResults;
    if (city) {
      results = allResults.filter((r: any) => {
        const searchText = (r._fullText + " " + r._url + " " + r.title).toLowerCase();
        // MUST match at least one strict city term in content/title/URL
        return meta.strictTerms.some(term => searchText.includes(term));
      });
    }

    // Remove internal fields before returning
    results = results.slice(0, numResults).map(({ _fullText, _url, ...rest }: any) => rest);

    if (results.length === 0 && city) {
      return res.json({ results: [], message: `No companies found specifically in ${city}. Try a different category or city.` });
    }

    return res.json({ results });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// POST /api/find-contacts — Contact finder via Exa LinkedIn
// ============================================================
api.post("/api/find-contacts", async (req: Request, res: Response) => {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Exa not configured" });
  }

  const { leadName, city } = req.body;
  if (!leadName) {
    return res.status(400).json({ error: "leadName is required" });
  }

  try {
    const exaRes = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        query: `CEO OR Founder OR Director OR Owner "${leadName}" ${city || ""}`,
        type: "neural",
        numResults: 3,
        includeDomains: ["linkedin.com"],
        contents: { summary: true },
      }),
    });

    if (!exaRes.ok) {
      return res.json({ contacts: [], source: "exa" });
    }

    const data: any = await exaRes.json();
    const contacts = (data.results || []).map((r: any) => ({
      name: r.title || "Unknown",
      title: extractTitle(r.summary || ""),
      linkedinUrl: r.url || "",
      source: "exa",
    }));

    return res.json({ contacts, source: "exa" });
  } catch {
    return res.json({ contacts: [], source: "exa" });
  }
});

function extractTitle(summary: string): string {
  const m1 = summary.match(/is (?:the )?(?:current )?([A-Z][A-Za-z &\/\-]{3,50}?)\s+(?:at|of|for)\s/);
  if (m1) return m1[1].trim();
  const roles = ["Founder", "CEO", "Co-Founder", "Director", "Owner", "Managing Director", "General Manager"];
  for (const role of roles) {
    if (summary.includes(role)) return role;
  }
  return "Executive";
}

// ============================================================
// POST /api/generate-brief — SSE streaming sales kit generation
// ============================================================
api.post("/api/generate-brief", async (req: Request, res: Response) => {
  sseHeaders(res);
  const { business, lead, memories } = req.body;

  if (!business || !lead) {
    sseSend(res, { type: "error", message: "business and lead are required" });
    res.end();
    return;
  }

  try {
    sseSend(res, { type: "progress", pct: 10, message: "Preparing brief...", detail: "Gathering context" });

    const memoryText = Array.isArray(memories) && memories.length > 0
      ? memories.map((m: string, i: number) => `${i + 1}. ${m}`).join("\n")
      : "None saved.";

    const prompt = `Generate a Customer Meeting Prep Brief for a B2B sales call.
Use ONLY the information provided below — do NOT browse the web or visit any URLs.

Seller: ${business.companyName}
Value Proposition: ${business.valueProposition}
Products: ${(business.products || []).join(", ")}
Proof Points: ${(business.proofPoints || []).join(", ")}

Target Account: ${lead.name}
Category: ${lead.category || ""}
City: ${lead.city || ""}
Evidence Found: ${lead.summary}
Source URL: ${lead.url}

Business Memories & Preferences:
${memoryText}

Return ONLY valid JSON (no markdown) with this structure:
{
  "accountBrief": "2-3 sentences about the target account",
  "fitRationale": "Why this account is a strong fit",
  "meetingPrep": "Specific preparation steps before the call",
  "discoveryQuestions": ["Q1?", "Q2?", "Q3?"],
  "objectionsAndResponses": [
    { "objection": "...", "response": "..." }
  ],
  "outreachEmailSubject": "Subject line under 65 chars",
  "outreachEmailBody": "3-paragraph personalized email with clear CTA",
  "memoriesUsed": ["which memories influenced this brief"]
}`;

    sseSend(res, { type: "progress", pct: 30, message: "AI generating brief...", detail: "Processing with LLM" });

    const result = await invokeLLM({
      messages: [
        { role: "system", content: "You are an expert B2B sales strategist. Return only valid JSON." },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "meeting_brief",
          strict: true,
          schema: {
            type: "object",
            properties: {
              accountBrief: { type: "string" },
              fitRationale: { type: "string" },
              meetingPrep: { type: "string" },
              discoveryQuestions: { type: "array", items: { type: "string" } },
              objectionsAndResponses: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    objection: { type: "string" },
                    response: { type: "string" },
                  },
                  required: ["objection", "response"],
                  additionalProperties: false,
                },
              },
              outreachEmailSubject: { type: "string" },
              outreachEmailBody: { type: "string" },
              memoriesUsed: { type: "array", items: { type: "string" } },
            },
            required: ["accountBrief", "fitRationale", "meetingPrep", "discoveryQuestions", "objectionsAndResponses", "outreachEmailSubject", "outreachEmailBody", "memoriesUsed"],
            additionalProperties: false,
          },
        },
      },
    });

    sseSend(res, { type: "progress", pct: 80, message: "Parsing results...", detail: "Extracting brief" });

    const content_text = result.choices[0]?.message?.content;
    let parsed: any;
    if (typeof content_text === "string") {
      const cleaned = content_text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    } else {
      throw new Error("No content in LLM response");
    }

    sseSend(res, { type: "progress", pct: 95, message: "Complete!", detail: "Brief ready" });
    sseSend(res, { type: "complete", result: parsed });
  } catch (e: any) {
    sseSend(res, { type: "error", message: e.message || "Brief generation failed" });
  }
  res.end();
});

// ============================================================
// POST /api/generate-sales-kit — SSE streaming sales kit generation
// ============================================================
api.post("/api/generate-sales-kit", async (req: Request, res: Response) => {
  sseHeaders(res);
  const { business, lead, memories, reviewPainPoints } = req.body;

  if (!business || !lead) {
    sseSend(res, { type: "error", message: "business and lead are required" });
    res.end();
    return;
  }

  try {
    // Phase 1: Fetch prospect website for context
    sseSend(res, { type: "progress", pct: 10, message: "Researching prospect...", detail: "Fetching prospect website" });

    let prospectContent = "";
    try {
      const prospectRes = await fetch(lead.url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
        signal: AbortSignal.timeout(15000),
      });
      const prospectHtml = await prospectRes.text();
      prospectContent = prospectHtml
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 3000);
    } catch {}

    sseSend(res, { type: "progress", pct: 30, message: "Generating sales kit...", detail: "AI analyzing synergies" });

    // Phase 2: Generate the sales kit via LLM
    const memoryText = Array.isArray(memories) && memories.length > 0
      ? memories.map((m: string, i: number) => `${i + 1}. ${m}`).join("\n")
      : "None saved.";

    const kitPrompt = `You are an expert B2B sales strategist creating a complete sales kit.
Use ONLY the information provided below — do NOT browse the web.

SELLER COMPANY:
Name: ${business.companyName}
Website: ${business.website}
Value Proposition: ${business.valueProposition}
Products: ${(business.products || []).join(", ")}
Proof Points: ${(business.proofPoints || []).join(", ")}
Current Segments: ${(business.currentSegments || []).join(", ")}

PROSPECT COMPANY:
Name: ${lead.name}
Website: ${lead.url}
Category: ${lead.category || ""}
City: ${lead.city || ""}
Evidence: ${lead.summary}
Prospect Website Content: ${prospectContent.slice(0, 2000)}

Business Memories & Preferences:
${memoryText}
${Array.isArray(reviewPainPoints) && reviewPainPoints.length > 0 ? `
CUSTOMER REVIEW PAIN POINTS (from real online reviews of the prospect):
${reviewPainPoints.map((pp: any, i: number) => `${i + 1}. [${pp.severity?.toUpperCase() || "MEDIUM"}] ${pp.issue} — Evidence: "${pp.evidence}"`).join("\n")}

IMPORTANT: Use these verified pain points from actual customer reviews to make the outreach email and synergies more specific and credible. Reference specific complaints or issues in the email body.
` : ""}
Generate a complete B2B sales kit with:
1. Account Brief - what the prospect does, why commercially relevant now, top synergies
2. Outreach Email - under 180 words, specific opening referencing prospect's website, connect ONE seller capability to ONE prospect pain, low-friction CTA, peer-to-peer tone
3. Synergies - list of seller products matched to prospect pain points with evidence
4. Solutions - 4-6 key solutions the seller offers that are relevant to this prospect
5. Why This Prospect - 4 specific reasons tied to evidence from their website

Return ONLY valid JSON with this structure:
{
  "accountBrief": "Detailed account brief paragraph",
  "whyRelevantNow": "Why this is a high-priority target right now",
  "synergies": [{"sellerProduct": "...", "prospectPain": "...", "evidence": "..."}],
  "suggestedAngle": "One-sentence BD angle",
  "outreachEmailSubject": "Subject line under 65 chars, curiosity-driven",
  "outreachEmailBody": "Full email body under 180 words",
  "solutions": [{"title": "...", "description": "One sentence"}],
  "whyThisProspect": ["Point 1 tied to evidence", "Point 2", "Point 3", "Point 4"],
  "proofStats": [{"number": "50+", "label": "Projects Delivered"}],
  "memoriesUsed": ["which memories influenced this"]
}`;

    const result = await invokeLLM({
      messages: [
        { role: "system", content: "You are an expert B2B sales strategist. Return only valid JSON." },
        { role: "user", content: kitPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "sales_kit",
          strict: true,
          schema: {
            type: "object",
            properties: {
              accountBrief: { type: "string" },
              whyRelevantNow: { type: "string" },
              synergies: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    sellerProduct: { type: "string" },
                    prospectPain: { type: "string" },
                    evidence: { type: "string" },
                  },
                  required: ["sellerProduct", "prospectPain", "evidence"],
                  additionalProperties: false,
                },
              },
              suggestedAngle: { type: "string" },
              outreachEmailSubject: { type: "string" },
              outreachEmailBody: { type: "string" },
              solutions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["title", "description"],
                  additionalProperties: false,
                },
              },
              whyThisProspect: { type: "array", items: { type: "string" } },
              proofStats: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    number: { type: "string" },
                    label: { type: "string" },
                  },
                  required: ["number", "label"],
                  additionalProperties: false,
                },
              },
              memoriesUsed: { type: "array", items: { type: "string" } },
            },
            required: ["accountBrief", "whyRelevantNow", "synergies", "suggestedAngle", "outreachEmailSubject", "outreachEmailBody", "solutions", "whyThisProspect", "proofStats", "memoriesUsed"],
            additionalProperties: false,
          },
        },
      },
    });

    sseSend(res, { type: "progress", pct: 80, message: "Processing results...", detail: "Finalizing sales kit" });

    const content_text = result.choices[0]?.message?.content;
    let kit: any;
    if (typeof content_text === "string") {
      const cleaned = content_text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      kit = JSON.parse(cleaned);
    } else {
      throw new Error("No content in LLM response");
    }

    sseSend(res, { type: "progress", pct: 95, message: "Complete!", detail: "Sales kit ready" });
    sseSend(res, {
      type: "complete",
      result: {
        accountBrief: kit.accountBrief,
        whyRelevantNow: kit.whyRelevantNow,
        synergies: kit.synergies,
        suggestedAngle: kit.suggestedAngle,
        outreachEmailSubject: kit.outreachEmailSubject,
        outreachEmailBody: kit.outreachEmailBody,
        solutions: kit.solutions,
        whyThisProspect: kit.whyThisProspect,
        proofStats: kit.proofStats,
        memoriesUsed: kit.memoriesUsed,
      },
    });
  } catch (e: any) {
    sseSend(res, { type: "error", message: e.message || "Sales kit generation failed" });
  }
  res.end();
});

// ============================================================
// POST /api/send-email — Send outreach email via Resend
// ============================================================
api.post("/api/send-email", async (req: Request, res: Response) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "Resend not configured" });
  }

  const { subject, html, from } = req.body;
  // Fixed recipient as configured
  const to = "ngurah.linggih@gmail.com";
  if (!subject || !html) {
    return res.status(400).json({ ok: false, error: "subject and html are required" });
  }

  try {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || "nura@biks.ai",
        to,
        subject,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errData: any = await resendRes.json();
      return res.json({ ok: false, error: errData.message || "Send failed" });
    }

    const data: any = await resendRes.json();
    return res.json({ ok: true, id: data.id });
  } catch (e: any) {
    return res.json({ ok: false, error: e.message });
  }
});

// ============================================================
// Shared HTML email builder
// ============================================================
function buildKitEmailHtml(business: any, lead: any, salesKit: any, contacts: any[], painPoints?: any[]) {
  const synergiesHtml = (salesKit.synergies || []).map((s: any) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #2a2a2a;font-size:13px;color:#e0e0e0;">${s.sellerProduct}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #2a2a2a;font-size:13px;color:#e0e0e0;">${s.prospectPain}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #2a2a2a;font-size:13px;color:#999;font-style:italic;">${s.evidence}</td>
    </tr>
  `).join("");

  const contactsHtml = (contacts || []).length > 0 ? `
    <div style="margin-top:24px;padding:20px;background:#161616;border:1px solid #2a2a2a;border-radius:8px;">
      <h3 style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#5b8af5;margin:0 0 12px;">Key Decision Makers</h3>
      ${(contacts || []).map((c: any) => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #222;">
          <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#5b8af5,#3ecf8e);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;">${(c.name || "?").charAt(0)}</div>
          <div>
            <div style="font-size:13px;color:#f0f0f0;font-weight:500;">${c.name}</div>
            <div style="font-size:11px;color:#666;">${c.title}${c.linkedinUrl ? ` \u00b7 <a href="${c.linkedinUrl}" style="color:#5b8af5;text-decoration:none;">LinkedIn</a>` : ''}</div>
          </div>
        </div>
      `).join("")}
    </div>
  ` : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;background:#0f0f0f;padding:0;">
  <!-- Header -->
  <div style="padding:24px 32px;border-bottom:1px solid #1e1e1e;">
    <div style="display:flex;align-items:center;gap:8px;">
      <div style="width:24px;height:24px;background:#f0f0f0;border-radius:4px;display:flex;align-items:center;justify-content:center;">
        <span style="font-size:10px;font-weight:900;color:#0f0f0f;">B</span>
      </div>
      <span style="font-size:16px;font-weight:700;color:#f0f0f0;font-family:'DM Serif Display',serif;">Biks.ai</span>
    </div>
  </div>

  <!-- Hero -->
  <div style="padding:40px 32px;text-align:center;background:linear-gradient(180deg,#111 0%,#0f0f0f 100%);">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#5b8af5;margin-bottom:12px;">PARTNERSHIP OPPORTUNITY</div>
    <h1 style="font-size:24px;font-weight:700;color:#f0f0f0;margin:0 0 8px;line-height:1.3;">${business.companyName} \u00d7 ${lead.name}</h1>
    <p style="font-size:14px;color:#888;margin:0;">${lead.category || ''} ${lead.city ? '\u00b7 ' + lead.city : ''}</p>
  </div>

  <!-- Outreach Message -->
  <div style="padding:32px;">
    <div style="background:#161616;border:1px solid #2a2a2a;border-radius:10px;padding:24px;">
      <h3 style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#3ecf8e;margin:0 0 16px;">Message</h3>
      <div style="font-size:14px;color:#ccc;line-height:1.8;white-space:pre-wrap;">${salesKit.outreachEmailBody}</div>
    </div>
  </div>

  <!-- Why Relevant Now -->
  <div style="padding:0 32px 24px;">
    <div style="background:#0e1e16;border:1px solid #2a4a37;border-radius:10px;padding:20px;">
      <h3 style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#3ecf8e;margin:0 0 10px;">Why Relevant Now</h3>
      <p style="font-size:13px;color:#a0d4b8;line-height:1.6;margin:0;">${salesKit.whyRelevantNow}</p>
    </div>
  </div>

  <!-- Pain Points from Reviews -->
  ${Array.isArray(painPoints) && painPoints.length > 0 ? `
  <div style="padding:0 32px 24px;">
    <h3 style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#f5454a;margin:0 0 12px;">Customer Pain Points We Can Solve</h3>
    <div style="background:#1a1515;border:1px solid #3a2020;border-radius:8px;padding:16px;">
      ${painPoints.slice(0, 3).map((pp: any) => `
        <div style="padding:8px 0;border-bottom:1px solid #2a2020;">
          <div style="font-size:13px;color:#f0f0f0;font-weight:500;margin-bottom:4px;">${pp.issue}</div>
          <div style="font-size:11px;color:#888;font-style:italic;">&ldquo;${pp.evidence}&rdquo;</div>
        </div>
      `).join("")}
    </div>
  </div>
  ` : ""}

  <!-- Synergies -->
  <div style="padding:0 32px 24px;">
    <h3 style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#444;margin:0 0 12px;">Top Synergies</h3>
    <table style="width:100%;border-collapse:collapse;background:#161616;border:1px solid #2a2a2a;border-radius:8px;overflow:hidden;">
      <tr style="background:#1a1a1a;">
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:#5b8af5;text-align:left;border-bottom:1px solid #2a2a2a;">Our Solution</th>
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:#f5454a;text-align:left;border-bottom:1px solid #2a2a2a;">Your Need</th>
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:#3ecf8e;text-align:left;border-bottom:1px solid #2a2a2a;">Evidence</th>
      </tr>
      ${synergiesHtml}
    </table>
  </div>

  <!-- Contacts -->
  ${contactsHtml}

  <!-- CTA -->
  <div style="padding:32px;text-align:center;">
    <div style="background:linear-gradient(135deg,#5b8af5,#3ecf8e);border-radius:10px;padding:32px;">
      <h3 style="font-size:18px;font-weight:700;color:#fff;margin:0 0 12px;">Let's Explore This Together</h3>
      <p style="font-size:13px;color:rgba(255,255,255,0.8);margin:0 0 20px;">${salesKit.suggestedAngle}</p>
      <a href="${business.website || '#'}" style="display:inline-block;background:#fff;color:#0f0f0f;font-size:13px;font-weight:700;padding:12px 28px;border-radius:6px;text-decoration:none;">Schedule a Call \u2192</a>
    </div>
  </div>

  <!-- Footer -->
  <div style="padding:24px 32px;border-top:1px solid #1e1e1e;text-align:center;">
    <p style="font-size:11px;color:#555;margin:0;">Sent via <span style="color:#f0f0f0;font-weight:600;">Biks.ai</span> \u2014 AI-powered sales intelligence</p>
    <p style="font-size:10px;color:#333;margin:8px 0 0;">From ${business.companyName} \u2022 ${business.website || ''}</p>
  </div>
</div>
</body>
</html>`;
}

// ============================================================
// POST /api/preview-kit-email — Return the exact HTML that would be sent
// ============================================================
api.post("/api/preview-kit-email", async (req: Request, res: Response) => {
  const { business, lead, salesKit, contacts, painPoints } = req.body;
  if (!business || !lead || !salesKit) {
    return res.status(400).json({ error: "business, lead, and salesKit are required" });
  }
  const html = buildKitEmailHtml(business, lead, salesKit, contacts || [], painPoints || []);
  return res.json({ html });
});

// ============================================================
// POST /api/send-kit-email — Send native HTML marketing email via Resend
// ============================================================
api.post("/api/send-kit-email", async (req: Request, res: Response) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "Resend not configured" });
  }

  const { business, lead, salesKit, contacts, painPoints } = req.body;
  if (!business || !lead || !salesKit) {
    return res.status(400).json({ ok: false, error: "business, lead, and salesKit are required" });
  }

  const to = "ngurah.linggih@gmail.com";
  const subject = salesKit.outreachEmailSubject || `${business.companyName} \u00d7 ${lead.name} \u2014 Partnership Opportunity`;

  const htmlBody = buildKitEmailHtml(business, lead, salesKit, contacts || [], painPoints || []);

  try {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || "nura@biks.ai",
        to,
        subject,
        html: htmlBody,
      }),
    });

    if (!resendRes.ok) {
      const errData: any = await resendRes.json();
      return res.json({ ok: false, error: errData.message || "Send failed" });
    }

    const data: any = await resendRes.json();
    return res.json({ ok: true, id: data.id });
  } catch (e: any) {
    return res.json({ ok: false, error: e.message });
  }
});

// ============================================================
// POST /api/scrape-reviews — Fetch & analyze Google Reviews of prospect
// ============================================================
api.post("/api/scrape-reviews", async (req: Request, res: Response) => {
  const exaKey = process.env.EXA_API_KEY;
  if (!exaKey) {
    return res.status(500).json({ error: "Exa not configured" });
  }

  const { leadName, leadUrl, sellerProducts, sellerSummary } = req.body;
  if (!leadName) {
    return res.status(400).json({ error: "leadName is required" });
  }

  try {
    // Step 1: Search for Google Reviews of the prospect company via Exa
    const reviewQueries = [
      `${leadName} Google reviews`,
      `${leadName} customer reviews complaints`,
      `${leadName} review rating feedback`,
    ];

    const fetchExa = async (q: string) => {
      const body: any = {
        query: q,
        type: "auto",
        numResults: 5,
        contents: {
          text: { maxCharacters: 3000 },
          highlights: true,
          summary: true,
        },
      };
      const r = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": exaKey },
        body: JSON.stringify(body),
      });
      if (!r.ok) return [];
      const d: any = await r.json();
      return d.results || [];
    };

    // Run all queries in parallel
    const allResults = await Promise.all(reviewQueries.map(fetchExa));
    const merged = allResults.flat();

    // Deduplicate by URL
    const seen = new Set<string>();
    const unique: any[] = [];
    for (const r of merged) {
      const url = (r.url || "").toLowerCase().replace(/\/$/, "");
      if (!seen.has(url)) {
        seen.add(url);
        unique.push(r);
      }
    }

    // Extract review content
    const reviewTexts = unique.slice(0, 8).map((r: any) => {
      const text = r.text || r.summary || "";
      const highlights = (r.highlights || []).join(" ");
      return `Source: ${r.url}\nTitle: ${r.title || ""}\nContent: ${text}\nHighlights: ${highlights}`;
    }).join("\n\n---\n\n");

    if (!reviewTexts.trim()) {
      return res.json({
        reviews: [],
        painPoints: [],
        solutionMapping: [],
        summary: "No reviews found for this company.",
      });
    }

    // Step 2: Use LLM to analyze reviews and extract pain points
    const analysisPrompt = `You are analyzing customer reviews and feedback about "${leadName}" (${leadUrl || ""}).

Here is the review/feedback content found online:
${reviewTexts}

Our company offers these products/services:
${(sellerProducts || []).join(", ")}

Our company summary: ${sellerSummary || ""}

Analyze the reviews and return ONLY valid JSON with this structure:
{
  "reviews": [
    {
      "text": "The actual review or complaint text (quoted or paraphrased)",
      "rating": 1-5 (estimated star rating, use 0 if unknown),
      "source": "URL where this was found",
      "sentiment": "negative" | "neutral" | "positive"
    }
  ],
  "painPoints": [
    {
      "issue": "Short description of the pain point",
      "frequency": "How often this is mentioned (common/occasional/rare)",
      "severity": "high" | "medium" | "low",
      "evidence": "Direct quote or paraphrase from reviews"
    }
  ],
  "solutionMapping": [
    {
      "painPoint": "The prospect's pain point",
      "ourSolution": "How our product/service solves this",
      "talkingPoint": "A specific talking point for the sales conversation"
    }
  ],
  "summary": "2-3 sentence summary of the prospect's main weaknesses/pain points that we can address"
}

Focus on NEGATIVE reviews and complaints. Extract 3-6 pain points. Map each to our solutions where possible. If reviews are mostly positive, still identify areas of improvement or gaps we can fill.`;

    const result = await invokeLLM({
      messages: [
        { role: "system", content: "You are a competitive intelligence analyst. Extract pain points from reviews and map them to sales opportunities. Return only valid JSON." },
        { role: "user", content: analysisPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "review_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              reviews: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    rating: { type: "number" },
                    source: { type: "string" },
                    sentiment: { type: "string" },
                  },
                  required: ["text", "rating", "source", "sentiment"],
                  additionalProperties: false,
                },
              },
              painPoints: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    issue: { type: "string" },
                    frequency: { type: "string" },
                    severity: { type: "string" },
                    evidence: { type: "string" },
                  },
                  required: ["issue", "frequency", "severity", "evidence"],
                  additionalProperties: false,
                },
              },
              solutionMapping: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    painPoint: { type: "string" },
                    ourSolution: { type: "string" },
                    talkingPoint: { type: "string" },
                  },
                  required: ["painPoint", "ourSolution", "talkingPoint"],
                  additionalProperties: false,
                },
              },
              summary: { type: "string" },
            },
            required: ["reviews", "painPoints", "solutionMapping", "summary"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = result.choices?.[0]?.message?.content;
    const content = typeof rawContent === "string" ? rawContent : "{}";
    let analysis;
    try {
      analysis = JSON.parse(content);
    } catch {
      analysis = { reviews: [], painPoints: [], solutionMapping: [], summary: "Failed to analyze reviews." };
    }

    return res.json(analysis);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default api;
