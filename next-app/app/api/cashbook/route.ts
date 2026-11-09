import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_USE_CASHBOOK } from "@/lib/auth/permissions";
import { TRANSFER_CATEGORY } from "@/lib/cashbook/categories";

// The Cashbook page's overview: every account with today's balance, the
// currencies an account can be opened in (USD plus any with a rate on
// file -- the same set the rest of the app offers), and categories this
// organization has already used, for the entry form's suggestions.
export async function GET() {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_USE_CASHBOOK.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const [accounts, balances, fx, used] = await Promise.all([
    ctx.admin
      .from("cash_accounts")
      .select("id, name, kind, currency, opening_balance, opening_date, is_active")
      .eq("org_id", ctx.orgId)
      .order("name"),
    ctx.admin.from("cash_account_balances").select("account_id, balance").eq("org_id", ctx.orgId),
    ctx.admin.from("fx_rates").select("currency").eq("org_id", ctx.orgId),
    ctx.admin
      .from("cash_transactions")
      .select("direction, category")
      .eq("org_id", ctx.orgId)
      .neq("category", TRANSFER_CATEGORY)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  const failed = accounts.error ?? balances.error ?? fx.error ?? used.error;
  if (failed) {
    return NextResponse.json({ error: failed.message }, { status: 400 });
  }

  const balanceById = new Map((balances.data ?? []).map((b) => [b.account_id, Number(b.balance)]));
  const currencies = Array.from(new Set(["USD", ...(fx.data ?? []).map((r) => r.currency)])).sort();
  const usedCategories = { in: new Set<string>(), out: new Set<string>() };
  for (const t of used.data ?? []) usedCategories[t.direction as "in" | "out"].add(t.category);

  return NextResponse.json({
    accounts: (accounts.data ?? []).map((a) => ({ ...a, balance: balanceById.get(a.id) ?? Number(a.opening_balance) })),
    currencies,
    usedCategories: { in: [...usedCategories.in], out: [...usedCategories.out] },
  });
}
