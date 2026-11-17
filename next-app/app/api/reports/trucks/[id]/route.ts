import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAPITAL_CATEGORIES, NON_CASH_CATEGORIES } from "@/lib/trucks/costs";
import { lastMonths } from "@/lib/dashboard/trends";
import { today } from "@/lib/format";
import type { Breakeven, TripAllocation, TripCost, TripFacts, TruckTotals } from "@/lib/types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 1000;
const ID_CHUNK = 100;

type Paged<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

// Every row of a query, a page at a time: the API returns at most 1000
// rows a request, and a long-lived truck or a whole fleet can pass that.
async function allRows<T>(page: (lo: number, hi: number) => Paged<T>): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await page(offset, offset + PAGE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { rows, error: null };
  }
}

type TripMoney = { truck_id?: string | null; actual_load_date: string | null; revenue_usd: number; cost_usd: number };
type CostMoney = { truck_id?: string; category: string; amount_usd: number; incurred_on: string };

// A truck's money from its trips and its truck costs. Buying the truck
// (purchase, clearing, registration) is an investment, not a cost of the
// period, so it's left out here and tracked by the payback instead.
function totals(trips: TripMoney[], costs: CostMoney[]): TruckTotals {
  const revenue = trips.reduce((s, t) => s + Number(t.revenue_usd || 0), 0);
  const tripCosts = trips.reduce((s, t) => s + Number(t.cost_usd || 0), 0);
  const owningCosts = costs
    .filter((c) => !CAPITAL_CATEGORIES.has(c.category))
    .reduce((s, c) => s + Number(c.amount_usd || 0), 0);
  return { trips: trips.length, revenue, tripCosts, owningCosts, profit: revenue - tripCosts - owningCosts };
}

