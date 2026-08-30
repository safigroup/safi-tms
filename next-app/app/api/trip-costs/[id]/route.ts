import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_MANAGE_TRIPS, CAN_OVERRIDE_RECORDS } from "@/lib/auth/permissions";
import { diffFields, writeAuditLog, getAuditLog } from "@/lib/auditLog";

const EDITABLE_FIELDS = [
  "category", "amount", "currency", "incurred_on", "description",
  "location", "paid_by", "receipt_ref", "liters", "price_per_liter",
];

// Edit history -- editing an existing entry is CAN_OVERRIDE_RECORDS
// (owner/admin), deliberately narrower than DELETE's CAN_MANAGE_TRIPS
// (ops can still create/delete entries day-to-day as before; retroactively
// changing one that's already recorded is the more sensitive action).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  const { id } = await params;
  const { entries, error } = await getAuditLog(ctx.admin, ctx.orgId, "trip_costs", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ entries });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_OVERRIDE_RECORDS.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { id } = await params;
  const { data: current } = await ctx.admin
    .from("trip_costs")
    .select("*")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!current) {
    return NextResponse.json({ error: "cost entry not found" }, { status: 404 });
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  for (const f of EDITABLE_FIELDS) {
    if (f in body) updates[f] = body[f];
  }

  // A different currency/date genuinely has a different rate on file --
  // re-look-up (same USD-needs-no-lookup rule as trip-costs/route.ts).
  // Otherwise the original frozen rate is left untouched: the point of a
  // correction is fixing a typo, not re-pricing history.
  if ("currency" in updates || "incurred_on" in updates) {
    const currency = (updates.currency as string) ?? current.currency;
    if (currency === "USD") {
      updates.fx_rate_to_usd = 1;
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
      updates.fx_rate_to_usd = rate.rate_to_usd;
    }
  }

  // Same auto-calc as creating a fuel entry: if liters/price are both on
  // file after this edit, the total is derived from them rather than
  // trusting a client-computed amount.
  if ("liters" in updates || "price_per_liter" in updates) {
    const liters = Number(updates.liters ?? current.liters);
    const pricePerLiter = Number(updates.price_per_liter ?? current.price_per_liter);
    if (Number.isFinite(liters) && liters > 0 && Number.isFinite(pricePerLiter) && pricePerLiter > 0) {
      updates.amount = Math.round(liters * pricePerLiter * 100) / 100;
    }
  }

  if ("amount" in updates) {
    const amt = Number(updates.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return NextResponse.json({ error: "Amount must be a number greater than zero." }, { status: 400 });
    }
    updates.amount = amt;
  }

  const changed = diffFields(current, updates, [...EDITABLE_FIELDS, "fx_rate_to_usd"]);
  if (!Object.keys(changed).length) {
    return NextResponse.json({ ok: true, changed: 0 });
  }

  const { error } = await ctx.admin.from("trip_costs").update(changed).eq("id", id).eq("org_id", ctx.orgId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await writeAuditLog(ctx.admin, ctx.orgId, "trip_costs", id, ctx.userId, current, changed);

  return NextResponse.json({ ok: true, changed: Object.keys(changed).length });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_MANAGE_TRIPS.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { id } = await params;

  const { error } = await ctx.admin
    .from("trip_costs")
    .delete()
    .eq("id", id)
    .eq("org_id", ctx.orgId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
