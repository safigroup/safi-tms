import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { resolveMilestonesDue, type Milestone } from "@/lib/billing/paymentSchedule";

// Mirrors the old app's refreshAll() (index.html): the same 9-query
// fan-out, run server-side and org-scoped instead of client-side under
// RLS. Deliberately one combined endpoint, not nine separate ones -- see
// the migration plan for why (every view calls this, and every mutation
// route's client-side follow-up re-calls it, the direct analogue of
// `await refreshAll()`).
export async function GET() {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { admin, orgId } = ctx;

  const [board, billable, ar, fx, customers, routes, trucks, drivers, rateCards, routeBorderPaths, milestones, nonCancelledInvoices] =
    await Promise.all([
      admin.from("trip_board").select("*").eq("org_id", orgId).order("actual_load_date", { ascending: false, nullsFirst: true }),
      admin.from("billable").select("*").eq("org_id", orgId).order("trip_no", { ascending: false }),
      admin.from("invoice_ar").select("*").eq("org_id", orgId).order("issued_on", { ascending: false }),
      admin.from("fx_rates").select("*").eq("org_id", orgId).order("effective_on", { ascending: false }),
      admin.from("customers").select("*").eq("org_id", orgId).order("name"),
      admin.from("routes").select("*").eq("org_id", orgId).order("name"),
      admin.from("trucks").select("*").eq("org_id", orgId).order("fleet_no"),
      admin.from("drivers").select("*").eq("org_id", orgId).order("full_name"),
      admin.from("rate_cards").select("*").eq("org_id", orgId).order("valid_from", { ascending: false }),
      admin.from("route_border_paths").select("*").eq("org_id", orgId).order("label"),
      admin.from("payment_milestones").select("seq, customer_id, label, pct, requires_pod").eq("org_id", orgId),
      // invoices has no trip_id of its own -- that lives on invoice_lines,
      // which has no status of its own -- so this is resolved in two steps
      // (the org-scoped, non-cancelled invoice ids, then their lines),
      // mirroring the verify-parent-then-fetch-children pattern already
      // used in app/api/invoices/[id]/route.ts.
      admin.from("invoices").select("id").eq("org_id", orgId).neq("status", "cancelled"),
    ]);

  const nonCancelledInvoiceIds = (nonCancelledInvoices.data ?? []).map((i) => i.id);
  const invoicedLines = nonCancelledInvoiceIds.length
    ? await admin.from("invoice_lines").select("trip_id, line_total").in("invoice_id", nonCancelledInvoiceIds)
    : { data: [] as { trip_id: string; line_total: number }[], error: null };

  const sources = { board, billable, ar, fx, customers, routes, trucks, drivers, rateCards, routeBorderPaths, milestones, invoicedTotals: nonCancelledInvoices, invoicedLines };
  const fetchErrors = Object.entries(sources)
    .filter(([, r]) => r.error)
    .map(([name]) => name);

  const alreadyInvoicedByTrip = new Map<string, number>();
  for (const l of invoicedLines.data ?? []) {
    alreadyInvoicedByTrip.set(l.trip_id, (alreadyInvoicedByTrip.get(l.trip_id) ?? 0) + Number(l.line_total));
  }

  const allMilestones: Milestone[] = milestones.data ?? [];
  const billableWithMilestones = (billable.data ?? [])
    .map((t) => ({
      ...t,
      milestones_due: resolveMilestonesDue(
        allMilestones,
        { customer_id: t.customer_id, status: t.status, pod_in_hand: t.pod_in_hand, revenue_usd: Number(t.revenue_usd) },
        alreadyInvoicedByTrip.get(t.trip_id) ?? 0,
      ),
    }))
    .filter((t) => t.milestones_due.length > 0);

  return NextResponse.json({
    fetchErrors,
    role: ctx.role,
    userId: ctx.userId,
    board: board.data ?? [],
    billable: billableWithMilestones,
    ar: ar.data ?? [],
    fx: fx.data ?? [],
    customers: customers.data ?? [],
    routes: routes.data ?? [],
    trucks: trucks.data ?? [],
    drivers: drivers.data ?? [],
    rateCards: rateCards.data ?? [],
    routeBorderPaths: routeBorderPaths.data ?? [],
  });
}
