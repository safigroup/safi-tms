import { NextResponse } from "next/server";
import { getAuthedApiKey } from "@/lib/auth/getAuthedApiKey";

// Read-only: lets an agent browse available routes (and whether each has a
// cost template to estimate against) before calling /api/agent/estimate.
export async function GET(request: Request) {
  const ctx = await getAuthedApiKey(request);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const [{ data: routes, error: routesError }, { data: templates, error: templatesError }, { data: paths, error: pathsError }] =
    await Promise.all([
      ctx.admin
        .from("routes")
        .select("id, name, origin, destination, distance_km, target_days, borders, is_active")
        .eq("org_id", ctx.orgId)
        .order("name"),
      ctx.admin
        .from("route_cost_templates")
        .select("route_id, category, amount, basis")
        .eq("org_id", ctx.orgId),
      ctx.admin
        .from("route_border_paths")
        .select("route_id, label, borders")
        .eq("org_id", ctx.orgId),
    ]);

  if (routesError) return NextResponse.json({ error: routesError.message }, { status: 400 });
  if (templatesError) return NextResponse.json({ error: templatesError.message }, { status: 400 });
  if (pathsError) return NextResponse.json({ error: pathsError.message }, { status: 400 });

  const result = (routes ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    origin: r.origin,
    destination: r.destination,
    distanceKm: r.distance_km,
    targetDays: r.target_days,
    isActive: r.is_active,
    defaultBorders: r.borders,
    alternateBorderPaths: (paths ?? []).filter((p) => p.route_id === r.id).map((p) => ({ label: p.label, borders: p.borders })),
    costTemplate: (templates ?? []).filter((t) => t.route_id === r.id).map((t) => ({ category: t.category, amount: t.amount, basis: t.basis })),
  }));

  return NextResponse.json({ routes: result });
}
