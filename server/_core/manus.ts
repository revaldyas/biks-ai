/**
 * Manus Public API v2 helper.
 *
 * Pattern: POST /task.create → poll GET /task.listMessages until agent_status=stopped.
 * Auth: x-manus-api-key header (NOT Bearer).
 *
 * Reference: /var/www/hackathon-singapore/MANUS_BUILD_GUIDE.md
 */

const BASE = "https://api.manus.ai/v2";

// Agent profile controls speed vs depth. "manus-1.6-lite" is the fast profile —
// right for these structured one-shot generations (brief, kit, review analysis).
// Override with MANUS_AGENT_PROFILE ("manus-1.6" / "manus-1.6-max") for more depth.
const AGENT_PROFILE = process.env.MANUS_AGENT_PROFILE || "manus-1.6-lite";

function extractJson(text: string): unknown {
  // Strip markdown code fences
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  // Try direct parse
  try { return JSON.parse(cleaned); } catch {}

  // Find the outermost JSON object in the text
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
  }

  return null;
}

export type ManusProgressFn = (message: string, detail: string, pct: number) => void;

export type ManusTaskOptions = {
  timeoutMs?: number;
  pollMs?: number;
  onProgress?: ManusProgressFn;
  profile?: string;
};

export async function manusTask<T>(
  prompt: string,
  schema: Record<string, unknown>,
  options: ManusTaskOptions = {}
): Promise<T> {
  const { timeoutMs = 180_000, pollMs = 2_500, onProgress, profile = AGENT_PROFILE } = options;

  const apiKey = process.env.MANUS_API_KEY;
  if (!apiKey) throw new Error("MANUS_API_KEY is not configured");

  const hdrs: Record<string, string> = {
    "Content-Type": "application/json",
    "x-manus-api-key": apiKey,
  };

  onProgress?.("Creating Manus task...", "Initializing AI agent", 22);

  // task.create can fail transiently under concurrent load, so retry with backoff.
  let created: any = null;
  let lastErr = "task.create error";
  let useStructuredOutput = true;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const createBody = JSON.stringify({
        message: { content: prompt },
        ...(useStructuredOutput ? { structured_output_schema: schema } : {}),
        agent_profile: profile,
      });
      const createRes = await fetch(`${BASE}/task.create`, { method: "POST", headers: hdrs, body: createBody });
      if (createRes.ok) {
        const j: any = await createRes.json().catch(() => null);
        if (j?.ok) { created = j; break; }
        lastErr = j?.error?.message ?? "task.create error";
      } else {
        lastErr = `${createRes.status}: ${await createRes.text().catch(() => "")}`;
        if (createRes.status === 400 && useStructuredOutput && /invalid_argument|structured|unexpected error/i.test(lastErr)) {
          useStructuredOutput = false;
          continue;
        }
        if (createRes.status >= 400 && createRes.status < 500 && createRes.status !== 429) break;
      }
    } catch (e: any) {
      lastErr = `network: ${e?.message ?? e}`;
    }
    if (attempt < 3) {
      const rateLimited = /\b429\b|resource_exhausted/i.test(lastErr);
      await new Promise(r => setTimeout(r, rateLimited ? 6000 : 1500 * (attempt + 1)));
    }
  }
  if (!created) throw new Error(`Manus task.create failed after retries (${lastErr})`);

  const taskId: string = created.task_id;
  onProgress?.("Agent started", "Manus is processing your request", 30);

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollMs));

    const pollRes = await fetch(
      `${BASE}/task.listMessages?task_id=${encodeURIComponent(taskId)}&order=desc&limit=20`,
      { headers: hdrs }
    );

    // Task not registered yet — retry silently
    if (pollRes.status === 404) continue;

    // Rate limited or transient server error — back off and keep polling.
    if (pollRes.status === 429 || pollRes.status >= 500) {
      await new Promise(r => setTimeout(r, Math.min(6_000, pollMs * 2)));
      continue;
    }

    if (!pollRes.ok) {
      const txt = await pollRes.text().catch(() => "");
      throw new Error(`Manus poll failed (${pollRes.status}): ${txt}`);
    }

    const poll: any = await pollRes.json();
    if (!poll.ok) {
      if (poll.error?.code === "resource_exhausted") {
        await new Promise(r => setTimeout(r, Math.min(10_000, pollMs * 4)));
        continue;
      }
      throw new Error(`Manus poll error: ${poll.error?.message}`);
    }

    const msgs: any[] = poll.messages ?? [];
    const statusEvent = msgs.find(m => m.type === "status_update");
    const agentStatus = statusEvent?.status_update?.agent_status;

    if (agentStatus === "running" || agentStatus === "waiting") {
      const brief = statusEvent?.status_update?.brief ?? "Manus is working...";
      const detail = statusEvent?.status_update?.description ?? "Processing";
      const elapsed = Date.now() - (deadline - timeoutMs);
      const pct = Math.min(82, 30 + Math.floor((elapsed / timeoutMs) * 60));
      onProgress?.(brief, detail, pct);
      continue;
    }

    if (agentStatus === "error") throw new Error("Manus agent reported an error");

    if (agentStatus !== "stopped") continue;

    onProgress?.("Agent finished", "Extracting structured output", 88);

    // Priority 1: standalone structured_output_result message (actual Manus API format)
    const structuredMsg = msgs.find(m => m.type === "structured_output_result");
    if (structuredMsg?.structured_output_result?.success && structuredMsg.structured_output_result.value != null) {
      return structuredMsg.structured_output_result.value as T;
    }

    // Priority 2: structured output nested inside assistant_message (fallback)
    const assistantMsg = msgs.find(m => m.type === "assistant_message");
    const nested = assistantMsg?.assistant_message?.structured_output_result;
    if (nested?.value != null) {
      try {
        const v = typeof nested.value === "string" ? JSON.parse(nested.value) : nested.value;
        return v as T;
      } catch {}
    }

    // Priority 3: extract JSON from raw text content
    const content = assistantMsg?.assistant_message?.content;
    if (content) {
      const extracted = extractJson(content);
      if (extracted != null) return extracted as T;
    }

    throw new Error("Manus: agent stopped but returned no parseable output");
  }

  throw new Error(`Manus: timed out after ${Math.round(timeoutMs / 1000)}s`);
}

