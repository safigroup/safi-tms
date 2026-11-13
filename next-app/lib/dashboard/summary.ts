import { waitLabel } from "@/lib/format";
import type { ArInvoice, BillableTrip, BoardTrip, FxRate } from "@/lib/types";

// Everything the Overview page shows, derived from data the app already
// loads (/api/bootstrap) -- pure functions so the figures can be checked
// on their own and stay identical wherever they're used.

export type Period = { from: string; to: string; label: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const ROLLING = ["loading", "in_transit", "at_border"];

// This month so far, and the same span of last month (cut to its length),
// so the comparison is like for like rather than a partial month against
// a full one.
export function monthToDate(todayIso: string): { current: Period; previous: Period } {
  const [y, m, d] = todayIso.split("-").map(Number);
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const pd = Math.min(d, new Date(Date.UTC(py, pm, 0)).getUTCDate());
  return {
    current: { from: `${y}-${pad(m)}-01`, to: todayIso, label: `${MONTHS[m - 1]} 1–${d}` },
    previous: { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(pd)}`, label: `${MONTHS[pm - 1]} 1–${pd}` },
  };
}

const inPeriod = (date: string | null, p: Period) => !!date && date.slice(0, 10) >= p.from && date.slice(0, 10) <= p.to;

// Revenue and costs land in the period a trip loaded in, the same rule the
// truck reports use, so the two never disagree.
export function tripMoney(board: BoardTrip[], p: Period) {
  const trips = board.filter((t) => inPeriod(t.actual_load_date, p));
  const revenue = trips.reduce((s, t) => s + Number(t.revenue_usd || 0), 0);
  const costs = trips.reduce((s, t) => s + Number(t.cost_usd || 0), 0);
  return { trips: trips.length, revenue, costs, margin: revenue - costs, marginPct: revenue > 0 ? ((revenue - costs) / revenue) * 100 : null };
}

export function tripCounts(board: BoardTrip[], p: Period) {
  return {
    loaded: board.filter((t) => inPeriod(t.actual_load_date, p)).length,
    delivered: board.filter((t) => inPeriod(t.actual_delivery_at, p)).length,
  };
}

// Each stage links to the Board filter that shows those trips.
export const STAGES: { key: string; label: string; filter: string; match: (t: BoardTrip) => boolean }[] = [
  { key: "planned", label: "Planned", filter: "active", match: (t) => ["draft", "allocated"].includes(t.status) },
  { key: "loading", label: "Loading", filter: "rolling", match: (t) => t.status === "loading" },
  { key: "in_transit", label: "In transit", filter: "rolling", match: (t) => t.status === "in_transit" },
  { key: "at_border", label: "At border", filter: "border", match: (t) => t.status === "at_border" },
  { key: "awaiting_pod", label: "Awaiting POD", filter: "pod", match: (t) => t.status === "delivered" && !t.pod_in_hand },
  { key: "to_invoice", label: "To invoice", filter: "billable", match: (t) => t.status === "pod_received" },
  { key: "invoiced", label: "Invoiced", filter: "all", match: (t) => t.status === "invoiced" },
];

export type Attention = { trip: BoardTrip; severity: "bad" | "warn"; reason: string };

const BORDER_WAIT_HOURS = 24;
const POD_GRACE_DAYS = 3;

// Trips someone should look at today, worst first.
export function needsAttention(board: BoardTrip[], now: number): Attention[] {
  const items: Attention[] = [];
  for (const t of board) {
    const rolling = ROLLING.includes(t.status);
    if (rolling && t.over_target) {
      items.push({ trip: t, severity: "bad", reason: `Late: day ${t.days_running} of ${t.target_days}` });
    }
    if (t.status === "at_border" && t.last_border_at) {
      const hours = (now - new Date(t.last_border_at).getTime()) / 3_600_000;
      if (hours >= BORDER_WAIT_HOURS) {
        const place = (t.last_border || "the border").split("/")[0].trim();
        items.push({ trip: t, severity: hours >= 48 ? "bad" : "warn", reason: `Waiting at ${place} for ${waitLabel(t.last_border_at, now)}` });
      }
    }
    if (t.status === "delivered" && !t.pod_in_hand && t.actual_delivery_at) {
      const days = Math.floor((now - new Date(t.actual_delivery_at).getTime()) / 86_400_000);
      if (days >= POD_GRACE_DAYS) items.push({ trip: t, severity: "warn", reason: `Delivered ${days} days ago, no POD yet` });
    }
    if (rolling && !t.cost_entries) {
      items.push({ trip: t, severity: "warn", reason: "On the road with no costs logged" });
    }
    if (["delivered", "pod_received", "invoiced"].includes(t.status) && t.docs_pending > 0) {
      items.push({ trip: t, severity: "warn", reason: `${t.docs_pending} document${t.docs_pending > 1 ? "s" : ""} still pending` });
    }
  }
  return items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "bad" ? -1 : 1));
}

// Milestones that can be invoiced right now -- the same projection
// Billing uses, so the total matches what Billing offers to raise.
export function readyToInvoice(billable: BillableTrip[]) {
  const items = billable
    .flatMap((b) =>
      b.milestones_due
        .filter((m) => m.raisable)
        .map((m) => ({ trip_id: b.trip_id, trip_no: b.trip_no, customer: b.customer, label: m.label, amount: m.amount_usd })),
    )
    .sort((a, b) => b.amount - a.amount);
  return {
    total: items.reduce((s, i) => s + i.amount, 0),
    trips: new Set(items.map((i) => i.trip_id)).size,
    items,
  };
}

export const AGING = [
  { key: "current", label: "Not yet due" },
  { key: "1-30", label: "1–30 days overdue" },
  { key: "31-60", label: "31–60 days overdue" },
  { key: "60+", label: "60+ days overdue" },
] as const;

// Unpaid invoices in USD, by how overdue they are. An invoice in another
// currency is converted at the latest rate on file; one with no rate is
// left out and its currency reported, rather than being counted as if it
// were dollars.
export function receivables(ar: ArInvoice[], fx: FxRate[]) {
  const latestRate = (cur: string) => (cur === "USD" ? 1 : fx.find((r) => r.currency === cur)?.rate_to_usd ?? null);
  const missingRates = new Set<string>();
  const open = ar
    .filter((i) => Number(i.outstanding) > 0 && AGING.some((a) => a.key === i.bucket))
    .flatMap((i) => {
      const rate = latestRate(i.currency);
      if (rate === null) {
        missingRates.add(i.currency);
        return [];
      }
      return [{ ...i, usd: Number(i.outstanding) * Number(rate) }];
    });

  const buckets = AGING.map((a) => {
    const rows = open.filter((i) => i.bucket === a.key);
    return { ...a, amount: rows.reduce((s, i) => s + i.usd, 0), count: rows.length };
  });
  const overdue = open.filter((i) => i.bucket !== "current");

  const byCustomer = new Map<string, { customer: string; total: number; overdue: number; invoices: number }>();
  for (const i of open) {
    const c = byCustomer.get(i.customer) ?? { customer: i.customer, total: 0, overdue: 0, invoices: 0 };
    c.total += i.usd;
    if (i.bucket !== "current") c.overdue += i.usd;
    c.invoices += 1;
    byCustomer.set(i.customer, c);
  }

  return {
    buckets,
    total: open.reduce((s, i) => s + i.usd, 0),
    overdueTotal: overdue.reduce((s, i) => s + i.usd, 0),
    overdueCount: overdue.length,
    oldestDays: overdue.reduce((m, i) => Math.max(m, Number(i.days_overdue) || 0), 0),
    topCustomers: [...byCustomer.values()].sort((a, b) => b.total - a.total).slice(0, 5),
    missingRates: [...missingRates],
  };
}
