import { Router, Request, Response, NextFunction } from "express";
import { ENV } from "./_core/env";
import { manusTask, startManusTask, checkManusTask } from "./_core/manus";
import {
  isSupabaseConfigured,
  verifyRequestUser,
  type SupabaseUser,
} from "./_core/supabaseAuth";

const api = Router();

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
  "expansionCategories": [
    { "name": "Clean 2-5 word market label, no '&'", "whyRelevant": "20-36 words: why this adjacent segment fits and its specific pain.", "salesAngle": "One-sentence pitch angle", "painPoints": ["Pain 1", "Pain 2"], "searchQueries": ["account-search query for this segment and the company's city"] }
  ]
}

REQUIREMENTS:
- valuePropositions: EXACTLY 3 (the strongest, source-supported).
- customerSegments: 3-5. clientNames empty if none shown — never invent.
- expansionCategories: EXACTLY 3 clean adjacent markets, findable via account search.
- currentSegments = the customerSegments labels (kept for backward compatibility).`;

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
      required: ["companyName", "website", "summary", "valueProposition", "valuePropositions", "currentSegments", "customerSegments", "products", "proofPoints", "expansionCategories"],
      additionalProperties: false,
    });

    return res.json({ taskId });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "Analysis failed" });
  }
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
    const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
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
        // Real cached page text only — EXCLUDES Exa's query-conditioned summary,
        // which echoes the searched city into every result and breaks location checks.
        _pageText: [r.text || "", ...(r.highlights || [])].join(" "),
        _url: (r.url || "").toLowerCase(),
        _host: hostOf(r.url || ""),
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

    let results = allResults;
    let drops = 0;
    if (city) {
      console.log(`[exa-search] city="${city}" country="${meta.country}" raw merged=${allResults.length}`);
      results = allResults.filter((r: any) => {
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
        if (!inTitleOrHost) {
          // Scan the REAL page text (not the query-poisoned summary). Require the city
          // term itself next to an address marker — a mere country mention is too weak.
          const pageText = (r._pageText || "").toLowerCase();
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

        if (!inTitleOrHost && !inAddressLine) {
          console.log(`[exa-search] DROP "${r.title}" (${host}) reason: city not in title/host/address line`);
          drops++; return false;
        }
        return true;
      });
      console.log(`[exa-search] post-filter kept=${results.length} dropped=${drops}`);
    }

    // Remove internal fields before returning
    results = results.slice(0, numResults).map(({ _fullText, _pageText, _url, _host, ...rest }: any) => rest);

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

  const { leadName, city, leadUrl } = req.body;
  if (!leadName) {
    return res.status(400).json({ error: "leadName is required" });
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
    return res.json(status);
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
