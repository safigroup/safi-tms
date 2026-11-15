import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_USE_CASHBOOK } from "@/lib/auth/permissions";
import { getOrgCashAccount, rateToUsd } from "@/lib/cashbook/server";

const PAGE = 1000;

// One account and every line of its statement -- manual entries and the
// TMS records placed in it (the cash_entries view). Paged because the API
// caps a single read at 1,000 rows and a statement needs every earlier
// movement to carry its balance forward correctly.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_USE_CASHBOOK.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { id } = await params;
  const account = await getOrgCashAccount(ctx.admin, ctx.orgId, id);
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  const entries = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.admin
      .from("cash_entries")
      .select("id, account_id, occurred_on, direction, amount, category, counterparty, description, reference, transfer_id, source, detail, paid_by, trip_id, trip_no, record_amount, record_currency, amount_usd, reconciled_at, created_at")
      .eq("org_id", ctx.orgId)
      .eq("account_id", id)
      .order("occurred_on")
      .order("created_at")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    entries.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  return NextResponse.json({ account, entries });
}

// How many statement lines an account has, optionally only those dated
// before a day -- manual entries and placed TMS records alike.
async function countEntries(admin: SupabaseClient, accountId: string, before?: string) {
  let q = admin.from("cash_entries").select("id", { count: "exact", head: true }).eq("account_id", accountId);
  if (before) q = q.lt("occurred_on", before);
  const { count } = await q;
  return count ?? 0;
}

// Rename, deactivate, or correct the type, opening balance/date -- or
// the currency, but only before the first entry: once there are entries,
// their amounts were typed in that currency and their USD values frozen
// from it, so relabelling them would silently change what they mean.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_USE_CASHBOOK.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { id } = await params;
  const account = await getOrgCashAccount(ctx.admin, ctx.orgId, id);
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "Give the account a name." }, { status: 400 });
    updates.name = name.slice(0, 80);
  }
  if (body.isActive !== undefined) updates.is_active = !!body.isActive;
  if (body.kind !== undefined) {
    if (!["bank", "mobile_money", "cash"].includes(body.kind)) {
      return NextResponse.json({ error: "Pick bank, mobile money or cash." }, { status: 400 });
    }
    updates.kind = body.kind;
  }
  if (body.currency !== undefined && body.currency !== account.currency) {
    if (typeof body.currency !== "string" || (await rateToUsd(ctx.admin, ctx.orgId, body.currency)) === null) {
      return NextResponse.json({ error: "Pick a currency with an exchange rate on file." }, { status: 400 });
    }
    if (await countEntries(ctx.admin, id)) {
      return NextResponse.json(
        { error: `This account already has entries in ${account.currency}, so its currency can't change. Delete them first, or open a new account.` },
        { status: 400 },
      );
    }
    updates.currency = body.currency;
  }
  if (body.openingBalance !== undefined) {
    const n = Number(body.openingBalance);
    if (!Number.isFinite(n)) return NextResponse.json({ error: "Enter a valid opening balance." }, { status: 400 });
    updates.opening_balance = Math.round(n * 100) / 100;
  }
  if (body.openingDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.openingDate)) {
      return NextResponse.json({ error: "Enter an opening date." }, { status: 400 });
    }
    if (await countEntries(ctx.admin, id, body.openingDate)) {
      return NextResponse.json({ error: "Some entries are dated before that opening date." }, { status: 400 });
    }
    updates.opening_date = body.openingDate;
  }

  const { error } = await ctx.admin.from("cash_accounts").update(updates).eq("id", id).eq("org_id", ctx.orgId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
