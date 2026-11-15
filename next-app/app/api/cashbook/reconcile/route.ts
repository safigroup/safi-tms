import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_USE_CASHBOOK } from "@/lib/auth/permissions";

const SOURCES = new Set(["manual", "payment", "trip_cost", "allocation", "truck_cost"]);
const BATCH = 200;

// Tick statement lines off against the account's own statement, or untick
// them. Each tick keeps the line's account and amount at that moment (see
// cash_reconciliations); a line that later moves or changes amount shows
// as not reconciled until it's ticked again.
export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_USE_CASHBOOK.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const body = await request.json();
  const items: { source: string; id: string }[] = Array.isArray(body.items) ? body.items : [];
  if (!items.length || items.length > 1000 || !items.every((i) => i && SOURCES.has(i.source) && typeof i.id === "string")) {
    return NextResponse.json({ error: "Pick the lines to reconcile." }, { status: 400 });
  }
  const reconciled = !!body.reconciled;

  if (!reconciled) {
    for (const source of new Set(items.map((i) => i.source))) {
      const ofSource = items.filter((i) => i.source === source).map((i) => i.id);
      for (let i = 0; i < ofSource.length; i += BATCH) {
        const { error } = await ctx.admin
          .from("cash_reconciliations")
          .delete()
          .eq("org_id", ctx.orgId)
          .eq("source", source)
          .in("record_id", ofSource.slice(i, i + BATCH));
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    return NextResponse.json({ ok: true });
  }

  // The lines as they stand now, from this organization only -- in batches,
  // so a long list of ids doesn't outgrow the request URL.
  const lines: { source: string; id: string; account_id: string; amount: number }[] = [];
  const ids = items.map((i) => i.id);
  for (let i = 0; i < ids.length; i += BATCH) {
    const { data, error } = await ctx.admin
      .from("cash_entries")
      .select("source, id, account_id, amount")
      .eq("org_id", ctx.orgId)
      .in("id", ids.slice(i, i + BATCH));
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    lines.push(...(data ?? []));
  }
  const wanted = new Set(items.map((i) => i.source + ":" + i.id));
  const rows = lines
    .filter((l) => wanted.has(l.source + ":" + l.id))
    .map((l) => ({
      org_id: ctx.orgId,
      account_id: l.account_id,
      source: l.source,
      record_id: l.id,
      amount: l.amount,
      reconciled_by: ctx.userId,
      reconciled_at: new Date().toISOString(),
    }));
  if (!rows.length) return NextResponse.json({ error: "line not found" }, { status: 404 });

  const { error } = await ctx.admin.from("cash_reconciliations").upsert(rows, { onConflict: "source,record_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, reconciled: rows.length });
}
