import { m0, m2 } from "@/lib/format";
import type { CompareMoney, CompareReport, CompareTruck } from "@/lib/types";
import type { Line } from "./summary";

// The fleet, routes and customers in plain words: a few sentences each,
// worked out by fixed rules from the comparison's own figures, so every
// sentence can be traced to a number in the table below it.

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pct = (part: number, whole: number) => Math.round((part / whole) * 100);
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

// "A", "A and B", "A, B and C", "A, B, C and 2 others".
function names(xs: string[], max = 3) {
  if (xs.length <= max) return xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "";
  return `${xs.slice(0, max).join(", ")} and ${plural(xs.length - max, "other")}`;
}

// What the period earned, against what's been collected of it.
function collectedLine(rows: CompareMoney[]): Line | null {
  const revenue = sum(rows, (r) => r.revenue);
  if (revenue <= 0) return null;
  const collected = sum(rows, (r) => r.collected);
  const overdue = sum(rows, (r) => r.overdue);
  const notInvoiced = sum(rows, (r) => Math.max(0, r.revenue - r.invoiced));
  if (collected >= revenue - 0.5) {
    return { key: "collected", tone: "pos", lead: "All of it has been collected.", text: `Every dollar of the ${m0(revenue)} earned has been paid.` };
  }
  const so = `${pct(collected, revenue)}% of the ${m0(revenue)} earned has been collected so far.`;
  if (overdue >= 0.5) {
    return { key: "collected", tone: "bad", lead: `${m0(overdue)} is overdue.`, text: so + (notInvoiced >= 0.5 ? ` Another ${m0(notInvoiced)} hasn't been invoiced yet.` : "") };
  }
  if (notInvoiced >= 0.5) {
    return { key: "collected", tone: "info", lead: `${m0(notInvoiced)} earned hasn't been invoiced yet.`, text: so };
  }
  return { key: "collected", tone: "info", lead: `${pct(collected, revenue)}% collected so far.`, text: "The rest is invoiced and not due yet." };
}

