import {
  makeRequest,
  type PlaceDetailsResult,
  type PlacesSearchResult,
} from "./_core/map";

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
};

const PRIMARY_KEYWORDS = ["water", "dirty", "filter"];
const SECONDARY_KEYWORDS = [
  "pool",
  "maintenance",
  "hygiene",
  "chlorine",
  "smell",
  "clean",
  "unclean",
  "jacuzzi",
  "spa",
  "sauna",
  "broken",
  "water quality",
];

const ALL_KEYWORDS = [...PRIMARY_KEYWORDS, ...SECONDARY_KEYWORDS];

type NormalizedPlace = {
  name: string;
  location: string;
  sourceUrl: string;
  rating: number | null;
  reviewCount: number | null;
  reviewTexts: string[];
};

export async function discoverReviewOpportunities(
  request: ReviewOpportunityRequest
): Promise<ReviewOpportunityResponse> {
  try {
    const liveResults = await discoverLiveOpportunities(request);
    if (liveResults.length > 0) {
      return {
        sourceMode: "live",
        results: liveResults,
      };
    }
  } catch {
    // Fall through to clearly labeled fallback mode.
  }

  return {
    sourceMode: "fallback",
    results: buildFallbackResults(request),
  };
}

async function discoverLiveOpportunities(
  request: ReviewOpportunityRequest
): Promise<ReviewOpportunityResult[]> {
  const places = await fetchCandidatePlaces(request);
  const opportunities = places
    .map((place) => buildOpportunityFromPlace(place, request.memories ?? []))
    .filter((opportunity): opportunity is ReviewOpportunityResult => opportunity !== null)
    .sort((a, b) => b.opportunityScore - a.opportunityScore);

  return opportunities.slice(0, 8);
}

async function fetchCandidatePlaces(
  request: ReviewOpportunityRequest
): Promise<NormalizedPlace[]> {
  const collected: NormalizedPlace[] = [];

  for (const businessType of request.businessTypes) {
    const search = (await makeRequest("/maps/api/place/textsearch/json", {
      query: `${businessType} in ${request.country}`,
      type: "spa",
    })) as PlacesSearchResult;

    const places = search.results.slice(0, 6);
    for (const place of places) {
      const details = (await makeRequest("/maps/api/place/details/json", {
        place_id: place.place_id,
        fields: "name,formatted_address,rating,user_ratings_total,reviews,url",
      })) as PlaceDetailsResult & {
        result?: PlaceDetailsResult["result"] & { url?: string };
      };

      const result = details.result;
      if (!result) continue;

      collected.push({
        name: result.name,
        location: result.formatted_address,
        sourceUrl:
          result.url ??
          `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(result.place_id)}`,
        rating: result.rating ?? null,
        reviewCount: result.user_ratings_total ?? null,
        reviewTexts: (result.reviews ?? []).map((review) => review.text).filter(Boolean),
      });
    }
  }

  return dedupePlaces(collected);
}

function dedupePlaces(places: NormalizedPlace[]) {
  const byName = new Map<string, NormalizedPlace>();

  for (const place of places) {
    const key = `${place.name}::${place.location}`.toLowerCase();
    if (!byName.has(key)) {
      byName.set(key, place);
    }
  }

  return Array.from(byName.values());
}

