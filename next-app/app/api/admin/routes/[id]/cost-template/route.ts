import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_EDIT_FLEET } from "@/lib/auth/permissions";
import { validateCostTemplate } from "@/lib/estimates/validateCostTemplate";

// A route's expected cost breakdown, used by the trip cost estimator --
// the cost-side counterpart to a customer's payment schedule. Unlike that
// one, there's no "org default to fall back to" here: a route with no
// template just means the estimator has nothing to show for it yet.
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
    .from("route_cost_templates")
    .select("id, category, amount, currency, basis")
    .eq("org_id", ctx.orgId)
    .eq("route_id", id)
    .order("category");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ lines: data ?? [] });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_EDIT_FLEET.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { id } = await params;
  const { data: route } = await ctx.admin
    .from("routes")
    .select("id")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!route) {
    return NextResponse.json({ error: "route not found" }, { status: 404 });
  }

  const body = await request.json();
  const rows = validateCostTemplate(body.lines);
  if (rows === null) {
    return NextResponse.json({ error: "Each line needs a valid category, a positive amount, a currency, and a basis." }, { status: 400 });
  }

  const { error: deleteError } = await ctx.admin
    .from("route_cost_templates")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("route_id", id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  if (rows.length) {
    const { error: insertError } = await ctx.admin.from("route_cost_templates").insert(
      rows.map((r) => ({ org_id: ctx.orgId, route_id: id, ...r })),
    );
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}
