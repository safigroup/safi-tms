import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_MANAGE_TRIPS } from "@/lib/auth/permissions";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_MANAGE_TRIPS.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { id } = await params;

  const { error } = await ctx.admin
    .from("trip_costs")
    .delete()
    .eq("id", id)
    .eq("org_id", ctx.orgId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
