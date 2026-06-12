export type ReviewOpportunityRequest = {
  country: string;
  businessTypes: string[];
  memories?: string[];
};

export type ReviewOpportunityResult = {
  businessName: string;
  location: string;
  sourceUrl: string;
  rating: number | null;
  reviewCount: number | null;
  problemDetected: string;
  painPointCategory: string;
  matchedKeywords: string[];
  reviewEvidence: string[];
  moncolOpportunity: string;
  opportunityScore: number;
  memoriesUsed: string[];
};

export type ReviewOpportunityResponse = {
  sourceMode: "live" | "fallback";
  results: ReviewOpportunityResult[];
  liveFailureReason?: string;
};

type ManusCreateTaskResponse = {
  ok?: boolean;
  task_id?: string;
};

type ManusMessage = {
  type?: string;
  status_update?: {
    agent_status?: "running" | "stopped" | "waiting" | "error";
    brief?: string;
    description?: string;
  };
  error_message?: {
    error_type?: string;
    content?: string;
  };
  structured_output_result?: {
    success?: boolean;
    value?: unknown;
    error?: string | null;
  };
};

type ManusListMessagesResponse = {
  ok?: boolean;
  task_id?: string;
  messages?: ManusMessage[];
};

const DEFAULT_MANUS_API_BASE_URL = "https://api.manus.ai";
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 30;

export async function discoverReviewOpportunities(
  request: ReviewOpportunityRequest
): Promise<ReviewOpportunityResponse> {
  if (!process.env.MANUS_API_KEY) {
    return {
      sourceMode: "fallback",
      liveFailureReason: "missing MANUS_API_KEY",
      results: buildFallbackResults(request),
    };
  }

  try {
    const liveResults = await discoverLiveViaManusTaskApi(request);
    if (liveResults.length === 0) {
      return {
        sourceMode: "fallback",
        liveFailureReason: "live search returned no matching review complaints",
        results: buildFallbackResults(request),
      };
    }

    return {
      sourceMode: "live",
      results: liveResults,
    };
  } catch (error) {
    return {
      sourceMode: "fallback",
      liveFailureReason: getManusFailureReason(error),
      results: buildFallbackResults(request),
    };
  }
}

async function discoverLiveViaManusTaskApi(
  request: ReviewOpportunityRequest
): Promise<ReviewOpportunityResult[]> {
  const config = getManusConfig();
  const taskId = await createReviewOpportunityTask(config, request);
  const structuredResult = await pollStructuredOutputResult(config, taskId);

  if (!structuredResult?.success) {
    return [];
  }

  const value = structuredResult.value as { results?: unknown[] } | undefined;
  const results = Array.isArray(value?.results) ? value.results : [];
  return results.map(normalizeResult).filter((result) => result.reviewEvidence.length > 0);
}

