import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "http";
import apiRoutes from "./api";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(apiRoutes);
  return app;
}

function startServer(app: express.Express): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, () => {
      const addr = server.address() as any;
      resolve({ port: addr.port, close: () => server.close() });
    });
  });
}

describe("API route handlers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("GET /api/mem0 returns unavailable when key is missing", async () => {
    const origKey = process.env.MEM0_API_KEY;
    delete process.env.MEM0_API_KEY;

    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/mem0`);
      const data = await res.json();
      expect(data.available).toBe(false);
      expect(data.items).toEqual([]);
    } finally {
      close();
      if (origKey) process.env.MEM0_API_KEY = origKey;
    }
  });

  it("POST /api/exa-search requires query", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/exa-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("query is required");
    } finally {
      close();
    }
  });

  it("POST /api/send-email requires subject and html", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: "test" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("subject and html are required");
    } finally {
      close();
    }
  });

  it("POST /api/find-contacts requires leadName", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/find-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("leadName is required");
    } finally {
      close();
    }
  });

  it("POST /api/analyze-website requires url", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/analyze-website`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const text = await res.text();
      // SSE response should contain error event
      expect(text).toContain("URL is required");
    } finally {
      close();
    }
  });

  it("POST /api/generate-sales-kit requires business and lead", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/generate-sales-kit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const text = await res.text();
      // SSE response should contain error event about missing fields
      expect(text).toContain("business and lead are required");
    } finally {
      close();
    }
  });

  it("POST /api/scrape-reviews requires leadName", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/scrape-reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("leadName is required");
    } finally {
      close();
    }
  });

  it("POST /api/review-opportunities requires country and businessTypes", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/review-opportunities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country: "Singapore" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("country and businessTypes are required");
    } finally {
      close();
    }
  });


  it("POST /api/review-opportunities returns a running task when Manus task starts", async () => {
    const originalManusKey = process.env.MANUS_API_KEY;
    process.env.MANUS_API_KEY = "manus-key";
    const originalFetch = globalThis.fetch;

    let manusCallCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("http://localhost:")) {
        return originalFetch(input, init);
      }

      manusCallCount += 1;
      if (manusCallCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ task_id: "task_route" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      return Promise.reject(new Error("Unexpected external fetch"));
    });

    vi.stubGlobal("fetch", fetchMock);

    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/review-opportunities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: "Singapore",
          businessTypes: ["spa", "wellness"],
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.taskId).toBe("task_route");
      expect(data.status).toBe("running");
      expect(typeof data.lastUpdatedAt).toBe("string");
    } finally {
      close();
      if (originalManusKey !== undefined) {
        process.env.MANUS_API_KEY = originalManusKey;
      } else {
        delete process.env.MANUS_API_KEY;
      }
    }
  });

  it("GET /api/review-opportunities/status requires taskId", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/review-opportunities/status`);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("taskId is required");
    } finally {
      close();
    }
  });

  it("GET /api/review-opportunities/status returns 404 for unknown task", async () => {
    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const res = await fetch(`http://localhost:${port}/api/review-opportunities/status?taskId=unknown-task`);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("taskId not found");
    } finally {
      close();
    }
  });

  it("GET /api/review-opportunities/status returns fallback only when Manus fails", async () => {
    const originalManusKey = process.env.MANUS_API_KEY;
    process.env.MANUS_API_KEY = "manus-key";
    const originalFetch = globalThis.fetch;

    let manusCallCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("http://localhost:")) {
        return originalFetch(input, init);
      }

      manusCallCount += 1;
      if (manusCallCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ task_id: "task_route_fail" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      if (manusCallCount === 2) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "upstream failed" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      return Promise.reject(new Error("Unexpected external fetch"));
    });

    vi.stubGlobal("fetch", fetchMock);

    const app = createTestApp();
    const { port, close } = await startServer(app);

    try {
      const createRes = await fetch(`http://localhost:${port}/api/review-opportunities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: "Singapore",
          businessTypes: ["spa", "wellness"],
        }),
      });
      expect(createRes.status).toBe(200);
      const created = await createRes.json();

      const res = await fetch(`http://localhost:${port}/api/review-opportunities/status?taskId=${created.taskId}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("failed");
      expect(data.sourceMode).toBe("fallback");
      expect(data.liveFailureReason).toBe("manus request failed with status 503");
      expect(Array.isArray(data.results)).toBe(true);
      expect(data.results).toEqual([]);
    } finally {
      close();
      if (originalManusKey !== undefined) {
        process.env.MANUS_API_KEY = originalManusKey;
      } else {
        delete process.env.MANUS_API_KEY;
      }
    }
  });
});
