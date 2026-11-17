import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAPITAL_CATEGORIES } from "@/lib/trucks/costs";
import { today } from "@/lib/format";
import { allRows, chunks } from "@/lib/reports/rows";
import { tripCollections, type Paid } from "@/lib/reports/collections";
import { busyDays, tripDays } from "@/lib/reports/detail";
import type { CompareCustomer, CompareMoney, CompareReport, CompareRoute, CompareTruck } from "@/lib/types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Trip = {
  trip_id: string;
  truck_id: string | null;
  route_id: string;
  route: string;
  customer_id: string;
  customer: string;
  actual_load_date: string;
  revenue_usd: number;
  cost_usd: number;
  days_running: number | null;
  actual_delivery_at: string | null;
  status: string;
  over_target: boolean | null;
};

// Every truck, route and customer side by side over an optional period:
// what each earned and cost, what's been collected, and (for trucks) km
// and days with a load. Trips count in the period they loaded, truck costs
// on the day they were incurred, and buying a truck is left out of its
// profit -- the same rules as the truck report, so a truck's row here and
// its own report agree. Read-only, visible to every role like the truck
// report (receivables already reach every role through /api/bootstrap).
export async function GET(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  const q = new URL(request.url).searchParams;
  const date = (key: string) => {
    const v = q.get(key);
    return v && DATE.test(v) ? v : null;
  };
  const from = date("from");
  const to = date("to");

  // Every trip, not just the period's: a truck's first day and the days a
  // trip loaded before the period kept it busy both reach outside it.
  const [trucksR, routesR, tripsR, costsR] = await Promise.all([
    allRows<CompareTruck["truck"] & { purchase_date: string | null }>((lo, hi) =>
      ctx.admin.from("trucks").select("id, fleet_no, horse_reg, is_active, purchase_date").eq("org_id", ctx.orgId).order("fleet_no").order("id").range(lo, hi),
    ),
    allRows<{ id: string; name: string; distance_km: number | null; target_days: number | null }>((lo, hi) =>
      ctx.admin.from("routes").select("id, name, distance_km, target_days").eq("org_id", ctx.orgId).order("id").range(lo, hi),
    ),
    allRows<Trip>((lo, hi) =>
      ctx.admin
        .from("trip_board")
        .select("trip_id, truck_id, route_id, route, customer_id, customer, actual_load_date, revenue_usd, cost_usd, days_running, actual_delivery_at, status, over_target")
        .eq("org_id", ctx.orgId)
        .not("actual_load_date", "is", null)
        .order("trip_id")
        .range(lo, hi),
    ),
    allRows<{ id: string; truck_id: string; category: string; amount_usd: number; incurred_on: string }>((lo, hi) =>
      ctx.admin.from("truck_costs").select("id, truck_id, category, amount_usd, incurred_on").eq("org_id", ctx.orgId).order("id").range(lo, hi),
    ),
  ]);
  const readError = trucksR.error ?? routesR.error ?? tripsR.error ?? costsR.error;
  if (readError) {
    return NextResponse.json({ error: readError }, { status: 400 });
  }

  const inRange = (d: string | null) => !!d && (!from || d >= from) && (!to || d <= to);
  const trips = tripsR.rows.filter((t) => inRange(t.actual_load_date));
  const tripIds = trips.map((t) => t.trip_id);

  const [emptyBatches, collections] = await Promise.all([
    Promise.all(chunks(tripIds).map((ids) =>
      allRows<{ id: string; trip_id: string }>((lo, hi) =>
        ctx.admin.from("trip_costs").select("id, trip_id").eq("org_id", ctx.orgId).eq("is_empty_return", true).in("trip_id", ids).order("id").range(lo, hi),
      ),
    )),
    tripCollections(ctx.admin, ctx.orgId, tripIds),
  ]);
  const laterError = emptyBatches.find((b) => b.error)?.error ?? collections.error;
  if (laterError) {
    return NextResponse.json({ error: laterError }, { status: 400 });
  }

  const emptyBack = new Set(emptyBatches.flatMap((b) => b.rows.map((r) => r.trip_id)));
  const routeById = new Map(routesR.rows.map((r) => [r.id, r]));
  const routeKm = (id: string) => {
    const d = routeById.get(id)?.distance_km;
    return d && d > 0 ? Number(d) : null;
  };
  const paidOf = (t: Trip): Paid => collections.byTrip.get(t.trip_id) ?? { invoiced: 0, collected: 0, overdue: 0 };
  const money = (ts: Trip[]): CompareMoney => {
    const m = { trips: ts.length, revenue: 0, tripCosts: 0, invoiced: 0, collected: 0, overdue: 0 };
    for (const t of ts) {
      const p = paidOf(t);
      m.revenue += Number(t.revenue_usd || 0);
      m.tripCosts += Number(t.cost_usd || 0);
      m.invoiced += p.invoiced;
      m.collected += p.collected;
      m.overdue += p.overdue;
    }
    return m;
  };
  const group = (key: (t: Trip) => string | null) => {
    const groups = new Map<string, Trip[]>();
    for (const t of trips) {
      const k = key(t);
      if (k) groups.set(k, [...(groups.get(k) ?? []), t]);
    }
    return groups;
  };

  const todayIso = today(ctx.timeZone);
  const byTruck = group((t) => t.truck_id);
  const trucks: CompareTruck[] = trucksR.rows
    .map((truck) => {
      const own = byTruck.get(truck.id) ?? [];
      const m = money(own);
      const owningCosts = costsR.rows
        .filter((c) => c.truck_id === truck.id && inRange(c.incurred_on) && !CAPITAL_CATEGORIES.has(c.category))
        .reduce((s, c) => s + Number(c.amount_usd || 0), 0);
      const kms = own.map((t) => {
        const d = routeKm(t.route_id);
        return d === null ? null : d * (emptyBack.has(t.trip_id) ? 2 : 1);
      });

      // Days from the truck's first day (its purchase date, or its first
      // trip or cost) to today at the latest, as in the truck report.
      const allTrips = tripsR.rows.filter((t) => t.truck_id === truck.id);
      const first = truck.purchase_date ?? [
        ...allTrips.map((t) => t.actual_load_date),
        ...costsR.rows.filter((c) => c.truck_id === truck.id).map((c) => c.incurred_on),
      ].sort()[0] ?? null;
      const lo = first && from && from > first ? from : first;
      const hi = to && to < todayIso ? to : todayIso;
      const span = lo && lo <= hi
        ? busyDays(allTrips.map((t) => ({ load: t.actual_load_date, days: tripDays(t).days })), lo, hi)
        : null;

      return {
        ...m,
        truck: { id: truck.id, fleet_no: truck.fleet_no, horse_reg: truck.horse_reg, is_active: truck.is_active },
        owningCosts,
        profit: m.revenue - m.tripCosts - owningCosts,
        km: kms.reduce<number>((s, k) => s + (k ?? 0), 0),
        kmKnown: kms.every((k) => k !== null),
        daysOnTrip: span?.busy ?? null,
        days: span?.total ?? null,
      };
    })
    .filter((r) => r.truck.is_active || r.trips > 0 || r.owningCosts > 0)
    .sort((a, b) => b.profit - a.profit);

  const routes: CompareRoute[] = [...group((t) => t.route_id)]
    .map(([id, ts]) => {
      const m = money(ts);
      const delivered = ts.map((t) => tripDays(t)).filter((d) => !d.running && d.days !== null);
      const route = routeById.get(id);
      return {
        ...m,
        id,
        name: route?.name ?? ts[0].route,
        km: routeKm(id),
        targetDays: route?.target_days ?? null,
        trucks: new Set(ts.map((t) => t.truck_id).filter(Boolean)).size,
        avgDays: delivered.length ? delivered.reduce((s, d) => s + d.days!, 0) / delivered.length : null,
        delivered: delivered.length,
        late: ts.filter((t) => t.over_target).length,
      };
    })
    .sort((a, b) => (b.revenue - b.tripCosts) - (a.revenue - a.tripCosts));

  const customers: CompareCustomer[] = [...group((t) => t.customer_id)]
    .map(([id, ts]) => ({ ...money(ts), id, name: ts[0].customer, late: ts.filter((t) => t.over_target).length }))
    .sort((a, b) => b.revenue - a.revenue);

  const body: CompareReport = {
    from,
    to,
    today: todayIso,
    trucks,
    routes,
    customers,
    tripsWithoutTruck: trips.filter((t) => !t.truck_id).length,
    paymentRatesMissing: collections.missingRates,
  };
  return NextResponse.json(body);
}