export function truckWords(c: CompareReport): Line[] {
  const rows = c.trucks;
  if (!rows.length) return [{ key: "none", tone: "info", lead: "No trucks to compare yet.", text: "Add trucks under Admin → Fleet." }];
  const lines: Line[] = [];
  const revenue = sum(rows, (r) => r.revenue);
  const costs = sum(rows, (r) => r.tripCosts + r.owningCosts);
  const profit = revenue - costs;
  const trips = sum(rows, (r) => r.trips);
  const fleet = plural(rows.length, "truck");

  if (revenue <= 0) {
    lines.push({ key: "result", tone: "info", lead: "Nothing earned in this period.", text: costs > 0 ? `The ${fleet} cost ${m0(costs)} to run and own.` : "No trips were loaded and no costs were logged." });
  } else if (profit >= 0) {
    lines.push({
      key: "result",
      tone: "pos",
      lead: `The fleet kept ${plural(pct(profit, revenue), "cent")} of every dollar it earned.`,
      text: `${fleet[0].toUpperCase() + fleet.slice(1)} earned ${m0(revenue)} from ${plural(trips, "trip")} and cost ${m0(costs)} to run and own, leaving ${m0(profit)}.`,
    });
  } else {
    lines.push({
      key: "result",
      tone: "bad",
      lead: `The fleet spent ${m2(costs / revenue)} for every dollar it earned.`,
      text: `${fleet[0].toUpperCase() + fleet.slice(1)} earned ${m0(revenue)} from ${plural(trips, "trip")} but cost ${m0(costs)} to run and own, a loss of ${m0(-profit)}.`,
    });
  }

  // Best and worst among the trucks that did anything.
  const working = rows.filter((r) => r.trips > 0 || r.owningCosts > 0).sort((a, b) => b.profit - a.profit);
  const said = (r: CompareTruck) => (r.revenue > 0 ? `It earned ${m0(r.revenue)} from ${plural(r.trips, "trip")} and cost ${m0(r.tripCosts + r.owningCosts)}.` : `It earned nothing and cost ${m0(r.tripCosts + r.owningCosts)}.`);
  if (working.length >= 2) {
    const best = working[0];
    const worst = working.at(-1)!;
    if (best.profit > 0.5) {
      lines.push({
        key: "best",
        tone: "pos",
        lead: `${best.truck.fleet_no} made the most: ${m0(best.profit)}.`,
        text: `That's ${pct(best.profit, best.revenue)}% of its revenue, from ${plural(best.trips, "trip")}.`,
      });
    }
    lines.push(worst.profit <= -0.5
      ? { key: "worst", tone: "bad", lead: `${worst.truck.fleet_no} lost ${m0(-worst.profit)}.`, text: said(worst) }
      : { key: "worst", tone: "info", lead: `${worst.truck.fleet_no} made the least: ${m0(worst.profit)}.`, text: said(worst) });
  }

  const idle = rows.filter((r) => r.truck.is_active && r.trips === 0);
  if (idle.length) {
    const owning = sum(idle, (r) => r.owningCosts);
    lines.push({
      key: "idle",
      tone: owning > 0.5 ? "bad" : "info",
      lead: `${idle.length === 1 ? `${idle[0].truck.fleet_no} had` : `${idle.length} trucks had`} no trips.`,
      text: (idle.length > 1 ? `${names(idle.map((r) => r.truck.fleet_no), 4)}. ` : "")
        + (owning > 0.5 ? `${idle.length === 1 ? "It" : "They"} still cost ${m0(owning)} to own.` : `Nothing was logged against ${idle.length === 1 ? "it" : "them"} either.`),
    });
  }

  const timed = rows.filter((r) => r.days && r.days > 0 && r.daysOnTrip !== null).map((r) => ({ r, share: r.daysOnTrip! / r.days! }));
  if (timed.length >= 2) {
    timed.sort((a, b) => b.share - a.share);
    const avg = sum(timed, (x) => x.share) / timed.length;
    lines.push({
      key: "days",
      tone: "info",
      lead: `On average a truck had a load on ${Math.round(avg * 100)}% of days.`,
      text: `Busiest: ${timed[0].r.truck.fleet_no} (${Math.round(timed[0].share * 100)}%). Least: ${timed.at(-1)!.r.truck.fleet_no} (${Math.round(timed.at(-1)!.share * 100)}%).`,
    });
  }

  const collected = collectedLine(rows);
  if (collected) lines.push(collected);
  if (c.tripsWithoutTruck) {
    lines.push({
      key: "no-truck",
      tone: "info",
      lead: `${plural(c.tripsWithoutTruck, "trip")} ${c.tripsWithoutTruck === 1 ? "has" : "have"} no truck assigned.`,
      text: `${c.tripsWithoutTruck === 1 ? "It counts" : "They count"} under routes and customers, but not here.`,
    });
  }
  return lines;
}

