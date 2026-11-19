import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_EDIT_COMMERCIAL } from "@/lib/auth/permissions";
import { today } from "@/lib/format";
import { FX_FEED, fetchUnitsPerUsd } from "@/lib/fx/feed";

// "Get today's rates" on the Exchange rates page: what the daily job does
// for one org, on demand, for when the job is late. Vercel's cron delivery
// is best effort, so this is how a person puts things right without
// waiting for tomorrow's run.
//
// Every currency the org already tracks gets a new row dated today
// (company time), whether or not it was due -- whoever pressed the button
// wants today's rates. A currency already dated today is left alone, so a
// rate someone entered by hand this morning is never overwritten. Past
// rows are never touched: costs keep the rate they were entered at.
export async function POST() {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_EDIT_COMMERCIAL.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { data, error } = await ctx.admin
    .from("fx_rates")
    .select("currency, effective_on")
    .eq("org_id", ctx.orgId)
    .neq("currency", "USD")
    .order("effective_on", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const todayIso = today(ctx.timeZone);
  const newest = new Map<string, string>();
  for (const r of data ?? []) {
    const currency = String(r.currency).trim();
    if (!newest.has(currency) || r.effective_on > newest.get(currency)!) newest.set(currency, r.effective_on);
  }
  const current = [...newest].filter(([, on]) => on >= todayIso).map(([c]) => c).sort();
  const wanted = [...newest].filter(([, on]) => on < todayIso).map(([c]) => c).sort();
  if (!wanted.length) {
    return NextResponse.json({ updated: [], current, missing: [] });
  }

  const feed = await fetchUnitsPerUsd();
  if (feed.error !== null) {
    return NextResponse.json({ error: `Couldn't get today's rates: ${feed.error}.` }, { status: 502 });
  }

  const missing = wanted.filter((c) => !(Number(feed.rates[c]) > 0));
  const updated = wanted.filter((c) => Number(feed.rates[c]) > 0).map((currency) => ({ currency, unitsPerUsd: Number(feed.rates[currency]) }));
  if (updated.length) {
    const { error: saveError } = await ctx.admin.from("fx_rates").upsert(
      updated.map(({ currency, unitsPerUsd }) => ({
        org_id: ctx.orgId,
        currency,
        rate_to_usd: 1 / unitsPerUsd,
        effective_on: todayIso,
        source: `${FX_FEED} (on request)`,
      })),
      { onConflict: "org_id,currency,effective_on" },
    );
    if (saveError) {
      return NextResponse.json({ error: saveError.message }, { status: 400 });
    }
  }

  return NextResponse.json({ updated, current, missing });
}
