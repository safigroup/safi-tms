import { lab, m0, m2, num } from "@/lib/format";
import type { TruckReport } from "@/lib/types";
import { collectionFigures } from "./detail";

// The truck report in plain words: a headline and a few sentences, each
// worked out by fixed rules from the report's own figures. Nothing here is
// estimated or generated, so a sentence can always be traced to a number
// on the page.

export type Tone = "pos" | "bad" | "info";
// `lead` is the takeaway, `text` the figures behind it.
export type Line = { key: string; tone: Tone; lead: string; text: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (part: number, whole: number) => Math.round((part / whole) * 100);

function ordinal(n: number) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

// Under half a dollar either way reads as breaking even at whole dollars.
const even = (n: number) => Math.abs(n) < 0.5;

export function isEmpty(r: TruckReport) {
  return r.trips.length === 0 && even(r.tripRevenue) && even(r.totalExpenses);
}

// The band's title: the period's result in three or four words.
export function headline(r: TruckReport): { text: string; tone: Tone } {
  const name = r.truck.fleet_no;
  if (isEmpty(r)) return { text: `Nothing recorded for ${name}`, tone: "info" };
  if (even(r.margin)) return { text: `${name} broke even`, tone: "info" };
  return r.margin > 0
    ? { text: `${name} made ${m0(r.margin)}`, tone: "pos" }
    : { text: `${name} lost ${m0(-r.margin)}`, tone: "bad" };
}

function result(r: TruckReport): Line {
  const name = r.truck.fleet_no;
  const trips = plural(r.trips.length, "trip");
  if (isEmpty(r)) {
    return { key: "result", tone: "info", lead: "Nothing recorded in this period.", text: "No trips were loaded and no costs were logged." };
  }
  if (r.tripRevenue <= 0) {
    return {
      key: "result",
      tone: "bad",
      lead: "It earned nothing in this period.",
      text: r.trips.length
        ? `Its ${trips} ${r.trips.length === 1 ? "has" : "have"} no revenue recorded, and it cost ${m0(r.totalExpenses)}.`
        : `It loaded no trips and still cost ${m0(r.totalExpenses)}.`,
    };
  }
  if (even(r.margin)) {
    return {
      key: "result",
      tone: "info",
      lead: "It broke even.",
      text: `${name} earned ${m0(r.tripRevenue)} from ${trips} and cost the same to run.`,
    };
  }
  if (r.margin > 0) {
    const cents = pct(r.margin, r.tripRevenue);
    return {
      key: "result",
      tone: "pos",
      lead: cents < 1 ? "It kept less than 1 cent of every dollar it earned." : `It kept ${plural(cents, "cent")} of every dollar it earned.`,
      text: `${name} earned ${m0(r.tripRevenue)} from ${trips} and cost ${m0(r.totalExpenses)} to run, leaving ${m0(r.margin)}.`,
    };
  }
  return {
    key: "result",
    tone: "bad",
    lead: `It spent ${m2(r.totalExpenses / r.tripRevenue)} for every dollar it earned.`,
    text: `${name} earned ${m0(r.tripRevenue)} from ${trips} but cost ${m0(r.totalExpenses)} to run, a loss of ${m0(-r.margin)}.`,
  };
}

function biggestCost(r: TruckReport): Line | null {
  const top = [...r.tripExpensesByCategory, ...r.standingExpensesByCategory].sort((a, b) => b.amountUsd - a.amountUsd)[0];
  if (!top || top.amountUsd <= 0 || r.totalExpenses <= 0) return null;
  const ofRevenue = r.tripRevenue > 0 ? ` (${plural(pct(top.amountUsd, r.tripRevenue), "cent")} of every dollar earned)` : "";
  const fuel = top.liters && top.avgPricePerLiterUsd
    ? ` That bought ${num(top.liters)} litres at an average of ${m2(top.avgPricePerLiterUsd)} a litre.`
    : "";
  return {
    key: "biggest",
    tone: "info",
    lead: `${cap(lab(top.category))} was the biggest cost.`,
    text: `${m0(top.amountUsd)}, which is ${pct(top.amountUsd, r.totalExpenses)}% of everything spent${ofRevenue}.${fuel}`,
  };
}

function againstBefore(r: TruckReport, label: string | null): Line | null {
  const prev = r.previous;
  if (!prev || !label) return null;
  const prevCosts = prev.tripCosts + prev.owningCosts;
  // Nothing happened in the comparison period: no sentence to write.
  if (prev.trips === 0 && even(prev.revenue) && even(prevCosts)) return null;

  const d = r.margin - prev.profit;
  const moved = (now: number, before: number, what: string) => {
    const change = now - before;
    return even(change) ? `${what} didn't change` : `${what} ${change > 0 ? "rose" : "fell"} by ${m0(Math.abs(change))}`;
  };
  const text = `${cap(moved(r.tripRevenue, prev.revenue, "revenue"))} and ${moved(r.totalExpenses, prevCosts, "costs")}.`;

  if (even(d)) return { key: "before", tone: "info", lead: `The same result as ${label}.`, text };
  const tone: Tone = d > 0 ? "pos" : "bad";
  const nowUp = r.margin >= 0;
  const wasUp = prev.profit >= 0;
  const lead = nowUp && wasUp
    ? `Profit is ${d > 0 ? "up" : "down"} ${m0(Math.abs(d))} compared with ${label}.`
    : nowUp
      ? `Back in profit, after a loss of ${m0(-prev.profit)} in ${label}.`
      : wasUp
        ? `Slipped into a loss, after a profit of ${m0(prev.profit)} in ${label}.`
        : `The loss ${d > 0 ? "shrank" : "grew"} by ${m0(Math.abs(d))} compared with ${label}.`;
  return { key: "before", tone, lead, text };
}

function againstFleet(r: TruckReport): Line | null {
  const fleet = r.fleet;
  if (!fleet) return null;
  const avg = fleet.avg.profit;
  const d = r.margin - avg;
  const each = avg >= 0 ? `a profit of ${m0(avg)}` : `a loss of ${m0(-avg)}`;
  const rank = fleet.rank ? ` ${r.truck.fleet_no} ranks ${ordinal(fleet.rank)} of ${fleet.trucks}.` : "";
  const text = `The fleet's ${fleet.trucks} trucks averaged ${each} each in this period.${rank}`;
  if (Math.abs(d) < Math.max(1, Math.abs(avg) * 0.02)) {
    return { key: "fleet", tone: "info", lead: "In line with the fleet average.", text };
  }
  return { key: "fleet", tone: d > 0 ? "pos" : "bad", lead: `${m0(Math.abs(d))} ${d > 0 ? "above" : "below"} the fleet average.`, text };
}

function emptyReturns(r: TruckReport): Line | null {
  if (r.emptyReturnExpenses <= 0 || r.tripExpenses <= 0) return null;
  return {
    key: "empty",
    tone: "info",
    lead: `Driving back empty cost ${m0(r.emptyReturnExpenses)}.`,
    text: `That's ${pct(r.emptyReturnExpenses, r.tripExpenses)}% of its trip costs, spent on return legs with no load.`,
  };
}

function purchaseCosts(r: TruckReport): Line | null {
  if (r.capitalExpenses <= 0) return null;
  return {
    key: "capital",
    tone: "info",
    lead: `${m0(r.capitalExpenses)} spent buying the truck isn't counted here.`,
    text: "Buying a truck is an investment rather than a cost of one period. It's tracked under “Has this truck paid for itself?” below.",
  };
}

// The trips that cost more than they earned, worst first. Only when some
// trips made money too: if every trip lost, the result line already says so.
function lossTrips(r: TruckReport): Line | null {
  const lost = r.trips
    .filter((t) => Number(t.margin_usd || 0) <= -0.5)
    .sort((a, b) => Number(a.margin_usd) - Number(b.margin_usd));
  const counted = r.trips.length;
  if (!lost.length || lost.length === counted) return null;
  const named = lost.slice(0, 3).map((t) => `${t.trip_no} (${m0(-Number(t.margin_usd))})`);
  const more = lost.length - named.length;
  const list = more > 0
    ? `${named.join(", ")} and ${plural(more, "other")}`
    : named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named.at(-1)}` : named[0];
  return {
    key: "loss-trips",
    tone: "bad",
    lead: `${lost.length} of ${counted} trips lost money.`,
    text: `${cap(list)}. They're marked in the trips list below.`,
  };
}

