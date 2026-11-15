import { catLabel, t, type PrintLang } from "@/lib/print/translations";
import type { CashEntry } from "@/lib/types";

// The cashbook's monthly summary: money in against money out by category,
// across every account, in USD. Shared by the Cashbook page and the Excel
// export so the two can't disagree.
//
// USD is the rate locked onto each line when it was entered. A customer
// payment in another currency has no locked rate, so it converts at the
// rate on file the day it arrived -- the same rule as the Overview's cash
// collected. Transfers between the company's own accounts are left out:
// they're neither income nor spending.

export type FxRow = { currency: string; rate_to_usd: number; effective_on: string };

export type SummaryRow = {
  direction: "in" | "out";
  key: string;
  label: string;
  byMonth: Record<string, number>;
  total: number;
};

export type CashSummary = {
  months: string[]; // "YYYY-MM"
  rows: SummaryRow[]; // money in first, then money out; biggest first within each
  totalIn: Record<string, number>;
  totalOut: Record<string, number>;
  net: Record<string, number>;
  grand: { in: number; out: number; net: number };
  missingRates: string[];
};

const cents = (n: number) => Math.round(n * 100) / 100;

export const monthOf = (day: string) => day.slice(0, 7);

// First and last day of a "YYYY-MM" month.
export function monthBounds(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(last).padStart(2, "0")}` };
}

// A "YYYY-MM" month moved by n months.
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Every month from one to another, inclusive.
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    if (out.length > 120) break;
  }
  return out;
}

export function monthLabel(month: string, lang: PrintLang): string {
  const [y, m] = month.split("-").map(Number);
  // en-US: British English shortens September to "Sept"
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

// The rate on file on a day: the latest one dated on or before it, else
// the oldest there is. rates may be in any order.
export function rateLookup(rates: FxRow[]) {
  const byCurrency = new Map<string, FxRow[]>();
  for (const r of [...rates].sort((a, b) => b.effective_on.localeCompare(a.effective_on))) {
    if (!byCurrency.has(r.currency)) byCurrency.set(r.currency, []);
    byCurrency.get(r.currency)!.push(r);
  }
  return (currency: string, day: string): number | null => {
    if (currency === "USD") return 1;
    const list = byCurrency.get(currency);
    if (!list?.length) return null;
    const r = list.find((x) => x.effective_on <= day) ?? list[list.length - 1];
    return Number(r.rate_to_usd);
  };
}

// A line's value in USD; null when there's no rate to convert it with.
export function entryUsd(
  e: Pick<CashEntry, "amount" | "amount_usd" | "occurred_on">,
  accountCurrency: string,
  rateOn: (currency: string, day: string) => number | null,
): number | null {
  if (e.amount_usd !== null && e.amount_usd !== undefined) return Number(e.amount_usd);
  const rate = rateOn(accountCurrency, e.occurred_on);
  return rate === null ? null : cents(Number(e.amount) * rate);
}

const titleCase = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

// Which summary row a line belongs to. Trip and truck costs are split by
// cost category, so fuel and border fees don't disappear into one figure.
export function summaryGroup(e: Pick<CashEntry, "source" | "category" | "detail" | "direction">, lang: PrintLang): { key: string; label: string } {
  switch (e.source) {
    case "payment":
      return { key: "payment", label: t(lang, "sum_payments") };
    case "allocation":
      return { key: "allocation", label: t(lang, "sum_allocations") };
    case "trip_cost":
      return { key: `trip_cost:${e.detail}`, label: `${t(lang, "sum_trip_costs")} · ${titleCase(catLabel(lang, e.detail ?? "other"))}` };
    case "truck_cost":
      return { key: `truck_cost:${e.detail}`, label: `${t(lang, "sum_truck_costs")} · ${titleCase(catLabel(lang, e.detail ?? "other"))}` };
    default:
      return { key: `manual:${e.direction}:${e.category.trim().toLowerCase()}`, label: e.category.trim() };
  }
}

export function buildCashSummary(
  entries: CashEntry[],
  accountCurrency: Map<string, string>,
  rates: FxRow[],
  fromMonth: string,
  toMonth: string,
  lang: PrintLang,
): CashSummary {
  const months = monthsBetween(fromMonth, toMonth);
  const inRange = new Set(months);
  const rateOn = rateLookup(rates);
  const rows = new Map<string, SummaryRow>();
  const missing = new Set<string>();

  for (const e of entries) {
    if (e.transfer_id) continue;
    const month = monthOf(e.occurred_on);
    if (!inRange.has(month)) continue;
    const currency = accountCurrency.get(e.account_id) ?? "USD";
    const usd = entryUsd(e, currency, rateOn);
    if (usd === null) {
      missing.add(currency);
      continue;
    }
    const { key, label } = summaryGroup(e, lang);
    const rowKey = e.direction + "|" + key;
    if (!rows.has(rowKey)) rows.set(rowKey, { direction: e.direction, key, label, byMonth: {}, total: 0 });
    const row = rows.get(rowKey)!;
    row.byMonth[month] = cents((row.byMonth[month] ?? 0) + usd);
    row.total = cents(row.total + usd);
  }

  const sorted = [...rows.values()].sort(
    (a, b) => (a.direction === b.direction ? b.total - a.total || a.label.localeCompare(b.label) : a.direction === "in" ? -1 : 1),
  );
  const totalIn: Record<string, number> = {};
  const totalOut: Record<string, number> = {};
  const net: Record<string, number> = {};
  for (const m of months) {
    totalIn[m] = cents(sorted.filter((r) => r.direction === "in").reduce((s, r) => s + (r.byMonth[m] ?? 0), 0));
    totalOut[m] = cents(sorted.filter((r) => r.direction === "out").reduce((s, r) => s + (r.byMonth[m] ?? 0), 0));
    net[m] = cents(totalIn[m] - totalOut[m]);
  }
  const grandIn = cents(months.reduce((s, m) => s + totalIn[m], 0));
  const grandOut = cents(months.reduce((s, m) => s + totalOut[m], 0));
  return {
    months,
    rows: sorted,
    totalIn,
    totalOut,
    net,
    grand: { in: grandIn, out: grandOut, net: cents(grandIn - grandOut) },
    missingRates: [...missing].sort(),
  };
}
