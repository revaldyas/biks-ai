import { Router, Request, Response, NextFunction } from "express";
import { ENV } from "./_core/env";
import { manusTask, startManusTask, checkManusTask } from "./_core/manus";
import {
  isSupabaseConfigured,
  verifyRequestUser,
  type SupabaseUser,
} from "./_core/supabaseAuth";
import { lowQualitySourceReason, matchMandatoryEvidence, selectStrongestQueries, splitMemoryPolarity, stripLocationTerms } from "./leadDiscovery";
import {
  assignOpportunityPriority,
  buildResearchAudit,
  extractContiguousEvidence,
  extractFacilityKeywords,
  isAdmissibleResearchSource,
  isDiscoveryOnlySource,
  isTimelySignal,
  mapInBatches,
  normalizeCompanyKey,
  normalizeHost,
  normalizeSignalType,
  parseLeadMarkdownEvaluations,
  type ResearchSource,
} from "./leadResearch";

const api = Router();

const analysisTaskTimings = new Map<string, { startedAt: number; url: string }>();
const opportunitySchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      name: { type: "string" },
      whyRelevant: { type: "string" },
      whyNonObvious: { type: "string" },
      sharedPain: { type: "string" },
      salesAngle: { type: "string" },
      painPoints: { type: "array", items: { type: "string" } },
      disqualifiers: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
      searchQueries: { type: "array", items: { type: "string" } },
      mustHaveEvidence: {
        type: "array",
        items: {
          type: "object",
          properties: {
            requirement: { type: "string" },
            acceptableSignals: { type: "array", items: { type: "string" } },
            sellerCapability: { type: "string" },
            sourceType: { type: "string" },
            sourceEvidence: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["requirement", "acceptableSignals", "sellerCapability", "sourceType", "sourceEvidence", "confidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["name", "whyRelevant", "whyNonObvious", "sharedPain", "salesAngle", "painPoints", "disqualifiers", "confidence", "searchQueries", "mustHaveEvidence"],
    additionalProperties: false,
  },
};

const leadDiscoverySchema = {
  type: "object",
  properties: {
    discoveryQueries: { type: "array", items: { type: "string" } },
    evidenceSignals: { type: "array", items: { type: "string" } },
    disqualifiers: { type: "array", items: { type: "string" } },
    signalQueries: { type: "array", items: { type: "string" } },
    buyerDefinition: { type: "string" },
  },
  required: ["discoveryQueries", "evidenceSignals", "disqualifiers", "signalQueries", "buyerDefinition"],
  additionalProperties: false,
};

const leadRankingSchema = {
  type: "object",
  properties: {
    evaluations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          candidateKey: { type: "string" },
          isRealCompany: { type: "boolean" },
          isOperating: { type: "boolean" },
          locationVerified: { type: "boolean" },
          isTargetBuyer: { type: "boolean" },
          requiredEvidenceVerified: { type: "boolean" },
          fitScore: { type: "number", minimum: 1, maximum: 5 },
          whyThisCompanyFits: { type: "string" },
          opportunitySignal: { type: "string" },
          opportunitySignalType: { type: "string" },
          opportunitySignalDate: { type: "string" },
          opportunitySignalSource: { type: "string" },
          whyNow: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 100 },
          rejectReason: { type: "string" },
        },
        required: ["candidateKey", "isRealCompany", "isOperating", "locationVerified", "isTargetBuyer", "requiredEvidenceVerified", "fitScore", "whyThisCompanyFits", "opportunitySignal", "opportunitySignalType", "opportunitySignalDate", "opportunitySignalSource", "whyNow", "confidence", "rejectReason"],
        additionalProperties: false,
      },
    },
  },
  required: ["evaluations"],
  additionalProperties: false,
};

const normalizeKey = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const scopedMem0UserId = (scope?: string, ownerId?: string) => {
  const owner = normalizeKey(ownerId || "demo").slice(0, 80) || "demo";
  const key = normalizeKey(scope || "global").slice(0, 80) || "global";
  return `biks:${owner}:${key}`;
};

// Endpoints reachable without a logged-in session. Everything else under
// `/api/*` requires a valid Supabase bearer token.
const PUBLIC_API_PATHS = new Set<string>(["/api/notify-signup"]);

// ============================================================
// Auth gate — every /api/* call must carry a valid Supabase token.
// When Supabase isn't configured (local dev without keys) the gate is open,
// matching the client's graceful fallback.
// ============================================================
api.use(async (req: Request, res: Response, next: NextFunction) => {
  // This router is mounted at "/", so it sees every request. Only guard our own
  // REST endpoints — let static HTML/assets and tRPC (which does its own auth)
  // pass straight through.
  if (!req.path.startsWith("/api/")) return next();
  if (req.path.startsWith("/api/trpc")) return next();
  if (req.method === "OPTIONS") return next();
  if (PUBLIC_API_PATHS.has(req.path)) return next();
  if (!isSupabaseConfigured) return next();

  const user = await verifyRequestUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as Request & { user?: SupabaseUser }).user = user;
  next();
});

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
// POST /api/analyze-website — fetch website then start Manus task, return taskId
// ============================================================
api.post("/api/analyze-website", async (req: Request, res: Response) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  const requestStartedAt = Date.now();
  try {
    // Fetch website content (fast, done server-side before creating task)
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

    const stripHtml = (h: string) => h
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Don't analyze a hosting/placeholder shell as if it were the company.
    const looksLikePlaceholder = (text: string) => {
      const lower = text.toLowerCase();
      return (
        lower.includes("replit app") ||
        lower.includes("needs to be published") ||
        lower.includes("this site is under construction") ||
        lower.includes("default web page") ||
        lower.includes("vite + react") ||
        lower.length < 300
      );
    };

    // Try the submitted URL, then ±www and ±trailing slash, until one returns real content.
    const buildVariants = (raw: string): string[] => {
      const withProto = raw.startsWith("http") ? raw : `https://${raw}`;
      const variants = new Set<string>();
      try {
        const u = new URL(withProto);
        const altHost = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
        for (const h of [u.hostname, altHost]) {
          const base = `${u.protocol}//${h}${u.pathname.replace(/\/$/, "")}`;
          variants.add(base); variants.add(base + "/");
        }
      } catch { variants.add(withProto); }
      return Array.from(variants);
    };

    let content = "";
    const variants = buildVariants(url);
    for (let i = 0; i < variants.length; i++) {
      try {
        const html = await fetchWithTimeout(variants[i], i === 0 ? 20000 : 15000);
        const text = stripHtml(html);
        if (!looksLikePlaceholder(text)) { content = text.slice(0, 8000); console.log(`[analyze-website] using "${variants[i]}" (len=${text.length})`); break; }
        if (text.length > content.length) content = text.slice(0, 8000); // best-effort fallback
      } catch (e: any) {
        console.log(`[analyze-website] variant "${variants[i]}" failed: ${e.message}`);
      }
    }
    if (!content) {
      return res.status(502).json({ error: "Failed to fetch website content. The site may be slow, offline, or blocking automated requests." });
    }

    console.log(`[analysis:timing] scrape_complete url=${url} durationMs=${Date.now() - requestStartedAt} contentLength=${content.length}`);

    const prompt = `You are a sharp B2B sales analyst producing CONCISE, website-ready analysis copy for a card-based UI. All website content is already provided below — do NOT browse the web or visit any URLs.

URL: ${url}
Website content (extracted text, already fetched):
${content}

GROUNDING RULES (critical):
- Use ONLY the content above. Do NOT invent clients, locations, certifications, statistics, awards, technologies, or years of experience.
- Include exact metrics ONLY when clearly visible; if a number is unreadable/uncertain, phrase it qualitatively.
- Include location/operating market only if it appears in the content; otherwise omit rather than guess.
- Separate KNOWN current customers from INFERRED new opportunities.
- Put visible client names directly in customer segments; use an empty clientNames array when none are shown — never invent names.
- This is real company content — do NOT say it is a placeholder/Replit/Vite/not-published page.
- Avoid generic AI filler ("innovative solutions", "cutting-edge", "tailored to meet customer needs", "comprehensive suite", "driving digital transformation"). Use concrete nouns.
- Labels must NOT use the "&" symbol, slashes, or parentheses; use "and" only for a natural industry category.

Return ONLY valid JSON (no markdown) with this structure:
{
  "companyName": "Company name",
  "website": "${url}",
  "summary": "ONE paragraph, 55-85 words: company name, location/market if known, core products/services, main customer types, and the commercial pain points it solves.",
  "valueProposition": "Fallback plain-text value proposition (1-2 sentences).",
  "valuePropositions": [
    { "valueLabel": "2-5 word Title Case label", "valueCopy": "18-35 words: specific capability AND business outcome.", "websiteCopy": "• Label: copy" }
  ],
  "currentSegments": ["Segment Label 1", "Segment Label 2"],
  "customerSegments": [
    { "segmentLabel": "Clean 2-5 word label, no '&'", "segmentDescription": "16-32 words on why this segment buys", "clientNames": ["Visible client A"], "websiteCopy": "Label — Client A" }
  ],
  "products": ["Product/service 1", "Product 2"],
  "proofPoints": ["Credibility indicator 1", "Indicator 2"],
  "websiteEvidence": [
    { "claim": "A source-supported business fact", "quote": "Exact short quote from the supplied website text", "sourceUrl": "${url}" }
  ],
  "capabilityModel": {
    "capabilities": ["What the company can uniquely do"],
    "outcomes": ["Measurable or observable buyer outcomes"],
    "buyerPains": ["Business/customer pain this capability solves"],
    "requiredBuyerConditions": ["Signals a prospect must have to need this"],
    "currentMarkets": ["Markets already served, if visible"],
    "proofPoints": ["Source-supported proof or credibility"],
    "disqualifiers": ["Signals that make a prospect irrelevant"]
  },
  "expansionCategories": [
    {
      "name": "Specific adjacent buyer market",
      "whyRelevant": "Why this market needs a transferable capability",
      "whyNonObvious": "Why this is outside the seller's current markets",
      "sharedPain": "Concrete pain shared with current buyers",
      "salesAngle": "Capability-led sales angle",
      "painPoints": ["Buyer pain"],
      "disqualifiers": ["Observable signal that makes a company irrelevant"],
      "confidence": 0,
      "searchQueries": ["Location-free organization query containing a prerequisite signal"],
      "mustHaveEvidence": [
        {
          "requirement": "Observable condition required to need the offering",
          "acceptableSignals": ["Specific phrase or facility signal"],
          "sellerCapability": "Website-derived capability",
          "sourceType": "website",
          "sourceEvidence": "Exact supporting website evidence",
          "confidence": 0
        }
      ]
    }
  ]
}

REQUIREMENTS:
- valuePropositions: EXACTLY 3 (the strongest, source-supported).
- customerSegments: 3-5. clientNames empty if none shown — never invent.
- websiteEvidence: 3-10 concise facts with exact supporting quotes. Never paraphrase the quote.
- currentSegments = the customerSegments labels (kept for backward compatibility).
- expansionCategories: 1-3 genuinely adjacent, non-obvious markets, or an empty array when evidence is insufficient.
- Derive opportunities ONLY from the supplied website content, capability model, and website evidence. User memory or business context is not available and must not be inferred.
- Every opportunity must link a transferable capability to a concrete buyer pain and include at least one mandatory buyer prerequisite: an observable condition without which the buyer cannot reasonably need the offering.
- Each prerequisite needs specific acceptable website signals, its seller capability, exact source evidence, and confidence. Avoid broad markets whose members commonly lack the prerequisite.
- Prefer commercial operators that own or control the relevant facility/infrastructure and can buy upgrades. Do not propose consultants, designers, distributors, equipment vendors, review directories, pet or animal services, or swim schools unless the seller's website explicitly serves those buyers.
- For water-treatment opportunities, prioritize businesses with owned customer-facing water facilities such as cold plunges, hydrotherapy pools, immersion baths, onsen, spa pools, or commercial pools; avoid providers that only run classes inside third-party pools.
- searchQueries must be location-free, target organizations rather than articles, contain concrete prerequisite signals, and never include a city or country.
- Return fewer opportunities rather than weak or generic ones. Confidence below 60 will be discarded.`;

    const taskId = await startManusTask(prompt, {
      type: "object",
      properties: {
        companyName: { type: "string" },
        website: { type: "string" },
        summary: { type: "string" },
        valueProposition: { type: "string" },
        valuePropositions: {
          type: "array",
          items: {
            type: "object",
            properties: { valueLabel: { type: "string" }, valueCopy: { type: "string" }, websiteCopy: { type: "string" } },
            required: ["valueLabel", "valueCopy", "websiteCopy"],
            additionalProperties: false,
          },
        },
        currentSegments: { type: "array", items: { type: "string" } },
        customerSegments: {
          type: "array",
          items: {
            type: "object",
            properties: { segmentLabel: { type: "string" }, segmentDescription: { type: "string" }, clientNames: { type: "array", items: { type: "string" } }, websiteCopy: { type: "string" } },
            required: ["segmentLabel", "segmentDescription", "clientNames", "websiteCopy"],
            additionalProperties: false,
          },
        },
        products: { type: "array", items: { type: "string" } },
        proofPoints: { type: "array", items: { type: "string" } },
        websiteEvidence: {
          type: "array",
          items: {
            type: "object",
            properties: {
              claim: { type: "string" },
              quote: { type: "string" },
              sourceUrl: { type: "string" },
            },
            required: ["claim", "quote", "sourceUrl"],
            additionalProperties: false,
          },
        },
        capabilityModel: {
          type: "object",
          properties: {
            capabilities: { type: "array", items: { type: "string" } },
            outcomes: { type: "array", items: { type: "string" } },
            buyerPains: { type: "array", items: { type: "string" } },
            requiredBuyerConditions: { type: "array", items: { type: "string" } },
            currentMarkets: { type: "array", items: { type: "string" } },
            proofPoints: { type: "array", items: { type: "string" } },
            disqualifiers: { type: "array", items: { type: "string" } },
          },
          required: ["capabilities", "outcomes", "buyerPains", "requiredBuyerConditions", "currentMarkets", "proofPoints", "disqualifiers"],
          additionalProperties: false,
        },
        expansionCategories: opportunitySchema,
      },
      required: ["companyName", "website", "summary", "valueProposition", "valuePropositions", "currentSegments", "customerSegments", "products", "proofPoints", "websiteEvidence", "capabilityModel", "expansionCategories"],
      additionalProperties: false,
    }, { profile: process.env.MANUS_REASONING_PROFILE || "manus-1.6" });

    analysisTaskTimings.set(taskId, { startedAt: requestStartedAt, url });
    console.log(`[analysis:timing] task_created taskId=${taskId} url=${url} durationMs=${Date.now() - requestStartedAt}`);

    return res.json({ taskId });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "Analysis failed" });
  }
});

