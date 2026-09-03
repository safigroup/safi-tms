import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClientInternal } from "@/lib/supabase/admin";
import { checkPlatformAdmin } from "./platformAdmin";

type AuthedPlatformAdmin = {
  ok: true;
  userId: string;
  email: string;
  admin: SupabaseClient;
};

type UnauthedResult = {
  ok: false;
  status: 401 | 403;
  reason: string;
};

// Mirrors getAuthedOrgContext()'s shape and rigor, but for actions that
// have no single org to scope by -- listing every organization, creating
// one, or switching a platform admin's active org. A route handler for one
// of those deliberately does NOT go through getAuthedOrgContext() (there is
// no org_id to resolve yet), but must not reach into
// lib/supabase/admin.ts directly either -- that file's whole invariant is
// "only handed out after the caller is checked". This is the platform-level
// equivalent of that check.
export async function getAuthedPlatformAdmin(): Promise<AuthedPlatformAdmin | UnauthedResult> {
  const supabase = await createServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, status: 401, reason: "not signed in" };
  }

  if (!(await checkPlatformAdmin(supabase, user.id))) {
    return { ok: false, status: 403, reason: "not permitted" };
  }

  return {
    ok: true,
    userId: user.id,
    email: user.email ?? "",
    admin: createAdminClientInternal(),
  };
}
