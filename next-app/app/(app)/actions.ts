"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedPlatformAdmin } from "@/lib/auth/getAuthedPlatformAdmin";
import { ACTIVE_ORG_COOKIE } from "@/lib/auth/getAuthedOrgContext";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// Re-checks platform-admin status itself rather than trusting that the
// dropdown calling this was only ever rendered for one -- a server action
// is reachable directly, not just through the UI that happens to render it.
//
// Deliberately does NOT call redirect(): this is invoked directly from a
// plain event handler (not a <form action>), and redirect() works by
// throwing -- a caller wrapping the call in try/catch (to report real
// errors) would catch that throw too and show it as if it were a failure.
// The caller does a full page navigation itself once this resolves, which
// also sidesteps every client component's own useEffect-fetched state
// (nav badges, bootstrap data, etc.) staying stale after just a cookie
// change with no full reload.
export async function setActiveOrg(orgId: string) {
  const ctx = await getAuthedPlatformAdmin();
  if (!ctx.ok) {
    throw new Error(ctx.reason);
  }

  const { data: org } = await ctx.admin.from("organizations").select("id").eq("id", orgId).maybeSingle();
  if (!org) {
    throw new Error("organization not found");
  }

  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}
