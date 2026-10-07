import { NextResponse } from "next/server";
import { getAuthedApiKey } from "@/lib/auth/getAuthedApiKey";
import { estimateTripCost, type CostTemplateLine } from "@/lib/estimates/estimateTripCost";

// Read-only: computes the same estimate the Estimator page shows (reusing
// the exact same estimateTripCost() function, so the two can never
// disagree), scoped to whichever org the caller's API key belongs to.
// Never touches trips/costs/invoices -- there is nothing here that writes
// anything, by design, so a leaked key can't do anything destructive.
export async function POST(request: Request) {
  const ctx = await getAuthedApiKey(request);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const body = await request.json().catch(() => ({}));
  const routeId = typeof body.routeId === "string" ? body.routeId : null;
  if (!routeId) {
    return NextResponse.json({ error: "routeId is required" }, { status: 400 });
  }

  const { data: route } = await ctx.admin
    .from("routes")
    .select("id, name, origin, destination, distance_km, borders")
    .eq("id", routeId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!route) {
    return NextResponse.json({ error: "route not found" }, { status: 404 });
  }

  const tonnage = Number(body.tonnage);
  const volumeCbm = Number(body.volumeCbm);
  const quantities = {
    distanceKm: route.distance_km ?? null,
    tonnage: Number.isFinite(tonnage) && tonnage > 0 ? tonnage : null,
    volumeCbm: Number.isFinite(volumeCbm) && volumeCbm > 0 ? volumeCbm : null,
  };

  const { data: templateRows } = await ctx.admin
    .from("route_cost_templates")
    .select("category, amount, currency, basis")
    .eq("org_id", ctx.orgId)
    .eq("route_id", routeId);
  const templateLines: CostTemplateLine[] = templateRows ?? [];
  const cost = estimateTripCost(templateLines, quantities);

  let revenue: { amount: number | null; margin: number | null; customerId: string } | null = null;
  const customerId = typeof body.customerId === "string" ? body.customerId : null;
  if (customerId) {
    // Fetched and matched in JS rather than a .or() filter string built
    // from request input -- mirrors the exact lookup NewTripForm's
    // applyRate() already does client-side against bootstrap data.
    const { data: rateCards } = await ctx.admin
      .from("rate_cards")
      .select("customer_id, rate_amount, rate_currency, rate_basis")
      .eq("org_id", ctx.orgId)
      .eq("route_id", routeId);
    const rateCard = (rateCards ?? []).find((r) => r.customer_id === customerId || !r.customer_id);

    if (rateCard) {
      const revenueEstimate = estimateTripCost(
        [{ category: "revenue", amount: rateCard.rate_amount, currency: rateCard.rate_currency, basis: rateCard.rate_basis as CostTemplateLine["basis"] }],
        quantities,
      );
      const amount = revenueEstimate.incomplete ? null : revenueEstimate.total;
      revenue = { amount, margin: amount !== null ? Math.round((amount - cost.total) * 100) / 100 : null, customerId };
    }
  }

  return NextResponse.json({
    route: { id: route.id, name: route.name, origin: route.origin, destination: route.destination, distanceKm: route.distance_km, borders: route.borders },
    cost,
    revenue,
  });
}
