import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_MANAGE_BILLING } from "@/lib/auth/permissions";

// Removes a payment recorded by mistake. remove_payment() deletes it and
// logs what was removed, by whom and why against the invoice, in one
// transaction; the invoice's status follows from its remaining payments.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_MANAGE_BILLING.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { id, paymentId } = await params;
  const { reason } = await request.json().catch(() => ({}));
  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "A reason is required." }, { status: 400 });
  }

  const { error } = await ctx.admin.rpc("remove_payment", {
    p_invoice: id,
    p_payment: paymentId,
    p_reason: reason.trim(),
    p_org: ctx.orgId,
    p_user: ctx.userId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
