import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";

// One trip's history -- status changes and border arrivals/clearances,
// oldest first -- for the Board's route line and timeline. Who recorded
// each one is resolved to an email the same way the edit history does.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { id } = await params;
  const { data: trip } = await ctx.admin
    .from("trips")
    .select("id, created_at")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }

  const { data: rows, error } = await ctx.admin
    .from("trip_events")
    .select("id, event_type, location, occurred_at, from_status, to_status, recorded_by")
    .eq("trip_id", id)
    .eq("org_id", ctx.orgId)
    .order("occurred_at");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const userIds = Array.from(new Set((rows ?? []).map((r) => r.recorded_by).filter(Boolean)));
  const emailById = new Map<string, string>();
  await Promise.all(
    userIds.map(async (uid) => {
      const { data } = await ctx.admin.auth.admin.getUserById(uid);
      if (data.user?.email) emailById.set(uid, data.user.email);
    }),
  );

  return NextResponse.json({
    createdAt: trip.created_at,
    events: (rows ?? []).map(({ recorded_by, ...e }) => ({
      ...e,
      recorded_by_email: (recorded_by && emailById.get(recorded_by)) || null,
    })),
  });
}