// Revenue/expense report for one truck over an optional date range.
// Trip revenue+costs are anchored on the trip's actual_load_date (a trip's
// whole P&L lands in whichever period it loaded in, rather than splitting
// its costs across periods); truck costs use their own incurred_on.
// Alongside the period's figures it returns the same truck over a
// comparison period (prevFrom/prevTo), the fleet's averages for the period,
// the last 12 months, and the truck's payback.
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
  const date = (key: string) => {
    const v = searchParams.get(key);
    return v && DATE.test(v) ? v : null;
  };
  const from = date("from");
  const to = date("to");
  const prevFrom = date("prevFrom");
  const prevTo = date("prevTo");
  const includeLedgers = searchParams.get("includeLedgers") === "1";

  // Everything below is read at once rather than one query after another:
  // each round trip to the database can cost most of a second from a
  // distant network. That's safe before the truck is confirmed as this
  // organization's, since every query is scoped to the organization too;
  // with no such truck, the rest is simply thrown away.
  //
  // The truck's trips and costs are fetched unfiltered (its whole life)
  // since the payback, the month-by-month figures and the comparison
  // period all reach outside whatever period the report itself is scoped
  // to. The period-scoped figures are derived by filtering these same rows
  // in JS rather than querying again.
  const [{ data: truck }, tripsResult, costsResult, routesResult, fleet] = await Promise.all([
    ctx.admin
      .from("trucks")
      .select("id, fleet_no, horse_reg, is_active, purchase_date, truck_type")
      .eq("id", id)
      .eq("org_id", ctx.orgId)
      .maybeSingle(),
    allRows((lo, hi) =>
      ctx.admin
        // Selected in full (not just the revenue/cost figures the summary
        // report needs) so the same row can also back a trip's printed
        // ledger -- same shape BoardTrip already uses on the Board page.
        .from("trip_board")
        .select("*")
        .eq("org_id", ctx.orgId)
        .eq("truck_id", id)
        .not("actual_load_date", "is", null)
        .order("actual_load_date", { ascending: false })
        .order("trip_id")
        .range(lo, hi),
    ),
    allRows((lo, hi) =>
      ctx.admin
        .from("truck_costs")
        .select("id, truck_id, category, description, amount, currency, fx_rate_to_usd, amount_usd, incurred_on")
        .eq("org_id", ctx.orgId)
        .eq("truck_id", id)
        .order("incurred_on", { ascending: false })
        .order("id")
        .range(lo, hi),
    ),
    // Route distances (one way), for the per-km figures.
    allRows((lo, hi) => ctx.admin.from("routes").select("id, distance_km").eq("org_id", ctx.orgId).order("id").range(lo, hi)),
    fleetAverages(ctx, id, from, to),
  ]);
  if (!truck) {
    return NextResponse.json({ error: "truck not found" }, { status: 404 });
  }
  if (tripsResult.error) {
    return NextResponse.json({ error: tripsResult.error }, { status: 400 });
  }
  if (costsResult.error) {
    return NextResponse.json({ error: costsResult.error }, { status: 400 });
  }
  const allTrips = tripsResult.rows;
  const allCosts = costsResult.rows;

  const within = (lo: string | null, hi: string | null) => (d: string | null) => !!d && (!lo || d >= lo) && (!hi || d <= hi);
  const inRange = within(from, to);
  const trips = allTrips.filter((t) => inRange(t.actual_load_date));
  const standingCosts = allCosts.filter((c) => inRange(c.incurred_on));
  const owningCosts = standingCosts.filter((c) => !CAPITAL_CATEGORIES.has(c.category));

  // trip_board's cost_usd is already an aggregate across all trip_costs for
  // a trip, so the per-category breakdown needs its own query against
  // trip_costs directly, scoped to just the trips already resolved above.
  // Asked for a hundred trips at a time, so neither the list of ids nor
  // the rows coming back outgrow a request; the batches, and each trip's
  // full ledger when the printed report asks for one, are read at once.
  const tripIds = trips.map((t) => t.trip_id);
  const idChunks: string[][] = [];
  for (let i = 0; i < tripIds.length; i += ID_CHUNK) idChunks.push(tripIds.slice(i, i + ID_CHUNK));

  const [costBatches, ledgerBatches] = await Promise.all([
    Promise.all(idChunks.map((chunk) =>
      allRows<{ trip_id: string; category: string; amount_usd: number; liters: number | null; is_empty_return: boolean }>((lo, hi) =>
        ctx.admin.from("trip_costs").select("id, trip_id, category, amount_usd, liters, is_empty_return").in("trip_id", chunk).order("id").range(lo, hi),
      ),
    )),
    // Full per-line cost detail, only fetched when the printed report is
    // asked to include each trip's ledger -- the summary never needs more
    // than the category/liters totals above.
    includeLedgers
      ? Promise.all(idChunks.map((chunk) => Promise.all([
          allRows<TripCost>((lo, hi) =>
            ctx.admin
              .from("trip_costs")
              .select("id, trip_id, category, description, amount, currency, fx_rate_to_usd, amount_usd, incurred_on, location, paid_by, receipt_ref, receipt_path, liters, price_per_liter, is_empty_return")
              .in("trip_id", chunk)
              .order("incurred_on", { ascending: true })
              .order("id")
              .range(lo, hi),
          ),
          allRows<TripAllocation>((lo, hi) =>
            ctx.admin
              .from("trip_allocations")
              .select("*")
              .eq("org_id", ctx.orgId)
              .in("trip_id", chunk)
              .order("allocated_on", { ascending: true })
              .order("id")
              .range(lo, hi),
          ),
        ])))
      : Promise.resolve(null),
  ]);
  const batchError = costBatches.find((b) => b.error)?.error ?? ledgerBatches?.flat().find((b) => b.error)?.error;
  if (batchError) {
    return NextResponse.json({ error: batchError }, { status: 400 });
  }
  if (routesResult.error) {
    return NextResponse.json({ error: routesResult.error }, { status: 400 });
  }
  const tripCostRows = costBatches.flatMap((b) => b.rows);
  const routeKm = new Map(routesResult.rows.map((r) => [r.id, r.distance_km && r.distance_km > 0 ? Number(r.distance_km) : null]));

  // Each trip's fuel and empty return, from the cost rows already fetched.
  const facts = new Map<string, TripFacts>(
    trips.map((t) => [t.trip_id, { route_km: routeKm.get(t.route_id) ?? null, fuel_usd: 0, fuel_liters: 0, fuel_no_liters_usd: 0, empty_return_usd: 0 }]),
  );
  for (const r of tripCostRows) {
    const f = facts.get(r.trip_id);
    if (!f) continue;
    const usd = Number(r.amount_usd || 0);
    if (r.is_empty_return) f.empty_return_usd += usd;
    if (r.category !== "fuel") continue;
    const liters = Number(r.liters || 0);
    f.fuel_usd += usd;
    if (liters > 0) f.fuel_liters += liters;
    else f.fuel_no_liters_usd += usd;
  }

  let tripsWithLedgers = trips;
  if (ledgerBatches) {
    const ledgerCostRows = ledgerBatches.flatMap(([costs]) => costs.rows);
    const allocationRows = ledgerBatches.flatMap(([, allocations]) => allocations.rows);
    tripsWithLedgers = trips.map((t) => ({
      ...t,
      costs: ledgerCostRows.filter((c) => c.trip_id === t.trip_id),
      allocations: allocationRows.filter((a) => a.trip_id === t.trip_id),
    }));
  }

  // Fuel's liters/avg-price-per-liter rides along on the same category
  // breakdown -- no separate query, since these rows are already fetched.
  // The average only counts entries that recorded liters: a fill-up logged
  // as a plain amount would otherwise add its dollars but none of its
  // liters, inflating the price per liter. That spend is returned
  // separately so the report can say what the average leaves out.
  const sumByCategory = (rows: { category: string; amount_usd: number; liters?: number | null }[]) => {
    const byCategory = new Map<string, { amountUsd: number; liters: number; withLitersUsd: number }>();
    for (const r of rows) {
      const cur = byCategory.get(r.category) ?? { amountUsd: 0, liters: 0, withLitersUsd: 0 };
      const usd = Number(r.amount_usd || 0);
      const liters = Number(r.liters || 0);
      cur.amountUsd += usd;
      if (liters > 0) {
        cur.liters += liters;
        cur.withLitersUsd += usd;
      }
      byCategory.set(r.category, cur);
    }
    return Array.from(byCategory, ([category, { amountUsd, liters, withLitersUsd }]) => ({
      category,
      amountUsd,
      ...(category === "fuel" && liters > 0
        ? {
            liters,
            avgPricePerLiterUsd: withLitersUsd / liters,
            withoutLitersUsd: Math.round((amountUsd - withLitersUsd) * 100) / 100,
          }
        : {}),
    })).sort((a, b) => b.amountUsd - a.amountUsd);
  };

  const period = totals(trips, standingCosts);
  const capitalExpenses = standingCosts
    .filter((c) => CAPITAL_CATEGORIES.has(c.category))
    .reduce((s, c) => s + Number(c.amount_usd || 0), 0);
  // A cut across the category breakdown above, not a category of its own
  // -- fuel, tolls, driver allowance etc. can all be incurred on either
  // leg of a trip. Surfaced separately so empty miles' real cost shows
  // up on its own, instead of being folded invisibly into whichever
  // category each entry happened to be.
  const emptyReturnExpenses = tripCostRows
    .filter((r) => r.is_empty_return)
    .reduce((s, r) => s + Number(r.amount_usd || 0), 0);

  const inPrevious = within(prevFrom, prevTo);
  const previous = prevFrom && prevTo
    ? {
        from: prevFrom,
        to: prevTo,
        ...totals(allTrips.filter((t) => inPrevious(t.actual_load_date)), allCosts.filter((c) => inPrevious(c.incurred_on))),
      }
    : null;

  // Months are the company's calendar, not UTC's.
  const todayIso = today(ctx.timeZone);
  const firstDay = truck.purchase_date || firstActivity(allTrips, allCosts);
  const monthly = lastMonths(todayIso, 12)
    .filter((m) => !!firstDay && m.key >= monthKey(firstDay))
    .map((m) => {
      const t = totals(
        allTrips.filter((x) => !!x.actual_load_date && monthKey(x.actual_load_date) === m.key),
        allCosts.filter((c) => monthKey(c.incurred_on) === m.key),
      );
      return { key: m.key, label: m.label, soFar: m.soFar, trips: t.trips, revenue: t.revenue, tripCosts: t.tripCosts, owningCosts: t.owningCosts };
    });

  return NextResponse.json({
    truck,
    from,
    to,
    trips: tripsWithLedgers.map((t) => ({ ...t, facts: facts.get(t.trip_id)! })),
    standingCosts,
    tripRevenue: period.revenue,
    tripExpenses: period.tripCosts,
    emptyReturnExpenses,
    standingExpenses: period.owningCosts,
    capitalExpenses,
    totalExpenses: period.tripCosts + period.owningCosts,
    margin: period.profit,
    tripExpensesByCategory: sumByCategory(tripCostRows),
    standingExpensesByCategory: sumByCategory(owningCosts),
    previous,
    fleet,
    monthly,
    // Every trip's time on the road, whenever it loaded: a trip loaded
    // last month can still have kept the truck busy this month.
    spans: allTrips.map((t) => ({ load: t.actual_load_date as string, ...tripDays(t) })),
    breakeven: computeBreakeven(truck.purchase_date, allTrips, allCosts, todayIso),
  });
}

