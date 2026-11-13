import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_SEE_FINANCE_OVERVIEW } from "@/lib/auth/permissions";
import { CAPITAL_CATEGORIES } from "@/lib/trucks/costs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 1000;

// Each truck's running costs (everything but purchase, clearing and
// registration) incurred between from and to, in USD at the rate frozen
// on each entry -- for the Overview's profit per truck.
export async function GET(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_SEE_FINANCE_OVERVIEW.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const q = new URL(request.url).searchParams;
  const from = q.get("from");
  const to = q.get("to");
  if (!from || !to || !DATE.test(from) || !DATE.test(to)) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 });
  }

  const byTruck: Record<string, number> = {};
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await ctx.admin
      .from("truck_costs")
      .select("truck_id, category, amount_usd")
      .eq("org_id", ctx.orgId)
      .gte("incurred_on", from)
      .lte("incurred_on", to)
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    for (const c of data ?? []) {
      if (CAPITAL_CATEGORIES.has(c.category)) continue;
      byTruck[c.truck_id] = (byTruck[c.truck_id] ?? 0) + Number(c.amount_usd || 0);
    }
    if (!data || data.length < PAGE) break;
  }
  return NextResponse.json({ byTruck });
}
