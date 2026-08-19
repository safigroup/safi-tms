import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";

// Ports saveCost() (index.html). The receipt photo itself is uploaded
// separately first via POST /api/storage/upload (see that route for why),
// and this just records the path it returns.
export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const body = await request.json();
  const { tripId, category, amount, currency, incurredOn } = body;

  const amt = Number(amount);
  if (!tripId) {
    return NextResponse.json({ error: "Pick a trip first." }, { status: 400 });
  }
  if (!Number.isFinite(amt) || amt <= 0) {
    return NextResponse.json({ error: "Enter an amount greater than zero." }, { status: 400 });
  }

  const { data: trip } = await ctx.admin
    .from("trips")
    .select("id")
    .eq("id", tripId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }

  // Most recent rate on file for this currency — mirrors how the old
  // client built S.rates (fx_rates ordered by effective_on desc, first
  // match per currency wins).
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
    .from("trip_costs")
    .insert({
      org_id: ctx.orgId,
      trip_id: tripId,
      category,
      description: body.description?.trim() || null,
      amount: amt,
      currency,
      fx_rate_to_usd: rate.rate_to_usd,
      incurred_on: incurredOn,
      location: body.location?.trim() || null,
      paid_by: body.paidBy,
      receipt_ref: body.receiptRef?.trim() || null,
      receipt_path: body.receiptPath || null,
      recorded_by: ctx.userId,
    })
    .select("id, amount_usd")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ id: data.id, amountUsd: data.amount_usd });
}
