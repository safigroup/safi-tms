import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";

// Revenue/expense report for one truck over an optional date range.
// Trip revenue+costs are anchored on the trip's actual_load_date (a trip's
// whole P&L lands in whichever period it loaded in, rather than splitting
// its costs across periods); standing costs use their own incurred_on.
// Read-only -- no role gate beyond normal auth, matching the rest of the
// app's precedent that financial figures are visible to every role.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const { data: truck } = await ctx.admin
    .from("trucks")
    .select("id, fleet_no, horse_reg, is_active")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!truck) {
    return NextResponse.json({ error: "truck not found" }, { status: 404 });
  }

  let tripQuery = ctx.admin
    .from("trip_board")
    .select("trip_id, trip_no, actual_load_date, revenue_usd, cost_usd, margin_usd")
    .eq("org_id", ctx.orgId)
    .eq("truck_id", id)
    .not("actual_load_date", "is", null)
    .order("actual_load_date", { ascending: false });
  if (from) tripQuery = tripQuery.gte("actual_load_date", from);
  if (to) tripQuery = tripQuery.lte("actual_load_date", to);

  let costQuery = ctx.admin
    .from("truck_costs")
    .select("id, truck_id, category, description, amount, currency, fx_rate_to_usd, amount_usd, incurred_on")
    .eq("org_id", ctx.orgId)
    .eq("truck_id", id)
    .order("incurred_on", { ascending: false });
  if (from) costQuery = costQuery.gte("incurred_on", from);
  if (to) costQuery = costQuery.lte("incurred_on", to);

  const [{ data: trips, error: tripsError }, { data: standingCosts, error: costsError }] =
    await Promise.all([tripQuery, costQuery]);

  if (tripsError) {
    return NextResponse.json({ error: tripsError.message }, { status: 400 });
  }
  if (costsError) {
    return NextResponse.json({ error: costsError.message }, { status: 400 });
  }

  // trip_board's cost_usd is already an aggregate across all trip_costs for
  // a trip, so the per-category P/L breakdown needs its own query against
  // trip_costs directly, scoped to just the trips already resolved above.
  const tripIds = (trips ?? []).map((t) => t.trip_id);
  const { data: tripCostRows, error: tripCostRowsError } = tripIds.length
    ? await ctx.admin.from("trip_costs").select("category, amount_usd").in("trip_id", tripIds)
    : { data: [] as { category: string; amount_usd: number }[], error: null };
  if (tripCostRowsError) {
    return NextResponse.json({ error: tripCostRowsError.message }, { status: 400 });
  }

  const sumByCategory = (rows: { category: string; amount_usd: number }[]) => {
    const totals = new Map<string, number>();
    for (const r of rows) {
      totals.set(r.category, (totals.get(r.category) ?? 0) + Number(r.amount_usd || 0));
    }
    return Array.from(totals, ([category, amountUsd]) => ({ category, amountUsd }))
      .sort((a, b) => b.amountUsd - a.amountUsd);
  };

  const tripRevenue = (trips ?? []).reduce((s, t) => s + Number(t.revenue_usd || 0), 0);
  const tripExpenses = (trips ?? []).reduce((s, t) => s + Number(t.cost_usd || 0), 0);
  const standingExpenses = (standingCosts ?? []).reduce((s, c) => s + Number(c.amount_usd || 0), 0);
  const totalExpenses = tripExpenses + standingExpenses;

  return NextResponse.json({
    truck,
    from: from || null,
    to: to || null,
    trips: trips ?? [],
    standingCosts: standingCosts ?? [],
    tripRevenue,
    tripExpenses,
    standingExpenses,
    totalExpenses,
    margin: tripRevenue - totalExpenses,
    tripExpensesByCategory: sumByCategory(tripCostRows ?? []),
    standingExpensesByCategory: sumByCategory(standingCosts ?? []),
  });
}