// ============================================================
// Task-based helpers for Vercel (no long-running server loop)
// ============================================================

export async function startManusTask(
  prompt: string,
  schema: Record<string, unknown>,
  options: Pick<ManusTaskOptions, "profile"> = {},
): Promise<string> {
  const apiKey = process.env.MANUS_API_KEY;
  if (!apiKey) throw new Error("MANUS_API_KEY is not configured");

  const hdrs = { "Content-Type": "application/json", "x-manus-api-key": apiKey };
  for (const useStructuredOutput of [true, false]) {
    const createRes = await fetch(`${BASE}/task.create`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        message: { content: prompt },
        ...(useStructuredOutput ? { structured_output_schema: schema } : {}),
        agent_profile: options.profile || AGENT_PROFILE,
      }),
    });

    if (createRes.ok) {
      const created: any = await createRes.json();
      if (created.ok) return created.task_id as string;
      throw new Error(`Manus: ${created.error?.message ?? "task.create error"}`);
    }

    const txt = await createRes.text().catch(() => "");
    const canFallback = useStructuredOutput && createRes.status === 400 && /invalid_argument|structured|unexpected error/i.test(txt);
    if (!canFallback) throw new Error(`Manus task.create failed (${createRes.status}): ${txt}`);
  }

  throw new Error("Manus task.create failed after schema fallback");
}

export type ManusTaskStatus =
  | { status: "running"; pct: number; message: string; detail: string; phase?: "initializing" | "working" }
  | { status: "done"; result: unknown }
  | { status: "error"; message: string };

export async function checkManusTask(taskId: string): Promise<ManusTaskStatus> {
  const apiKey = process.env.MANUS_API_KEY;
  if (!apiKey) throw new Error("MANUS_API_KEY is not configured");

  const hdrs = { "Content-Type": "application/json", "x-manus-api-key": apiKey };
  const pollRes = await fetch(
    `${BASE}/task.listMessages?task_id=${encodeURIComponent(taskId)}&order=desc&limit=20`,
    { headers: hdrs },
  );

  if (pollRes.status === 404) {
    // Task not registered yet. Normal for the first few seconds, but a *persistent*
    // 404 means a dead/invalid id — the client uses `phase` to bail after a grace window.
    return { status: "running", pct: 10, message: "Starting...", detail: "Task is initializing", phase: "initializing" };
  }

  if (!pollRes.ok) {
    const txt = await pollRes.text().catch(() => "");
    throw new Error(`Manus poll failed (${pollRes.status}): ${txt}`);
  }

  const poll: any = await pollRes.json();
  if (!poll.ok) throw new Error(`Manus poll error: ${poll.error?.message}`);

  const msgs: any[] = poll.messages ?? [];
  const statusEvent = msgs.find(m => m.type === "status_update");
  const agentStatus = statusEvent?.status_update?.agent_status;

  if (!agentStatus || agentStatus === "running" || agentStatus === "waiting") {
    const message = statusEvent?.status_update?.brief ?? "Manus is working...";
    const detail = statusEvent?.status_update?.description ?? "Processing";
    // 200 response => the task is registered and alive (working), not a dead id.
    return { status: "running", pct: 50, message, detail, phase: "working" };
  }

  if (agentStatus === "error") {
    return { status: "error", message: "Manus agent reported an error" };
  }

  if (agentStatus === "stopped") {
    const structuredMsg = msgs.find(m => m.type === "structured_output_result");
    if (structuredMsg?.structured_output_result?.success && structuredMsg.structured_output_result.value != null) {
      return { status: "done", result: structuredMsg.structured_output_result.value };
    }

    const assistantMsg = msgs.find(m => m.type === "assistant_message");
    const nested = assistantMsg?.assistant_message?.structured_output_result;
    if (nested?.value != null) {
      try {
        const v = typeof nested.value === "string" ? JSON.parse(nested.value) : nested.value;
        return { status: "done", result: v };
      } catch {}
    }

    const content = assistantMsg?.assistant_message?.content;
    if (content) {
      const extracted = extractJson(content);
      if (extracted != null) return { status: "done", result: extracted };
      if (/Qualifying Leads|Fit Score|Opportunity Signal/i.test(content)) {
        return { status: "done", result: { rawText: content } };
      }
    }

    return { status: "error", message: "Agent stopped but returned no parseable output" };
  }

  return { status: "running", pct: 20, message: "Agent status unknown", detail: `Status: ${agentStatus}` };
}
