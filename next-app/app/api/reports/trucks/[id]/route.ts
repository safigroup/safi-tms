import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";

const CAPITAL_CATEGORIES = new Set(["purchase", "clearing", "registration"]);

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
    .select("id, fleet_no, horse_reg, is_active, purchase_date")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!truck) {
    return NextResponse.json({ error: "truck not found" }, { status: 404 });
  }

  // Fetched unfiltered (the truck's whole life) since the breakeven
  // projection below is inherently an all-time metric, independent of
  // whatever period the report itself is scoped to. The period-scoped
  // figures used for display are derived by filtering these same rows in
  // JS rather than querying twice.
  const [{ data: allTrips, error: tripsError }, { data: allCosts, error: costsError }] = await Promise.all([
    ctx.admin
      .from("trip_board")
      .select("trip_id, trip_no, actual_load_date, revenue_usd, cost_usd, margin_usd")
      .eq("org_id", ctx.orgId)
      .eq("truck_id", id)
      .not("actual_load_date", "is", null)
      .order("actual_load_date", { ascending: false }),
    ctx.admin
      .from("truck_costs")
      .select("id, truck_id, category, description, amount, currency, fx_rate_to_usd, amount_usd, incurred_on")
      .eq("org_id", ctx.orgId)
      .eq("truck_id", id)
      .order("incurred_on", { ascending: false }),
  ]);
  if (tripsError) {
    return NextResponse.json({ error: tripsError.message }, { status: 400 });
  }
  if (costsError) {
    return NextResponse.json({ error: costsError.message }, { status: 400 });
  }

  const inRange = (d: string | null) => !!d && (!from || d >= from) && (!to || d <= to);
  const trips = (allTrips ?? []).filter((t) => inRange(t.actual_load_date));
  const standingCosts = (allCosts ?? []).filter((c) => inRange(c.incurred_on));

  // trip_board's cost_usd is already an aggregate across all trip_costs for
  // a trip, so the per-category P/L breakdown needs its own query against
  // trip_costs directly, scoped to just the trips already resolved above.
  const tripIds = trips.map((t) => t.trip_id);
  const { data: tripCostRows, error: tripCostRowsError } = tripIds.length
    ? await ctx.admin.from("trip_costs").select("category, amount_usd, liters").in("trip_id", tripIds)
    : { data: [] as { category: string; amount_usd: number; liters: number | null }[], error: null };
  if (tripCostRowsError) {
    return NextResponse.json({ error: tripCostRowsError.message }, { status: 400 });
  }

  // Fuel's liters/avg-price-per-liter rides along on the same category
  // breakdown -- no separate query, since these rows are already fetched.
  const sumByCategory = (rows: { category: string; amount_usd: number; liters?: number | null }[]) => {
    const totals = new Map<string, { amountUsd: number; liters: number }>();
    for (const r of rows) {
      const cur = totals.get(r.category) ?? { amountUsd: 0, liters: 0 };
      cur.amountUsd += Number(r.amount_usd || 0);
      cur.liters += Number(r.liters || 0);
      totals.set(r.category, cur);
    }
    return Array.from(totals, ([category, { amountUsd, liters }]) => ({
      category,
      amountUsd,
      ...(category === "fuel" && liters > 0 ? { liters, avgPricePerLiterUsd: amountUsd / liters } : {}),
    })).sort((a, b) => b.amountUsd - a.amountUsd);
  };

  const tripRevenue = trips.reduce((s, t) => s + Number(t.revenue_usd || 0), 0);
  const tripExpenses = trips.reduce((s, t) => s + Number(t.cost_usd || 0), 0);
  const standingExpenses = standingCosts.reduce((s, c) => s + Number(c.amount_usd || 0), 0);
  const totalExpenses = tripExpenses + standingExpenses;

  return NextResponse.json({
    truck,
    from: from || null,
    to: to || null,
    trips,
    standingCosts,
    tripRevenue,
    tripExpenses,
    standingExpenses,
    totalExpenses,
    margin: tripRevenue - totalExpenses,
    tripExpensesByCategory: sumByCategory(tripCostRows ?? []),
    standingExpensesByCategory: sumByCategory(standingCosts),
    breakeven: computeBreakeven(truck.purchase_date, allTrips ?? [], allCosts ?? []),
  });
}

