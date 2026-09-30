import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_MANAGE_TRIPS, CAN_OVERRIDE_RECORDS } from "@/lib/auth/permissions";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { id } = await params;
  const { status } = await request.json();

  const { data: trip } = await ctx.admin
    .from("trips")
    .select("status")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }

  // Reopening a closed trip is a retroactive correction, not a routine
  // progress update -- gated the same way trip-costs' own retroactive
  // edits are (CAN_OVERRIDE_RECORDS), narrower than every other status
  // step here (CAN_MANAGE_TRIPS).
  const isReopen = trip.status === "closed" && status === "invoiced";
  const allowed = isReopen ? CAN_OVERRIDE_RECORDS : CAN_MANAGE_TRIPS;
  if (!allowed.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { error } = await ctx.admin.rpc("advance_trip_status", {
    p_trip: id,
    p_org: ctx.orgId,
    p_status: status,
    p_user: ctx.userId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
