import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClientInternal } from "@/lib/supabase/admin";

export type OrgRole = "owner" | "admin" | "ops" | "finance" | "viewer";

type AuthedOrgContext = {
  ok: true;
  userId: string;
  email: string;
  orgId: string;
  orgName: string;
  role: OrgRole;
  admin: SupabaseClient;
};

type UnauthedResult = {
  ok: false;
  status: 401 | 403;
  reason: string;
};

/**
 * The one place a route handler is allowed to get hold of the service-role
 * client. Every route handler must start with:
 *
 *   const ctx = await getAuthedOrgContext();
 *   if (!ctx.ok) return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
 *
 * and every query after that must filter by `ctx.orgId` — the database no
 * longer does this automatically the way RLS did for the anon-key app.
 *
 * Steps, and why each one is here:
 * 1. auth.getUser() — NOT getSession(). getUser() revalidates against the
 *    auth server instead of trusting a JWT claim that could be stale or,
 *    in a differently-shaped bug, spoofed.
 * 2. The memberships lookup uses the anon/user-scoped client, not the
 *    admin client. RLS on `memberships` itself is real defense-in-depth
 *    here — even a bug in this function can't return someone else's
 *    membership row, because Postgres won't let the query see it.
 * 3. Only after both checks pass does this function hand back a
 *    service-role client at all.
 */
export async function getAuthedOrgContext(): Promise<
  AuthedOrgContext | UnauthedResult
> {
  const supabase = await createServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, status: 401, reason: "not signed in" };
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id, role, organizations(name)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle<{
      org_id: string;
      role: OrgRole;
      organizations: { name: string } | null;
    }>();

  if (!membership) {
    return {
      ok: false,
      status: 403,
      reason: "not a member of any organisation",
    };
  }

  return {
    ok: true,
    userId: user.id,
    email: user.email ?? "",
    orgId: membership.org_id,
    orgName: membership.organizations?.name ?? "",
    role: membership.role,
    admin: createAdminClientInternal(),
  };
}
