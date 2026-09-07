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

  const [board, billable, ar, fx, customers, routes, trucks, drivers, rateCards, routeBorderPaths, milestones, invoicedTotals] =
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
      admin.from("invoices").select("trip_id, total_due").eq("org_id", orgId).neq("status", "cancelled"),
    ]);

  const sources = { board, billable, ar, fx, customers, routes, trucks, drivers, rateCards, routeBorderPaths, milestones, invoicedTotals };
  const fetchErrors = Object.entries(sources)
    .filter(([, r]) => r.error)
    .map(([name]) => name);

  const alreadyInvoicedByTrip = new Map<string, number>();
  for (const inv of invoicedTotals.data ?? []) {
    alreadyInvoicedByTrip.set(inv.trip_id, (alreadyInvoicedByTrip.get(inv.trip_id) ?? 0) + Number(inv.total_due));
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
