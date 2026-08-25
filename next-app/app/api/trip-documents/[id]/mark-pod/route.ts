import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_MANAGE_TRIPS } from "@/lib/auth/permissions";

export async function POST(
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
  const { tripId } = await request.json();

  const { error } = await ctx.admin.rpc("mark_pod_received", {
    p_doc: id,
    p_trip: tripId,
    p_org: ctx.orgId,
    p_user: ctx.userId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
