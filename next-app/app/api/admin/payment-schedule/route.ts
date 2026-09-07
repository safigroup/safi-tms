import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_EDIT_COMMERCIAL } from "@/lib/auth/permissions";
import { validateMilestones } from "@/lib/billing/validateMilestones";

// The organization's default payment schedule (customer_id null) -- what
// every customer without their own override is invoiced against. Unlike
// the customer-specific route, an empty submission is rejected rather than
// treated as "revert to default": there is no further fallback for the
// default itself, so the org must always have at least one valid schedule.
export async function GET() {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { data, error } = await ctx.admin
    .from("payment_milestones")
    .select("seq, label, pct, requires_pod")
    .eq("org_id", ctx.orgId)
    .is("customer_id", null)
    .order("seq");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ milestones: data ?? [] });
}

export async function PUT(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_EDIT_COMMERCIAL.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const body = await request.json();
  const rows = validateMilestones(body.milestones);
  if (!rows) {
    return NextResponse.json({ error: "Milestones must each have a label and a positive percentage, summing to exactly 100%." }, { status: 400 });
  }

  const { error: deleteError } = await ctx.admin
    .from("payment_milestones")
    .delete()
    .eq("org_id", ctx.orgId)
    .is("customer_id", null);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  const { error: insertError } = await ctx.admin.from("payment_milestones").insert(
    rows.map((r, i) => ({ org_id: ctx.orgId, customer_id: null, seq: i + 1, ...r })),
  );
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
