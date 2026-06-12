import { beforeEach, describe, expect, it, vi } from "vitest";

const makeRequestMock = vi.fn();

vi.mock("./_core/map", () => ({
  makeRequest: makeRequestMock,
}));

describe("review opportunity discovery", () => {
  beforeEach(() => {
    makeRequestMock.mockReset();
  });

  it("returns live opportunities when matching review complaints are found", async () => {
    makeRequestMock
      .mockResolvedValueOnce({
        results: [
          {
            place_id: "spa-1",
            name: "Aqua Spa Singapore",
            formatted_address: "Singapore",
            rating: 4.1,
            user_ratings_total: 128,
            geometry: { location: { lat: 1.3, lng: 103.8 } },
            types: ["spa"],
          },
        ],
      })
      .mockResolvedValueOnce({
        result: {
          place_id: "spa-1",
          name: "Aqua Spa Singapore",
          formatted_address: "Singapore",
          rating: 4.1,
          user_ratings_total: 128,
          reviews: [
            {
              author_name: "Guest",
              rating: 2,
              text: "The pool water was dirty and the filter looked broken.",
              time: 1,
            },
          ],
          url: "https://maps.example/spa-1",
          geometry: { location: { lat: 1.3, lng: 103.8 } },
        },
      });

    const { discoverReviewOpportunities } = await import("./reviewOpportunities");
    const result = await discoverReviewOpportunities({
      country: "Singapore",
      businessTypes: ["spa"],
      memories: ["Prefer premium hospitality", "Wellness facilities are ideal"],
    });

    expect(result.sourceMode).toBe("live");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      businessName: "Aqua Spa Singapore",
      problemDetected: "Dirty water",
      painPointCategory: "Water Quality",
      moncolOpportunity: "Water treatment optimization",
      sourceUrl: "https://maps.example/spa-1",
    });
    expect(result.results[0]?.matchedKeywords).toEqual(
      expect.arrayContaining(["water", "dirty", "filter", "pool", "broken"])
    );
    expect(result.results[0]?.opportunityScore).toBeGreaterThanOrEqual(4);
    expect(result.results[0]?.memoriesUsed.length).toBeGreaterThan(0);
  });

  it("falls back clearly when live access fails", async () => {
    makeRequestMock.mockRejectedValue(new Error("maps unavailable"));

    const { discoverReviewOpportunities } = await import("./reviewOpportunities");
    const result = await discoverReviewOpportunities({
      country: "Singapore",
      businessTypes: ["spa", "wellness"],
      memories: ["Avoid small wellness centers"],
    });

    expect(result.sourceMode).toBe("fallback");
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]?.reviewEvidence[0]).toContain("Fallback demo data");
    expect(result.results[0]?.sourceUrl).toContain("google.com/maps/search");
  });
});
