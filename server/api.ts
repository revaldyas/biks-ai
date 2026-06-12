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

    // Fetch website content
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let html = "";
    try {
      const fetchRes = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BiksBot/1.0)" },
        signal: controller.signal,
      });
      html = await fetchRes.text();
    } catch (e: any) {
      sseSend(res, { type: "error", message: `Failed to fetch website: ${e.message}` });
      res.end();
      return;
    } finally {
      clearTimeout(timeout);
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
    const id = data?.results?.[0]?.id || `local_${Date.now()}`;
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

  try {
    const exaRes = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        query: city ? `${query} located in ${city}` : query,
        type: "auto",
        category: "company",
        numResults,
        contents: {
          text: { maxCharacters: 2000 },
          highlights: true,
          summary: true,
        },
      }),
    });

    if (!exaRes.ok) {
      const errText = await exaRes.text();
      return res.status(exaRes.status).json({ error: errText });
    }

    const data: any = await exaRes.json();
    const allResults = (data.results || []).map((r: any) => {
      // Extract email from text/highlights if available
      const allText = [r.text || "", r.summary || "", ...(r.highlights || [])].join(" ");
      const emailMatch = allText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
      return {
        title: r.title || "Unknown Business",
        url: r.url || "#",
        summary: r.summary || r.highlights?.[0] || "",
        highlights: r.highlights || [],
        email: emailMatch ? emailMatch[0] : null,
        _fullText: allText,
      };
    });

    // Post-filter: only keep results that mention the city (or its known aliases) in their content/URL
    let results = allResults;
    if (city) {
      const cityLower = city.toLowerCase();
      const cityAliases: Record<string, string[]> = {
        "singapore": ["singapore", "sg", ".sg"],
        "jakarta": ["jakarta", "jkt", ".id", "indonesia"],
        "bali": ["bali", ".id", "indonesia"],
        "kuala lumpur": ["kuala lumpur", "kl", ".my", "malaysia"],
        "bangkok": ["bangkok", "bkk", ".th", "thailand"],
        "ho chi minh city": ["ho chi minh", "hcmc", "saigon", ".vn", "vietnam"],
        "manila": ["manila", ".ph", "philippines"],
        "hong kong": ["hong kong", "hongkong", ".hk"],
        "tokyo": ["tokyo", ".jp", "japan"],
        "sydney": ["sydney", ".au", "australia"],
        "dubai": ["dubai", ".ae", "uae"],
        "london": ["london", ".uk", "united kingdom"],
        "new york": ["new york", "nyc", "ny"],
      };
      const aliases = cityAliases[cityLower] || [cityLower];
      results = allResults.filter((r: any) => {
        const searchText = (r._fullText + " " + r.url + " " + r.title).toLowerCase();
        return aliases.some(alias => searchText.includes(alias));
      });
      // If filtering removes all results, return unfiltered with a note
      if (results.length === 0) results = allResults;
    }

    // Remove internal _fullText field before returning
    results = results.map(({ _fullText, ...rest }: any) => rest);

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
// POST /api/generate-sales-kit — SSE streaming sales kit with HTML one-pager
// ============================================================
api.post("/api/generate-sales-kit", async (req: Request, res: Response) => {
  sseHeaders(res);
  const { business, lead, memories } = req.body;

  if (!business || !lead) {
    sseSend(res, { type: "error", message: "business and lead are required" });
    res.end();
    return;
  }

  try {
    // Phase 1: Fetch seller website for design tokens
    sseSend(res, { type: "progress", pct: 5, message: "Analyzing seller website...", detail: "Extracting design language" });

    let sellerHtml = "";
    let sellerCss = "";
    try {
      const sellerRes = await fetch(business.website, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BiksBot/1.0)" },
        signal: AbortSignal.timeout(10000),
      });
      sellerHtml = await sellerRes.text();

      // Try to extract CSS link
      const cssMatch = sellerHtml.match(/href="([^"]*\.css[^"]*)"/i);
      if (cssMatch) {
        const cssUrl = cssMatch[1].startsWith("http") ? cssMatch[1] : new URL(cssMatch[1], business.website).href;
        try {
          const cssRes = await fetch(cssUrl, { signal: AbortSignal.timeout(5000) });
          sellerCss = (await cssRes.text()).slice(0, 3000);
        } catch {}
      }
    } catch {}

    // Extract design tokens from CSS/HTML
    const colorMatches = (sellerCss + sellerHtml).match(/#[0-9a-fA-F]{6}/g) || [];
    const primaryColor = colorMatches[0] || "#1a5276";
    const fontMatch = (sellerCss + sellerHtml).match(/font-family[:\s]*['"]?([^;'"\}]+)/i);
    const fontFamily = fontMatch ? fontMatch[1].trim().split(",")[0].replace(/['"]*/g, "") : "Inter";

    // Try to find logo
    const logoMatch = sellerHtml.match(/<img[^>]*(?:logo|brand)[^>]*src=["']([^"']+)["']/i)
      || sellerHtml.match(/<img[^>]*src=["']([^"']*logo[^"']*)["']/i);
    const sellerLogoUrl = logoMatch ? (logoMatch[1].startsWith("http") ? logoMatch[1] : new URL(logoMatch[1], business.website).href) : "";

    sseSend(res, { type: "progress", pct: 15, message: "Analyzing prospect website...", detail: "Fetching prospect data" });

    // Phase 2: Fetch prospect website
    let prospectContent = "";
    let prospectLogoUrl = "";
    try {
      const prospectRes = await fetch(lead.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BiksBot/1.0)" },
        signal: AbortSignal.timeout(10000),
      });
      const prospectHtml = await prospectRes.text();
      const pLogoMatch = prospectHtml.match(/<img[^>]*(?:logo|brand)[^>]*src=["']([^"']+)["']/i)
        || prospectHtml.match(/<img[^>]*src=["']([^"']*logo[^"']*)["']/i);
      prospectLogoUrl = pLogoMatch ? (pLogoMatch[1].startsWith("http") ? pLogoMatch[1] : new URL(pLogoMatch[1], lead.url).href) : "";

      prospectContent = prospectHtml
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 3000);
    } catch {}

    sseSend(res, { type: "progress", pct: 30, message: "Generating sales kit...", detail: "AI analyzing synergies" });

    // Phase 3: Generate the full sales kit via LLM
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

Generate a complete B2B sales kit with:
1. Account Brief - what the prospect does, why commercially relevant now, top synergies (seller product → prospect pain point → evidence from website)
2. Outreach Email - under 180 words, specific opening referencing something from prospect's website, connect ONE seller capability to ONE prospect pain, low-friction CTA, peer-to-peer tone
3. Synergies - list of seller products matched to prospect pain points with evidence
4. One-pager content - hero headline, subheadline, intro statement, about seller text, solution items (6), why-this-prospect points (4), proof stats (3), CTA text

Return ONLY valid JSON with this structure:
{
  "accountBrief": "Detailed account brief paragraph",
  "whyRelevantNow": "Why this is a high-priority target right now",
  "synergies": [{"sellerProduct": "...", "prospectPain": "...", "evidence": "..."}],
  "suggestedAngle": "One-sentence BD angle",
  "outreachEmailSubject": "Subject line under 65 chars, curiosity-driven",
  "outreachEmailBody": "Full email body under 180 words",
  "onePager": {
    "heroHeadline": "Bold headline for the one-pager",
    "heroSubheadline": "Supporting subheadline",
    "introStatement": "Single sentence establishing core opportunity",
    "aboutSeller": "2 paragraphs about the seller",
    "solutions": [{"title": "...", "description": "One sentence"}],
    "whyThisProspect": ["Point 1 tied to evidence", "Point 2", "Point 3", "Point 4"],
    "proofStats": [{"number": "50+", "label": "Projects Delivered"}],
    "ctaHeadline": "CTA section headline",
    "ctaButtonText": "Button text",
    "ctaContact": "Contact details"
  },
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
              onePager: {
                type: "object",
                properties: {
                  heroHeadline: { type: "string" },
                  heroSubheadline: { type: "string" },
                  introStatement: { type: "string" },
                  aboutSeller: { type: "string" },
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
                  ctaHeadline: { type: "string" },
                  ctaButtonText: { type: "string" },
                  ctaContact: { type: "string" },
                },
                required: ["heroHeadline", "heroSubheadline", "introStatement", "aboutSeller", "solutions", "whyThisProspect", "proofStats", "ctaHeadline", "ctaButtonText", "ctaContact"],
                additionalProperties: false,
              },
              memoriesUsed: { type: "array", items: { type: "string" } },
            },
            required: ["accountBrief", "whyRelevantNow", "synergies", "suggestedAngle", "outreachEmailSubject", "outreachEmailBody", "onePager", "memoriesUsed"],
            additionalProperties: false,
          },
        },
      },
    });

    sseSend(res, { type: "progress", pct: 70, message: "Building HTML one-pager...", detail: "Assembling branded document" });

    const content_text = result.choices[0]?.message?.content;
    let kit: any;
    if (typeof content_text === "string") {
      const cleaned = content_text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      kit = JSON.parse(cleaned);
    } else {
      throw new Error("No content in LLM response");
    }

    // Phase 4: Build HTML one-pager
    const op = kit.onePager;
    const htmlOnePager = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${business.companyName} × ${lead.name} — Sales Kit</title>