async function createReviewOpportunityTask(
  config: ReturnType<typeof getManusConfig>,
  request: ReviewOpportunityRequest
) {
  const response = await fetch(`${config.baseUrl}/v2/task.create`, {
    method: "POST",
    headers: config.headers,
    body: JSON.stringify({
      message: {
        content: [
          {
            type: "text",
            text: buildTaskPrompt(request),
          },
        ],
      },
      structured_output_schema: getStructuredOutputSchema(),
    }),
  });

  if (!response.ok) {
    throw new Error(`manus request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as ManusCreateTaskResponse;
  if (!payload.task_id) {
    throw new Error("manus request failed with status 0");
  }

  return payload.task_id;
}

async function pollStructuredOutputResult(
  config: ReturnType<typeof getManusConfig>,
  taskId: string
) {
  let latestStatus: "running" | "stopped" | "waiting" | "error" | undefined;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const response = await fetch(
      `${config.baseUrl}/v2/task.listMessages?task_id=${encodeURIComponent(taskId)}&order=desc&limit=50`,
      {
        method: "GET",
        headers: {
          "x-manus-api-key": config.headers["x-manus-api-key"],
        },
      }
    );

    if (!response.ok) {
      throw new Error(`manus request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as ManusListMessagesResponse;
    const messages = Array.isArray(payload.messages) ? payload.messages : [];

    const structuredOutput = messages.find(
      (message) => message.type === "structured_output_result" && message.structured_output_result
    )?.structured_output_result;

    latestStatus = messages.find(
      (message) => message.type === "status_update" && message.status_update?.agent_status
    )?.status_update?.agent_status;

    if (latestStatus === "error") {
      const errorMessage = messages.find(
        (message) => message.type === "error_message" && message.error_message?.content
      )?.error_message?.content;
      throw new Error(errorMessage || "manus request failed with status 0");
    }

    if (latestStatus === "stopped") {
      return structuredOutput ?? { success: false, value: { results: [] }, error: "No structured output returned" };
    }

    if (attempt < MAX_POLL_ATTEMPTS - 1) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  throw new Error(
    latestStatus === "running" || latestStatus === "waiting"
      ? "manus task did not finish before timeout"
      : "manus request failed with status 0"
  );
}

function getStructuredOutputSchema() {
  return {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            businessName: { type: "string" },
            location: { type: "string" },
            sourceUrl: { type: "string" },
            rating: { type: ["number", "null"] },
            reviewCount: { type: ["number", "null"] },
            problemDetected: { type: "string" },
            painPointCategory: { type: "string" },
            matchedKeywords: {
              type: "array",
              items: { type: "string" },
            },
            reviewEvidence: {
              type: "array",
              items: { type: "string" },
            },
            moncolOpportunity: { type: "string" },
            opportunityScore: { type: "integer" },
            memoriesUsed: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: [
            "businessName",
            "location",
            "sourceUrl",
            "rating",
            "reviewCount",
            "problemDetected",
            "painPointCategory",
            "matchedKeywords",
            "reviewEvidence",
            "moncolOpportunity",
            "opportunityScore",
            "memoriesUsed",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  };
}

function buildTaskPrompt(request: ReviewOpportunityRequest) {
  const memories = request.memories ?? [];
  return `Find Moncol Pool review-based sales opportunities.

Search Google Maps in ${request.country}.
Target business types:
${request.businessTypes.map((type) => `- ${type}`).join("\n")}

Find businesses where public reviews mention operational complaints related to:
- water
- dirty
- filter
- pool
- hygiene
- maintenance

Return only businesses where the complaint creates a real Moncol opportunity.

Map complaint patterns into Moncol opportunity types such as:
- Water treatment optimization
- Filtration maintenance service
- Water chemistry optimization
- Hygiene and facility water quality improvement

Use current memories as ranking context:
${memories.length > 0 ? memories.map((memory, idx) => `${idx + 1}. ${memory}`).join("\n") : "None"}

Rules:
- Focus on Singapore spa, wellness, medical spa, recovery, athletic recovery club, and resort spa businesses.
- Include only relevant review snippets.
- Do not invent review evidence.
- If there are no valid matches, return an empty results array.
- Keep opportunityScore between 1 and 5.`;
}

function getManusConfig() {
  return {
    baseUrl: normalizeManusBaseUrl(process.env.MANUS_API_BASE_URL),
    headers: {
      "x-manus-api-key": process.env.MANUS_API_KEY || "",
      "Content-Type": "application/json",
    },
  };
}

function normalizeManusBaseUrl(baseUrl?: string) {
  if (!baseUrl) {
    return DEFAULT_MANUS_API_BASE_URL;
  }

  try {
    const url = new URL(baseUrl);
    if (url.hostname === "open.manus.ai") {
      return DEFAULT_MANUS_API_BASE_URL;
    }
  } catch {
    return DEFAULT_MANUS_API_BASE_URL;
  }

  return baseUrl.replace(/\/+$/, "");
}

function normalizeResult(result: unknown): ReviewOpportunityResult {
  const value = (result ?? {}) as Record<string, unknown>;
  return {
    businessName: String(value.businessName ?? ""),
    location: String(value.location ?? ""),
    sourceUrl: String(value.sourceUrl ?? ""),
    rating: typeof value.rating === "number" ? value.rating : null,
    reviewCount: typeof value.reviewCount === "number" ? value.reviewCount : null,
    problemDetected: String(value.problemDetected ?? ""),
    painPointCategory: String(value.painPointCategory ?? ""),
    matchedKeywords: Array.isArray(value.matchedKeywords)
      ? value.matchedKeywords.map((item) => String(item))
      : [],
    reviewEvidence: Array.isArray(value.reviewEvidence)
      ? value.reviewEvidence.map((item) => String(item))
      : [],
    moncolOpportunity: String(value.moncolOpportunity ?? ""),
    opportunityScore: clampScore(typeof value.opportunityScore === "number" ? value.opportunityScore : 1),
    memoriesUsed: Array.isArray(value.memoriesUsed)
      ? value.memoriesUsed.map((item) => String(item))
      : [],
  };
}

function clampScore(score: number) {
  return Math.max(1, Math.min(5, Math.round(score)));
}

function getManusFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const statusMatch = message.match(/status\s+(\d{3})/i);
  if (statusMatch?.[1]) {
    return `manus request failed with status ${statusMatch[1]}`;
  }
  if (message === "manus task did not finish before timeout") {
    return message;
  }
  return message || "manus request failed with status 0";
}

function buildFallbackResults(
  request: ReviewOpportunityRequest
): ReviewOpportunityResult[] {
  const memories = request.memories ?? [];

  const base = [
    {
      businessName: "Harbor Wellness Spa",
      location: "Singapore",
      sourceUrl: "https://www.google.com/maps/search/?api=1&query=Harbor+Wellness+Spa+Singapore",
      rating: null,
      reviewCount: null,
      reviewEvidence: [
        "Fallback demo data. Live Manus review discovery was unavailable, so this scenario models a complaint about dirty spa water and hygiene concerns.",
      ],
      matchedKeywords: ["water", "dirty", "spa", "hygiene"],
      problemDetected: "Dirty spa water complaint",
      painPointCategory: "Water Quality",
      moncolOpportunity: "Water treatment optimization",
    },
    {
      businessName: "Velocity Recovery Club",
      location: "Singapore",
      sourceUrl: "https://www.google.com/maps/search/?api=1&query=Velocity+Recovery+Club+Singapore",
      rating: null,
      reviewCount: null,
      reviewEvidence: [
        "Fallback demo data. This scenario models customer complaints that a recovery pool filter or circulation system was not working properly.",
      ],
      matchedKeywords: ["filter", "pool", "maintenance", "broken"],
      problemDetected: "Filter issue",
      painPointCategory: "Maintenance",
      moncolOpportunity: "Filtration maintenance service",
    },
    {
      businessName: "Luma Medical Spa",
      location: "Singapore",
      sourceUrl: "https://www.google.com/maps/search/?api=1&query=Luma+Medical+Spa+Singapore",
      rating: null,
      reviewCount: null,
      reviewEvidence: [
        "Fallback demo data. This scenario models reviews describing a strong chlorine smell and concern around water balance in wet treatment areas.",
      ],
      matchedKeywords: ["chlorine", "smell", "water quality", "spa"],
      problemDetected: "Chemical imbalance",
      painPointCategory: "Water Treatment",
      moncolOpportunity: "Water chemistry optimization",
    },
  ];

  return base.map((item) => {
    const memoriesUsed = selectRelevantMemories(memories, item.businessName, item.reviewEvidence.join(" "));
    return {
      ...item,
      memoriesUsed,
      opportunityScore: scoreOpportunity(item.businessName, item.reviewEvidence.join(" "), item.matchedKeywords, memoriesUsed),
    };
  });
}

function selectRelevantMemories(memories: string[], businessName: string, evidenceText: string) {
  const text = `${businessName} ${evidenceText}`.toLowerCase();
  return memories.filter((memory) => {
    const lower = memory.toLowerCase();
    if (lower.includes("avoid small")) return true;
    if (lower.includes("premium hospitality")) return true;
    if (lower.includes("wellness")) return text.includes("wellness") || text.includes("spa") || text.includes("recovery");
    return false;
  }).slice(0, 3);
}

function scoreOpportunity(
  businessName: string,
  evidenceText: string,
  matchedKeywords: string[],
  memoriesUsed: string[]
) {
  let score = 1;
  const text = `${businessName} ${evidenceText}`.toLowerCase();

  if (matchedKeywords.some((keyword) => ["water", "dirty", "filter"].includes(keyword))) score += 2;
  if (matchedKeywords.some((keyword) => ["pool", "spa", "sauna", "jacuzzi"].includes(keyword))) score += 1;
  if (matchedKeywords.some((keyword) => ["maintenance", "broken", "chlorine", "smell", "hygiene"].includes(keyword))) score += 1;
  if (text.includes("recovery") || text.includes("medical spa") || text.includes("wellness")) score += 1;

  for (const memory of memoriesUsed) {
    const lower = memory.toLowerCase();
    if (lower.includes("avoid small")) score -= 1;
    if (lower.includes("premium hospitality")) score += 1;
    if (lower.includes("wellness")) score += 1;
  }

  return clampScore(score);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
