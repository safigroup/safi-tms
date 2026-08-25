import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_MANAGE_TEAM } from "@/lib/auth/permissions";

// Team member list for the Admin > Team view. memberships has no email --
// that lives in Supabase Auth, reachable only through the Admin API -- so
// each row's email is resolved via getUserById() rather than a table join.
// A failure resolving one user (e.g. an orphaned membership row) drops that
// row instead of failing the whole list.
export async function GET() {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_MANAGE_TEAM.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { data: rows, error } = await ctx.admin
    .from("memberships")
    .select("user_id, role, created_at")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const members = (
    await Promise.all(
      rows.map(async (row) => {
        const { data, error: userError } = await ctx.admin.auth.admin.getUserById(row.user_id);
        if (userError || !data.user) return null;
        return {
          userId: row.user_id,
          email: data.user.email ?? "",
          role: row.role,
          createdAt: row.created_at,
        };
      }),
    )
  ).filter((m) => m !== null);

  return NextResponse.json({ viewerRole: ctx.role, members });
}