type Ctx = Extract<Awaited<ReturnType<typeof getAuthedOrgContext>>, { ok: true }>;

// What the fleet's trucks averaged over the same period, and where this
// truck ranks among them by profit. A truck counts if it's active or had
// trips or costs in the period; trips with no truck assigned belong to
// none of them. Null (no comparison shown) with fewer than two trucks, or
// if the fleet's figures couldn't be read -- the report itself still
// stands without them.
async function fleetAverages(ctx: Ctx, truckId: string, from: string | null, to: string | null) {
  const [trucksResult, tripsResult, costsResult] = await Promise.all([
    ctx.admin.from("trucks").select("id, is_active").eq("org_id", ctx.orgId),
    allRows((lo, hi) => {
      let q = ctx.admin
        .from("trip_board")
        .select("trip_id, truck_id, actual_load_date, revenue_usd, cost_usd")
        .eq("org_id", ctx.orgId)
        .not("actual_load_date", "is", null)
        .not("truck_id", "is", null);
      if (from) q = q.gte("actual_load_date", from);
      if (to) q = q.lte("actual_load_date", to);
      return q.order("trip_id").range(lo, hi);
    }),
    allRows((lo, hi) => {
      let q = ctx.admin.from("truck_costs").select("id, truck_id, category, amount_usd, incurred_on").eq("org_id", ctx.orgId);
      if (from) q = q.gte("incurred_on", from);
      if (to) q = q.lte("incurred_on", to);
      return q.order("id").range(lo, hi);
    }),
  ]);
  if (trucksResult.error || tripsResult.error || costsResult.error) return null;

  const rows = (trucksResult.data ?? [])
    .map((t) => {
      const own = totals(
        tripsResult.rows.filter((x) => x.truck_id === t.id),
        costsResult.rows.filter((c) => c.truck_id === t.id),
      );
      const counted = t.is_active || own.trips > 0 || own.tripCosts > 0 || own.owningCosts > 0;
      return { id: t.id, counted, ...own };
    })
    .filter((r) => r.counted)
    .sort((a, b) => b.profit - a.profit);
  if (rows.length < 2) return null;

  const avg = (pick: (r: TruckTotals) => number) => rows.reduce((s, r) => s + pick(r), 0) / rows.length;
  const position = rows.findIndex((r) => r.id === truckId);
  return {
    trucks: rows.length,
    rank: position < 0 ? null : position + 1,
    avg: {
      revenue: avg((r) => r.revenue),
      tripCosts: avg((r) => r.tripCosts),
      owningCosts: avg((r) => r.owningCosts),
      profit: avg((r) => r.profit),
    },
  };
}

