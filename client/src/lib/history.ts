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
// Returns the new row id so the caller can keep updating this session as it grows.
export async function saveHistory(kind: HistoryKind, title: string, data: any): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess?.session) return null;
    const { data: row } = await supabase.from("histories").insert({ kind, title, data }).select("id").single();
    return (row as { id: string } | null)?.id ?? null;
  } catch (e) {
    console.warn("[history] save failed", e);
    return null;
  }
}

// Update a session's stored snapshot as the user generates leads / brief / kit.
export async function updateHistoryData(id: string, data: any): Promise<void> {
  if (!isSupabaseConfigured || !id) return;
  try {
    await supabase.from("histories").update({ data }).eq("id", id);
  } catch (e) {
    console.warn("[history] update failed", e);
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

// Delete one saved item. Returns true on success. RLS scopes it to the owner.
export async function deleteHistory(id: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const { error } = await supabase.from("histories").delete().eq("id", id);
    return !error;
  } catch (e) {
    console.warn("[history] delete failed", e);
    return false;
  }
}

// Clear all of the signed-in user's saved items (RLS scopes the delete to them).
export async function clearAllHistory(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess?.session?.user?.id;
    if (!uid) return false;
    const { error } = await supabase.from("histories").delete().eq("user_id", uid);
    return !error;
  } catch (e) {
    console.warn("[history] clear failed", e);
    return false;
  }
}
