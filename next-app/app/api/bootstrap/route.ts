import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";

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

  const [board, billable, ar, fx, customers, routes, trucks, drivers, rateCards] =
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
    ]);

  const sources = { board, billable, ar, fx, customers, routes, trucks, drivers, rateCards };
  const fetchErrors = Object.entries(sources)
    .filter(([, r]) => r.error)
    .map(([name]) => name);

  return NextResponse.json({
    fetchErrors,
    role: ctx.role,
    userId: ctx.userId,
    board: board.data ?? [],
    billable: (billable.data ?? []).filter(
      (t) => !t.loading_invoiced || (t.pod_in_hand && !t.delivery_invoiced),
    ),
    ar: ar.data ?? [],
    fx: fx.data ?? [],
    customers: customers.data ?? [],
    routes: routes.data ?? [],
    trucks: trucks.data ?? [],
    drivers: drivers.data ?? [],
    rateCards: rateCards.data ?? [],
  });
}
