import { describe, expect, it } from "vitest";

describe("Resend API key validation", () => {
  it("RESEND_API_KEY is set and valid format", () => {
    const key = process.env.RESEND_API_KEY;
    expect(key).toBeDefined();
    expect(key!.startsWith("re_")).toBe(true);
  });

  it("RESEND_FROM_EMAIL is set", () => {
    const from = process.env.RESEND_FROM_EMAIL;
    expect(from).toBeDefined();
    expect(from).toBe("nura@biks.ai");
  });

  it("Resend API key can authenticate", { timeout: 15000 }, async () => {
    const key = process.env.RESEND_API_KEY;
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
    });
    // 200 means valid key, 403 means invalid
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});
