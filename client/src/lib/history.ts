import { supabase, isSupabaseConfigured } from "./supabase";

export type HistoryKind = "analysis" | "leads" | "kit";

export interface HistoryRow {
  id: string;
  kind: HistoryKind;
  title: string;
  data: any;
  created_at: string;
}

// Save silently — never throw into the UI. No-op when not configured / not signed in.
export async function saveHistory(kind: HistoryKind, title: string, data: any): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess?.session) return;
    await supabase.from("histories").insert({ kind, title, data });
  } catch (e) {
    console.warn("[history] save failed", e);
  }
}

export async function listHistory(): Promise<HistoryRow[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const { data } = await supabase
      .from("histories")
      .select("id, kind, title, data, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    return (data as HistoryRow[]) || [];
  } catch {
    return [];
  }
}
