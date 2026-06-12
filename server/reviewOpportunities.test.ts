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

  it("returns live results through Manus task.create and task.listMessages", async () => {
    process.env.MANUS_API_KEY = "manus-key";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          task_id: "task_123",
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          task_id: "task_123",
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

    const { discoverReviewOpportunities } = await import("./reviewOpportunities");
    const result = await discoverReviewOpportunities({
      country: "Singapore",
      businessTypes: ["spa", "wellness"],
      memories: ["Prefer premium hospitality"],
    });

    expect(result.sourceMode).toBe("live");
    expect(result.liveFailureReason).toBeUndefined();
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      businessName: "Aqua Wellness Club",
      painPointCategory: "Water Quality",
      opportunityScore: 5,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
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

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.manus.ai/v2/task.listMessages?task_id=task_123&order=desc&limit=50",
      expect.objectContaining({
        method: "GET",
        headers: {
          "x-manus-api-key": "manus-key",
        },
      })
    );
  });

  it("falls back with missing MANUS_API_KEY reason", async () => {
    const { discoverReviewOpportunities } = await import("./reviewOpportunities");
    const result = await discoverReviewOpportunities({
      country: "Singapore",
      businessTypes: ["spa"],
      memories: [],
    });

    expect(result.sourceMode).toBe("fallback");
    expect(result.liveFailureReason).toBe("missing MANUS_API_KEY");
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("falls back when Manus request fails", async () => {
    process.env.MANUS_API_KEY = "manus-key";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        createJsonResponse(
          { error: "temporary upstream failure" },
          { status: 503 }
        )
      )
    );

    const { discoverReviewOpportunities } = await import("./reviewOpportunities");
    const result = await discoverReviewOpportunities({
      country: "Singapore",
      businessTypes: ["spa"],
      memories: ["Avoid small wellness centers"],
    });

    expect(result.sourceMode).toBe("fallback");
    expect(result.liveFailureReason).toBe("manus request failed with status 503");
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("falls back when live search returns no matching review complaints", async () => {
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

    const { discoverReviewOpportunities } = await import("./reviewOpportunities");
    const result = await discoverReviewOpportunities({
      country: "Singapore",
      businessTypes: ["spa", "wellness"],
      memories: ["Avoid small wellness centers"],
    });

    expect(result.sourceMode).toBe("fallback");
    expect(result.liveFailureReason).toBe("live search returned no matching review complaints");
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("normalizes open.manus.ai env to the official api.manus.ai host", async () => {
    process.env.MANUS_API_KEY = "manus-key";
    process.env.MANUS_API_BASE_URL = "https://open.manus.ai";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ task_id: "task_normalized" }))
      .mockResolvedValueOnce(
        createJsonResponse({
          task_id: "task_normalized",
          messages: [
            {
              type: "structured_output_result",
              structured_output_result: {
                success: true,
                value: {
                  results: [
                    {
                      businessName: "Harbor Wellness Spa",
                      location: "Singapore",
                      sourceUrl: "https://maps.google.com/?q=Harbor+Wellness+Spa+Singapore",
                      rating: 4.2,
                      reviewCount: 52,
                      problemDetected: "Dirty spa water complaint",
                      painPointCategory: "Water Quality",
                      matchedKeywords: ["water", "dirty"],
                      reviewEvidence: ["Guests reported dirty water in the spa area."],
                      moncolOpportunity: "Water treatment optimization",
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

    const { discoverReviewOpportunities } = await import("./reviewOpportunities");
    const result = await discoverReviewOpportunities({
      country: "Singapore",
      businessTypes: ["spa"],
      memories: [],
    });

    expect(result.sourceMode).toBe("live");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.manus.ai/v2/task.create");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.manus.ai/v2/task.listMessages?task_id=task_normalized&order=desc&limit=50"
    );
  });
});
