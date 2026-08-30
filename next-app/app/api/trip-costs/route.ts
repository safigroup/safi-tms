import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_MANAGE_TRIPS } from "@/lib/auth/permissions";

// Ports saveCost() (index.html). The receipt photo itself is uploaded
// separately first via POST /api/storage/upload (see that route for why),
// and this just records the path it returns.
export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_MANAGE_TRIPS.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const body = await request.json();
  const { tripId, category, amount, currency, incurredOn } = body;

  if (!tripId) {
    return NextResponse.json({ error: "Pick a trip first." }, { status: 400 });
  }

  // If both are on file, the server computes the total itself rather than
  // trusting a client-computed value -- liters/price and the stored amount
  // can never drift apart. Otherwise amount is used as submitted, same as
  // before liters/price existed.
  const liters = Number(body.liters);
  const pricePerLiter = Number(body.pricePerLiter);
  const hasFuelBreakdown = Number.isFinite(liters) && liters > 0 && Number.isFinite(pricePerLiter) && pricePerLiter > 0;
  const amt = hasFuelBreakdown ? Math.round(liters * pricePerLiter * 100) / 100 : Number(amount);
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
  // match per currency wins). USD needs no lookup: it never has a real
  // conversion, so requiring an org to keep a trivial "1 USD = 1 USD" row
  // on file just to record a native-USD cost would be needless friction.
  let rateToUsd: number;
  if (currency === "USD") {
    rateToUsd = 1;
  } else {
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
    rateToUsd = rate.rate_to_usd;
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
      fx_rate_to_usd: rateToUsd,
      incurred_on: incurredOn,
      location: body.location?.trim() || null,
      paid_by: body.paidBy,
      receipt_ref: body.receiptRef?.trim() || null,
      receipt_path: body.receiptPath || null,
      liters: hasFuelBreakdown ? liters : null,
      price_per_liter: hasFuelBreakdown ? pricePerLiter : null,
      recorded_by: ctx.userId,
    })
    .select("id, amount_usd")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ id: data.id, amountUsd: data.amount_usd });
}
