import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_USE_CASHBOOK } from "@/lib/auth/permissions";

// A wrong entry is deleted and re-entered, same as trip costs. A transfer
// leg takes its other leg with it, so money never appears to leave one
// account without arriving in the other.
export async function DELETE(
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
  const { data: tx } = await ctx.admin
    .from("cash_transactions")
    .select("id, transfer_id")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!tx) {
    return NextResponse.json({ error: "transaction not found" }, { status: 404 });
  }

  const del = ctx.admin.from("cash_transactions").delete().eq("org_id", ctx.orgId);
  const { error } = tx.transfer_id ? await del.eq("transfer_id", tx.transfer_id) : await del.eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
