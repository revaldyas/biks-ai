import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// When env vars are missing, the app runs WITHOUT auth (graceful fallback for
// local dev / preview) instead of crashing.
export const isSupabaseConfigured = !!(url && anonKey);

export const supabase = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : (null as any);

export const TRIAL_DAYS = 7;