export function routeWords(c: CompareReport): Line[] {
  const rows = c.routes.filter((r) => r.trips > 0);
  if (!rows.length) return [{ key: "none", tone: "info", lead: "No trips in this period.", text: "Routes show up here once trips on them are loaded." }];
  const lines: Line[] = [];
  const perTrip = (r: (typeof rows)[number]) => (r.revenue - r.tripCosts) / r.trips;
  const ranked = [...rows].sort((a, b) => perTrip(b) - perTrip(a));
  const best = ranked[0];
  const kept = (r: (typeof rows)[number]) => (r.revenue > 0 ? ` ${pct(r.revenue - r.tripCosts, r.revenue)}% of its revenue was left after trip costs.` : "");
  lines.push(perTrip(best) >= 0
    ? { key: "best", tone: "pos", lead: `${best.name} left the most per trip: ${m0(perTrip(best))}.`, text: `From ${plural(best.trips, "trip")}.${kept(best)}` }
    : { key: "best", tone: "bad", lead: `Every route lost money on its trips.`, text: `The best, ${best.name}, lost ${m0(-perTrip(best))} a trip.` });
  if (ranked.length >= 2) {
    const worst = ranked.at(-1)!;
    if (perTrip(worst) < 0 && perTrip(best) >= 0) {
      lines.push({ key: "worst", tone: "bad", lead: `${worst.name} lost money: ${m0(-perTrip(worst))} a trip.`, text: `From ${plural(worst.trips, "trip")}: its trip costs came to more than it earned.` });
    } else if (perTrip(worst) >= 0) {
      lines.push({ key: "worst", tone: "info", lead: `${worst.name} left the least per trip: ${m0(perTrip(worst))}.`, text: `From ${plural(worst.trips, "trip")}.${kept(worst)}` });
    }
  }
  const late = rows.filter((r) => r.late > 0).sort((a, b) => b.late / b.trips - a.late / a.trips)[0];
  if (late) {
    lines.push({
      key: "late",
      tone: "bad",
      lead: `${late.late} of ${late.trips} trips on ${late.name} ran late.`,
      text: late.targetDays
        ? `Its target is ${plural(late.targetDays, "day")}${late.avgDays !== null ? `; delivered trips took ${late.avgDays.toFixed(1)} days on average` : ""}.`
        : "Late against the route's target.",
    });
  }
  const unknown = rows.filter((r) => r.km === null);
  if (unknown.length) {
    lines.push({
      key: "no-km",
      tone: "info",
      lead: `${unknown.length === 1 ? `${unknown[0].name} has` : `${unknown.length} routes have`} no distance set.`,
      text: "Set it under Admin → Routes to see what each route earns per km.",
    });
  }
  return lines;
}

export function customerWords(c: CompareReport): Line[] {
  const rows = c.customers.filter((r) => r.trips > 0);
  if (!rows.length) return [{ key: "none", tone: "info", lead: "No trips in this period.", text: "Customers show up here once their trips are loaded." }];
  const lines: Line[] = [];
  const revenue = sum(rows, (r) => r.revenue);
  if (revenue > 0) {
    const top = [...rows].sort((a, b) => b.revenue - a.revenue)[0];
    const share = pct(top.revenue, revenue);
    lines.push({
      key: "top",
      tone: "info",
      lead: rows.length === 1 ? `All the revenue came from ${top.name}.` : `${top.name} brought in ${share}% of revenue.`,
      text: `${m0(top.revenue)} from ${plural(top.trips, "trip")}.${rows.length > 1 && share > 50 ? " More than half the business rests on this one customer." : ""}`,
    });
  }
  const owing = rows.filter((r) => r.overdue >= 0.5).sort((a, b) => b.overdue - a.overdue);
  if (owing.length) {
    const total = sum(owing, (r) => r.overdue);
    lines.push({
      key: "overdue",
      tone: "bad",
      lead: `${owing[0].name} owes the most overdue: ${m0(owing[0].overdue)}.`,
      text: owing.length > 1 ? `${m0(total)} is overdue across ${plural(owing.length, "customer")}.` : "Chase it under Billing.",
    });
  }
  const earning = rows.filter((r) => r.revenue > 0);
  if (earning.length >= 2) {
    const low = [...earning].sort((a, b) => (a.revenue - a.tripCosts) / a.revenue - (b.revenue - b.tripCosts) / b.revenue)[0];
    const cents = pct(low.revenue - low.tripCosts, low.revenue);
    lines.push(cents < 0
      ? { key: "low", tone: "bad", lead: `Trips for ${low.name} lost money.`, text: `They cost ${m0(low.tripCosts)} against ${m0(low.revenue)} earned.` }
      : { key: "low", tone: "info", lead: `Trips for ${low.name} kept the least: ${plural(cents, "cent")} of each dollar.`, text: `After trip costs, from ${plural(low.trips, "trip")}.` });
  }
  // Overdue money is already named above; otherwise say how much is in.
  const collected = collectedLine(rows);
  if (collected && !(owing.length && collected.tone === "bad")) lines.push(collected);
  return lines;
}
