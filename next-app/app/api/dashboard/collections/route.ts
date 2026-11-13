import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_SEE_FINANCE_OVERVIEW } from "@/lib/auth/permissions";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 1000;

// Cash collected (invoice payments received) in two date ranges, in USD --
// the one Overview figure /api/bootstrap doesn't already carry. Each
// payment converts at the rate that was on file on the day it arrived,
// falling back to the oldest rate when it predates them all.
export async function GET(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_SEE_FINANCE_OVERVIEW.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const q = new URL(request.url).searchParams;
  const ranges = { current: [q.get("from"), q.get("to")], previous: [q.get("prevFrom"), q.get("prevTo")] };
  if (![...ranges.current, ...ranges.previous].every((d) => d && DATE.test(d))) {
    return NextResponse.json({ error: "from, to, prevFrom and prevTo must be YYYY-MM-DD" }, { status: 400 });
  }
  const earliest = [ranges.current[0]!, ranges.previous[0]!].sort()[0];
  const latest = [ranges.current[1]!, ranges.previous[1]!].sort()[1];

  const payments: { received_on: string; amount: number; currency: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.admin
      .from("payments")
      .select("received_on, amount, currency")
      .eq("org_id", ctx.orgId)
      .gte("received_on", earliest)
      .lte("received_on", latest)
      .order("received_on")
      .range(from, from + PAGE - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    payments.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const { data: rates, error: ratesError } = await ctx.admin
    .from("fx_rates")
    .select("currency, rate_to_usd, effective_on")
    .eq("org_id", ctx.orgId)
    .order("effective_on", { ascending: false });
  if (ratesError) {
    return NextResponse.json({ error: ratesError.message }, { status: 400 });
  }
  const rateOn = (currency: string, day: string) => {
    if (currency === "USD") return 1;
    const forCurrency = (rates ?? []).filter((r) => r.currency === currency);
    const r = forCurrency.find((x) => x.effective_on <= day) ?? forCurrency.at(-1);
    return r ? Number(r.rate_to_usd) : null;
  };

  const missing = new Set<string>();
  const sum = ([from, to]: (string | null)[]) =>
    payments
      .filter((p) => p.received_on >= from! && p.received_on <= to!)
      .reduce((s, p) => {
        const rate = rateOn(p.currency, p.received_on);
        if (rate === null) {
          missing.add(p.currency);
          return s;
        }
        return s + Number(p.amount) * rate;
      }, 0);

  return NextResponse.json({ current: sum(ranges.current), previous: sum(ranges.previous), missingRates: [...missing] });
}
