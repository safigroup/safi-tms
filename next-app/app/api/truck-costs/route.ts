import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_EDIT_COMMERCIAL } from "@/lib/auth/permissions";

// Standing (non-trip) truck costs -- maintenance, insurance, licensing,
// etc. Mirrors trip-costs/route.ts's FX-freeze-at-entry-time pattern
// exactly, just scoped to a truck instead of a trip.
export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_EDIT_COMMERCIAL.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const body = await request.json();
  const { truckId, category, amount, currency, incurredOn } = body;

  const amt = Number(amount);
  if (!truckId) {
    return NextResponse.json({ error: "Pick a truck first." }, { status: 400 });
  }
  if (!Number.isFinite(amt) || amt <= 0) {
    return NextResponse.json({ error: "Enter an amount greater than zero." }, { status: 400 });
  }

  const { data: truck } = await ctx.admin
    .from("trucks")
    .select("id")
    .eq("id", truckId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!truck) {
    return NextResponse.json({ error: "truck not found" }, { status: 404 });
  }

  const { data: rate } = await ctx.admin
    .from("fx_rates")
    .select("rate_to_usd")
    .eq("org_id", ctx.orgId)
    .eq("currency", currency)
    .order("effective_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!rate) {
    return NextResponse.json({ error: `No exchange rate on file for ${currency}.` }, { status: 400 });
  }

  const { data, error } = await ctx.admin
    .from("truck_costs")
    .insert({
      org_id: ctx.orgId,
      truck_id: truckId,
      category,
      description: body.description?.trim() || null,
      amount: amt,
      currency,
      fx_rate_to_usd: rate.rate_to_usd,
      incurred_on: incurredOn,
      recorded_by: ctx.userId,
    })
    .select("id, amount_usd")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ id: data.id, amountUsd: data.amount_usd });
}