// ============================================================
// GET /api/mem0 — Fetch all memories
// ============================================================
api.get("/api/mem0", async (req: Request, res: Response) => {
  const apiKey = process.env.MEM0_API_KEY;
  if (!apiKey) {
    return res.json({ available: false, items: [] });
  }

  try {
    const authedUser = (req as Request & { user?: SupabaseUser }).user;
    const userId = scopedMem0UserId(req.query.scope as string | undefined, authedUser?.id);
    const memRes = await fetch(`https://api.mem0.ai/v1/memories/?user_id=${encodeURIComponent(userId)}`, {
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

  const { text, scope } = req.body;
  if (!text) {
    return res.status(400).json({ ok: false, error: "text is required" });
  }

  try {
    const authedUser = (req as Request & { user?: SupabaseUser }).user;
    const userId = scopedMem0UserId(scope, authedUser?.id);
    const memRes = await fetch("https://api.mem0.ai/v1/memories/", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: text }],
        user_id: userId,
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
          const pollRes = await fetch(`https://api.mem0.ai/v1/memories/?user_id=${encodeURIComponent(userId)}`, {
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
    // Delete all memories for this analyzed-business scope.
    try {
      const authedUser = (req as Request & { user?: SupabaseUser }).user;
      const userId = scopedMem0UserId(req.query.scope as string | undefined, authedUser?.id);
      await fetch("https://api.mem0.ai/v1/memories/", {
        method: "DELETE",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_id: userId }),
      });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.json({ ok: false, error: e.message });
    }
  }
});

const opportunityConfidence = (category: any) => {
  const numeric = Number(category?.confidence);
  if (Number.isFinite(numeric)) return numeric <= 1 ? numeric * 100 : numeric;
  const label = String(category?.opportunityStrength || "").toUpperCase();
  if (label === "HIGH") return 85;
  if (label.includes("MEDIUM-HIGH")) return 75;
  if (label.includes("MEDIUM")) return 65;
  return 0;
};

export const normalizeOpportunityResult = (generated: any) => (Array.isArray(generated?.expansionCategories) ? generated.expansionCategories : [])
  .filter((category: any) => opportunityConfidence(category) >= 60)
  .map((category: any) => {
    const transferable = category?.transferableCapability || {};
    const capabilityEvidence = Array.isArray(transferable?.sourceEvidence)
      ? transferable.sourceEvidence.map((item: any) => item?.quote || item?.claim).filter(Boolean).join("; ")
      : String(transferable?.sourceEvidence || "");
    const prerequisiteSource = Array.isArray(category.mustHaveEvidence)
      ? category.mustHaveEvidence
      : (Array.isArray(category.mandatoryBuyerPrerequisites) ? category.mandatoryBuyerPrerequisites : []);
    const mustHaveEvidence = prerequisiteSource
      .map((item: any) => {
        const rawConfidence = Number(item?.confidence);
        return {
          requirement: String(item?.requirement || item?.prerequisiteLabel || "").trim(),
          acceptableSignals: (Array.isArray(item?.acceptableSignals) ? item.acceptableSignals : item?.acceptableWebsiteSignals || []).map((signal: any) => String(signal).trim()).filter(Boolean),
          sellerCapability: String(item?.sellerCapability || transferable?.capability || "").trim(),
          sourceType: "website" as const,
          sourceEvidence: String(item?.sourceEvidence || capabilityEvidence || transferable?.capabilitySource || "").trim(),
          confidence: Number.isFinite(rawConfidence) ? (rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence) : opportunityConfidence(category),
        };
      })
      .filter((item: any) => item.requirement && item.sellerCapability && item.sourceEvidence && item.acceptableSignals.length > 0 && item.confidence >= 60);
    const painPoints = (Array.isArray(category.painPoints) ? category.painPoints : category.buyerPains || [])
      .map((pain: any) => String(typeof pain === "string" ? pain : pain?.pain || "").trim()).filter(Boolean);
    const disqualifiers = Array.from(new Set([
      ...(Array.isArray(category.disqualifiers) ? category.disqualifiers : []),
      ...prerequisiteSource.flatMap((item: any) => Array.isArray(item?.disqualifyingSignals) ? item.disqualifyingSignals : []),
    ].map((value: any) => String(value).trim()).filter(Boolean)));
    const searchQueries = (Array.isArray(category.searchQueries) ? category.searchQueries : category.suggestedSearchQueries || [])
      .map((query: any) => String(query).trim()).filter(Boolean).slice(0, 8);
    return {
      ...category,
      name: String(category.name || category.marketLabel || "").trim(),
      whyRelevant: String(category.whyRelevant || category.marketDescription || category.adjacencyRationale || "").trim(),
      whyNonObvious: String(category.whyNonObvious || category.adjacencyRationale || "").trim(),
      sharedPain: String(category.sharedPain || painPoints[0] || "").trim(),
      salesAngle: String(category.salesAngle || transferable?.capability || "").trim(),
      painPoints,
      disqualifiers,
      confidence: opportunityConfidence(category),
      mustHaveEvidence,
      requiredEvidence: mustHaveEvidence.map((item: any) => item.requirement),
      searchQueries,
      contextApplied: ["website capability model", "website evidence"],
      memoriesUsed: [],
    };
  })
  .filter((category: any) => category.name && category.mustHaveEvidence.length > 0 && category.searchQueries.length > 0)
  .slice(0, 3);

export const normalizeCompanyAnalysisResult = (generated: any) => ({
  ...generated,
  expansionCategories: normalizeOpportunityResult(generated),
});

// ============================================================
// POST /api/exa-search — Lead discovery via Exa
// ============================================================
api.post("/api/lead-research/start", async (req: Request, res: Response) => {
  const { business, category, city, memories = [] } = req.body;
  if (!business || !category || !city) return res.status(400).json({ error: "business, category, and city are required" });
  try {
    const prompt = `Act as a senior B2B research strategist. Create a precise, industry-agnostic search plan for Exa. Do not browse the web and do not identify companies in this task.

Seller profile:
${JSON.stringify({ companyName: business.companyName, website: business.website, products: business.products, proofPoints: business.proofPoints, capabilityModel: business.capabilityModel }, null, 2)}

Selected adjacent market:
${JSON.stringify(category, null, 2)}

Target operating location: ${city}
User business context for lead selection and ranking only:
${Array.isArray(memories) && memories.length ? memories.map((m: any, i: number) => `${i + 1}. ${String(typeof m === "string" ? m : m?.text || "")}`).join("\n") : "None"}

Planning requirements:
- Return 1 Exa Company Search discovery query that finds actual operators/buyers in ${city}.
- The query must be a natural-language company description, not Boolean keyword soup.
- The query must answer: company/operator type, geography, observable need condition, scale or timing preference, and false-positive exclusions.
- The query must include language like "Return operators or owners, not equipment vendors, consultants, directories, pet services, swim schools, or competitors" unless those are explicitly the target buyers.
- Do not make expansion, new-site plans, funding, hiring, or partnerships mandatory in the discovery query. These are ranking signals only. The query should still find currently operating eligible buyers even when no timing signal exists.
- If user context says to prioritize expansion or premium buyers, phrase it as "especially expanding or premium operators", not as a required condition.
- Keep queries industry-agnostic; derive every term from the supplied opportunity and seller capability model.
- Return concrete evidenceSignals that prove the mandatory buyer prerequisite.
- Return disqualifiers for manufacturers, equipment sellers, installers, consultants, directories, and competitors.
- Return 3-5 reusable signalQueries for expansion, new locations, construction, launches, funding, partnerships, procurement, and hiring.
- User context may prioritize or exclude lead types, but must not remove the mandatory prerequisite.

Return only the structured result.`;
    const taskId = await startManusTask(prompt, leadDiscoverySchema, {
      profile: process.env.MANUS_REASONING_PROFILE || "manus-1.6",
    });
    console.log(`[lead-research] planning_started taskId=${taskId} city=${city}`);
    return res.json({ taskId, phase: "planning" });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Lead research could not start" });
  }
});

api.get("/api/lead-research/poll", async (req: Request, res: Response) => {
  const id = String(req.query.id || "");
  if (!id) return res.status(400).json({ error: "task id is required" });
  try {
    return res.json(await checkManusTask(id));
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Lead research polling failed" });
  }
});

api.post("/api/lead-research/corroborate", async (req: Request, res: Response) => {
  const { discovery, business, category, city, memories = [], numResults = 8 } = req.body;
  const exaKey = process.env.EXA_API_KEY;
  if (!exaKey) return res.status(500).json({ error: "Exa not configured" });
  const plannedQueries = Array.isArray(discovery?.discoveryQueries) ? discovery.discoveryQueries.map(String).filter(Boolean).slice(0, 3) : [];
  if (!plannedQueries.length) return res.status(400).json({ error: "Manus returned no search plan" });

  try {
    const prerequisiteItems = Array.isArray(category?.mustHaveEvidence) ? category.mustHaveEvidence : [];
    const mandatorySignals = Array.from(new Set([
      ...prerequisiteItems.flatMap((item: any) => Array.isArray(item?.acceptableSignals) ? item.acceptableSignals : []),
      ...(Array.isArray(category?.requiredEvidence) ? category.requiredEvidence : []),
      ...(Array.isArray(discovery?.evidenceSignals) ? discovery.evidenceSignals : []),
    ].map((value: any) => String(value).trim()).filter(Boolean)));
    const facilitySignals = extractFacilityKeywords(mandatorySignals);
    const evidenceSignals = facilitySignals.length ? facilitySignals : mandatorySignals;
    const sourceText = (result: any) => [result.text || "", ...(result.highlights || [])].join(" ").replace(/\s+/g, " ").trim();
    const fetchExa = async (query: string, includeDomains: string[] = [], resultCount = 5, companyOnly = false) => {
      const body: any = {
        query,
        type: "auto",
        numResults: resultCount,
        contents: { text: { maxCharacters: 3000 }, highlights: true, summary: true },
      };
      if (companyOnly) body.category = "company";
      if (includeDomains.length) body.includeDomains = includeDomains;
      for (let attempt = 0; attempt < 4; attempt++) {
        const response = await fetch("https://api.exa.ai/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": exaKey },
          body: JSON.stringify(body),
        });
        if (response.ok) {
          const data: any = await response.json();
          return Array.isArray(data.results) ? data.results : [];
        }
        if (response.status !== 429 && response.status < 500) {
          console.warn(`[lead-research] Exa failed status=${response.status} query=${query}`);
          return [];
        }
        const retryAfter = Number(response.headers.get("retry-after")) * 1000;
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1200 * (attempt + 1);
        console.warn(`[lead-research] Exa retry status=${response.status} attempt=${attempt + 1} delayMs=${delay}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      console.warn(`[lead-research] Exa exhausted retries query=${query}`);
      return [];
    };

    const disqualifiers = [
      ...(Array.isArray(category?.disqualifiers) ? category.disqualifiers : []),
      ...(Array.isArray(discovery?.disqualifiers) ? discovery.disqualifiers : []),
      "equipment vendors",
      "consultants",
      "directories",
      "pet services",
      "swim schools",
      "competitors",
    ].map((value: any) => String(value).trim()).filter(Boolean);
    const operatorType = String(category?.name || discovery?.buyerDefinition || "target buyer organizations").replace(/\s+/g, " ").trim();
    const queryEvidenceSignals = evidenceSignals
      .filter((signal: string) => !(signal === "plunge" && evidenceSignals.includes("cold plunge")))
      .filter((signal: string) => !(signal === "hydrotherapy" && evidenceSignals.includes("hydrotherapy pool")));
    const facilityRequirement = queryEvidenceSignals.length
      ? queryEvidenceSignals.slice(0, 6).join(", ")
      : String(category?.sharedPain || category?.whyRelevant || "the required buyer facility").replace(/\s+/g, " ").trim();
    const disqualifierText = Array.from(new Set(disqualifiers)).slice(0, 10).join(", ");
    const companySearchQuery = [
      `Companies operating ${operatorType} in ${city}`,
      `They own or operate customer-facing facilities with ${facilityRequirement}`,
      "Return operators or owners: actual clubs, studios, bathhouses, spas, hotels, resorts, clinics, or wellness facilities",
      `Do not return ${disqualifierText}`,
      "Especially include premium, multi-site, high-throughput, opening, expanding, renovating, funded, or partnership-backed operators, but do not require an expansion signal.",
    ].filter(Boolean).join(". ");
    const broadResults = await fetchExa(companySearchQuery, [], 50, true);
    const webDiscoveryQueries = Array.from(new Set([
      `Official websites of ${city} ${operatorType} offering ${facilityRequirement}; pages should mention booking, address, location, membership, opening hours, or services. Do not return ${disqualifierText}.`,
      `${city} businesses operating customer-facing ${facilityRequirement}; official site pages with address, booking, membership, opening hours, or locations. Do not return ${disqualifierText}.`,
      `${city} local operators or owners with ${facilityRequirement}; official website service page, location page, booking page, or membership page. Do not return ${disqualifierText}.`,
    ].map(query => query.replace(/\s+/g, " ").trim()).filter(Boolean)));
    const webDiscoveryResults = (await Promise.all(webDiscoveryQueries.map(query => fetchExa(query, [], 15, false)))).flat();

    const candidates = new Map<string, any>();
    const addCandidate = (result: any, discoveryOrigin: "exa-company" | "exa-web", originQuery: string) => {
      if (!result?.url || isDiscoveryOnlySource(result.url, result.title)) return;
      const companyEntity = Array.isArray(result.entities) ? result.entities.find((entity: any) => entity?.type === "company") : null;
      const companyProps = companyEntity?.properties || {};
      const key = normalizeCompanyKey(companyProps.name || result.title, result.url);
      if (!key) return;
      const text = [sourceText(result), companyProps.description || "", companyProps.headquarters?.city || "", companyProps.headquarters?.country || ""].join(" ");
      const normalizedDiscoveryText = `${result.title || ""} ${result.url || ""} ${text}`.toLowerCase();
      const citySignal = normalizedDiscoveryText.includes(String(city).toLowerCase());
      if (discoveryOrigin === "exa-web" && !citySignal) return;
      const existing = candidates.get(key);
      if (existing) {
        existing.initialText = `${existing.initialText} ${text}`.slice(0, 6000);
        existing.queryHits += 1;
      } else {
        candidates.set(key, {
          candidateKey: key,
          name: String(companyProps.name || result.title || "").replace(/\s+[|\-–].*$/, "").trim(),
          officialWebsite: result.url,
          operatingLocation: [companyProps.headquarters?.city, companyProps.headquarters?.country].filter(Boolean).join(", "),
          facilityClaim: "",
          operatingClaim: "",
          discoveryOrigin,
          discoveryQuery: originQuery,
          companySearchQuery,
          initialText: text,
          queryHits: 1,
        });
      }
    };
    for (const result of broadResults) {
      addCandidate(result, "exa-company", companySearchQuery);
    }
    for (const result of webDiscoveryResults) {
      addCandidate(result, "exa-web", "");
    }
    const vendorPattern = /\b(manufacturer|supplier|installer|distributor|equipment seller|we supply|we install)\b/i;
    const genericNonBuyerPattern = /\b(pet|dog|canine|animal|veterinary|swimming lessons?|swim school|school of swimology|lifeguard services|kids pool party|third[- ]party pools?|consultants?|architects?|design consultancy|equipment seller|manufacturer|supplier|distributor)\b/i;
    const candidatePriority = (candidate: any) => {
      const text = `${candidate.name} ${candidate.initialText}`;
      const evidenceHits = matchMandatoryEvidence(text, evidenceSignals).length;
      const locationHit = text.toLowerCase().includes(String(city).toLowerCase()) ? 1 : 0;
      return evidenceHits * 25 + locationHit * 8 + Math.min(candidate.queryHits, 5) * 4 - (vendorPattern.test(text) ? 40 : 0) - (genericNonBuyerPattern.test(text) ? 80 : 0);
    };
    const uniqueCandidates = Array.from(candidates.values())
      .sort((a, b) => candidatePriority(b) - candidatePriority(a))
      .filter(candidate => candidatePriority(candidate) > -20)
      .slice(0, 20);

    const evidenceBundles = await mapInBatches(uniqueCandidates, 5, async candidate => {
      const officialHost = normalizeHost(candidate.officialWebsite || "");
      const evidenceTerms = evidenceSignals.slice(0, 5).join(" OR ");
      const [officialResults, signalResults] = await Promise.all([
        officialHost ? fetchExa(`${candidate.name} ${evidenceTerms} ${city}`, [officialHost], 5) : Promise.resolve([]),
        fetchExa(`"${candidate.name}" expansion OR "new location" OR opening OR launch OR construction OR funding OR partnership OR hiring`, [], 5),
      ]);
      const sourcesByUrl = new Map<string, ResearchSource>();
      const addResearchResult = (result: any) => {
        const pageText = sourceText(result);
        if (!result?.url || !pageText) return;
        const socialHost = /(^|\.)(instagram|facebook|linkedin)\.com$/i.test(normalizeHost(result.url));
        const source: ResearchSource = {
          url: result.url,
          title: result.title,
          pageText,
          publishedDate: result.publishedDate || "",
          sourceType: normalizeHost(result.url) === officialHost
            ? "official"
            : socialHost && pageText.toLowerCase().includes(String(candidate.name).toLowerCase())
              ? "official-social"
              : "independent",
        };
        if (!isAdmissibleResearchSource(source)) return;
        const existing = sourcesByUrl.get(source.url);
        if (!existing || source.pageText.length > existing.pageText.length) sourcesByUrl.set(source.url, source);
      };
      for (const result of [...officialResults, ...signalResults]) addResearchResult(result);
      let sources = Array.from(sourcesByUrl.values()).slice(0, 8);
      let facilitySource = sources.find(source => extractContiguousEvidence(source.pageText, evidenceSignals));
      const locationTerms = [city, candidate.operatingLocation].filter(Boolean).map(String);
      let locationSource = sources.find(source => source.sourceType !== "official-social" && extractContiguousEvidence(source.pageText, locationTerms));
      if (officialHost && facilitySource && !locationSource) {
        const locationResults = await fetchExa(`${candidate.name} ${city} address location opening hours contact`, [officialHost], 3);
        for (const result of locationResults) addResearchResult(result);
        sources = Array.from(sourcesByUrl.values()).slice(0, 8);
        facilitySource = sources.find(source => extractContiguousEvidence(source.pageText, evidenceSignals));
        locationSource = sources.find(source => source.sourceType !== "official-social" && extractContiguousEvidence(source.pageText, locationTerms));
      }
      const operatingSignals = ["book", "booking", "contact", "opening hours", "membership", "services", "visit", "locations"];
      const operatingSource = sources.find(source => extractContiguousEvidence(source.pageText, operatingSignals));
      return {
        ...candidate,
        requiredEvidenceSignals: evidenceSignals,
        sources,
        facilityEvidence: facilitySource ? extractContiguousEvidence(facilitySource.pageText, evidenceSignals) : "",
        facilityEvidenceUrl: facilitySource?.url || "",
        locationEvidence: locationSource ? extractContiguousEvidence(locationSource.pageText, locationTerms) : "",
        locationEvidenceUrl: locationSource?.url || "",
        operatingEvidence: operatingSource ? extractContiguousEvidence(operatingSource.pageText, operatingSignals) : "",
        operatingEvidenceUrl: operatingSource?.url || "",
      };
    });

    const compactBundles = evidenceBundles.map(bundle => ({
      candidateKey: bundle.candidateKey,
      name: bundle.name,
      officialWebsite: bundle.officialWebsite,
      discoveryOrigin: bundle.discoveryOrigin,
      facilityEvidence: bundle.facilityEvidence,
      facilityEvidenceUrl: bundle.facilityEvidenceUrl,
      locationEvidence: bundle.locationEvidence,
      locationEvidenceUrl: bundle.locationEvidenceUrl,
      operatingEvidence: bundle.operatingEvidence,
      operatingEvidenceUrl: bundle.operatingEvidenceUrl,
      sources: bundle.sources.slice(0, 3).map((source: ResearchSource) => ({ ...source, pageText: source.pageText.slice(0, 700) })),
    }));
    const finalPrompt = `Compare every candidate below as a potential B2B lead. Return up to 12 candidates that pass all eligibility checks, ordered strongest first. Do not return rejected candidates.

Seller:
${JSON.stringify({ companyName: business?.companyName, products: business?.products, capabilityModel: business?.capabilityModel }, null, 2)}
Selected market and requirements:
${JSON.stringify(category, null, 2)}
Required location: ${city}
User context for lead ranking:
${JSON.stringify(memories)}
Manus search plan and buyer definition:
${JSON.stringify(discovery)}

Candidate evidence bundles:
${JSON.stringify(compactBundles)}

Rules:
- A candidate passes only when it is a real operating target operator/buyer in ${city}, and the supplied evidence proves at least one required facility condition.
- Reject manufacturers, equipment sellers, installers, consultants, distributors, and competitors.
- Use only supplied evidence URLs and text. Do not invent or replace URLs, facts, dates, or companies.
- opportunitySignal is separate from baseline eligibility. Use expansion, new-location, construction, launch, funding, hiring, partnership, procurement, or operational-change evidence when present.
- opportunitySignalDate must be an explicit source-supported ISO date. Leave all opportunity-signal fields empty if the date or claim is unsupported.
- Compare candidates and explain the concrete seller-to-buyer fit and why the timing matters.
- Every returned evaluation must pass all baseline checks and receive fitScore 3-5 with an empty rejectReason.
- Evaluate the complete supplied set before selecting finalists. The application performs deterministic evidence checks and applies the final cap after your comparison.`;
    const taskId = await startManusTask(finalPrompt, leadRankingSchema, {
      profile: process.env.MANUS_REASONING_PROFILE || "manus-1.6",
    });
    const partialAudit = {
      candidatesDiscovered: uniqueCandidates.length,
      candidatesRetrievedByExa: broadResults.length + webDiscoveryResults.length,
      uniqueCompanies: evidenceBundles.length,
    };
    console.log(`[lead-research] corroboration_complete taskId=${taskId} ${JSON.stringify(partialAudit)}`);
    return res.json({ taskId, phase: "ranking", evidenceBundles, partialAudit, companySearchQuery, numResults: Math.min(8, Math.max(1, Number(numResults) || 8)) });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Evidence corroboration failed" });
  }
});

api.post("/api/lead-research/finalize", async (req: Request, res: Response) => {
  const { rankingResult, evidenceBundles = [], partialAudit = {}, memories = [], numResults = 8 } = req.body;
  if (!rankingResult) return res.status(400).json({ error: "ranking result is required" });
  try {
    const rawEvaluations = Array.isArray(rankingResult?.evaluations)
      ? rankingResult.evaluations
      : Array.isArray(rankingResult)
        ? rankingResult
        : parseLeadMarkdownEvaluations(String(rankingResult?.rawText || ""));
    const evaluations = rawEvaluations.map((evaluation: any) => ({
      ...evaluation,
      isRealCompany: evaluation.isRealCompany ?? true,
      isOperating: evaluation.isOperating ?? true,
      locationVerified: evaluation.locationVerified ?? true,
      isTargetBuyer: evaluation.isTargetBuyer ?? true,
      requiredEvidenceVerified: evaluation.requiredEvidenceVerified ?? true,
      whyThisCompanyFits: evaluation.whyThisCompanyFits || evaluation.explanation || "",
      opportunitySignalType: evaluation.opportunitySignalType || normalizeSignalType(evaluation.opportunitySignal || ""),
      confidence: evaluation.confidence ?? 80,
      rejectReason: evaluation.rejectReason || "",
    }));
    const bundleByKey = new Map((Array.isArray(evidenceBundles) ? evidenceBundles : []).map((bundle: any) => [bundle.candidateKey, bundle]));
    const hasConcreteFacilityEvidence = (bundle: any) => {
      const signals = Array.isArray(bundle.requiredEvidenceSignals) ? bundle.requiredEvidenceSignals : [];
      const signalText = signals.join(" ").toLowerCase();
      const evidenceText = `${bundle.name || ""} ${bundle.facilityEvidence || ""} ${bundle.operatingEvidence || ""}`.toLowerCase();
      const terms = Array.from(new Set([
        "cold plunge", "ice bath", "hydrotherapy pool", "aquatic therapy", "aqua therapy",
        "therapeutic pool", "immersion", "flotation tank", "mineral pool", "onsen",
        "hot pool", "cold pool", "cold bath", "water immersion",
        ...["pool", "plunge", "hydrotherapy", "aquatic", "immersion", "flotation", "onsen", "bath"]
          .filter(term => signalText.includes(term)),
      ]));
      return terms.some(term => evidenceText.includes(term));
    };
    const isVendorLikeBundle = (bundle: any) => /\b(manufacturer|supplier|installer|distributor|equipment seller|engineering|technology|design consultancy|consultants?|architects?|we supply|we install|shipping available|contact us for a quote|warranty|components|commission the system|products?|existing .* pool|service for an existing|sales manager|company profile)\b/i
      .test(`${bundle.name || ""} ${bundle.facilityEvidence || ""} ${bundle.operatingEvidence || ""}`);
    const hasWeakLocationEvidence = (bundle: any) => /\b(afghanistan|albania|algeria|saudi arabia|senegal|serbia|seychelles|sierra leone|slovakia|slovenia|solomon islands|country\*)\b/i
      .test(String(bundle.locationEvidence || ""));
    const lacksBuyingAuthority = (bundle: any) => /\b(pet|dog|canine|animal|veterinary|third[- ]party pools?|jw marriott|private pools or our|swimming lessons?|swim school|school of swimology|lifeguard services|kids pool party)\b/i
      .test(`${bundle.name || ""} ${bundle.facilityEvidence || ""} ${bundle.locationEvidence || ""} ${bundle.operatingEvidence || ""}`);
    const finalEvaluations = evaluations;
    const evaluationAudit: any[] = [];
    const displayPriority = (signalPriority: "A" | "B" | "C", fitScore: number): "High" | "Medium" | "Low" => {
      if (signalPriority === "A") return "High";
      if (signalPriority === "B") return "Medium";
      return fitScore >= 4 ? "Medium" : "Low";
    };
    const verified = finalEvaluations.flatMap((evaluation: any) => {
      const bundle: any = bundleByKey.get(evaluation.candidateKey);
      if (!bundle) return [];
      const signalSource = (bundle.sources || []).find((source: ResearchSource) => source.url === evaluation.opportunitySignalSource);
      const signalExcerpt = signalSource ? extractContiguousEvidence(signalSource.pageText, [
        evaluation.opportunitySignalType,
        "expansion", "new location", "new branch", "opening", "launch", "construction", "funding", "hiring", "partnership", "procurement",
      ]) : "";
      const evaluatedYear = String(evaluation.opportunitySignalDate || "").match(/\b20\d{2}\b/)?.[0] || "";
      const sourceDate = String(signalSource?.publishedDate || "") ||
        (evaluatedYear && signalSource?.pageText?.includes(evaluatedYear) ? String(evaluation.opportunitySignalDate) : "");
      const supportedSignal = Boolean(
        signalSource && isAdmissibleResearchSource(signalSource) &&
        signalExcerpt && sourceDate && isTimelySignal(sourceDate) &&
        normalizeSignalType(evaluation.opportunitySignalType) !== "none"
      );
      const eligible = Boolean(
        evaluation.isRealCompany && evaluation.isOperating && evaluation.locationVerified &&
        evaluation.isTargetBuyer && evaluation.requiredEvidenceVerified &&
        bundle.facilityEvidence && bundle.locationEvidence && bundle.operatingEvidence &&
        hasConcreteFacilityEvidence(bundle) &&
        !isVendorLikeBundle(bundle) &&
        !hasWeakLocationEvidence(bundle) &&
        !lacksBuyingAuthority(bundle) &&
        Number(evaluation.fitScore) >= 3 &&
        !evaluation.rejectReason
      );
      evaluationAudit.push({
        candidateKey: evaluation.candidateKey,
        name: bundle.name,
        eligible,
        rejectReason: eligible ? "" : evaluation.rejectReason || "Required evidence was not verified",
        signalSupported: supportedSignal,
      });
      if (!eligible) return [];
      const signalPriority = supportedSignal ? assignOpportunityPriority(evaluation.opportunitySignalType, sourceDate) : "C";
      const fitScore = Number(evaluation.fitScore);
      return [{
        title: bundle.name,
        url: bundle.officialWebsite,
        summary: evaluation.whyThisCompanyFits || `Verified ${bundle.name} has required facility evidence for this opportunity.`,
        highlights: [],
        fitScore,
        eligibilityPass: true,
        whyThisCompanyFits: evaluation.whyThisCompanyFits || `Verified ${bundle.name} has required facility evidence for this opportunity.`,
        facilityEvidence: bundle.facilityEvidence,
        locationEvidence: bundle.locationEvidence,
        operatingEvidence: bundle.operatingEvidence,
        evidence: bundle.facilityEvidence,
        evidenceQuote: bundle.facilityEvidence,
        evidenceUrl: bundle.facilityEvidenceUrl,
        verifiedAddress: bundle.locationEvidence,
        opportunityPriority: displayPriority(signalPriority, fitScore),
        opportunitySignal: supportedSignal ? signalExcerpt : "",
        opportunitySignalType: supportedSignal ? normalizeSignalType(evaluation.opportunitySignalType) : "none",
        opportunitySignalDate: supportedSignal ? sourceDate : "",
        opportunitySignalSource: supportedSignal ? evaluation.opportunitySignalSource : "",
        whyNow: supportedSignal ? evaluation.whyNow : evaluation.whyNow || "Verified capability fit; no timely commercial signal was confirmed.",
        confidence: Number(evaluation.confidence) || 0,
        memoriesUsed: Array.isArray(memories) ? memories.map((memory: any) => String(typeof memory === "string" ? memory : memory?.text || "")).filter(Boolean) : [],
        verificationStatus: "verified",
        disqualifiers: [],
      }];
    });
    const priorityWeight: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
    const finalResults = verified
      .sort((a: any, b: any) => priorityWeight[b.opportunityPriority] - priorityWeight[a.opportunityPriority] || b.fitScore - a.fitScore || b.confidence - a.confidence)
      .slice(0, Math.min(8, Math.max(1, Number(numResults) || 8)));
    const audit = buildResearchAudit({
      discovered: Number(partialAudit.candidatesDiscovered) || 0,
      exaRetrieved: Number(partialAudit.candidatesRetrievedByExa) || 0,
      unique: Number(partialAudit.uniqueCompanies) || evidenceBundles.length,
      evaluated: evidenceBundles.length,
      rejected: Math.max(0, evidenceBundles.length - verified.length),
      verified: verified.length,
      signalBacked: verified.filter((lead: any) => lead.opportunitySignalType !== "none").length,
      returned: finalResults.length,
    });
    console.log(`[lead-research] finalized ${JSON.stringify(audit)}`);
    return res.json({ status: "done", results: finalResults, audit, evaluationAudit, validationStatus: "manus-led" });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Lead research finalization failed" });
  }
});

api.post("/api/exa-search", async (req: Request, res: Response) => {
  const { query, queries, city, numResults = 5, business, category, memories = [] } = req.body;
  const candidateQueries = Array.from(new Set(
    (Array.isArray(queries) ? queries : [query])
      .map((q: any) => String(q || "").trim())
      .filter(Boolean)
  ));
  if (candidateQueries.length === 0) {
    return res.status(400).json({ error: "query is required" });
  }

  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Exa not configured" });
  }

  // City-to-country and domain mapping for strict filtering
  const cityMeta: Record<string, { country: string; domains: string[]; strictTerms: string[] }> = {
    "singapore": { country: "Singapore", domains: [".sg", ".com.sg"], strictTerms: ["singapore"] },
    "jakarta": { country: "Indonesia", domains: [".id", ".co.id"], strictTerms: ["jakarta", "jkt"] },
    "bali": { country: "Indonesia", domains: [".id", ".co.id"], strictTerms: ["bali", "denpasar", "seminyak", "ubud", "canggu", "kuta", "sanur", "nusa dua"] },
    "kuala lumpur": { country: "Malaysia", domains: [".my", ".com.my"], strictTerms: ["kuala lumpur", "petaling jaya", "bangsar", "mont kiara", "cheras", "ampang", "bukit bintang"] },
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
    const memoryTexts = (Array.isArray(memories) ? memories : [])
      .map((m: any) => String(typeof m === "string" ? m : m?.text || ""))
      .filter(Boolean);
    const prerequisiteItems = Array.isArray(category?.mustHaveEvidence) ? category.mustHaveEvidence : [];
    const mandatorySignals = prerequisiteItems.flatMap((item: any) => Array.isArray(item?.acceptableSignals) ? item.acceptableSignals : []).map((signal: any) => String(signal).trim()).filter(Boolean);
    const requiredEvidence = prerequisiteItems.length
      ? prerequisiteItems.map((item: any) => String(item.requirement || "")).filter(Boolean)
      : (Array.isArray(category?.requiredEvidence) ? category.requiredEvidence : []);
    if (!mandatorySignals.length && !requiredEvidence.length) {
      return res.status(400).json({ error: "Selected opportunity has no mandatory buyer prerequisites. Regenerate opportunities before searching." });
    }
    const memoryPolarity = splitMemoryPolarity(memoryTexts, [...requiredEvidence, ...mandatorySignals]);
    const memoryContext = memoryPolarity.positive.join("; ");
    const disqualifiers = [
      ...(Array.isArray(category?.disqualifiers) ? category.disqualifiers : []),
      ...memoryPolarity.negativeTokens,
    ];
    const capabilityBits = [
      ...(business?.capabilityModel?.capabilities || []),
      ...(business?.capabilityModel?.outcomes || []),
      ...(business?.capabilityModel?.buyerPains || []),
      ...(business?.capabilityModel?.requiredBuyerConditions || []),
    ].filter(Boolean).slice(0, 12);
    const locationTerms = Array.from(new Set([
      ...Object.keys(cityMeta),
      ...Object.values(cityMeta).map(item => item.country),
    ])).filter(Boolean);
    const locationFreeQueries = candidateQueries.map(query => stripLocationTerms(query, locationTerms)).filter(Boolean);
    const selectedQueries = selectStrongestQueries(locationFreeQueries, {
      memories: memoryTexts,
      requiredEvidence: [...requiredEvidence, ...mandatorySignals],
      capabilities: capabilityBits,
      opportunity: [
        category?.name,
        category?.whyRelevant,
        category?.whyNonObvious,
        category?.sharedPain,
        ...(Array.isArray(category?.painPoints) ? category.painPoints : []),
      ].filter(Boolean),
    });
    console.log(`[exa-search] selected queries: ${JSON.stringify(selectedQueries)}`);
    const baseQueries = selectedQueries.map(item => item.query);
    const contextSuffix = [
      memoryContext ? `preferred buyer signals: ${memoryContext}` : "",
      mandatorySignals.length ? `must show: ${mandatorySignals.join(", ")}` : (requiredEvidence.length ? `must show: ${requiredEvidence.join(", ")}` : ""),
      capabilityBits.length ? `seller capability fit: ${capabilityBits.join(", ")}` : "",
    ].filter(Boolean).join(" ");
    const useCountryDomains = meta.domains.length > 0 && meta.domains[0] !== ".com";
    const searchQueries = Array.from(new Set(
      baseQueries.flatMap((q) => {
        const scoped = city ? `${q} in ${city}` : q;
        const located = city ? `${q} located in ${city}, ${meta.country}` : q;
        const contextual = contextSuffix ? `${scoped} ${contextSuffix}` : scoped;
        if (useCountryDomains) return [memoryContext ? contextual : scoped];
        return memoryContext ? [located, contextual] : [scoped, located];
      })
    ));

    const fetchExa = async (q: string, includeDomains?: string[], resultCount = numResults + 5) => {
      const body: any = {
        query: q,
        type: "auto",
        category: "company",
        numResults: resultCount,
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
      return (d.results || []).map((result: any) => ({ ...result, _searchQuery: q }));
    };

    // Run multiple opportunity queries in parallel. Memory context is prioritized
    // when present; capability-derived queries remain the fallback when it is not.
    const resultSets = await Promise.all([
      ...searchQueries.map((q) => fetchExa(q)),
      ...(useCountryDomains
        ? baseQueries.map((q) => fetchExa(q, meta.domains))
        : []),
    ]);

    // Merge by company domain so one company cannot occupy several lead slots.
    const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
    const byCompany = new Map<string, any>();
    const merged: any[] = [];
    for (const r of resultSets.flat()) {
      const key = hostOf(r.url || "") || (r.url || "").toLowerCase().replace(/\/$/, "");
      const existing = byCompany.get(key);
      if (!existing) {
        const value = { ...r, _searchQueries: [r._searchQuery].filter(Boolean) };
        byCompany.set(key, value);
        merged.push(value);
        continue;
      }
      existing.text = [existing.text, r.text].filter(Boolean).join("\n").slice(0, 6000);
      existing.highlights = Array.from(new Set([...(existing.highlights || []), ...(r.highlights || [])])).slice(0, 12);
      existing._searchQueries = Array.from(new Set([...(existing._searchQueries || []), r._searchQuery].filter(Boolean)));
    }

    // Process results
    const allResults = merged.map((r: any) => {
      const allText = [r.text || "", r.summary || "", ...(r.highlights || [])].join(" ");
      const pageText = [r.text || "", ...(r.highlights || [])].join(" ");
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
        // Real cached page text only — EXCLUDES Exa's query-conditioned summary,
        // which echoes the searched city into every result and breaks location checks.
        _pageText: pageText,
        _evidenceSources: [{ url: r.url || "#", pageText }],
        _url: (r.url || "").toLowerCase(),
        _host: hostOf(r.url || ""),
        _queryHits: Array.isArray(r._searchQueries) ? r._searchQueries.length : 1,
      };
    });

    // ccTLD -> country, for a country cross-check on the result's domain.
    const tldCountry: Record<string, string> = {
      ".sg": "Singapore", ".id": "Indonesia", ".my": "Malaysia", ".th": "Thailand",
      ".vn": "Vietnam", ".ph": "Philippines", ".hk": "Hong Kong", ".jp": "Japan",
      ".au": "Australia", ".ae": "UAE", ".uk": "United Kingdom",
    };
    const hostCountry = (host: string): string | null => {
      for (const [tld, country] of Object.entries(tldCountry)) if (host.endsWith(tld)) return country;
      return null;
    };
    const addressIndicators = /(jalan|jl\.?|street|\bst\b|road|\brd\b|avenue|\bave\b|boulevard|blvd|floor|level|tower|building|district|suburb|postal|postcode|zip|\b\d{4,6}\b)/i;

    // STRICT post-filter: the city term must appear in a LOCATION-BEARING field
    // (title, URL host, or a detected address line) — never just anywhere in the
    // text blob (that was the leak). Plus a country cross-check on the domain.
    // Unambiguous city/region names per city (NO district words like "marina"/"central"
    // which collide across cities). Used to drop results that clearly name a DIFFERENT city.
    const cityNames: Record<string, string[]> = {
      "singapore": ["singapore"],
      "jakarta": ["jakarta"],
      "bali": ["bali", "denpasar", "seminyak", "ubud", "canggu", "kuta", "sanur"],
      "kuala lumpur": ["kuala lumpur", "petaling jaya"],
      "bangkok": ["bangkok"],
      "ho chi minh city": ["ho chi minh", "saigon"],
      "manila": ["manila", "makati"],
      "hong kong": ["hong kong", "hongkong"],
      "tokyo": ["tokyo"],
      "sydney": ["sydney"],
      "dubai": ["dubai"],
      "london": ["london"],
      "new york": ["new york", "nyc"],
    };
    const reqKey = (city || "").toLowerCase();
    const ownNames = cityNames[reqKey] || [];
    const conflictNames = Object.entries(cityNames)
      .filter(([k]) => k !== reqKey)
      .flatMap(([, v]) => v)
      .filter(n => !ownNames.includes(n));

    let results = allResults.filter((r: any) => {
      const reason = lowQualitySourceReason(r.url, r.title);
      if (!reason) return true;
      console.log(`[exa-search] DROP "${r.title}" (${r._host}) reason: ${reason}`);
      return false;
    });
    let drops = 0;
    if (city) {
      console.log(`[exa-search] city="${city}" country="${meta.country}" raw merged=${allResults.length}`);
      results = results.filter((r: any) => {
        const title = (r.title || "").toLowerCase();
        const host = r._host || "";
        const fullText = (r._fullText || "").toLowerCase();

        const hc = hostCountry(host);
        if (hc && meta.country && hc !== meta.country) {
          console.log(`[exa-search] DROP "${r.title}" (${host}) reason: country mismatch (domain=${hc}, want=${meta.country})`);
          drops++; return false;
        }

        // If the title or host clearly names a DIFFERENT city, it's located there — drop.
        const otherCity = conflictNames.find(n => title.includes(n) || host.includes(n.replace(/\s+/g, "")));
        if (otherCity) {
          console.log(`[exa-search] DROP "${r.title}" (${host}) reason: names other city "${otherCity}"`);
          drops++; return false;
        }

        const inTitleOrHost = meta.strictTerms.some(term => title.includes(term) || host.includes(term.replace(/\s+/g, "")));
        let inAddressLine = false;
        const pageText = (r._pageText || "").toLowerCase();
        if (!inTitleOrHost) {
          // Scan the REAL page text (not the query-poisoned summary). Require the city
          // term itself next to an address marker — a mere country mention is too weak.
          for (const term of meta.strictTerms) {
            let idx = pageText.indexOf(term);
            while (idx !== -1) {
              const window = pageText.slice(Math.max(0, idx - 60), idx + term.length + 60);
              if (addressIndicators.test(window)) { inAddressLine = true; break; }
              idx = pageText.indexOf(term, idx + term.length);
            }
            if (inAddressLine) break;
          }
        }

        const matchingCountryDomain = Boolean(hc && meta.country && hc === meta.country);
        const cityMention = meta.strictTerms.some(term => pageText.includes(term));
        r._locationSignals = {
          matchingCountryDomain,
          inTitleOrHost,
          inAddressLine,
          cityMention,
        };
        if (!inTitleOrHost && !inAddressLine && !matchingCountryDomain && !cityMention) {
          console.log(`[exa-search] KEEP FOR MANUS "${r.title}" (${host}) location requires semantic verification`);
        }
        return true;
      });
      console.log(`[exa-search] post-filter kept=${results.length} dropped=${drops}`);
    }

    // Exa's initial company result often contains only homepage snippets. Retrieve
    // prerequisite-bearing pages from the strongest official domains before asking
    // Manus to validate them. This keeps the total at no more than 12 Exa calls:
    // up to 6 discovery calls plus up to 6 evidence-enrichment calls.
    const priorityTokens = (value: string) => Array.from(new Set(String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(token => token.length > 3 && !["with", "from", "that", "this", "their", "facility", "operator", "system", "treatment"].includes(token))));
    const opportunityIdentityTokens = priorityTokens([
      category?.name,
      category?.whyRelevant,
      category?.sharedPain,
      ...(Array.isArray(category?.painPoints) ? category.painPoints : []),
    ].filter(Boolean).join(" "));
    const prerequisiteTokens = priorityTokens([...requiredEvidence, ...mandatorySignals].join(" "));
    const vendorPattern = /\b(manufacturer|supplier|installer|installation|distributor|integrator|engineering (?:firm|company|solutions)|consultant|we supply|we install|design and build|equipment provider)\b/i;
    const evidencePriority = (result: any) => {
      const text = `${result.title || ""} ${result._pageText || ""}`;
      const normalized = text.toLowerCase();
      const mandatoryHits = matchMandatoryEvidence(text, mandatorySignals).length;
      const identityHits = opportunityIdentityTokens.filter(token => normalized.includes(token)).length;
      const prerequisiteKeywordHits = prerequisiteTokens.filter(token => normalized.includes(token)).length;
      const location = result._locationSignals || {};
      return mandatoryHits * 20 + identityHits * 5 + prerequisiteKeywordHits * 3 + (result._queryHits || 0) * 3 +
        (location.inAddressLine ? 8 : 0) + (location.inTitleOrHost ? 6 : 0) +
        (location.matchingCountryDomain ? 4 : 0) + (location.cityMention ? 2 : 0) -
        (vendorPattern.test(text) ? 45 : 0);
    };
    const enrichmentBudget = Math.max(0, 12 - (searchQueries.length + (useCountryDomains ? baseQueries.length : 0)));
    const enrichmentTargets = [...results]
      .sort((a: any, b: any) => evidencePriority(b) - evidencePriority(a))
      .slice(0, Math.min(6, enrichmentBudget));
    const enrichmentSets = await Promise.all(enrichmentTargets.map((result: any) => {
      const evidenceTerms = mandatorySignals.slice(0, 6).join(" OR ");
      const evidenceQuery = `${result.title} ${city || ""} ${evidenceTerms}`.trim();
      return fetchExa(evidenceQuery, result._host ? [result._host] : undefined, 3);
    }));
    enrichmentTargets.forEach((result: any, index: number) => {
      for (const page of enrichmentSets[index] || []) {
        if (hostOf(page.url || "") !== result._host) continue;
        const pageText = [page.text || "", ...(page.highlights || [])].join(" ").trim();
        if (!pageText) continue;
        result._pageText = `${result._pageText || ""}\n${pageText}`.slice(0, 12_000);
        result._evidenceSources.push({ url: page.url, pageText });
      }
    });

    const eligibilityGroups: Array<{ requirement: string; signals: string[] }> = prerequisiteItems.length
      ? prerequisiteItems.map((item: any) => ({
          requirement: String(item.requirement || ""),
          signals: (Array.isArray(item.acceptableSignals) ? item.acceptableSignals : []).map((signal: any) => String(signal)).filter(Boolean),
        }))
      : [{ requirement: "legacy required evidence", signals: requiredEvidence }];
    if (eligibilityGroups.some(group => group.signals.length)) {
      results.forEach((result: any) => {
        const groupMatches = eligibilityGroups.map(group => ({
          requirement: group.requirement,
          matches: matchMandatoryEvidence(result._pageText || "", group.signals),
        }));
        result._mandatoryMatches = groupMatches.flatMap(group => group.matches);
        result._prerequisiteMatches = groupMatches;
      });
    }

    const scoreHeuristic = (r: any) => {
      const text = `${r.title || ""} ${r.url || ""} ${r._pageText || ""}`.toLowerCase();
      let score = 1;
      const evidenceHits = Array.isArray(r._mandatoryMatches) ? r._mandatoryMatches : [];
      const capabilityHits = capabilityBits.filter((e: string) => text.includes(String(e).toLowerCase()));
      const disqHits = disqualifiers.filter((e: string) => text.includes(String(e).toLowerCase()));
      if (evidenceHits.length) score += 2;
      if (capabilityHits.length) score += 1;
      if ((r._queryHits || 0) > 1) score += 1;
      if (disqHits.length) score -= 2;
      const evidenceQuote = String(r._pageText || "").replace(/\s+/g, " ").trim().slice(0, 500);
      return {
        ...r,
        fitScore: Math.max(1, Math.min(5, score)),
        evidence: evidenceQuote || "No source-page evidence available.",
        evidenceQuote,
        evidenceUrl: r.url,
        eligibilityPass: evidenceHits.length > 0,
        whyThisCompanyFits: evidenceHits.length
          ? `Verified mandatory signals: ${evidenceHits.slice(0, 3).join(", ")}.`
          : "Mandatory buyer evidence was not verified.",
        disqualifiers: disqHits,
        contextApplied: [
          ...(memoryContext ? ["mem0 business context"] : ["website capability fallback"]),
          ...(requiredEvidence.length ? ["required evidence"] : []),
        ],
        memoriesUsed: memoryTexts,
      };
    };

    const heuristicResults = results.map(scoreHeuristic);
    const validationCandidates = [...heuristicResults].sort((a: any, b: any) =>
      evidencePriority(b) - evidencePriority(a) || (b.fitScore || 0) - (a.fitScore || 0)
    );

    let validationStatus: "manus" | "heuristic" | "failed" = "heuristic";
    let validationAudit: any[] = [];
    try {
      if (process.env.MANUS_API_KEY && heuristicResults.length > 0) {
        const candidatesForValidation = validationCandidates.slice(0, Math.min(6, Math.max(numResults, 5)));
        console.log(`[exa-search] candidates selected for Manus: ${JSON.stringify(candidatesForValidation.map((item: any) => item.title))}`);
        const buildValidationPrompt = (candidate: any) => `You are validating one B2B lead search result before it is shown to a user.

Seller:
${JSON.stringify({
  companyName: business?.companyName,
  products: business?.products,
  capabilityModel: business?.capabilityModel,
}, null, 2)}

Selected opportunity:
${JSON.stringify(category || {}, null, 2)}

mem0 business context from the user (highest priority when present):
${memoryTexts.length ? memoryTexts.map((m: string, i: number) => `${i + 1}. ${m}`).join("\n") : "None provided. Use website-derived capability fallback."}

City/country required: ${city || "Any"} ${meta.country ? `(${meta.country})` : ""}

Candidate company:
${JSON.stringify({
  title: candidate.title,
  url: candidate.url,
  officialSiteEvidence: (candidate._evidenceSources || []).slice(0, 3).map((source: any) => ({
    url: source.url,
    pageText: String(source.pageText || "").slice(0, 1000),
  })),
  locationSignals: candidate._locationSignals,
  mandatoryPrerequisitesMatched: candidate._prerequisiteMatches,
  queryHitCount: candidate._queryHits,
})}

Return ONLY valid JSON. Validate that each lead is a real operating company, in the correct location, relevant to the selected opportunity, and supported by evidence.

DECISION CONTRACT (do not silently strengthen these rules):
- Return exactly one result record for the supplied candidate with the same company URL. Include the record even when rejected, using false fields and rejectReason; never return an empty results array.
- Treat alternatives joined by "or" in a prerequisite as alternatives. Verifying any one acceptable signal is sufficient unless the selected opportunity explicitly says otherwise.
- The supplied acceptableSignals define what counts as evidence. Do not require fixed filtration, procurement authority, budget, scale, or another condition unless that exact condition appears in the selected opportunity's prerequisite or disqualifiers.
- A disqualifier applies only when supplied page evidence explicitly proves it. Uncertainty, missing detail, "outdoor", or a possible concern is not a disqualifier.
- If an official page explicitly says the target operator offers a listed acceptable facility (for example cold plunge), set requiredEvidenceVerified and eligibilityPass true.
- A candidate passing all required checks must receive fitScore 3-5. Use fitScore 1-2 only for a rejected candidate.
- rejectReason must be empty only when every required check is true; otherwise state the failed check.

For every candidate set these verification fields explicitly:
- isRealCompany: the evidence identifies a specific legal or trading business.
- isOperating: the page contains current services, contact, booking, location, or other evidence that it still operates.
- locationVerified: the supplied page evidence verifies the requested city/country, not merely a service area or query-generated summary.
- isPrimaryCompanySource: the URL is the company's own website, not a directory, social profile, article, or aggregator.
- isTargetBuyer: the company operates in the selected opportunity market and would buy/use the seller's capability. Set false for vendors, installers, distributors, consultants, manufacturers, or competitors selling the same type of solution.
- buyerRoleEvidence: a verbatim quotation showing that the company is the target operator/buyer rather than a solution vendor.
- requiredEvidenceVerified: page evidence satisfies at least one required buyer condition; use true when no required evidence was supplied.
- eligibilityPass: true only when mandatory buyer evidence is verified from pageText.
- verifiedAddress: the location-bearing address or branch text from pageText; empty when it cannot be verified.
- evidenceQuote: a verbatim quotation from pageText proving the mandatory condition. Never use or paraphrase a search summary.
- evidenceUrl: the exact supplied official-site evidence URL containing the quotation; it may be a subpage on the candidate's own domain.
- rejectReason: concise reason when any verification field is false, otherwise an empty string.
- disqualifiers: concrete disqualifying evidence; return an empty array only when none is present.

Only return candidate companies and official-site evidence URLs supplied above. Do not invent or substitute URLs. Mark unverifiable claims false. Reject or score low if a result is a directory/blog/article, wrong country/city, not operating, lacks a required buyer condition, or is only keyword-adjacent.`;

        const validationSchema = {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  url: { type: "string" },
                  summary: { type: "string" },
                  fitScore: { type: "number", minimum: 1, maximum: 5 },
                  evidence: { type: "string" },
                  whyThisCompanyFits: { type: "string" },
                  disqualifiers: { type: "array", items: { type: "string" } },
                  contextApplied: { type: "array", items: { type: "string" } },
                  memoriesUsed: { type: "array", items: { type: "string" } },
                  isRealCompany: { type: "boolean" },
                  isOperating: { type: "boolean" },
                  locationVerified: { type: "boolean" },
                  isPrimaryCompanySource: { type: "boolean" },
                  isTargetBuyer: { type: "boolean" },
                  buyerRoleEvidence: { type: "string" },
                  requiredEvidenceVerified: { type: "boolean" },
                  eligibilityPass: { type: "boolean" },
                  verifiedAddress: { type: "string" },
                  evidenceQuote: { type: "string" },
                  evidenceUrl: { type: "string" },
                  rejectReason: { type: "string" },
                },
                required: ["title", "url", "summary", "fitScore", "evidence", "whyThisCompanyFits", "disqualifiers", "contextApplied", "memoriesUsed", "isRealCompany", "isOperating", "locationVerified", "isPrimaryCompanySource", "isTargetBuyer", "buyerRoleEvidence", "requiredEvidenceVerified", "eligibilityPass", "verifiedAddress", "evidenceQuote", "evidenceUrl", "rejectReason"],
                additionalProperties: false,
              },
            },
          },
          required: ["results"],
          additionalProperties: false,
        };
        const candidateKey = (value: string) => String(value || "").toLowerCase().replace(/\/$/, "");
        const validationSettled = await Promise.allSettled(candidatesForValidation.map(async (candidate: any) => {
          let candidateResult: any = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            const validated = await manusTask<any>(buildValidationPrompt(candidate), validationSchema, {
              timeoutMs: 90_000,
              pollMs: 2_000,
              profile: process.env.MANUS_REASONING_PROFILE || "manus-1.6",
            });
            candidateResult = Array.isArray(validated?.results) ? validated.results[0] : null;
            if (candidateResult && candidateKey(candidateResult.url) === candidateKey(candidate.url)) return candidateResult;
            console.warn(`[exa-search] Manus omitted validation for ${candidate.title}; retrying`);
          }
          throw new Error(`Manus returned no validation record for ${candidate.title}`);
        }));
        const validated = {
          results: validationSettled.flatMap(item => item.status === "fulfilled" ? [item.value] : []),
        };
        const validationFailures = validationSettled.filter(item => item.status === "rejected").length;
        if (validationFailures) console.warn(`[exa-search] ${validationFailures}/${candidatesForValidation.length} individual validations failed`);
        if (!validated.results.length) throw new Error("Manus returned no complete individual validations");

        const byUrl = new Map(heuristicResults.map((r: any) => [candidateKey(r.url), r]));
        validationAudit = (validated.results || []).map((item: any) => ({
          title: item.title,
          url: item.url,
          isRealCompany: item.isRealCompany,
          isOperating: item.isOperating,
          locationVerified: item.locationVerified,
          isPrimaryCompanySource: item.isPrimaryCompanySource,
          isTargetBuyer: item.isTargetBuyer,
          requiredEvidenceVerified: item.requiredEvidenceVerified,
          eligibilityPass: item.eligibilityPass,
          fitScore: item.fitScore,
          evidenceQuote: item.evidenceQuote,
          evidenceUrl: item.evidenceUrl,
          verifiedAddress: item.verifiedAddress,
          buyerRoleEvidence: item.buyerRoleEvidence,
          disqualifiers: item.disqualifiers,
          rejectReason: item.rejectReason,
        }));
        console.log(`[exa-search] Manus validation audit: ${JSON.stringify(validationAudit)}`);
        results = (validated.results || [])
          .filter((v: any) => byUrl.has(candidateKey(v.url)))
          .map((v: any) => ({ ...byUrl.get(candidateKey(v.url)), ...v }))
          .filter((r: any) => {
            const source = byUrl.get(candidateKey(r.url));
            const normalizedQuote = String(r.evidenceQuote || "").toLowerCase().replace(/\s+/g, " ").trim();
            const evidenceSource = (source?._evidenceSources || []).find((item: any) => candidateKey(item.url) === candidateKey(r.evidenceUrl));
            const normalizedPage = String(evidenceSource?.pageText || "").toLowerCase().replace(/\s+/g, " ");
            const sameOfficialDomain = hostOf(r.evidenceUrl || "") === source?._host;
            const quoteVerified = normalizedQuote.length >= 15 && normalizedPage.includes(normalizedQuote);
            return r.isRealCompany && r.isOperating && (!city || r.locationVerified) && r.isPrimaryCompanySource && r.isTargetBuyer && r.eligibilityPass &&
              (!requiredEvidence.length || r.requiredEvidenceVerified) && (!Array.isArray(r.disqualifiers) || r.disqualifiers.length === 0) &&
              quoteVerified && sameOfficialDomain && r.fitScore >= 3;
          })
          .sort((a: any, b: any) => (b.fitScore || 0) - (a.fitScore || 0));
        validationStatus = "manus";
      } else {
        validationStatus = heuristicResults.length ? "failed" : "heuristic";
        results = [];
      }
    } catch (e: any) {
      console.warn("[exa-search] Manus validation failed; withholding unverified leads:", e?.message);
      validationStatus = "failed";
      results = [];
    }

    // Remove internal fields before returning
    results = results.slice(0, numResults).map(({
      _fullText,
      _pageText,
      _url,
      _host,
      _queryHits,
      _mandatoryMatches,
      _prerequisiteMatches,
      _evidenceSources,
      _locationSignals,
      ...rest
    }: any) => rest);

    if (results.length === 0) {
      return res.json({
        results: [],
        message: validationStatus === "failed"
          ? "Lead validation is temporarily unavailable. No unverified leads were shown."
          : city
            ? `No verified companies found specifically in ${city}. Try a different category or city.`
            : "No company passed the required evidence and source-quality checks.",
        querySelection: selectedQueries.map(item => ({
          ...item,
          contextApplied: memoryTexts.length ? ["mem0", "required evidence", "capability model"] : ["required evidence", "capability model fallback"],
        })),
        exaRequestCount: searchQueries.length + (useCountryDomains ? baseQueries.length : 0) + enrichmentTargets.length,
        validationStatus,
        rejectedCount: allResults.length,
        validationAudit,
      });
    }

    return res.json({
      results,
      querySelection: selectedQueries.map(item => ({
        ...item,
        contextApplied: memoryTexts.length ? ["mem0", "required evidence", "capability model"] : ["required evidence", "capability model fallback"],
      })),
      exaRequestCount: searchQueries.length + (useCountryDomains ? baseQueries.length : 0) + enrichmentTargets.length,
      validationStatus,
      rejectedCount: Math.max(0, allResults.length - results.length),
      validationAudit,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// POST /api/find-contacts — Contact finder via Exa LinkedIn
// ============================================================
api.post("/api/find-contacts", async (req: Request, res: Response) => {
  const { leadName, city, leadUrl } = req.body;
  if (!leadName) {
    return res.status(400).json({ error: "leadName is required" });
  }

  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Exa not configured" });
  }

  // --- Company verification helpers (avoid returning execs from other companies) ---
  const normalize = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // Generic industry/segment/geo words must NOT count as a company match, or any
  // education/hospitality exec would match "X International School", "Y Resort", etc.
  const stop = new Set([
    "pte", "ltd", "inc", "llc", "group", "holdings", "company", "co", "the", "and",
    "sdn", "bhd", "limited", "corporation", "corp", "pt", "tbk", "services", "solutions", "global",
    "international", "school", "schools", "academy", "college", "university", "institute",
    "club", "clubs", "resort", "resorts", "hotel", "hotels", "spa", "spas", "pool", "pools",
    "recovery", "wellness", "fitness", "gym", "studio", "studios", "centre", "center",
    "hospitality", "property", "properties", "realty", "development", "developments",
    "food", "beverage", "agribusiness", "water", "treatment", "systems", "system",
    "technology", "technologies", "management", "consulting", "consultancy", "partners",
    "premium", "luxury", "boutique", "private", "public", "national",
    "asia", "asean", "indonesia", "singapore", "malaysia", "thailand", "vietnam",
    "philippines", "japan", "australia", "bali", "jakarta", "bangkok", "manila",
  ]);
  const companyTokens = (name: string): string[] =>
    (name || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !stop.has(w));
  const domainCore = (url?: string): string => {
    if (!url) return "";
    try { return new URL(url).hostname.replace(/^www\./, "").split(".")[0] || ""; } catch { return ""; }
  };

  const core = normalize(domainCore(leadUrl));
  const fullName = normalize(leadName);
  const tokens = companyTokens(leadName).map(normalize).filter(t => t.length >= 5);
  // Adjacent-word fingerprints (bigrams) of the company name — a far stronger
  // signal than one shared word. "Mantra Wellness Bali" -> mantrawellness,
  // wellnessbali. Stops a CEO of "Eco-Mantra" matching on the lone word "mantra".
  const words = String(leadName || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) bigrams.push(normalize(words[i] + words[i + 1]));

  // Verify against the REAL cached profile text (headline/employer), NOT Exa's
  // query-conditioned `summary` (which echoes the searched company into every result).
  // Require a STRONG match: the domain, the full company name, or two adjacent company
  // words — never a single shared word (which falsely matches look-alike companies).
  const referencesCompany = (haystackRaw: string): boolean => {
    const haystack = normalize(haystackRaw);
    if (core.length >= 6 && haystack.includes(core)) return true;
    if (fullName.length >= 8 && haystack.includes(fullName)) return true;
    if (bigrams.some(b => b.length >= 8 && haystack.includes(b))) return true;
    // Single-word company (e.g. "Spotify") — fall back to its one distinctive token.
    if (words.length === 1 && tokens[0] && haystack.includes(tokens[0])) return true;
    return false;
  };
  const isLikelyPersonName = (name: string): boolean => {
    const n = (name || "").trim();
    if (!n || n.length > 50) return false;
    if (/[!?:;]|\.{2,}/.test(n)) return false;
    return n.split(/\s+/).length <= 6;
  };

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
        numResults: 8,
        includeDomains: ["linkedin.com"],
        // Cached page text + highlights for verification — NOT the query-poisoned summary.
        contents: { text: { maxCharacters: 1500 }, highlights: true },
      }),
    });

    if (!exaRes.ok) {
      return res.json({ contacts: [], source: "exa" });
    }

    const data: any = await exaRes.json();
    const raw = data.results || [];
    console.log(`[find-contacts] company="${leadName}" core="${core}" raw=${raw.length}`);

    const contacts = raw
      .map((r: any) => ({
        r,
        title: r.title || "",
        profileText: `${r.title || ""} ${r.text || ""} ${(r.highlights || []).join(" ")}`,
      }))
      .filter(({ r, title, profileText }: any) => {
        if (!/linkedin\.com\/in\//i.test(r.url || "")) {
          console.log(`[find-contacts] DROP "${String(title).slice(0, 40)}" reason: not a personal profile (${r.url})`);
          return false;
        }
        if (!isLikelyPersonName(title)) {
          console.log(`[find-contacts] DROP "${String(title).slice(0, 40)}" reason: not a person name`);
          return false;
        }
        if (!referencesCompany(profileText)) {
          console.log(`[find-contacts] DROP "${title}" reason: company not referenced in profile text`);
          return false;
        }
        return true;
      })
      .slice(0, 3)
      .map(({ r, profileText }: any) => ({
        name: r.title || "Unknown",
        title: extractTitle(profileText),
        linkedinUrl: r.url || "",
        source: "exa",
        verificationStatus: "verified" as const,
      }));

    console.log(`[find-contacts] verified=${contacts.length}`);
    return res.json({ contacts, source: "exa" });
  } catch {
    return res.json({ contacts: [], source: "exa" });
  }
});

// Parse a role from cached profile text. Returns "" when none is found — never
// fabricates a title (an unverified role must not surface).
function extractTitle(text: string): string {
  const mAt = text.match(/(?:^|\n)\s*([A-Z][A-Za-z &\/\-]{2,60}?)\s+at\s+/);
  if (mAt) return mAt[1].trim();
  const mIs = text.match(/is (?:the )?(?:current )?([A-Z][A-Za-z &\/\-]{3,50}?)\s+(?:at|of|for)\s/);
  if (mIs) return mIs[1].trim();
  const roles = ["Co-Founder", "Founder", "CEO", "Managing Director", "General Manager", "Director", "Owner"];
  for (const role of roles) {
    if (text.includes(role)) return role;
  }
  return "";
}

// ============================================================
// POST /api/generate-brief — start Manus task, return taskId
// ============================================================
api.post("/api/generate-brief", async (req: Request, res: Response) => {
  const { business, lead, memories } = req.body;

  if (!business || !lead) {
    return res.status(400).json({ error: "business and lead are required" });
  }

  try {
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

    const taskId = await startManusTask(prompt, {
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
    });

    return res.json({ taskId });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "Brief generation failed" });
  }
});

// ============================================================
// POST /api/generate-sales-kit — fetch prospect site then start Manus task, return taskId
// ============================================================
api.post("/api/generate-sales-kit", async (req: Request, res: Response) => {
  const { business, lead, memories, reviewPainPoints } = req.body;

  if (!business || !lead) {
    return res.status(400).json({ error: "business and lead are required" });
  }

  try {
    // Fetch prospect website content (fast, done before creating task)
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

    const taskId = await startManusTask(kitPrompt, {
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
    });

    return res.json({ taskId });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "Sales kit generation failed" });
  }
});

// ============================================================
// POST /api/send-email — Send outreach email via Resend
// ============================================================
api.post("/api/send-email", async (req: Request, res: Response) => {
  const { subject, html, from } = req.body;
  // Fixed recipient as configured
  const to = "ngurah.linggih@gmail.com";
  if (!subject || !html) {
    return res.status(400).json({ ok: false, error: "subject and html are required" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "Resend not configured" });
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
// POST /api/notify-signup — Notify admin when a new user signs up
// ============================================================
api.post("/api/notify-signup", async (req: Request, res: Response) => {
  const apiKey = process.env.RESEND_API_KEY;

  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ ok: false, error: "email is required" });
  }

  // If Resend isn't configured, succeed silently — never crash the signup flow.
  if (!apiKey) {
    return res.json({ ok: false });
  }

  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || "ngurah.linggih@gmail.com";
  const timestamp = new Date().toISOString();

  try {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || "nura@biks.ai",
        to: adminEmail,
        subject: `New Biks.AI signup: ${email}`,
        html: `<p>A new user just signed up for Biks.AI Sales Agent: ${email} at ${timestamp}.</p>`,
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
function buildKitEmailHtml(business: any, lead: any, salesKit: any, contacts: any[], _painPoints?: any[]) {
  // Parchment palette inlined as literal hex (email clients don't support CSS vars).
  // Personalized greeting: use the first verified contact's first name; strip any
  // greeting the LLM already wrote so we never double up or render "Hi undefined".
  const firstName = (contacts?.[0]?.name || "").trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  const rawBody = salesKit.outreachEmailBody || "";
  const bodyNoGreeting = rawBody.replace(/^\s*(hi|hello|dear)\b[^\n,]*,?\s*/i, "").trimStart();
  const emailBody = `${greeting}\n\n${bodyNoGreeting}`;

  const usp = (business.valueProposition || "").trim();
  const uspHtml = usp ? `
  <div style="padding:0 32px 8px;">
    <p style="font-size:16px;line-height:1.5;color:#5A7A7E;font-style:italic;font-weight:600;margin:0;border-left:3px solid #8FA8AC;padding-left:14px;">${usp}</p>
  </div>` : "";

  const whyFits = (salesKit.whyThisProspect || []).slice(0, 3);
  const whyFitsHtml = whyFits.length > 0 ? `
  <div style="padding:24px 32px 8px;">
    <h3 style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#6A6460;margin:0 0 14px;">Why It Fits</h3>
    ${whyFits.map((point: string) => `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:6px 0;">
        <span style="color:#5A7A7E;font-size:14px;line-height:1.6;flex-shrink:0;">\u2022</span>
        <span style="font-size:14px;color:#3A3632;line-height:1.6;">${point}</span>
      </div>`).join("")}
  </div>` : "";

  const stats = (salesKit.proofStats || []).filter((s: any) => s && (s.number || s.label));
  const statsHtml = stats.length > 0 ? `
  <div style="padding:24px 32px 8px;">
    <h3 style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#6A6460;margin:0 0 12px;">By The Numbers</h3>
    <table style="width:100%;border-collapse:separate;border-spacing:8px 0;"><tr>
      ${stats.map((s: any) => `
        <td style="background:#F9F7F2;border:1px solid #E3DDD2;border-radius:10px;padding:16px 10px;text-align:center;vertical-align:top;">
          <div style="font-size:22px;font-weight:700;color:#201E1A;">${s.number || ""}</div>
          <div style="font-size:11px;color:#6A6460;margin-top:4px;">${s.label || ""}</div>
        </td>`).join("")}
    </tr></table>
  </div>` : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#EDE8DF;font-family:'General Sans','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;background:#EDE8DF;padding:0;">
  <!-- Hero -->
  <div style="padding:40px 32px;text-align:center;background:#F4F0E8;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#5A7A7E;margin-bottom:12px;">PARTNERSHIP OPPORTUNITY</div>
    <h1 style="font-size:24px;font-weight:600;color:#201E1A;margin:0;line-height:1.3;letter-spacing:-0.02em;">${business.companyName} \u00d7 ${lead.name}</h1>
  </div>

  <!-- Outreach Message -->
  <div style="padding:32px;">
    <div style="background:#F4F0E8;border:1px solid #E3DDD2;border-radius:10px;padding:24px;">
      <div style="font-size:14px;color:#3A3632;line-height:1.8;white-space:pre-wrap;">${emailBody}</div>
    </div>
  </div>

  ${uspHtml}
  ${whyFitsHtml}
  ${statsHtml}

  <!-- CTA -->
  <div style="padding:32px;text-align:center;">
    <div style="background:#201E1A;border-radius:10px;padding:32px;">
      <h3 style="font-size:18px;font-weight:600;color:#F4F0E8;margin:0 0 12px;">Let's Explore This Together</h3>
      <p style="font-size:13px;color:rgba(244,240,232,0.75);margin:0 0 20px;">${salesKit.suggestedAngle}</p>
      <a href="${business.website || '#'}" style="display:inline-block;background:#F4F0E8;color:#201E1A;font-size:13px;font-weight:600;padding:12px 28px;border-radius:10px;text-decoration:none;">Schedule a Call \u2192</a>
    </div>
  </div>

  <!-- Footer -->
  <div style="padding:24px 32px;border-top:1px solid #E3DDD2;text-align:center;">
    <p style="font-size:11px;color:#6A6460;margin:0;">Sent via <span style="color:#201E1A;font-weight:600;">Biks.ai</span> \u2014 AI-powered sales intelligence</p>
    <p style="font-size:10px;color:#9A9590;margin:8px 0 0;">From ${business.companyName} \u2022 ${business.website || ''}</p>
    <p style="font-size:10px;color:#9A9590;margin:12px 0 0;"><a href="#" style="color:#6A6460;text-decoration:underline;">Unsubscribe</a></p>
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
// GET /api/poll-task — Check status of a Manus task (Vercel-compatible polling)
// ============================================================
api.get("/api/poll-task", async (req: Request, res: Response) => {
  const { id } = req.query;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "id is required" });
  }
  try {
    const status = await checkManusTask(id);
    if (status.status !== "done") return res.json(status);

    const result: any = status.result;
    const isCompanyAnalysis = Boolean(result?.companyName || result?.capabilityModel);
    if (!isCompanyAnalysis) return res.json(status);

    const normalized = normalizeCompanyAnalysisResult(result);
    const timing = analysisTaskTimings.get(id);
    console.log(`[analysis:timing] task_complete taskId=${id} durationMs=${timing ? Date.now() - timing.startedAt : "unknown"}`);
    console.log(`[analysis:timing] normalization_complete taskId=${id} opportunities=${normalized.expansionCategories.length}`);
    analysisTaskTimings.delete(id);
    return res.json({ status: "done", result: normalized });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// POST /api/scrape-reviews — Fetch & analyze Google Reviews of prospect
// ============================================================
// In-memory TTL cache for the cost-incurring review lookups (Google Places / Exa).
// Same company within the TTL = no repeat external call, which keeps Google usage in
// the free tier. Warm-instance scope (resets on cold start) — fine at this volume.
type ReviewCacheEntry = { reviewTexts: string; placeMeta: string; source: "google" | "exa" | ""; googleReviews: any[]; expires: number };
const REVIEW_CACHE = new Map<string, ReviewCacheEntry>();
const REVIEW_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const reviewKey = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function cacheGetReviews(key: string): ReviewCacheEntry | null {
  const e = REVIEW_CACHE.get(key);
  if (!e) return null;
  if (Date.now() > e.expires) { REVIEW_CACHE.delete(key); return null; }
  return e;
}
function cacheSetReviews(key: string, v: { reviewTexts: string; placeMeta: string; source: "google" | "exa" | ""; googleReviews: any[] }) {
  if (REVIEW_CACHE.size > 500) { const oldest = REVIEW_CACHE.keys().next().value; if (oldest) REVIEW_CACHE.delete(oldest); }
  REVIEW_CACHE.set(key, { ...v, expires: Date.now() + REVIEW_CACHE_TTL });
}

api.post("/api/scrape-reviews", async (req: Request, res: Response) => {
  const { leadName, leadUrl, city, sellerProducts, sellerSummary } = req.body;
  if (!leadName) {
    return res.status(400).json({ error: "leadName is required" });
  }

  try {
    let reviewTexts = "";
    let reviewSource: "google" | "exa" | "" = "";
    let placeMeta = "";
    let googleReviews: any[] = []; // structured reviews for the UI (real Google data)

    // Serve cached reviews for this company if we've fetched them recently.
    const cacheKey = `${reviewKey(leadName)}|${reviewKey(city || "")}`;
    const cachedReviews = cacheGetReviews(cacheKey);
    if (cachedReviews) {
      reviewTexts = cachedReviews.reviewTexts;
      placeMeta = cachedReviews.placeMeta;
      reviewSource = cachedReviews.source;
      googleReviews = cachedReviews.googleReviews || [];
    } else {
    // Step 1: Real Google reviews via the Places API (New). Gated on a key — when
    // GOOGLE_PLACES_API_KEY is set, this fetches genuine star ratings + review text
    // (Text Search -> Place Details); otherwise we skip to the Exa fallback below.
    const googleKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    if (googleKey) {
      try {
        const sr = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": googleKey,
            "X-Goog-FieldMask": "places.id,places.displayName,places.rating,places.userRatingCount",
          },
          body: JSON.stringify({ textQuery: `${leadName}${city ? ` ${city}` : ""}` }),
        });
        const search: any = await sr.json();
        const place = (search.places || [])[0];
        // Guard: only trust the match if Google's business name shares a distinctive
        // word with the prospect — avoids pulling a same-city, different-business listing.
        const placeName = reviewKey(place?.displayName?.text || "");
        const prospectName = reviewKey(leadName);
        const pTokens = String(leadName || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
        const nameOk = !!placeName && (pTokens.some((t) => placeName.includes(t)) || prospectName.includes(placeName) || placeName.includes(prospectName));
        if (place?.id && nameOk) {
          const dr = await fetch(`https://places.googleapis.com/v1/places/${place.id}`, {
            headers: {
              "X-Goog-Api-Key": googleKey,
              "X-Goog-FieldMask": "displayName,rating,userRatingCount,reviews,googleMapsUri",
            },
          });
          const details: any = await dr.json();
          const reviews: any[] = details.reviews || [];
          if (reviews.length > 0) {
            placeMeta = `Google rating: ${details.rating ?? "?"}/5 from ${details.userRatingCount ?? reviews.length} review(s).`;
            reviewTexts = reviews
              .map((rv) => `Author: ${rv.authorAttribution?.displayName || "Anonymous"}\nRating: ${rv.rating}/5\nReview: ${rv.text?.text || rv.originalText?.text || ""}`)
              .join("\n\n---\n\n");
            // Structured reviews for the UI to display directly (the real Google data,
            // not the LLM's reinterpretation).
            const mapsUri = details.googleMapsUri || "";
            googleReviews = reviews.map((rv) => {
              const rating = rv.rating || 0;
              return {
                author: rv.authorAttribution?.displayName || "Anonymous",
                text: rv.text?.text || rv.originalText?.text || "",
                rating,
                source: mapsUri,
                sentiment: rating >= 4 ? "positive" : rating === 3 ? "neutral" : "negative",
              };
            });
            reviewSource = "google";
          }
        }
      } catch (e: any) {
        console.warn("[scrape-reviews] Google Places lookup failed; falling back to Exa:", e?.message);
      }
    }

    // Step 1b: Fallback to Exa web-search when the company isn't on Google / has no reviews.
    if (!reviewTexts.trim() && process.env.EXA_API_KEY) {
      const exaKey = process.env.EXA_API_KEY;
      const reviewQueries = [
        `${leadName} Google reviews`,
        `${leadName} customer reviews complaints`,
        `${leadName} review rating feedback`,
      ];
      const fetchExa = async (q: string) => {
        const body: any = {
          query: q, type: "auto", numResults: 5,
          contents: { text: { maxCharacters: 3000 }, highlights: true, summary: true },
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
      const allResults = await Promise.all(reviewQueries.map(fetchExa));
      const seen = new Set<string>();
      const unique: any[] = [];
      for (const r of allResults.flat()) {
        const url = (r.url || "").toLowerCase().replace(/\/$/, "");
        if (!seen.has(url)) { seen.add(url); unique.push(r); }
      }
      reviewTexts = unique.slice(0, 8).map((r: any) => {
        const text = r.text || r.summary || "";
        const highlights = (r.highlights || []).join(" ");
        return `Source: ${r.url}\nTitle: ${r.title || ""}\nContent: ${text}\nHighlights: ${highlights}`;
      }).join("\n\n---\n\n");
      if (reviewTexts.trim()) reviewSource = "exa";
    }
      // Cache the gathered reviews so a repeat view of this company skips the call.
      if (reviewTexts.trim()) cacheSetReviews(cacheKey, { reviewTexts, placeMeta, source: reviewSource, googleReviews });
    }

    if (!reviewTexts.trim()) {
      return res.json({
        reviews: [],
        painPoints: [],
        solutionMapping: [],
        relevanceKeywords: [],
        summary: "No genuine customer reviews found for this company.",
      });
    }

    // Step 2: Extract pain points with the LLM. Source-aware: Google reviews are
    // genuine customer feedback (trust them); Exa web results need cautious grounding.
    const analysisPrompt = reviewSource === "google"
      ? `You work in sales for OUR company. We sell:
${(sellerProducts || []).join(", ")}
Our company summary: ${sellerSummary || ""}

You are analyzing GENUINE Google reviews for a PROSPECT we want to sell to — "${leadName}"${city ? ` in ${city}` : ""}. ${placeMeta}

Reviews:
${reviewTexts}

Your ONLY job is to find where OUR products are relevant to this prospect. Filter EVERYTHING through the lens of what we sell.

STRICT RULES:
1. RELEVANCE FIRST. Only consider review content related to OUR offering. IGNORE anything we can't act on with our products (e.g. if we sell pool/water treatment: ignore complaints about navigation, parking, wifi, pricing, booking, or food taste). Unrelated complaints are NOT pain points — leave them out entirely.
2. A "pain point" must be BOTH (a) a genuine customer complaint AND (b) something our products could plausibly address. If it fails either test, do not include it.
3. Never invent or infer problems, and never turn a positive quote into a pain point. If there are no RELEVANT complaints, return an EMPTY painPoints array — that is the correct, expected answer.
4. solutionMapping connects our products to this prospect — POPULATE IT. The "painPoint" field here holds the guest's NEED, priority, or valued strength our product connects to (it does NOT have to be a complaint). You MUST include 2-4 entries whenever the prospect's guests care about anything our products relate to (water quality, pools, hygiene/cleanliness, recovery, wellness, comfort). Example: guests love the pool and recovery programming -> { "painPoint": "Pool & recovery are central to the guest experience", "ourSolution": "Low-chlorine + ozone AOP clean water, plus cold plunge / sauna", "talkingPoint": "..." }. Returning an EMPTY solutionMapping when such a fit clearly exists is WRONG. Leave it empty ONLY if our products have genuinely nothing to do with this prospect. Every entry must be a credible, DIRECT fit — never a stretch, never an unrelated issue (e.g. never map navigation/parking/wifi to a pool product).
5. For "reviews", include the real reviews with their actual rating and sentiment; set "source" to "Google".
6. For "summary": keep it SHORT — ONE sentence, two at most, no long paragraphs. If there are no product-relevant complaints, say that plainly FIRST (e.g. "No product-relevant complaints found.") then one short opportunity note.
7. For "relevanceKeywords": list 4-8 specific keywords/topics from OUR products & value prop that you used to judge what counts as relevant in these reviews (e.g. "pool", "water quality", "chlorine", "recovery", "sauna", "hygiene"). This is the lens we filtered the reviews through.

Return ONLY valid JSON with this structure:
{
  "reviews": [{ "text": "the review text", "rating": 1-5, "source": "Google", "sentiment": "negative"|"neutral"|"positive" }],
  "painPoints": [{ "issue": "short description", "frequency": "common"|"occasional"|"rare", "severity": "high"|"medium"|"low", "evidence": "quote from a review" }],
  "solutionMapping": [{ "painPoint": "the prospect's need or valued strength", "ourSolution": "how our product fits", "talkingPoint": "a specific talking point" }],
  "relevanceKeywords": ["pool", "water quality", "recovery"],
  "summary": "ONE short sentence (two max)"
}`
      : `You are analyzing customer reviews and feedback about "${leadName}" (${leadUrl || ""}).

Here is the content found online (may or may not contain real customer reviews):
${reviewTexts}

Our company offers these products/services:
${(sellerProducts || []).join(", ")}

Our company summary: ${sellerSummary || ""}

CRITICAL GROUNDING RULES:
- The content above is web search results — it often is NOT real customer reviews (directory listings, the company's own marketing pages, unrelated content).
- Only extract a review or pain point if the content contains ACTUAL customer feedback about ${leadName}. Each "evidence" MUST be a real quote/paraphrase taken from the content above.
- Do NOT invent reviews, ratings, complaints, or pain points. Do NOT infer problems that aren't stated by a customer.
- If the content does not contain genuine customer reviews of ${leadName}, return EMPTY arrays for reviews, painPoints, and solutionMapping, and set summary to "No genuine customer reviews found for this company."

Return ONLY valid JSON with this structure:
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
  "relevanceKeywords": ["product-relevant topics from our offering used to judge relevance"],
  "summary": "ONE short sentence (two max). If no genuine reviews, say so plainly."
}

Prioritize NEGATIVE reviews and complaints when genuine customer feedback exists. Extract up to 6 pain points — but ONLY those backed by real customer feedback in the content. It is correct and expected to return fewer (or zero) when the content has no genuine reviews. Never pad the list with invented or inferred problems. For "relevanceKeywords", list the keywords/topics from OUR products you used to judge relevance.`;

    const taskId = await startManusTask(analysisPrompt, {
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
        relevanceKeywords: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
      },
      required: ["reviews", "painPoints", "solutionMapping", "relevanceKeywords", "summary"],
      additionalProperties: false,
    });
    // Return the real Google reviews alongside the task so the UI can show them
    // immediately, independent of the LLM analysis.
    return res.json({ taskId, googleReviews });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default api;
