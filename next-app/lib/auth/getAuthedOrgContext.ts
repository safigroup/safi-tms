import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClientInternal } from "@/lib/supabase/admin";
import { checkPlatformAdmin } from "./platformAdmin";

export type OrgRole = "owner" | "admin" | "ops" | "finance" | "viewer";

// Set by the setActiveOrg server action (app/(app)/actions.ts) -- a
// platform admin's choice of which org to view/edit. Deliberately a
// session cookie (no maxAge): a fresh browser session always re-resolves
// rather than silently persisting a "viewing org X" state indefinitely.
export const ACTIVE_ORG_COOKIE = "safi:activeOrg";

type AuthedOrgContext = {
  ok: true;
  userId: string;
  email: string;
  orgId: string;
  orgName: string;
  role: OrgRole;
  admin: SupabaseClient;
  isPlatformAdmin: boolean;
};

type UnauthedResult = {
  ok: false;
  status: 401 | 403;
  reason: string;
  isPlatformAdmin?: boolean;
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
 *
 * Platform admins (lib/auth/platformAdmin.ts) are the one exception to
 * "one user, one org": if the caller is a platform admin AND has an active
 * org selected (the ACTIVE_ORG_COOKIE, set via setActiveOrg), that org is
 * resolved directly with a synthetic "owner" role, reusing every existing
 * permission check as-is instead of introducing a parallel one. This
 * function's return shape is otherwise unchanged, so no existing route
 * needs to know platform admins exist at all.
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
    console.error("[getAuthedOrgContext] auth.getUser() failed:", userError?.message ?? "no user in session");
    return { ok: false, status: 401, reason: "not signed in" };
  }

  const isPlatformAdmin = await checkPlatformAdmin(supabase, user.id);

  if (isPlatformAdmin) {
    const activeOrgId = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
    if (activeOrgId) {
      const admin = createAdminClientInternal();
      const { data: org } = await admin
        .from("organizations")
        .select("id, name")
        .eq("id", activeOrgId)
        .maybeSingle();
      if (org) {
        return {
          ok: true,
          userId: user.id,
          email: user.email ?? "",
          orgId: org.id,
          orgName: org.name,
          role: "owner",
          admin,
          isPlatformAdmin: true,
        };
      }
      // Stale/deleted org id in the cookie -- fall through to the
      // membership lookup below rather than failing outright.
    }
  }

  const { data: membership, error: membershipError } = await supabase
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
    console.error(
      "[getAuthedOrgContext] no membership row for user",
      user.id,
      membershipError ? `— query error: ${membershipError.message}` : "— query succeeded, zero rows",
    );
    return {
      ok: false,
      status: 403,
      reason: "not a member of any organisation",
      isPlatformAdmin,
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
    isPlatformAdmin,
  };
}
