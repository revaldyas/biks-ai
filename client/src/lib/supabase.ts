import { createClient } from "@supabase/supabase-js";

// Public Supabase config. The anon key is safe to ship in the browser bundle
// (it's RLS-protected by design). Env vars take precedence so deploys can
// override without a code change; the fallback guarantees the app connects even
// if the Vercel env vars aren't set.
const SUPABASE_URL_FALLBACK = "https://lxyawymepqnjtvfczquv.supabase.co";
const SUPABASE_ANON_KEY_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4eWF3eW1lcHFuanR2ZmN6cXV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MjEyMjEsImV4cCI6MjA5Njk5NzIyMX0.shYzLjpzWf_7T2XlSa-3ZsGM_00MWZYruZ5oE926MCg";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || SUPABASE_URL_FALLBACK;
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || SUPABASE_ANON_KEY_FALLBACK;

// When env vars are missing, the app runs WITHOUT auth (graceful fallback for
// local dev / preview) instead of crashing.
export const isSupabaseConfigured = !!(url && anonKey);

export const supabase = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : (null as any);

export const TRIAL_DAYS = 7;
