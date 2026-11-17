import type { TruckReport, TruckReportTrip } from "@/lib/types";

// The truck report's detail: each trip as a row with what to look at,
// the period's figures per trip, per km and per day, and the checks that
// say when those figures can't be relied on yet. Pure functions over the
// report, so they can be checked on their own.

const ROLLING = ["loading", "in_transit", "at_border"];
const DAY_MS = 86_400_000;
const dayNo = (iso: string) => Math.round(Date.parse(iso.slice(0, 10) + "T00:00:00Z") / DAY_MS);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

// How long a trip had the truck, loading to delivery, in whole days on the
// company's calendar (trip_board's days_running). Still on the road: the
// days so far. No delivery time recorded otherwise (an older trip): null,
// since days_running would keep counting to today.
export function tripDays(t: { status: string; actual_delivery_at: string | null; days_running: number | null }) {
  const running = ROLLING.includes(t.status);
  const known = t.days_running !== null && (!!t.actual_delivery_at || running);
  return { days: known ? Number(t.days_running) : null, running };
}

// How many days from `from` to `to` (both included) a truck had a load on:
// each trip from the day it loaded to the day it was delivered (to today if
// still running; just the day it loaded if unknown), a day with two trips
// on it counted once.
export function busyDays(spans: { load: string | null; days: number | null }[], from: string, to: string) {
  const lo = dayNo(from);
  const hi = dayNo(to);
  const busy = new Set<number>();
  for (const s of spans) {
    if (!s.load) continue;
    const first = dayNo(s.load);
    const last = s.days === null ? first : first + s.days;
    for (let d = Math.max(first, lo); d <= Math.min(last, hi); d++) busy.add(d);
  }
  return { busy: busy.size, total: hi - lo + 1 };
}

// Where a trip stands with its customer's money: paid in full, overdue,
// invoiced and not yet due, or not (fully) invoiced yet.
export type PayState = "paid" | "overdue" | "part_paid" | "invoiced" | "part_invoiced" | "not_invoiced" | "none";

export function payState(t: TruckReportTrip): PayState {
  const revenue = Number(t.revenue_usd || 0);
  const f = t.facts;
  if (revenue <= 0) return "none";
  if (f.collected_usd >= revenue - 0.5) return "paid";
  if (f.overdue_usd >= 0.5) return "overdue";
  if (f.invoiced_usd < 0.5) return "not_invoiced";
  if (f.invoiced_usd < revenue - 0.5) return "part_invoiced";
  return f.collected_usd >= 0.5 ? "part_paid" : "invoiced";
}

// What a truck's trips earned in the period, split by where the money is:
// collected, overdue, invoiced but not due yet, and not invoiced yet.
export function collectionFigures(r: TruckReport) {
  const pos = (n: number) => Math.max(0, n);
  const revenue = sum(r.trips.map((t) => Number(t.revenue_usd || 0)));
  const invoiced = sum(r.trips.map((t) => t.facts.invoiced_usd));
  const collected = sum(r.trips.map((t) => t.facts.collected_usd));
  const overdue = sum(r.trips.map((t) => t.facts.overdue_usd));
  return {
    revenue,
    invoiced,
    collected,
    overdue,
    notDue: sum(r.trips.map((t) => pos(t.facts.invoiced_usd - t.facts.collected_usd - t.facts.overdue_usd))),
    notInvoiced: sum(r.trips.map((t) => pos(Number(t.revenue_usd || 0) - t.facts.invoiced_usd))),
    // Not invoiced, on trips already delivered: money that could be asked for now.
    notInvoicedDelivered: sum(r.trips.filter((t) => !ROLLING.includes(t.status)).map((t) => pos(Number(t.revenue_usd || 0) - t.facts.invoiced_usd))),
  };
}

// What a trip row is marked with, worst first.
// (Cancelled trips never reach the report: trip_board leaves them out.)
export type Flag = "loss" | "no_costs" | "no_revenue" | "late" | "no_litres" | "running";

