import { placeName, type BorderCrossing } from "@/lib/trips/timeline";
import type { BoardTrip, Truck } from "@/lib/types";
import { tripMoney } from "./summary";

// The Overview's trends: how the business has moved month by month, which
// routes and trucks earn, and where trucks wait. Pure functions over data
// the page already has, plus border crossings and running costs from
// /api/dashboard/*.

export const SPANS = [3, 6, 12] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export type Month = { key: string; label: string; from: string; to: string; soFar: boolean };

// The last n calendar months, oldest first, ending with this month so far.
export function lastMonths(todayIso: string, n: number): Month[] {
  const [y, m, d] = todayIso.split("-").map(Number);
  const months: Month[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const first = new Date(Date.UTC(y, m - 1 - i, 1));
    const yy = first.getUTCFullYear();
    const mm = first.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const key = `${yy}-${pad(mm)}`;
    months.push({
      key,
      label: MONTHS[mm - 1] + (yy !== y ? ` ’${String(yy).slice(2)}` : ""),
      from: `${key}-01`,
      to: i === 0 ? todayIso : `${key}-${pad(lastDay)}`,
      soFar: i === 0 && d < lastDay,
    });
  }
  return months;
}

export function spanLabel(months: Month[]) {
  const first = months[0];
  const last = months[months.length - 1];
  const year = (m: Month) => m.key.slice(0, 4);
  const name = (m: Month) => MONTHS[Number(m.key.slice(5)) - 1];
  return `${name(first)}${year(first) !== year(last) ? " " + year(first) : ""} – ${name(last)} ${year(last)}${last.soFar ? " (to date)" : ""}`;
}

// Revenue and costs land in the month a trip loaded, like the KPIs above
// and the truck reports.
export function monthlyMoney(board: BoardTrip[], months: Month[]) {
  return months.map((m) => ({ ...m, ...tripMoney(board, { from: m.from, to: m.to, label: m.label }) }));
}

const loadedIn = (t: BoardTrip, from: string, to: string) =>
  !!t.actual_load_date && t.actual_load_date >= from && t.actual_load_date <= to;

export function marginByRoute(board: BoardTrip[], from: string, to: string) {
  const byRoute = new Map<string, { route_id: string; route: string; trips: number; revenue: number; costs: number }>();
  for (const t of board.filter((x) => loadedIn(x, from, to))) {
    const r = byRoute.get(t.route_id) ?? { route_id: t.route_id, route: t.route, trips: 0, revenue: 0, costs: 0 };
    r.trips += 1;
    r.revenue += Number(t.revenue_usd || 0);
    r.costs += Number(t.cost_usd || 0);
    byRoute.set(t.route_id, r);
  }
  return [...byRoute.values()]
    .map((r) => ({
      ...r,
      margin: r.revenue - r.costs,
      marginPct: r.revenue > 0 ? ((r.revenue - r.costs) / r.revenue) * 100 : null,
      perTrip: (r.revenue - r.costs) / r.trips,
    }))
    .sort((a, b) => b.margin - a.margin);
}

// Each truck's trip margin less what it cost to keep running (maintenance,
// insurance, tyres...) over the same months. Purchase costs are left to
// the truck report's breakeven.
export function profitByTruck(board: BoardTrip[], trucks: Truck[], runningCosts: Record<string, number>, from: string, to: string) {
  const trips = board.filter((t) => loadedIn(t, from, to));
  const rows = trucks
    .map((truck) => {
      const own = trips.filter((t) => t.truck_id === truck.id);
      const revenue = own.reduce((s, t) => s + Number(t.revenue_usd || 0), 0);
      const tripCosts = own.reduce((s, t) => s + Number(t.cost_usd || 0), 0);
      const running = runningCosts[truck.id] ?? 0;
      return { truck, trips: own.length, revenue, tripMargin: revenue - tripCosts, running, profit: revenue - tripCosts - running };
    })
    .filter((r) => r.truck.is_active || r.trips > 0 || r.running > 0)
    .sort((a, b) => b.profit - a.profit);
  return { rows, tripsWithoutTruck: trips.filter((t) => !t.truck_id).length };
}

