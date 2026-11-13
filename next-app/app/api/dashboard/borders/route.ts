import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { borderCrossings } from "@/lib/trips/timeline";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 1000;
// A crossing cleared in the period may have arrived a while before it.
const LOOKBACK_DAYS = 30;

// Border crossings (arrival paired with clearance, per trip) from `from`
// onwards, for the Overview's border waiting times. Operational, so
// every role can see it, like the Board.
export async function GET(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const from = new URL(request.url).searchParams.get("from");
  if (!from || !DATE.test(from)) {
    return NextResponse.json({ error: "from must be YYYY-MM-DD" }, { status: 400 });
  }
  const since = new Date(Date.parse(from + "T00:00:00Z") - LOOKBACK_DAYS * 86_400_000).toISOString();

  const events: { trip_id: string; event_type: string; location: string | null; occurred_at: string }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await ctx.admin
      .from("trip_events")
      .select("trip_id, event_type, location, occurred_at")
      .eq("org_id", ctx.orgId)
      .in("event_type", ["border_arrival", "border_cleared"])
      .gte("occurred_at", since)
      .order("occurred_at")
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    events.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const byTrip = new Map<string, typeof events>();
  for (const e of events) {
    byTrip.set(e.trip_id, [...(byTrip.get(e.trip_id) ?? []), e]);
  }
  const crossings = [...byTrip].flatMap(([trip_id, list]) => borderCrossings(list).map((c) => ({ trip_id, ...c })));
  return NextResponse.json({ crossings });
}