export type TripRow = {
  trip: TruckReportTrip;
  // Still on the road.
  running: boolean;
  // Loading to delivery in whole days (so far, if running); null when no
  // delivery time was recorded.
  days: number | null;
  // Kilometres counted for the per-km figures: the route one way, plus the
  // way back when the trip logged costs for an empty return. Null when its
  // route has no distance set.
  km: number | null;
  marginPct: number | null;
  flags: Flag[];
};

export function tripRows(r: TruckReport): TripRow[] {
  return r.trips.map((trip) => {
    const { days, running } = tripDays(trip);
    const f = trip.facts;
    const km = f.route_km ? f.route_km * (f.empty_return_usd > 0 ? 2 : 1) : null;
    const revenue = Number(trip.revenue_usd || 0);
    const margin = Number(trip.margin_usd || 0);
    const flags: Flag[] = [];
    if (margin <= -0.5) flags.push("loss");
    if (Number(trip.cost_entries || 0) === 0) flags.push("no_costs");
    if (revenue <= 0) flags.push("no_revenue");
    if (trip.over_target) flags.push("late");
    if (f.fuel_no_liters_usd > 0) flags.push("no_litres");
    if (running) flags.push("running");
    return { trip, running, days, km, marginPct: revenue > 0 ? (margin / revenue) * 100 : null, flags };
  });
}

export type Units = {
  // The average trip. `profit` also carries its share of owning costs.
  perTrip: { trips: number; revenue: number; tripCosts: number; left: number; profit: number } | null;
  perKm: {
    km: number;
    // Of those, km driven back empty.
    returnKm: number;
    revenue: number;
    tripCosts: number;
    // Owning costs too, and the profit left: only when every trip's
    // distance is known, so the owning costs aren't spread over too few km.
    allCosts: number | null;
    profit: number | null;
    // Trips left out: their route has no distance.
    leftOut: number;
  } | null;
  fuel: {
    kmPerLitre: number;
    litresPer100: number;
    costPerKm: number;
    // Trips counted: distance known and litres logged for all their fuel.
    trips: number;
    // Trips with a distance but left out: fuel without litres, or none logged.
    leftOut: number;
  } | null;
  days: {
    from: string;
    to: string;
    total: number;
    onTrip: number;
    share: number;
    profitPerDay: number;
    // The average delivered trip, loading to delivery.
    avgTripDays: number | null;
    delivered: number;
    late: number;
  } | null;
};

// `todayIso` is today on the company's calendar.
export function unitFigures(r: TruckReport, todayIso: string): Units {
  const rows = tripRows(r);
  const n = rows.length;
  const revenueOf = (xs: TripRow[]) => sum(xs.map((x) => Number(x.trip.revenue_usd || 0)));
  const costsOf = (xs: TripRow[]) => sum(xs.map((x) => Number(x.trip.cost_usd || 0)));

  const perTrip = n
    ? {
        trips: n,
        revenue: revenueOf(rows) / n,
        tripCosts: costsOf(rows) / n,
        left: (revenueOf(rows) - costsOf(rows)) / n,
        profit: (revenueOf(rows) - costsOf(rows) - r.standingExpenses) / n,
      }
    : null;

  const measured = rows.filter((x) => x.km !== null);
  const km = sum(measured.map((x) => x.km!));
  const everyTrip = measured.length === n;
  const perKm = km > 0
    ? {
        km,
        returnKm: sum(measured.filter((x) => x.trip.facts.empty_return_usd > 0).map((x) => x.trip.facts.route_km!)),
        revenue: revenueOf(measured) / km,
        tripCosts: costsOf(measured) / km,
        allCosts: everyTrip ? (costsOf(measured) + r.standingExpenses) / km : null,
        profit: everyTrip ? (revenueOf(measured) - costsOf(measured) - r.standingExpenses) / km : null,
        leftOut: n - measured.length,
      }
    : null;

  // Only trips whose every fuel entry has its litres: one fill-up logged
  // as a plain amount would add kilometres with no litres against them.
  const fuelled = measured.filter((x) => x.trip.facts.fuel_liters > 0 && x.trip.facts.fuel_no_liters_usd === 0);
  const fuelKm = sum(fuelled.map((x) => x.km!));
  const litres = sum(fuelled.map((x) => x.trip.facts.fuel_liters));
  const fuel = fuelKm > 0 && litres > 0
    ? {
        kmPerLitre: fuelKm / litres,
        litresPer100: (litres / fuelKm) * 100,
        costPerKm: sum(fuelled.map((x) => x.trip.facts.fuel_usd)) / fuelKm,
        trips: fuelled.length,
        leftOut: measured.length - fuelled.length,
      }
    : null;

  return { perTrip, perKm, fuel, days: dayFigures(r, rows, todayIso) };
}

