import { describe, expect, it } from "vitest";
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
});
