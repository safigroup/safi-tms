import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";

// Bundles printInvoice()'s three queries plus billInvoice()'s payments
// list (index.html) into one route. invoice_lines has no org_id column of
// its own, so the pattern here is verify-parent-then-fetch-children: the
// invoice lookup is org-scoped, and only once that confirms ownership do
// the lines/payments queries (scoped by invoice_id alone) run -- an
// invoice_id a route handler never independently verified would let
// invoice_lines leak across orgs, the same class of gap flagged for
// invoice_lines in the migration plan.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { id } = await params;

  const { data: invoice } = await ctx.admin
    .from("invoices")
    .select("*, customers(name,country,tpin,contact_email,payment_terms)")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!invoice) {
    return NextResponse.json({ error: "invoice not found" }, { status: 404 });
  }

  const [lines, payments] = await Promise.all([
    ctx.admin.from("invoice_lines").select("*").eq("invoice_id", id),
    ctx.admin.from("payments").select("*").eq("invoice_id", id).order("received_on"),
  ]);

  return NextResponse.json({
    invoice,
    lines: lines.data ?? [],
    payments: payments.data ?? [],
  });
}
