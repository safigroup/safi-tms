import { NextResponse } from "next/server";
import { getAuthedCron } from "@/lib/auth/getAuthedCron";

// open.er-api.com is free, keyless, and covers every currency this app has
// ever used (USD/TZS/ZMW/CDF/RWF confirmed) -- no account to manage, no
// quota to watch.
const FX_API_URL = "https://open.er-api.com/v6/latest/USD";

// Twice a month (see vercel.json), refreshes every currency an org
// already tracks -- it never introduces a currency no one asked for, it
// only keeps existing ones current. Always INSERTS a new row dated today
// (upserting only against today's own date, the same (org_id, currency,
// effective_on) key /api/admin/fx-rates already uses) -- it never
// touches a past row, since trip_costs freezes whatever rate was on file
// when each cost was entered. Safe to invoke more than once on the same
// day: re-upserting today's row is a no-op-shaped overwrite, not a second
// charge, which is what Vercel's cron delivery (best-effort, occasionally
// duplicated) requires.
export async function GET(request: Request) {
  const ctx = await getAuthedCron(request);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { data: existing, error: existingError } = await ctx.admin
    .from("fx_rates")
    .select("org_id, currency")
    .neq("currency", "USD");
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const tracked = Array.from(
    new Map((existing ?? []).map((r) => [`${r.org_id}:${r.currency}`, r])).values(),
  );
  if (!tracked.length) {
    return NextResponse.json({ ok: true, updated: [], skipped: [] });
  }

  let rates: Record<string, number>;
  try {
    const res = await fetch(FX_API_URL);
    if (!res.ok) {
      return NextResponse.json({ error: `fx api responded ${res.status}` }, { status: 502 });
    }
    const json = await res.json();
    rates = json.rates ?? {};
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "fx api request failed" }, { status: 502 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const updated: string[] = [];
  const skipped: string[] = [];
  for (const { org_id, currency } of tracked) {
    const unitsPerUsd = rates[currency];
    if (!unitsPerUsd) {
      skipped.push(`${org_id}:${currency}`);
      continue;
    }
    const { error } = await ctx.admin.from("fx_rates").upsert(
      {
        org_id,
        currency,
        rate_to_usd: 1 / unitsPerUsd,
        effective_on: today,
        source: "open.er-api.com (auto)",
      },
      { onConflict: "org_id,currency,effective_on" },
    );
    if (error) {
      skipped.push(`${org_id}:${currency}`);
      continue;
    }
    updated.push(`${org_id}:${currency}`);
  }

  return NextResponse.json({ ok: true, updated, skipped });
}