const ROLLING = ["loading", "in_transit", "at_border"];

// How long a trip had the truck, loading to delivery, in whole days on the
// company's calendar (trip_board's days_running). Still on the road: the
// days so far. No delivery time recorded otherwise (an older trip, or one
// cancelled after loading): unknown, since days_running would keep
// counting to today.
function tripDays(t: { status: string; actual_delivery_at: string | null; days_running: number | null }) {
  const running = ROLLING.includes(t.status);
  const known = t.days_running !== null && (!!t.actual_delivery_at || running);
  return { days: known ? Number(t.days_running) : null, running };
}

const monthKey = (d: string) => d.slice(0, 7); // "YYYY-MM"

function nextMonth(y: number, m: number): [number, number] {
  return m === 12 ? [y + 1, 1] : [y, m + 1];
}

function firstActivity(allTrips: TripMoney[], allCosts: CostMoney[]) {
  return [
    ...allTrips.map((t) => t.actual_load_date).filter((d): d is string => !!d),
    ...allCosts.map((c) => c.incurred_on),
  ].sort()[0] ?? null;
}

// Payback: the truck's whole-life cashflow, starting at
// -(purchase + clearing + registration costs) on its purchase date, walked
// forward one calendar month at a time adding that month's trip revenue
// less trip costs less what it cost to own (maintenance, insurance, etc.).
// Only money that actually moved counts: the purchase costs are the
// investment itself, and depreciation is a book entry spreading that same
// purchase, so counting either again would double it. The first month the
// running total crosses zero is the payback point; if it hasn't happened
// yet, the average of the last six full months is projected forward -- a
// straight line, not a forecast model, but enough for an "at this rate"
// estimate. The month in progress is left out of that average: a part
// month would drag it down.
function computeBreakeven(
  purchaseDate: string | null,
  allTrips: TripMoney[],
  allCosts: CostMoney[],
  todayIso: string,
): Breakeven {
  const investment = allCosts
    .filter((c) => CAPITAL_CATEGORIES.has(c.category))
    .reduce((s, c) => s + Number(c.amount_usd || 0), 0);
  const operatingCosts = allCosts.filter((c) => !CAPITAL_CATEGORIES.has(c.category) && !NON_CASH_CATEGORIES.has(c.category));

  const startDate = purchaseDate || firstActivity(allTrips, allCosts);
  if (!startDate) {
    return { investment, startDate: null, months: [], recovered: 0, status: "no_data" };
  }

  const nowMonth = monthKey(todayIso);
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

  const base = { investment, startDate, months: rows, recovered: cumulative + investment };

  // Nothing to pay back until what the truck cost to buy has been logged.
  if (investment <= 0) return { ...base, status: "no_investment" };
  if (reachedOn) return { ...base, status: "reached", reachedOn };

  const recent = rows.filter((r) => r.month < nowMonth).slice(-6);
  if (!recent.length) return { ...base, status: "too_early" };
  const avgMonthlyNet = recent.reduce((s, r) => s + r.net, 0) / recent.length;

  if (avgMonthlyNet <= 0) {
    return { ...base, status: "not_on_track", avgMonthlyNet, basisMonths: recent.length };
  }

  const monthsToGo = Math.ceil(-cumulative / avgMonthlyNet);
  let [py, pm] = nowMonth.split("-").map(Number);
  for (let i = 0; i < monthsToGo; i++) [py, pm] = nextMonth(py, pm);
  const projectedOn = `${py}-${String(pm).padStart(2, "0")}`;

  return { ...base, status: "projected", projectedOn, avgMonthlyNet, basisMonths: recent.length, monthsToGo };
}
