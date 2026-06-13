export type ReviewOpportunityRequest = {
  country: string;
  businessTypes: string[];
  memories?: string[];
};

export type ReviewOpportunityResult = {
  businessName: string;
  location: string;
  sourceUrl: string;
  googleMapsUrl: string;
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

export type ReviewOpportunityTaskStartResponse = {
  taskId: string;
  status: "running";
  lastUpdatedAt: string;
};

export type ReviewOpportunityTaskStatusResponse = {
  taskId: string;
  status: "running" | "waiting" | "stopped" | "failed";
  lastUpdatedAt: string;
  sourceMode?: "live" | "fallback";
  results?: ReviewOpportunityResult[];
  liveFailureReason?: string;
};

type ManusCreateTaskResponse = {
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
  task_id?: string;
  messages?: ManusMessage[];
};

type StoredTask = {
  request: ReviewOpportunityRequest;
  lastUpdatedAt: string;
};

const DEFAULT_MANUS_API_BASE_URL = "https://api.manus.ai";
const reviewOpportunityTasks = new Map<string, StoredTask>();
const STRONG_SIGNAL_KEYWORDS = [
  "water",
  "pool",
  "bath",
  "onsen",
  "jacuzzi",
  "hot tub",
  "cold plunge",
  "filter",
  "chlorine",
  "dirty",
  "hygiene",
  "maintenance",
];
const MEDIUM_SIGNAL_KEYWORDS = [
  "cleanliness",
  "cleaning",
  "sanitary",
  "facility condition",
  "operational issue",
  "equipment issue",
  "water flow",
  "thermal controls",
  "leak",
  "dripping",
  "plumbing",
  "mold",
  "algae",
  "clean",
];
const NEAR_MISS_SIGNAL_KEYWORDS = [
  "recurring complaint",
  "maintenance concern",
  "cleanliness concern",
  "operational concern",
];
const REQUIRED_COMPLAINT_SIGNALS = [
  "dirty water",
  "poor water quality",
  "cloudy water",
  "bad smell from water",
  "chlorine issue",
  "filter issue",
  "maintenance complaint",
  "hygiene complaint",
  "jacuzzi issue",
  "hot tub issue",
  "pool cleanliness issue",
];

export async function createReviewOpportunityTask(
  request: ReviewOpportunityRequest
): Promise<ReviewOpportunityTaskStartResponse> {
  if (!process.env.MANUS_API_KEY) {
    throw new Error("missing MANUS_API_KEY");
  }

  const config = getManusConfig();
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

  const lastUpdatedAt = new Date().toISOString();
  reviewOpportunityTasks.set(payload.task_id, {
    request,
    lastUpdatedAt,
  });

  return {
    taskId: payload.task_id,
    status: "running",
    lastUpdatedAt,
  };
}

export async function getReviewOpportunityTaskStatus(
  taskId: string
): Promise<ReviewOpportunityTaskStatusResponse> {
  const storedTask = reviewOpportunityTasks.get(taskId);
  if (!storedTask) {
    throw new Error("taskId not found");
  }

  if (!process.env.MANUS_API_KEY) {
    return buildFailedFallbackStatus(taskId, storedTask, "missing MANUS_API_KEY");
  }

  const config = getManusConfig();

  try {
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
      return buildFailedFallbackStatus(
        taskId,
        storedTask,
        `manus request failed with status ${response.status}`
      );
    }

    const payload = (await response.json()) as ManusListMessagesResponse;
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const latestStatus = messages.find(
      (message) => message.type === "status_update" && message.status_update?.agent_status
    )?.status_update?.agent_status;

    const lastUpdatedAt = new Date().toISOString();
    reviewOpportunityTasks.set(taskId, {
      ...storedTask,
      lastUpdatedAt,
    });

    if (latestStatus === "running" || latestStatus === "waiting") {
      return {
        taskId,
        status: latestStatus,
        lastUpdatedAt,
      };
    }

    if (latestStatus === "error") {
      const errorMessage = messages.find(
        (message) => message.type === "error_message" && message.error_message?.content
      )?.error_message?.content;

      return buildFailedFallbackStatus(
        taskId,
        { ...storedTask, lastUpdatedAt },
        errorMessage || "manus request failed with status 0"
      );
    }

    if (latestStatus === "stopped") {
      const structuredOutput = messages.find(
        (message) => message.type === "structured_output_result" && message.structured_output_result
      )?.structured_output_result;

      if (!structuredOutput?.success) {
        return buildFailedFallbackStatus(
          taskId,
          { ...storedTask, lastUpdatedAt },
          structuredOutput?.error || "No structured output returned"
        );
      }

      const value = structuredOutput.value as { results?: unknown[] } | undefined;
      const results = Array.isArray(value?.results) ? value.results.map(normalizeResult) : [];
      const filteredResults = rankAndLimitGoogleMapsResults(results);

      return {
        taskId,
        status: "stopped",
        lastUpdatedAt,
        sourceMode: "live",
        results: filteredResults,
      };
    }

    return {
      taskId,
      status: "running",
      lastUpdatedAt,
    };
  } catch (error) {
    return buildFailedFallbackStatus(taskId, storedTask, getManusFailureReason(error));
  }
}

