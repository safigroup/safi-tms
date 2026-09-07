import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_EDIT_COMMERCIAL } from "@/lib/auth/permissions";
import { validateMilestones } from "@/lib/billing/validateMilestones";

// A customer's own payment schedule override -- fully replaces the org
// default (not merged) as soon as it has any rows. Unlike the org-default
// route, an empty submission here is valid: it means "stop overriding,
// fall back to the org default" (which resolveMilestonesDue() and
// raise_invoice() both already treat customer_id null as).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { id } = await params;
  const { data, error } = await ctx.admin
    .from("payment_milestones")
    .select("seq, label, pct, requires_pod")
    .eq("org_id", ctx.orgId)
    .eq("customer_id", id)
    .order("seq");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ milestones: data ?? [] });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_EDIT_COMMERCIAL.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { id } = await params;
  const { data: customer } = await ctx.admin
    .from("customers")
    .select("id")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!customer) {
    return NextResponse.json({ error: "customer not found" }, { status: 404 });
  }

  const body = await request.json();
  const empty = Array.isArray(body.milestones) && body.milestones.length === 0;
  const rows = empty ? [] : validateMilestones(body.milestones);
  if (rows === null) {
    return NextResponse.json({ error: "Milestones must each have a label and a positive percentage, summing to exactly 100%." }, { status: 400 });
  }

  const { error: deleteError } = await ctx.admin
    .from("payment_milestones")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("customer_id", id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  if (rows.length) {
    const { error: insertError } = await ctx.admin.from("payment_milestones").insert(
      rows.map((r, i) => ({ org_id: ctx.orgId, customer_id: id, seq: i + 1, ...r })),
    );
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}
