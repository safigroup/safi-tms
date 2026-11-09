import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_USE_CASHBOOK } from "@/lib/auth/permissions";
import { TRANSFER_CATEGORY } from "@/lib/cashbook/categories";
import { getOrgCashAccount, rateToUsd } from "@/lib/cashbook/server";

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// One manual money-in or money-out entry, in the account's own currency.
export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_USE_CASHBOOK.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const body = await request.json();
  const amount = Number(body.amount);
  const category = text(body.category, 60);
  if (body.direction !== "in" && body.direction !== "out") {
    return NextResponse.json({ error: "Choose money in or money out." }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Enter an amount greater than zero." }, { status: 400 });
  }
  if (!category) return NextResponse.json({ error: "Pick or type a category." }, { status: 400 });
  // Transfers are recorded as a pair through /api/cashbook/transfers.
  if (category === TRANSFER_CATEGORY) {
    return NextResponse.json({ error: "Use the Transfer tab to move money between accounts." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.occurredOn ?? "")) {
    return NextResponse.json({ error: "Enter a date." }, { status: 400 });
  }

  const account = await getOrgCashAccount(ctx.admin, ctx.orgId, body.accountId);
  if (!account) return NextResponse.json({ error: "account not found" }, { status: 404 });
  if (!account.is_active) return NextResponse.json({ error: "This account is closed." }, { status: 400 });
  if (body.occurredOn < account.opening_date) {
    return NextResponse.json({ error: `This account opens on ${account.opening_date}; date the entry on or after it.` }, { status: 400 });
  }
  const rate = await rateToUsd(ctx.admin, ctx.orgId, account.currency);
  if (rate === null) {
    return NextResponse.json({ error: `No exchange rate on file for ${account.currency}.` }, { status: 400 });
  }

  const { data, error } = await ctx.admin
    .from("cash_transactions")
    .insert({
      org_id: ctx.orgId,
      account_id: account.id,
      occurred_on: body.occurredOn,
      direction: body.direction,
      amount: Math.round(amount * 100) / 100,
      fx_rate_to_usd: rate,
      category,
      counterparty: text(body.counterparty, 120),
      description: text(body.description, 300),
      reference: text(body.reference, 80),
      recorded_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ id: data.id });
}
