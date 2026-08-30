import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_EDIT_FLEET } from "@/lib/auth/permissions";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; pathId: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_EDIT_FLEET.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { id, pathId } = await params;
  const { error } = await ctx.admin
    .from("route_border_paths")
    .delete()
    .eq("id", pathId)
    .eq("route_id", id)
    .eq("org_id", ctx.orgId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
