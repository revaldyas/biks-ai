import { beforeEach, describe, expect, it, vi } from "vitest";

function createJsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("review opportunity discovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env.MANUS_API_KEY;
    delete process.env.MANUS_API_BASE_URL;
  });

  it("creates a Manus review opportunity task", async () => {
    process.env.MANUS_API_KEY = "manus-key";

    const fetchMock = vi.fn().mockResolvedValueOnce(
      createJsonResponse({
        task_id: "task_123",
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    const { createReviewOpportunityTask } = await import("./reviewOpportunities");
    const result = await createReviewOpportunityTask({
      country: "Singapore",
      businessTypes: ["spa", "wellness"],
      memories: ["Prefer premium hospitality"],
    });

    expect(result.taskId).toBe("task_123");
    expect(result.status).toBe("running");
    expect(typeof result.lastUpdatedAt).toBe("string");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.manus.ai/v2/task.create",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-manus-api-key": "manus-key",
        }),
      })
    );

    const createTaskBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(createTaskBody.structured_output_schema).toBeTruthy();
    expect(createTaskBody.message.content[0].text).toContain("Search Google Maps in Singapore.");
  });

  it("returns running task status while Manus research is in progress", async () => {
    process.env.MANUS_API_KEY = "manus-key";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ task_id: "task_running" }))
      .mockResolvedValueOnce(
        createJsonResponse({
          task_id: "task_running",
          messages: [
            {
              type: "status_update",
              status_update: {
                agent_status: "running",
              },
            },
          ],
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const { createReviewOpportunityTask, getReviewOpportunityTaskStatus } = await import("./reviewOpportunities");
    await createReviewOpportunityTask({
      country: "Singapore",
      businessTypes: ["spa"],
      memories: [],
    });

    const result = await getReviewOpportunityTaskStatus("task_running");
    expect(result).toMatchObject({
      taskId: "task_running",
      status: "running",
    });
  });

  it("returns live results when Manus task stops with structured output", async () => {
    process.env.MANUS_API_KEY = "manus-key";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ task_id: "task_live" }))
      .mockResolvedValueOnce(
        createJsonResponse({
          task_id: "task_live",
          messages: [
            {
              type: "structured_output_result",
              structured_output_result: {
                success: true,
                value: {
                  results: [
                    {
                      businessName: "Aqua Wellness Club",
                      location: "Singapore",
                      sourceUrl: "https://maps.google.com/?q=Aqua+Wellness+Club+Singapore",
                      googleMapsUrl: "https://maps.google.com/?q=Aqua+Wellness+Club+Singapore",
                      rating: 4.1,
                      reviewCount: 128,
                      problemDetected: "Dirty pool water",
                      painPointCategory: "Water Quality",
                      matchedKeywords: ["water", "dirty", "pool"],
                      reviewEvidence: ["Guests mentioned the pool water looked dirty."],
                      moncolOpportunity: "Water treatment optimization",
                      opportunityScore: 5,
                      memoriesUsed: ["Prefer premium hospitality"],
                    },
                  ],
                },
              },
            },
            {
              type: "status_update",
              status_update: {
                agent_status: "stopped",
              },
            },
          ],
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const { createReviewOpportunityTask, getReviewOpportunityTaskStatus } = await import("./reviewOpportunities");
    await createReviewOpportunityTask({
      country: "Singapore",
      businessTypes: ["spa", "wellness"],
      memories: ["Prefer premium hospitality"],
    });

    const result = await getReviewOpportunityTaskStatus("task_live");
    expect(result.status).toBe("stopped");
    expect(result.sourceMode).toBe("live");
    expect(result.results).toHaveLength(1);
    expect(result.results?.[0]).toMatchObject({
      businessName: "Aqua Wellness Club",
      painPointCategory: "Water Quality",
      opportunityScore: 5,
    });
  });

  it("returns live empty results when Manus stops without valid complaint snippets", async () => {
    process.env.MANUS_API_KEY = "manus-key";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ task_id: "task_near_miss" }))
      .mockResolvedValueOnce(
        createJsonResponse({
          task_id: "task_near_miss",
          messages: [
            {
              type: "structured_output_result",
              structured_output_result: {
                success: true,
                value: {
                  results: [
                    {
                      businessName: "Harbor Heat Club",
                      location: "Singapore",
                      sourceUrl: "https://maps.google.com/?q=Harbor+Heat+Club+Singapore",
                      googleMapsUrl: "https://maps.google.com/?q=Harbor+Heat+Club+Singapore",
                      rating: 4.0,
                      reviewCount: 48,
                      problemDetected: "Jet bath seating was previously too high",
                      painPointCategory: "Operational issue",
                      matchedKeywords: [],
                      reviewEvidence: ["Google Maps reviewers said the jet bath seating was previously too high and the massage itself was pleasant."],
                      moncolOpportunity: "Operational improvement for bath and hot tub facilities",
                      opportunityScore: 4,
                      memoriesUsed: ["Prefer premium hospitality"],
                    },
                  ],
                },
              },
            },
            {
              type: "status_update",
              status_update: {
                agent_status: "stopped",
              },
            },
          ],
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const { createReviewOpportunityTask, getReviewOpportunityTaskStatus } = await import("./reviewOpportunities");
    await createReviewOpportunityTask({
      country: "Singapore",
      businessTypes: ["spa", "wellness"],
      memories: ["Prefer premium hospitality"],
    });

    const result = await getReviewOpportunityTaskStatus("task_near_miss");
    expect(result.status).toBe("stopped");
    expect(result.sourceMode).toBe("live");
    expect(result.results).toEqual([]);
  });

  it("returns only the top 3 Google Maps opportunities and excludes non-Google sources", async () => {
    process.env.MANUS_API_KEY = "manus-key";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ task_id: "task_top3" }))
      .mockResolvedValueOnce(
        createJsonResponse({
          task_id: "task_top3",
          messages: [
            {
              type: "structured_output_result",
              structured_output_result: {
                success: true,
                value: {
                  results: [
                    {
                      businessName: "A",
                      location: "Singapore",
                      sourceUrl: "https://www.google.com/maps/place/A",
                      googleMapsUrl: "https://www.google.com/maps/place/A",
                      rating: 4.0,
                      reviewCount: 10,
                      problemDetected: "Dirty water issue",
                      painPointCategory: "Water Quality",
                      matchedKeywords: ["dirty", "water"],
                      reviewEvidence: ["Google Maps review snippet about dirty water."],
                      moncolOpportunity: "Water treatment optimization",
                      opportunityScore: 5,
                      memoriesUsed: [],
                    },
                    {
                      businessName: "B",
                      location: "Singapore",
                      sourceUrl: "https://www.google.com/maps/place/B",
                      googleMapsUrl: "https://www.google.com/maps/place/B",
                      rating: 4.0,
                      reviewCount: 10,
                      problemDetected: "Pool cleanliness concern",
                      painPointCategory: "Pool Cleanliness",
                      matchedKeywords: ["pool"],
                      reviewEvidence: ["Google Maps review snippet about a dirty pool."],
                      moncolOpportunity: "Hygiene improvement",
                      opportunityScore: 4,
                      memoriesUsed: [],
                    },
                    {
                      businessName: "C",
                      location: "Singapore",
                      sourceUrl: "https://www.google.com/maps/place/C",
                      googleMapsUrl: "https://www.google.com/maps/place/C",
                      rating: 4.0,
                      reviewCount: 10,
                      problemDetected: "Filter issue",
                      painPointCategory: "Maintenance",
                      matchedKeywords: ["filter"],
                      reviewEvidence: ["Google Maps review snippet about the filter not working."],
                      moncolOpportunity: "Filtration maintenance service",
                      opportunityScore: 4,
                      memoriesUsed: [],
                    },
                    {
                      businessName: "D",
                      location: "Singapore",
                      sourceUrl: "https://www.google.com/maps/place/D",
                      googleMapsUrl: "https://www.google.com/maps/place/D",
                      rating: 4.0,
                      reviewCount: 10,
                      problemDetected: "Maintenance concern",
                      painPointCategory: "Maintenance",
                      matchedKeywords: ["maintenance"],
                      reviewEvidence: ["Google Maps review snippet about poor maintenance."],
                      moncolOpportunity: "Maintenance service",
                      opportunityScore: 3,
                      memoriesUsed: [],
                    },
                    {
                      businessName: "E",
                      location: "Singapore",
                      sourceUrl: "https://www.tripadvisor.com/Hotel_Review-E",
                      googleMapsUrl: "https://www.tripadvisor.com/Hotel_Review-E",
                      rating: 4.0,
                      reviewCount: 10,
                      problemDetected: "Dirty water issue",
                      painPointCategory: "Water Quality",
                      matchedKeywords: ["dirty", "water"],
                      reviewEvidence: ["TripAdvisor snippet."],
                      moncolOpportunity: "Water treatment optimization",
                      opportunityScore: 5,
                      memoriesUsed: [],
                    },
                  ],
                },
              },
            },
            {
              type: "status_update",
              status_update: {
                agent_status: "stopped",
              },
            },
          ],
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const { createReviewOpportunityTask, getReviewOpportunityTaskStatus } = await import("./reviewOpportunities");
    await createReviewOpportunityTask({
      country: "Singapore",
      businessTypes: ["spa", "wellness"],
      memories: [],
    });

    const result = await getReviewOpportunityTaskStatus("task_top3");
    expect(result.status).toBe("stopped");
    expect(result.results).toHaveLength(3);
    expect(result.results?.map((item) => item.businessName)).toEqual(["A", "B", "C"]);
    expect(result.results?.every((item) => item.sourceUrl.includes("google.com/maps") || item.sourceUrl.includes("maps.google.com"))).toBe(true);
  });

  it("excludes snippets that do not directly mention allowed water or hygiene terms", async () => {
    process.env.MANUS_API_KEY = "manus-key";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ task_id: "task_direct_terms" }))
      .mockResolvedValueOnce(
        createJsonResponse({
          task_id: "task_direct_terms",
          messages: [
            {
              type: "structured_output_result",
              structured_output_result: {
                success: true,
                value: {
                  results: [
                    {
                      businessName: "Valid Water Club",
                      location: "Singapore",
                      sourceUrl: "https://www.google.com/maps/place/Valid",
                      googleMapsUrl: "https://www.google.com/maps/place/Valid",
                      rating: 4.0,
                      reviewCount: 10,
                      problemDetected: "Dirty water issue",
                      painPointCategory: "Water Quality",
                      matchedKeywords: ["water", "dirty"],
                      reviewEvidence: ["Google Maps review snippet said the water was dirty."],
                      moncolOpportunity: "Water treatment optimization",
                      opportunityScore: 5,
                      memoriesUsed: [],
                    },
                    {
                      businessName: "Invalid Smell Hotel",
                      location: "Singapore",
                      sourceUrl: "https://www.google.com/maps/place/Invalid",
                      googleMapsUrl: "https://www.google.com/maps/place/Invalid",
                      rating: 4.0,
                      reviewCount: 10,
                      problemDetected: "Bad room smell",
                      painPointCategory: "Room Condition",
                      matchedKeywords: ["smell"],
                      reviewEvidence: ["Google Maps review snippet said the room smelled bad."],
                      moncolOpportunity: "Unknown",
                      opportunityScore: 3,
                      memoriesUsed: [],
                    },
                  ],
                },
              },
            },
            {
              type: "status_update",
              status_update: {
                agent_status: "stopped",
              },
            },
          ],
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const { createReviewOpportunityTask, getReviewOpportunityTaskStatus } = await import("./reviewOpportunities");
    await createReviewOpportunityTask({
      country: "Singapore",
      businessTypes: ["spa"],
      memories: [],
    });

    const result = await getReviewOpportunityTaskStatus("task_direct_terms");
    expect(result.status).toBe("stopped");
    expect(result.results).toHaveLength(1);
    expect(result.results?.[0].businessName).toBe("Valid Water Club");
  });

  it("returns live empty results for operational issues that do not match required Moncol complaint categories", async () => {
    process.env.MANUS_API_KEY = "manus-key";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ task_id: "task_semantic" }))
      .mockResolvedValueOnce(
        createJsonResponse({
          task_id: "task_semantic",
          messages: [
            {
              type: "structured_output_result",
              structured_output_result: {
                success: true,
                value: {
                  results: [
                    {
                      businessName: "Pressure Spa",
                      location: "Singapore",
                      sourceUrl: "https://www.google.com/maps/place/PressureSpa",
                      googleMapsUrl: "https://www.google.com/maps/place/PressureSpa",
                      rating: 4.2,
                      reviewCount: 31,
                      problemDetected: "Water pressure inconsistent",
                      painPointCategory: "Water system opportunity",
                      matchedKeywords: [],
                      reviewEvidence: ["Google Maps review mentioned water pressure was inconsistent and taps were dripping during treatment."],
                      moncolOpportunity: "Water system maintenance and plumbing optimization",
                      opportunityScore: 4,
                      memoriesUsed: [],
                    },
                  ],
                },
              },
            },
            {
              type: "status_update",
              status_update: {
                agent_status: "stopped",
              },
            },
          ],
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const { createReviewOpportunityTask, getReviewOpportunityTaskStatus } = await import("./reviewOpportunities");
    await createReviewOpportunityTask({
      country: "Singapore",
      businessTypes: ["spa"],
      memories: [],
    });

    const result = await getReviewOpportunityTaskStatus("task_semantic");
    expect(result.status).toBe("stopped");
    expect(result.sourceMode).toBe("live");
    expect(result.results).toEqual([]);
  });

  it("falls back only when Manus task status request fails", async () => {
    process.env.MANUS_API_KEY = "manus-key";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ task_id: "task_fail" }))
      .mockResolvedValueOnce(
        createJsonResponse(
          { error: "temporary upstream failure" },
          { status: 503 }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    const { createReviewOpportunityTask, getReviewOpportunityTaskStatus } = await import("./reviewOpportunities");
    await createReviewOpportunityTask({
      country: "Singapore",
      businessTypes: ["spa"],
      memories: ["Avoid small wellness centers"],
    });

    const result = await getReviewOpportunityTaskStatus("task_fail");
    expect(result.status).toBe("failed");
    expect(result.sourceMode).toBe("fallback");
    expect(result.liveFailureReason).toBe("manus request failed with status 503");
    expect(result.results).toEqual([]);
  });

  it("returns live empty results when Manus stops without matches", async () => {
    process.env.MANUS_API_KEY = "manus-key";
    process.env.MANUS_API_BASE_URL = "https://api.manus.ai";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ task_id: "task_empty" }))
      .mockResolvedValueOnce(
        createJsonResponse({
          task_id: "task_empty",
          messages: [
            {
              type: "structured_output_result",
              structured_output_result: {
                success: true,
                value: {
                  results: [],
                },
              },
            },
            {
              type: "status_update",
              status_update: {
                agent_status: "stopped",
              },
            },
          ],
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const { createReviewOpportunityTask, getReviewOpportunityTaskStatus } = await import("./reviewOpportunities");
    await createReviewOpportunityTask({
      country: "Singapore",
      businessTypes: ["spa", "wellness"],
      memories: ["Avoid small wellness centers"],
    });

    const result = await getReviewOpportunityTaskStatus("task_empty");
    expect(result.status).toBe("stopped");
    expect(result.sourceMode).toBe("live");
    expect(result.results).toEqual([]);
  });

  it("normalizes open.manus.ai env to the official api.manus.ai host", async () => {
    process.env.MANUS_API_KEY = "manus-key";
    process.env.MANUS_API_BASE_URL = "https://open.manus.ai";

    const fetchMock = vi.fn().mockResolvedValueOnce(createJsonResponse({ task_id: "task_normalized" }));
    vi.stubGlobal("fetch", fetchMock);

    const { createReviewOpportunityTask } = await import("./reviewOpportunities");
    await createReviewOpportunityTask({
      country: "Singapore",
      businessTypes: ["spa"],
      memories: [],
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.manus.ai/v2/task.create");
  });
});