const ON_ROAD = ["loading", "in_transit", "at_border"];
const BOOKED = ["draft", "allocated"];

// Where each active truck is right now, and how long the free ones have
// been free (since their last delivery).
export function truckUse(board: BoardTrip[], trucks: Truck[], now: number) {
  const active = trucks.filter((t) => t.is_active);
  const onTrip = active.filter((tr) => board.some((t) => t.truck_id === tr.id && ON_ROAD.includes(t.status)));
  const booked = active.filter(
    (tr) => !onTrip.includes(tr) && board.some((t) => t.truck_id === tr.id && BOOKED.includes(t.status)),
  );
  const free = active
    .filter((tr) => !onTrip.includes(tr) && !booked.includes(tr))
    .map((truck) => {
      const last = board
        .filter((t) => t.truck_id === truck.id && t.actual_delivery_at)
        .sort((a, b) => b.actual_delivery_at!.localeCompare(a.actual_delivery_at!))[0];
      return {
        truck,
        lastTrip: last?.trip_no ?? null,
        since: last?.actual_delivery_at ?? null,
        days: last ? Math.max(0, Math.floor((now - new Date(last.actual_delivery_at!).getTime()) / DAY_MS)) : null,
      };
    })
    // Never used first, then longest free.
    .sort((a, b) => (a.days === null ? -1 : b.days === null ? 1 : b.days - a.days));
  return { active: active.length, onTrip, booked, free };
}

export type TripCrossing = BorderCrossing & { trip_id: string };

// Waits at each border for crossings cleared in the period, and the
// trucks waiting there now.
export function borderWaits(crossings: TripCrossing[], board: BoardTrip[], from: string, to: string, now: number) {
  const atBorder = new Set(board.filter((t) => t.status === "at_border").map((t) => t.trip_id));
  const byBorder = new Map<string, { border: string; waits: number[]; waitingNow: number[] }>();
  const entry = (location: string | null) => {
    const name = placeName(location);
    const key = name.toLowerCase();
    if (!byBorder.has(key)) byBorder.set(key, { border: name, waits: [], waitingNow: [] });
    return byBorder.get(key)!;
  };

  // Only a trip's latest open arrival counts as waiting now.
  const latestOpen = new Map<string, TripCrossing>();
  for (const c of crossings) {
    if (c.arrivedAt && c.clearedAt) {
      const day = c.clearedAt.slice(0, 10);
      if (day >= from && day <= to) {
        entry(c.location).waits.push((new Date(c.clearedAt).getTime() - new Date(c.arrivedAt).getTime()) / HOUR_MS);
      }
    } else if (c.arrivedAt && atBorder.has(c.trip_id)) {
      const prev = latestOpen.get(c.trip_id);
      if (!prev || prev.arrivedAt! < c.arrivedAt) latestOpen.set(c.trip_id, c);
    }
  }
  for (const c of latestOpen.values()) {
    entry(c.location).waitingNow.push((now - new Date(c.arrivedAt!).getTime()) / HOUR_MS);
  }

  return [...byBorder.values()]
    .map((b) => ({
      border: b.border,
      crossings: b.waits.length,
      avgHours: b.waits.length ? b.waits.reduce((s, h) => s + h, 0) / b.waits.length : null,
      longestHours: b.waits.length ? Math.max(...b.waits) : null,
      waitingNow: b.waitingNow.length,
      longestNowHours: b.waitingNow.length ? Math.max(...b.waitingNow) : null,
    }))
    .sort((a, b) => (b.avgHours ?? -1) - (a.avgHours ?? -1));
}

// A round axis maximum at or above the largest value: 1, 2, 2.5 or 5 times
// a power of ten.
export function niceMax(value: number) {
  if (value <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 2.5, 5, 10].find((s) => s * mag >= value) ?? 10) * mag;
}

// Axis and bar labels: 980, 12.5k, 1.2M.
export function short(n: number) {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "")}k`;
  return `${sign}${Math.round(a)}`;
}