const monthKey = (d: string) => d.slice(0, 7); // "YYYY-MM"

function nextMonth(y: number, m: number): [number, number] {
  return m === 12 ? [y + 1, 1] : [y, m + 1];
}

// Asset breakeven: the truck's whole-life cashflow, starting at
// -(purchase + clearing + registration costs) on its purchase date, walked
// forward one calendar month at a time adding that month's trip revenue
// less trip costs less ongoing standing costs (maintenance, insurance,
// etc. -- everything except the capital categories, which would otherwise
// be double-counted). The first month cumulative crosses zero is the
// breakeven point; if it hasn't happened yet, the trailing 6-month average
// net is projected forward -- a naive linear extrapolation, not a
// forecast model, but enough for an "at this rate" estimate.
function computeBreakeven(
  purchaseDate: string | null,
  allTrips: { actual_load_date: string | null; revenue_usd: number; cost_usd: number }[],
  allCosts: { category: string; amount_usd: number; incurred_on: string }[],
) {
  const investment = allCosts
    .filter((c) => CAPITAL_CATEGORIES.has(c.category))
    .reduce((s, c) => s + Number(c.amount_usd || 0), 0);
  const operatingCosts = allCosts.filter((c) => !CAPITAL_CATEGORIES.has(c.category));

  const activityDates = [
    ...allTrips.map((t) => t.actual_load_date).filter((d): d is string => !!d),
    ...allCosts.map((c) => c.incurred_on),
  ].sort();
  const startDate = purchaseDate || activityDates[0] || null;

  if (!startDate) {
    return { investment, startDate: null, months: [], status: "no_data" as const };
  }

  const nowMonth = monthKey(new Date().toISOString());
  const months: string[] = [];
  let [y, m] = monthKey(startDate).split("-").map(Number);
  const [endY, endM] = nowMonth.split("-").map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    [y, m] = nextMonth(y, m);
  }

  const revenueByMonth = new Map<string, number>();
  const tripCostByMonth = new Map<string, number>();
  const opCostByMonth = new Map<string, number>();
  for (const t of allTrips) {
    if (!t.actual_load_date) continue;
    const k = monthKey(t.actual_load_date);
    revenueByMonth.set(k, (revenueByMonth.get(k) ?? 0) + Number(t.revenue_usd || 0));
    tripCostByMonth.set(k, (tripCostByMonth.get(k) ?? 0) + Number(t.cost_usd || 0));
  }
  for (const c of operatingCosts) {
    const k = monthKey(c.incurred_on);
    opCostByMonth.set(k, (opCostByMonth.get(k) ?? 0) + Number(c.amount_usd || 0));
  }

  let cumulative = -investment;
  let reachedOn: string | null = null;
  const rows = months.map((k) => {
    const revenue = revenueByMonth.get(k) ?? 0;
    const tripCosts = tripCostByMonth.get(k) ?? 0;
    const operating = opCostByMonth.get(k) ?? 0;
    const net = revenue - tripCosts - operating;
    const opening = cumulative;
    cumulative += net;
    if (reachedOn === null && opening < 0 && cumulative >= 0) {
      reachedOn = k;
    }
    return { month: k, revenue, tripCosts, operatingCosts: operating, net, cumulative };
  });

  if (reachedOn) {
    return { investment, startDate, months: rows, status: "reached" as const, reachedOn };
  }

  const trailing = rows.slice(-6);
  const avgMonthlyNet = trailing.length ? trailing.reduce((s, r) => s + r.net, 0) / trailing.length : 0;

  if (avgMonthlyNet <= 0) {
    return { investment, startDate, months: rows, status: "not_on_track" as const, avgMonthlyNet };
  }

  const remaining = -cumulative;
  const monthsNeeded = Math.ceil(remaining / avgMonthlyNet);
  let [py, pm] = nowMonth.split("-").map(Number);
  for (let i = 0; i < monthsNeeded; i++) [py, pm] = nextMonth(py, pm);
  const projectedOn = `${py}-${String(pm).padStart(2, "0")}`;

  return { investment, startDate, months: rows, status: "projected" as const, projectedOn, avgMonthlyNet };
}
