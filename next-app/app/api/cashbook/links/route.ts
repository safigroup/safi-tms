import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_USE_CASHBOOK } from "@/lib/auth/permissions";
import { getOrgCashAccount, isLinkSource, LINK_TABLE } from "@/lib/cashbook/server";

// TMS records in the cashbook: invoice payments, trip costs paid by the
// office, an agent or card, trip allocations and truck costs. Each says
// which account its money went through; until it does, it waits in the
// Cashbook's "To place" list. The cash_link_guard trigger checks every
// placement (right company, open account, on or after its opening date,
// the account-currency amount when currencies differ), so its message is
// what the user sees when one doesn't fit.

const LIMIT = 1000;

// The "To place" list: records the cashbook can take that aren't in an
// account yet, from the day the earliest account opened -- anything older
// is already in the opening balances.
export async function GET() {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_USE_CASHBOOK.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { data: first } = await ctx.admin
    .from("cash_accounts")
    .select("opening_date")
    .eq("org_id", ctx.orgId)
    .order("opening_date")
    .limit(1)
    .maybeSingle();
  if (!first) return NextResponse.json({ since: null, items: [], more: false });

  const { data, error } = await ctx.admin
    .from("cash_link_sources")
    .select("source, id, occurred_on, direction, record_amount, record_currency, category, counterparty, description, reference, detail, paid_by, trip_id, trip_no")
    .eq("org_id", ctx.orgId)
    .is("cash_account_id", null)
    .gte("occurred_on", first.opening_date)
    .order("occurred_on")
    .order("created_at")
    .limit(LIMIT);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ since: first.opening_date, items: data ?? [], more: (data?.length ?? 0) === LIMIT });
}

// Place one or more records in an account. amount -- what actually went
// through the account, in its currency -- is only for a single record in
// another currency than the account.
export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_USE_CASHBOOK.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const body = await request.json();
  const items: unknown[] = Array.isArray(body.items) ? body.items : [];
  if (!items.length || items.length > 500) {
    return NextResponse.json({ error: "Pick what to place." }, { status: 400 });
  }
  if (!items.every((i) => i && typeof i === "object" && isLinkSource((i as { source?: unknown }).source) && typeof (i as { id?: unknown }).id === "string")) {
    return NextResponse.json({ error: "invalid items" }, { status: 400 });
  }
  let amount: number | null = null;
  if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
    amount = Math.round(Number(body.amount) * 100) / 100;
    if (!(amount > 0)) return NextResponse.json({ error: "Enter an amount greater than zero." }, { status: 400 });
    if (items.length !== 1) {
      return NextResponse.json({ error: "Place records in another currency one at a time, with the amount that went through the account." }, { status: 400 });
    }
  }

  const account = await getOrgCashAccount(ctx.admin, ctx.orgId, body.accountId);
  if (!account) return NextResponse.json({ error: "account not found" }, { status: 404 });

  let placed = 0;
  const errors: { id: string; error: string }[] = [];
  for (const item of items as { source: keyof typeof LINK_TABLE; id: string }[]) {
    const { data, error } = await ctx.admin
      .from(LINK_TABLE[item.source])
      .update({ cash_account_id: account.id, cash_amount: amount })
      .eq("id", item.id)
      .eq("org_id", ctx.orgId)
      .select("id");
    if (error) errors.push({ id: item.id, error: error.message });
    else if (!data?.length) errors.push({ id: item.id, error: "not found" });
    else placed++;
  }
  return NextResponse.json({ placed, errors }, { status: placed ? 200 : 400 });
}

// Take a record back out of its account and onto the "To place" list.
export async function DELETE(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_USE_CASHBOOK.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const body = await request.json();
  const source: unknown = body.source;
  if (!isLinkSource(source) || typeof body.id !== "string") {
    return NextResponse.json({ error: "invalid record" }, { status: 400 });
  }
  const { data, error } = await ctx.admin
    .from(LINK_TABLE[source])
    .update({ cash_account_id: null, cash_amount: null })
    .eq("id", body.id)
    .eq("org_id", ctx.orgId)
    .select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data?.length) {
    return NextResponse.json({ error: "record not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
