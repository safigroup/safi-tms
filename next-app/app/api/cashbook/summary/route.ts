import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_USE_CASHBOOK } from "@/lib/auth/permissions";
import { isMonth, loadCashbook } from "@/lib/cashbook/report";
import { buildCashSummary, monthBounds } from "@/lib/cashbook/summary";

// The monthly summary for a range of months: money in against money out
// by category across every account, in USD (see lib/cashbook/summary.ts).
export async function GET(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_USE_CASHBOOK.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const q = new URL(request.url).searchParams;
  const from = q.get("from");
  const to = q.get("to");
  if (!isMonth(from) || !isMonth(to) || from > to) {
    return NextResponse.json({ error: "Pick a range of months." }, { status: 400 });
  }

  try {
    const { accounts, entries, rates } = await loadCashbook(ctx.admin, ctx.orgId, monthBounds(to).last);
    const currency = new Map(accounts.map((a) => [a.id, a.currency]));
    return NextResponse.json(buildCashSummary(entries, currency, rates, from, to, q.get("lang") === "fr" ? "fr" : "en"));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