function buildFailedFallbackStatus(
  taskId: string,
  storedTask: StoredTask,
  reason: string
): ReviewOpportunityTaskStatusResponse {
  const lastUpdatedAt = new Date().toISOString();
  reviewOpportunityTasks.set(taskId, {
    ...storedTask,
    lastUpdatedAt,
  });

  return {
    taskId,
    status: "failed",
    lastUpdatedAt,
    sourceMode: "fallback",
    liveFailureReason: reason,
    results: [],
  };
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
            googleMapsUrl: { type: "string" },
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
            "googleMapsUrl",
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
  const expandedBusinessTypes = [
    "spa",
    "wellness center",
    "hotel spa",
    "sauna",
    "jacuzzi",
    "recovery center",
    "cold plunge",
    "swimming pool facility",
  ];
  const expandedKeywords = [
    ...STRONG_SIGNAL_KEYWORDS,
    ...MEDIUM_SIGNAL_KEYWORDS,
    ...NEAR_MISS_SIGNAL_KEYWORDS,
  ];
  const searchQueries = [
    "spa Singapore google reviews dirty water",
    "wellness spa Singapore reviews pool dirty",
    "hotel spa Singapore reviews jacuzzi dirty",
    "sauna Singapore reviews hygiene smell",
    "cold plunge Singapore reviews water cleanliness",
  ];

  return `Find Moncol Pool review-based sales opportunities.

Search Google Maps in ${request.country}.
Primary requested business types:
${request.businessTypes.map((type) => `- ${type}`).join("\n")}

Expanded business types to search:
${expandedBusinessTypes.map((type) => `- ${type}`).join("\n")}

Suggested live search queries:
${searchQueries.map((query) => `- ${query}`).join("\n")}

Find businesses where public reviews mention operational complaints related to:
${expandedKeywords.map((keyword) => `- ${keyword}`).join("\n")}

Return only businesses where the complaint creates a real Moncol opportunity.

Map complaint patterns into Moncol opportunity types such as:
- Water treatment optimization
- Filtration maintenance service
- Water chemistry optimization
- Hygiene and facility water quality improvement

Use current memories as ranking context:
${memories.length > 0 ? memories.map((memory, idx) => `${idx + 1}. ${memory}`).join("\n") : "None"}

Rules:
- Focus on Singapore spa, wellness, medical spa, recovery, athletic recovery club, and resort spa businesses, but do not return businesses unless they have actual complaint evidence.
- Use Google Maps review snippets only.
- sourceUrl must point to Google Maps only.
- googleMapsUrl must point to Google Maps only.
- Include only relevant Google Maps review snippets.
- Exclude TripAdvisor, Reddit, TikTok, forums, blog comments, and other review websites.
- Do not invent review evidence.
- A result is valid only if there is actual review complaint evidence from a Google Maps review snippet.
- reviewEvidence must not be empty.
- Exclude any business where the opportunity is inferred only from business type, pool/spa/onsen presence, or facility type.
- Required complaint categories include:
  - dirty water
  - poor water quality
  - cloudy water
  - bad smell from water
  - chlorine issues
  - filter issues
  - maintenance complaints
  - hygiene complaints
  - jacuzzi issues
  - hot tub issues
  - pool cleanliness issues
- Every valid result must include:
  - businessName
  - googleMapsUrl
  - actual Google Maps review snippet
  - detected complaint
  - why Moncol can help
- If no valid complaints are found, return an empty results array.
- Rank results by strongest buying signal priority in this order:
  1. dirty water
  2. pool cleanliness
  3. filter issues
  4. water quality complaints
  5. hygiene complaints
  6. maintenance complaints
- Return only the 3 strongest opportunities.
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
  const rawEvidence = Array.isArray(value.reviewEvidence)
    ? value.reviewEvidence.map((item) => String(item)).filter(Boolean)
    : [];
  const rawKeywords = Array.isArray(value.matchedKeywords)
    ? value.matchedKeywords.map((item) => String(item)).filter(Boolean)
    : [];
  const normalizedKeywords = normalizeMatchedKeywords(rawKeywords, rawEvidence.join(" "), String(value.problemDetected ?? ""));
  const normalizedEvidence = rawEvidence;

  return {
    businessName: String(value.businessName ?? ""),
    location: String(value.location ?? ""),
    sourceUrl: String(value.sourceUrl ?? ""),
    googleMapsUrl: String(value.googleMapsUrl ?? value.sourceUrl ?? ""),
    rating: typeof value.rating === "number" ? value.rating : null,
    reviewCount: typeof value.reviewCount === "number" ? value.reviewCount : null,
    problemDetected: String(value.problemDetected ?? ""),
    painPointCategory: String(value.painPointCategory ?? ""),
    matchedKeywords: normalizedKeywords,
    reviewEvidence: normalizedEvidence,
    moncolOpportunity: String(value.moncolOpportunity ?? ""),
    opportunityScore: clampScore(typeof value.opportunityScore === "number" ? value.opportunityScore : 1),
    memoriesUsed: Array.isArray(value.memoriesUsed)
      ? value.memoriesUsed.map((item) => String(item))
      : [],
  };
}

function normalizeMatchedKeywords(keywords: string[], evidenceText: string, problemDetected: string) {
  const text = `${keywords.join(" ")} ${evidenceText} ${problemDetected}`.toLowerCase();
  const supportedKeywords = [
    ...STRONG_SIGNAL_KEYWORDS,
    ...MEDIUM_SIGNAL_KEYWORDS,
    ...NEAR_MISS_SIGNAL_KEYWORDS,
  ];

  const detected = supportedKeywords.filter((keyword) => text.includes(keyword));
  return detected.length > 0 ? detected : keywords;
}

function rankAndLimitGoogleMapsResults(results: ReviewOpportunityResult[]) {
  return results
    .filter((result) => isGoogleMapsUrl(result.sourceUrl) && isGoogleMapsUrl(result.googleMapsUrl))
    .filter((result) => result.reviewEvidence.length > 0)
    .filter((result) => hasActualComplaintEvidence(result))
    .sort((a, b) => {
      const priorityDiff = getGoogleMapsOpportunityPriorityScore(b) - getGoogleMapsOpportunityPriorityScore(a);
      if (priorityDiff !== 0) return priorityDiff;
      return b.opportunityScore - a.opportunityScore;
    })
    .slice(0, 3);
}

function isGoogleMapsUrl(url: string) {
  const lower = url.toLowerCase();
  return lower.includes("google.com/maps") || lower.includes("maps.google.com");
}

function getGoogleMapsOpportunityPriorityScore(result: ReviewOpportunityResult) {
  const text = [
    result.problemDetected,
    result.painPointCategory,
    result.reviewEvidence.join(" "),
    result.matchedKeywords.join(" "),
  ].join(" ").toLowerCase();

  if (text.includes("dirty water")) return 60;
  if (text.includes("pool cleanliness") || (text.includes("pool") && (text.includes("dirty") || text.includes("cleanliness")))) return 50;
  if (text.includes("filter")) return 40;
  if (text.includes("water quality")) return 30;
  if (text.includes("hygiene") || text.includes("cleanliness") || text.includes("cleaning") || text.includes("sanitary")) return 20;
  if (text.includes("maintenance")) return 10;
  if (text.includes("jacuzzi")) return 8;
  if (text.includes("hot tub")) return 8;
  return 0;
}

function hasActualComplaintEvidence(result: ReviewOpportunityResult) {
  const text = [
    result.problemDetected,
    result.painPointCategory,
    result.reviewEvidence.join(" "),
    result.matchedKeywords.join(" "),
  ].join(" ").toLowerCase();
  if (text.includes("staff was friendly")) return false;
  if (text.includes("massage was excellent")) return false;
  if (text.includes("location was convenient")) return false;
  if (text.includes("multiple pools")) return false;
  return REQUIRED_COMPLAINT_SIGNALS.some((signal) => text.includes(signal)) ||
    (text.includes("water") && (text.includes("dirty") || text.includes("cloudy") || text.includes("quality"))) ||
    (text.includes("water") && text.includes("smell")) ||
    (text.includes("pool") && text.includes("cleanliness")) ||
    (text.includes("chlorine") && (text.includes("issue") || text.includes("problem") || text.includes("complaint"))) ||
    (text.includes("filter") && (text.includes("issue") || text.includes("problem") || text.includes("complaint"))) ||
    (text.includes("jacuzzi") && (text.includes("issue") || text.includes("dirty"))) ||
    (text.includes("hot tub") && (text.includes("issue") || text.includes("dirty") || text.includes("cleanliness"))) ||
    (text.includes("maintenance") && (text.includes("complaint") || text.includes("poor"))) ||
    (text.includes("hygiene") && (text.includes("complaint") || text.includes("poor")));
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
  return message || "manus request failed with status 0";
}
