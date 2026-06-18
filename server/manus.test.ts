import { afterEach, describe, expect, it, vi } from "vitest";
import { manusTask } from "./_core/manus";

describe("Manus task creation", () => {
  const originalKey = process.env.MANUS_API_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalKey) process.env.MANUS_API_KEY = originalKey;
    else delete process.env.MANUS_API_KEY;
  });

  it("falls back to an unstructured task when Manus rejects the schema", async () => {
    process.env.MANUS_API_KEY = "test-manus-key";
    const requests: Array<{ url: string; body?: any }> = [];

    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (input, init) => {
        requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ error: { code: "invalid_argument", message: "unexpected error from node server" } }), { status: 400 });
      })
      .mockImplementationOnce(async (input, init) => {
        requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ ok: true, task_id: "task-1" }), { status: 200 });
      })
      .mockImplementationOnce(async () => new Response(JSON.stringify({
        ok: true,
        messages: [
          { type: "status_update", status_update: { agent_status: "stopped" } },
          { type: "assistant_message", assistant_message: { content: '{"expansionCategories":[]}' } },
        ],
      }), { status: 200 }));

    const result = await manusTask<{ expansionCategories: unknown[] }>(
      "Return JSON",
      { type: "object", properties: { expansionCategories: { type: "array" } } },
      { pollMs: 0, timeoutMs: 1_000 },
    );

    expect(result).toEqual({ expansionCategories: [] });
    expect(requests[0].body.structured_output_schema).toBeDefined();
    expect(requests[1].body.structured_output_schema).toBeUndefined();
    expect(requests[1].body.message.content).toBe("Return JSON");
  });
});
