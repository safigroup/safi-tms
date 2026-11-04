import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_MANAGE_TRIPS } from "@/lib/auth/permissions";

// Records money allocated to a trip -- the debit side of its balance
// statement. Same permission and same rate-on-file conversion as a trip
// cost, so the two net off in the same dollars.
export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_MANAGE_TRIPS.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const body = await request.json();
  const { tripId, currency, allocatedOn } = body;
  const amount = Number(body.amount);
  if (!tripId) {
    return NextResponse.json({ error: "Pick a trip first." }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
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
    .from("trip_allocations")
    .insert({
      org_id: ctx.orgId,
      trip_id: tripId,
      allocated_on: allocatedOn,
      amount: Math.round(amount * 100) / 100,
      currency,
      fx_rate_to_usd: rateToUsd,
      description: body.description?.trim() || null,
      reference: body.reference?.trim() || null,
      recorded_by: ctx.userId,
    })
    .select("id, amount_usd")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ id: data.id, amountUsd: data.amount_usd });
}
