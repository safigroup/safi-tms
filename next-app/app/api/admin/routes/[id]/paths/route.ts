import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_EDIT_FLEET } from "@/lib/auth/permissions";

// Alternate border-crossing paths for a route -- routes.borders stays the
// route's default; these are additional options a trip can pick from at
// creation time. Routes are in the "fleet" permission bucket already.
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
    .from("route_border_paths")
    .select("id, route_id, label, borders")
    .eq("org_id", ctx.orgId)
    .eq("route_id", id)
    .order("label");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ paths: data ?? [] });
}

export async function POST(
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
  const label = String(body.label || "").trim();
  const borders: string[] = Array.isArray(body.borders) ? body.borders.map((b: unknown) => String(b).trim()).filter(Boolean) : [];
  if (!label) {
    return NextResponse.json({ error: "A label is required." }, { status: 400 });
  }
  if (!borders.length) {
    return NextResponse.json({ error: "At least one border is required." }, { status: 400 });
  }

  const { data, error } = await ctx.admin
    .from("route_border_paths")
    .insert({ org_id: ctx.orgId, route_id: id, label, borders })
    .select("id, route_id, label, borders")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data);
}