// What the period's trips earned, against what's been collected of it:
// the overdue money first, then what hasn't been invoiced.
function paidLine(r: TruckReport): Line | null {
  const c = collectionFigures(r);
  if (c.revenue <= 0) return null;
  if (c.collected >= c.revenue - 0.5) {
    return { key: "paid", tone: "pos", lead: "All of it has been collected.", text: `Every dollar these trips earned has been paid.` };
  }
  const so = `${pct(c.collected, c.revenue)}% of what it earned has been collected so far (${m0(c.collected)} of ${m0(c.revenue)}).`;
  if (c.overdue >= 0.5) {
    return {
      key: "paid",
      tone: "bad",
      lead: `${m0(c.overdue)} is overdue.`,
      text: so + (c.notInvoicedDelivered >= 0.5 ? ` Another ${m0(c.notInvoicedDelivered)} from delivered trips hasn't been invoiced yet.` : ""),
    };
  }
  if (c.notInvoicedDelivered >= 0.5) {
    return { key: "paid", tone: "info", lead: `${m0(c.notInvoicedDelivered)} from delivered trips hasn't been invoiced yet.`, text: so };
  }
  return null;
}

// `previousLabel` names the comparison period ("1–17 Oct"), when there is one.
export function plainWords(r: TruckReport, previousLabel: string | null): Line[] {
  // With nothing recorded there's nothing to compare: say so, and stop.
  if (isEmpty(r)) return [result(r), purchaseCosts(r)].filter((l): l is Line => !!l);
  return [
    result(r),
    biggestCost(r),
    lossTrips(r),
    paidLine(r),
    againstBefore(r, previousLabel),
    againstFleet(r),
    emptyReturns(r),
    purchaseCosts(r),
  ].filter((l): l is Line => !!l);
}
