import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Shared by getAuthedOrgContext() and getAuthedPlatformAdmin() -- always
// called with the caller's own anon/user-scoped client, never the
// service-role one, so platform_admins' RLS (self-read only) is real
// defense-in-depth here, not just an app-level check.
export async function checkPlatformAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}
