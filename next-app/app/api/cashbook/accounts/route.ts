import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_USE_CASHBOOK } from "@/lib/auth/permissions";
import { rateToUsd } from "@/lib/cashbook/server";

const KINDS = new Set(["bank", "mobile_money", "cash"]);

export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_USE_CASHBOOK.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const body = await request.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const openingBalance = Number(body.openingBalance ?? 0);
  if (!name) return NextResponse.json({ error: "Give the account a name." }, { status: 400 });
  if (!KINDS.has(body.kind)) return NextResponse.json({ error: "Pick bank, mobile money or cash." }, { status: 400 });
  if (!Number.isFinite(openingBalance)) return NextResponse.json({ error: "Enter a valid opening balance." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.openingDate ?? "")) {
    return NextResponse.json({ error: "Enter an opening date." }, { status: 400 });
  }
  // Same currencies the rest of the app supports: USD, or any with a rate
  // on file -- needed later to put this account's movements in USD.
  if (typeof body.currency !== "string" || (await rateToUsd(ctx.admin, ctx.orgId, body.currency)) === null) {
    return NextResponse.json({ error: "Pick a currency with an exchange rate on file." }, { status: 400 });
  }

  const { data, error } = await ctx.admin
    .from("cash_accounts")
    .insert({
      org_id: ctx.orgId,
      name: name.slice(0, 80),
      kind: body.kind,
      currency: body.currency,
      opening_balance: Math.round(openingBalance * 100) / 100,
      opening_date: body.openingDate,
    })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ id: data.id });
}