function buildOpportunityFromPlace(
  place: NormalizedPlace,
  memories: string[]
): ReviewOpportunityResult | null {
  const matches = place.reviewTexts
    .map((text) => ({
      text,
      keywords: matchKeywords(text),
    }))
    .filter((item) => item.keywords.length > 0);

  if (matches.length === 0) return null;

  const matchedKeywords = Array.from(new Set(matches.flatMap((item) => item.keywords)));
  const reviewEvidence = matches.slice(0, 3).map((item) => item.text);
  const primaryIssue = detectProblem(reviewEvidence.join(" "));
  const memoriesUsed = selectRelevantMemories(memories, place);

  return {
    businessName: place.name,
    location: place.location,
    sourceUrl: place.sourceUrl,
    rating: place.rating,
    reviewCount: place.reviewCount,
    problemDetected: primaryIssue.problemDetected,
    painPointCategory: primaryIssue.painPointCategory,
    matchedKeywords,
    reviewEvidence,
    moncolOpportunity: primaryIssue.moncolOpportunity,
    opportunityScore: scoreOpportunity(place, matchedKeywords, memoriesUsed),
    memoriesUsed,
  };
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
        "Fallback demo data. Live Google review access was unavailable, so this scenario models a complaint about dirty spa water and guest hygiene concerns.",
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

  return base.map((item) => ({
    ...item,
    memoriesUsed: selectRelevantMemories(memories, {
      name: item.businessName,
      location: item.location,
      sourceUrl: item.sourceUrl,
      rating: item.rating,
      reviewCount: item.reviewCount,
      reviewTexts: item.reviewEvidence,
    }),
    opportunityScore: scoreOpportunity(
      {
        name: item.businessName,
        location: item.location,
        sourceUrl: item.sourceUrl,
        rating: item.rating,
        reviewCount: item.reviewCount,
        reviewTexts: item.reviewEvidence,
      },
      item.matchedKeywords,
      selectRelevantMemories(memories, {
        name: item.businessName,
        location: item.location,
        sourceUrl: item.sourceUrl,
        rating: item.rating,
        reviewCount: item.reviewCount,
        reviewTexts: item.reviewEvidence,
      })
    ),
  }));
}

function matchKeywords(text: string) {
  const lower = text.toLowerCase();
  return ALL_KEYWORDS.filter((keyword) => lower.includes(keyword));
}

function detectProblem(text: string) {
  const lower = text.toLowerCase();

  if (lower.includes("dirty") && lower.includes("water")) {
    return {
      problemDetected: "Dirty water",
      painPointCategory: "Water Quality",
      moncolOpportunity: "Water treatment optimization",
    };
  }

  if (lower.includes("filter") || lower.includes("broken")) {
    return {
      problemDetected: "Filter issue",
      painPointCategory: "Maintenance",
      moncolOpportunity: "Filtration maintenance service",
    };
  }

  if (lower.includes("chlorine") || lower.includes("smell")) {
    return {
      problemDetected: "Chemical imbalance",
      painPointCategory: "Water Treatment",
      moncolOpportunity: "Water chemistry optimization",
    };
  }

  return {
    problemDetected: "Operational cleanliness concern",
    painPointCategory: "Hygiene",
    moncolOpportunity: "Facility water quality and hygiene improvement",
  };
}

function selectRelevantMemories(memories: string[], place: NormalizedPlace) {
  const placeText = `${place.name} ${place.location} ${place.reviewTexts.join(" ")}`.toLowerCase();

  return memories.filter((memory) => {
    const lower = memory.toLowerCase();
    if (lower.includes("premium hospitality") && (placeText.includes("spa") || placeText.includes("resort"))) {
      return true;
    }
    if (lower.includes("avoid small")) {
      return true;
    }
    if (lower.includes("wellness")) {
      return placeText.includes("wellness") || placeText.includes("recovery") || placeText.includes("spa");
    }
    return lower.includes("premium") || lower.includes("hospitality") || lower.includes("recovery");
  }).slice(0, 3);
}

function scoreOpportunity(
  place: NormalizedPlace,
  matchedKeywords: string[],
  memoriesUsed: string[]
) {
  let score = 1;
  const text = `${place.name} ${place.location} ${place.reviewTexts.join(" ")}`.toLowerCase();

  if (matchedKeywords.some((keyword) => PRIMARY_KEYWORDS.includes(keyword))) score += 2;
  if (matchedKeywords.some((keyword) => ["pool", "spa", "jacuzzi", "sauna"].includes(keyword))) score += 1;
  if (matchedKeywords.some((keyword) => ["dirty", "unclean", "smell", "chlorine", "maintenance", "broken"].includes(keyword))) score += 1;
  if (text.includes("resort") || text.includes("medical spa") || text.includes("recovery")) score += 1;

  for (const memory of memoriesUsed) {
    const lower = memory.toLowerCase();
    if (lower.includes("avoid small")) score -= 1;
    if (lower.includes("prefer premium hospitality")) score += 1;
    if (lower.includes("wellness")) score += 1;
  }

  return Math.max(1, Math.min(5, score));
}
