import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";

// Excludes 0/O/1/l/I -- this gets read aloud or typed from a phone screen.
const CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";

function generatePassword(length = 16): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CHARSET[randomInt(CHARSET.length)];
  return out;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { id } = await params;
  const isSelf = id === ctx.userId;

  // Same 404 whether the id doesn't exist at all or belongs to another org --
  // this must not be usable to probe cross-org user ids.
  const { data: membership } = await ctx.admin
    .from("memberships")
    .select("user_id, role")
    .eq("org_id", ctx.orgId)
    .eq("user_id", id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // admin may reset ops/finance/viewer, but not another admin or the owner --
  // only the owner (or the account holder themselves) can do that.
  const allowed =
    isSelf ||
    ctx.role === "owner" ||
    (ctx.role === "admin" && membership.role !== "owner" && membership.role !== "admin");
  if (!allowed) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const password = generatePassword();
  const { error } = await ctx.admin.auth.admin.updateUserById(id, { password });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ password });
}
