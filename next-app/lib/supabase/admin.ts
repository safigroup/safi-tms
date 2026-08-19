import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The service_role key bypasses RLS on every table, always. Nothing should
// import this file directly — go through getAuthedOrgContext() in
// lib/auth/getAuthedOrgContext.ts, which resolves and verifies the caller's
// org_id first and only then hands back a client. A route handler that
// constructs an admin client itself has no guarantee org_id was ever
// checked.
let cached: SupabaseClient | null = null;

export function createAdminClientInternal(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return cached;
}
