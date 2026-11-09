import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_USE_CASHBOOK } from "@/lib/auth/permissions";
import { TRANSFER_CATEGORY } from "@/lib/cashbook/categories";
import { getOrgCashAccount, rateToUsd } from "@/lib/cashbook/server";

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// Moving money between two of the organization's own accounts: money out
// of one, money in to the other, written in a single insert so a transfer
// can never be half-recorded. Across currencies both amounts are entered
// as they actually left and arrived, rather than converted by the app.
export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_USE_CASHBOOK.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const body = await request.json();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.occurredOn ?? "")) {
    return NextResponse.json({ error: "Enter a date." }, { status: 400 });
  }
  if (!body.fromAccountId || body.fromAccountId === body.toAccountId) {
    return NextResponse.json({ error: "Pick two different accounts." }, { status: 400 });
  }
  const [from, to] = await Promise.all([
    getOrgCashAccount(ctx.admin, ctx.orgId, body.fromAccountId),
    getOrgCashAccount(ctx.admin, ctx.orgId, body.toAccountId),
  ]);
  if (!from || !to) return NextResponse.json({ error: "account not found" }, { status: 404 });
  if (!from.is_active || !to.is_active) return NextResponse.json({ error: "One of these accounts is closed." }, { status: 400 });
  const opens = from.opening_date > to.opening_date ? from.opening_date : to.opening_date;
  if (body.occurredOn < opens) {
    return NextResponse.json({ error: `Date the transfer on or after ${opens}, when both accounts are open.` }, { status: 400 });
  }

  const amountOut = Number(body.amountOut);
  const amountIn = from.currency === to.currency ? amountOut : Number(body.amountIn);
  if (!Number.isFinite(amountOut) || amountOut <= 0 || !Number.isFinite(amountIn) || amountIn <= 0) {
    return NextResponse.json({ error: "Enter amounts greater than zero." }, { status: 400 });
  }

  const [rateOut, rateIn] = await Promise.all([
    rateToUsd(ctx.admin, ctx.orgId, from.currency),
    rateToUsd(ctx.admin, ctx.orgId, to.currency),
  ]);
  if (rateOut === null || rateIn === null) {
    return NextResponse.json({ error: `No exchange rate on file for ${rateOut === null ? from.currency : to.currency}.` }, { status: 400 });
  }

  const transferId = randomUUID();
  const shared = {
    org_id: ctx.orgId,
    occurred_on: body.occurredOn,
    category: TRANSFER_CATEGORY,
    description: text(body.description, 300),
    reference: text(body.reference, 80),
    transfer_id: transferId,
    recorded_by: ctx.userId,
  };
  const { error } = await ctx.admin.from("cash_transactions").insert([
    { ...shared, account_id: from.id, direction: "out", amount: Math.round(amountOut * 100) / 100, fx_rate_to_usd: rateOut, counterparty: to.name },
    { ...shared, account_id: to.id, direction: "in", amount: Math.round(amountIn * 100) / 100, fx_rate_to_usd: rateIn, counterparty: from.name },
  ]);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ transferId });
}