// The period's days, and how many of them the truck had a load on. A day
// counts from the day a trip loaded to the day it was delivered, both
// included, and a day with two trips on it counts once. The period starts
// no earlier than the truck's first day (its purchase date, or its first
// trip or cost) and ends no later than today.
function dayFigures(r: TruckReport, rows: TripRow[], todayIso: string): Units["days"] {
  const start = r.breakeven.startDate;
  if (!start) return null;
  const from = r.from && r.from > start ? r.from : start;
  const to = r.to && r.to < todayIso ? r.to : todayIso;
  if (from > to) return null;
  const { busy, total } = busyDays(r.spans, from, to);
  const done = rows.filter((x) => !x.running && x.days !== null);
  return {
    from,
    to,
    total,
    onTrip: busy,
    share: busy / total,
    profitPerDay: r.margin / total,
    avgTripDays: done.length ? sum(done.map((x) => x.days!)) / done.length : null,
    delivered: done.length,
    late: rows.filter((x) => x.flags.includes("late")).length,
  };
}

export type Check = { key: string; tone: "warn" | "info"; text: string; trips: TruckReportTrip[] };

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

// What to put right before relying on the report, worst first.
export function dataChecks(r: TruckReport): Check[] {
  const rows = tripRows(r);
  const having = (flag: Flag) => rows.filter((x) => x.flags.includes(flag)).map((x) => x.trip);
  const noDistance = rows.filter((x) => x.km === null).map((x) => x.trip);
  const checks: Check[] = [];
  const noCosts = having("no_costs");
  if (noCosts.length) {
    checks.push({
      key: "no_costs",
      tone: "warn",
      text: `${count(noCosts.length, "trip has", "trips have")} no costs logged, so ${noCosts.length === 1 ? "its" : "their"} profit looks higher than it is.`,
      trips: noCosts,
    });
  }
  const noRevenue = having("no_revenue");
  if (noRevenue.length) {
    checks.push({
      key: "no_revenue",
      tone: "warn",
      text: `${count(noRevenue.length, "trip has", "trips have")} no revenue entered, so ${noRevenue.length === 1 ? "it shows" : "they show"} as a loss.`,
      trips: noRevenue,
    });
  }
  const noLitres = having("no_litres");
  if (noLitres.length) {
    checks.push({
      key: "no_litres",
      tone: "info",
      text: `Fuel on ${count(noLitres.length, "trip", "trips")} was logged without litres, so km per litre leaves ${noLitres.length === 1 ? "it" : "them"} out.`,
      trips: noLitres,
    });
  }
  if (noDistance.length) {
    checks.push({
      key: "no_distance",
      tone: "info",
      text: `${count(noDistance.length, "trip runs", "trips run")} on a route with no distance set, so the per-km figures leave ${noDistance.length === 1 ? "it" : "them"} out. Set it under Admin → Routes.`,
      trips: noDistance,
    });
  }
  const running = having("running");
  if (running.length) {
    checks.push({
      key: "running",
      tone: "info",
      text: `${count(running.length, "trip is", "trips are")} still on the road, so more costs may come in.`,
      trips: running,
    });
  }
  return checks;
}