<!-- Fonts loaded from Google as enhancement; falls back to system fonts -->
<link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@400;600;700&family=Playfair+Display:ital,wght@0,700;1,400&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #f5f5f5; font-family: '${fontFamily}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; }
.wrapper { max-width: 600px; margin: 0 auto; background: #fff; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
.accent-bar { height: 4px; background: linear-gradient(90deg, ${primaryColor}, ${primaryColor}88); }
.top-bar { background: ${primaryColor}; padding: 8px 24px; text-align: center; }
.top-bar span { color: #fff; font-size: 11px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; }
.navbar { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; border-bottom: 1px solid #eee; }
.navbar .logos { display: flex; align-items: center; gap: 12px; }
.navbar .logos img { height: 28px; max-width: 120px; object-fit: contain; }
.navbar .logos .divider { width: 1px; height: 24px; background: #ddd; }
.navbar .badge { font-size: 9px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #999; border: 1px solid #ddd; padding: 3px 8px; border-radius: 3px; }
.hero { background: ${primaryColor}; padding: 48px 32px; text-align: center; }
.hero h1 { font-family: 'Playfair Display', serif; font-size: 28px; color: #fff; margin-bottom: 12px; font-weight: 700; }
.hero p { font-size: 14px; color: rgba(255,255,255,0.85); margin-bottom: 20px; }
.hero .cta-btn { display: inline-block; background: #fff; color: ${primaryColor}; font-size: 13px; font-weight: 700; padding: 10px 24px; border-radius: 4px; text-decoration: none; }
.partner-strip { display: flex; align-items: center; justify-content: center; gap: 16px; padding: 20px 24px; background: #fafafa; border-bottom: 1px solid #eee; }
.partner-strip span { font-size: 11px; color: #888; font-weight: 600; }
.partner-strip img { height: 22px; max-width: 100px; object-fit: contain; }
.intro { padding: 32px 32px 24px; text-align: center; }
.intro p { font-family: 'Playfair Display', serif; font-style: italic; font-size: 16px; color: #444; line-height: 1.6; }
.about { padding: 24px 32px; }
.about h2 { font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: ${primaryColor}; margin-bottom: 12px; }
.about p { font-size: 13px; color: #444; line-height: 1.7; margin-bottom: 12px; }
.solutions { padding: 24px 32px; }
.solutions h2 { font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: ${primaryColor}; margin-bottom: 16px; }
.solutions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.solution-cell { padding: 14px; border: 1px solid #eee; border-radius: 6px; }
.solution-cell .dot { width: 8px; height: 8px; border-radius: 50%; background: ${primaryColor}; display: inline-block; margin-right: 8px; }
.solution-cell h3 { font-size: 13px; font-weight: 700; display: inline; }
.solution-cell p { font-size: 12px; color: #666; margin-top: 6px; line-height: 1.5; }
.why-section { background: #1a2332; padding: 32px; }
.why-section h2 { font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.6); margin-bottom: 16px; }
.why-section ol { list-style: none; counter-reset: why; }
.why-section li { counter-increment: why; font-size: 13px; color: rgba(255,255,255,0.9); padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); line-height: 1.5; }
.why-section li::before { content: counter(why) "."; font-weight: 700; color: ${primaryColor}; margin-right: 10px; }
.proof { padding: 32px; text-align: center; }
.proof h2 { font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: ${primaryColor}; margin-bottom: 16px; }
.proof-grid { display: flex; justify-content: center; gap: 24px; }
.proof-cell { text-align: center; }
.proof-cell .number { font-family: 'Playfair Display', serif; font-size: 28px; font-weight: 700; color: ${primaryColor}; }
.proof-cell .label { font-size: 11px; color: #888; margin-top: 4px; }
.quote { padding: 32px; text-align: center; border-top: 1px solid #eee; }
.quote p { font-family: 'Playfair Display', serif; font-style: italic; font-size: 16px; color: #333; line-height: 1.6; }
.cta-section { background: ${primaryColor}; padding: 32px; text-align: center; }
.cta-section h2 { font-family: 'Playfair Display', serif; font-size: 22px; color: #fff; margin-bottom: 16px; }
.cta-section .btn { display: inline-block; background: #fff; color: ${primaryColor}; font-size: 13px; font-weight: 700; padding: 10px 24px; border-radius: 4px; text-decoration: none; margin-bottom: 12px; }
.cta-section .contact { font-size: 12px; color: rgba(255,255,255,0.8); }
.footer { padding: 20px 24px; text-align: center; border-top: 1px solid #eee; }
.footer img { height: 20px; margin-bottom: 8px; }
.footer p { font-size: 10px; color: #aaa; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="accent-bar"></div>
  <div class="top-bar"><span>Confidential Sales Brief</span></div>
  <div class="navbar">
    <div class="logos">
      ${sellerLogoUrl ? `<img src="${sellerLogoUrl}" alt="${business.companyName}">` : `<span style="font-weight:700;font-size:14px;">${business.companyName}</span>`}
      <div class="divider"></div>
      ${prospectLogoUrl ? `<img src="${prospectLogoUrl}" alt="${lead.name}">` : `<span style="font-weight:700;font-size:14px;">${lead.name}</span>`}
    </div>
    <div class="badge">Confidential</div>
  </div>
  <div class="hero">
    <h1>${op.heroHeadline}</h1>
    <p>${op.heroSubheadline}</p>
    <a href="mailto:${business.website ? 'hello@' + new URL(business.website).hostname : ''}" class="cta-btn">${op.ctaButtonText}</a>
  </div>
  <div class="partner-strip">
    <span>Presented to</span>
    ${prospectLogoUrl ? `<img src="${prospectLogoUrl}" alt="${lead.name}">` : `<strong>${lead.name}</strong>`}
    <span>by</span>
    ${sellerLogoUrl ? `<img src="${sellerLogoUrl}" alt="${business.companyName}">` : `<strong>${business.companyName}</strong>`}
  </div>
  <div class="intro"><p>${op.introStatement}</p></div>
  <div class="about">
    <h2>About ${business.companyName}</h2>
    <p>${op.aboutSeller}</p>
  </div>
  <div class="solutions">
    <h2>Solutions</h2>
    <div class="solutions-grid">
      ${(op.solutions || []).map((s: any) => `<div class="solution-cell"><span class="dot"></span><h3>${s.title}</h3><p>${s.description}</p></div>`).join("\n      ")}
    </div>
  </div>
  <div class="why-section">
    <h2>Why ${lead.name}?</h2>
    <ol>
      ${(op.whyThisProspect || []).map((p: string) => `<li>${p}</li>`).join("\n      ")}
    </ol>
  </div>
  <div class="proof">
    <h2>Track Record</h2>
    <div class="proof-grid">
      ${(op.proofStats || []).map((s: any) => `<div class="proof-cell"><div class="number">${s.number}</div><div class="label">${s.label}</div></div>`).join("\n      ")}
    </div>
  </div>
  <div class="quote"><p>"${business.valueProposition}"</p></div>
  <div class="cta-section">
    <h2>${op.ctaHeadline}</h2>
    <a href="mailto:${business.website ? 'hello@' + new URL(business.website).hostname : ''}" class="btn">${op.ctaButtonText}</a>
    <div class="contact">${op.ctaContact}</div>
  </div>
  <div class="footer">
    ${sellerLogoUrl ? `<img src="${sellerLogoUrl}" alt="${business.companyName}">` : `<strong>${business.companyName}</strong>`}
    <p>© ${new Date().getFullYear()} ${business.companyName}. All rights reserved.</p>
  </div>
</div>
</body>
</html>`;

    // Save HTML to storage
    sseSend(res, { type: "progress", pct: 90, message: "Saving one-pager...", detail: "Uploading to storage" });

    const { storagePut } = await import("./storage");
    const { url: htmlUrl } = await storagePut(
      `sales-kits/${business.companyName.replace(/\s+/g, "-").toLowerCase()}-${lead.name.replace(/\s+/g, "-").toLowerCase()}.html`,
      htmlOnePager,
      "text/html",
    );

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
        memoriesUsed: kit.memoriesUsed,
        onePagerUrl: htmlUrl,
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

export default api;
