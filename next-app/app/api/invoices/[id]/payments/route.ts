import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";

// Ports pay() (index.html). Currency is the invoice's own currency, not a
// client-supplied value -- looked up server-side from the org-scoped
// invoice row rather than trusted from the request body.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { id } = await params;
  const body = await request.json();
  const amt = Number(body.amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return NextResponse.json({ error: "Enter an amount greater than zero." }, { status: 400 });
  }

  const { data: invoice } = await ctx.admin
    .from("invoices")
    .select("id, currency")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!invoice) {
    return NextResponse.json({ error: "invoice not found" }, { status: 404 });
  }

  const { error } = await ctx.admin.from("payments").insert({
    org_id: ctx.orgId,
    invoice_id: id,
    amount: amt,
    currency: invoice.currency,
    received_on: body.receivedOn,
    method: body.method,
    reference: body.reference?.trim() || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
