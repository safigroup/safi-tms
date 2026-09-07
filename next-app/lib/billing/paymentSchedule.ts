import "server-only";

export type Milestone = {
  seq: number;
  customer_id: string | null;
  label: string;
  pct: number;
  requires_pod: boolean;
};

export type MilestoneDue = {
  seq: number;
  label: string;
  pct: number;
  amount_usd: number;
  raisable: boolean;
  blocked_reason?: "not_started" | "awaiting_pod";
};

const NOT_STARTED_STATUSES = new Set(["draft", "allocated"]);

// Resolves which of an org's payment_milestones (a customer's own rows if
// they have any -- fully overriding the default, not merged -- else the
// rows with customer_id null) still have money outstanding for one trip.
// Mirrors raise_invoice()'s own math exactly: cumulative percent through
// each milestone minus whatever's already been invoiced for the trip, so
// legacy pre-schedule invoices (milestone_seq null) or a schedule edited
// after some invoices were already raised are both handled correctly by
// amount alone -- no need to track which exact seq each past invoice
// corresponds to. This is the projection the UI uses to decide what to
// show; raise_invoice() re-validates everything itself server-side
// regardless, so a stale or manipulated client hint can't raise anything
// it shouldn't.
export function resolveMilestonesDue(
  allMilestones: Milestone[],
  trip: { customer_id: string; status: string; pod_in_hand: boolean; revenue_usd: number },
  alreadyInvoicedUsd: number,
): MilestoneDue[] {
  const own = allMilestones.filter((m) => m.customer_id === trip.customer_id);
  const schedule = (own.length ? own : allMilestones.filter((m) => m.customer_id === null))
    .slice()
    .sort((a, b) => a.seq - b.seq);

  const due: MilestoneDue[] = [];
  let cumPct = 0;
  for (const m of schedule) {
    cumPct += Number(m.pct);
    const cumTarget = Math.round(((trip.revenue_usd * cumPct) / 100) * 100) / 100;
    const amount = Math.round((cumTarget - alreadyInvoicedUsd) * 100) / 100;
    if (amount <= 0.01) continue;

    const raisable = m.requires_pod ? trip.pod_in_hand : !NOT_STARTED_STATUSES.has(trip.status);
    due.push({
      seq: m.seq,
      label: m.label,
      pct: Number(m.pct),
      amount_usd: amount,
      raisable,
      blocked_reason: raisable ? undefined : m.requires_pod ? "awaiting_pod" : "not_started",
    });
  }
  return due;
}
