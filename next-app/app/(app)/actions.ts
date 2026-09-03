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

  redirect("/board");
}
