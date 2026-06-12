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

  const { query, numResults = 5 } = req.body;
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
        query,
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
    const results = (data.results || []).map((r: any) => {
      // Extract email from text/highlights if available
      const allText = [r.text || "", r.summary || "", ...(r.highlights || [])].join(" ");
      const emailMatch = allText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
      return {
        title: r.title || "Unknown Business",
        url: r.url || "#",
        summary: r.summary || r.highlights?.[0] || "",
        highlights: r.highlights || [],
        email: emailMatch ? emailMatch[0] : null,
      };
    });

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
