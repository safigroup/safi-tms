import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";

// Separate from the generic /api/admin/[entity] route -- fx_rates is
// upsert-only (never a plain insert-then-update-by-id), keyed on
// (org_id, currency, effective_on), with no toggle. Forcing it into the
// generic entity shape would be exactly the over-engineering avoided
// elsewhere in this migration.
export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { currency, unitsPerUsd, effectiveOn, source } = await request.json();
  const per = Number(unitsPerUsd);
  if (!Number.isFinite(per) || per <= 0) {
    return NextResponse.json({ error: "Enter how many units buy one dollar." }, { status: 400 });
  }

  const { error } = await ctx.admin.from("fx_rates").upsert(
    {
      org_id: ctx.orgId,
      currency,
      rate_to_usd: 1 / per,
      effective_on: effectiveOn,
      source: source?.trim() || null,
    },
    { onConflict: "org_id,currency,effective_on" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
