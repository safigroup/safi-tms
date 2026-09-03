import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_MANAGE_TRIPS } from "@/lib/auth/permissions";

// Ports createTrip() (index.html) onto the create_trip() Postgres function.
export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_MANAGE_TRIPS.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const body = await request.json();
  const { customerId, routeId, revenue } = body;

  if (!customerId || !routeId) {
    return NextResponse.json(
      { error: "Customer and route are both required." },
      { status: 400 },
    );
  }
  const rev = Number(revenue);
  if (!Number.isFinite(rev) || rev <= 0) {
    return NextResponse.json(
      { error: "Enter the agreed revenue." },
      { status: 400 },
    );
  }

  const { data, error } = await ctx.admin
    .rpc("create_trip", {
      p_org: ctx.orgId,
      p_customer: customerId,
      p_route: routeId,
      p_revenue: rev,
      p_truck: body.truckId || null,
      p_driver: body.driverId || null,
      p_commodity: body.commodity?.trim() || null,
      p_tonnage: body.tonnage ? Number(body.tonnage) : null,
      p_container_no: body.containerNo?.trim() || null,
      p_seal_no: body.sealNo?.trim() || null,
      p_load_date: body.loadDate || null,
      p_eta: body.eta || null,
      p_user: ctx.userId,
      p_borders: Array.isArray(body.borders) && body.borders.length ? body.borders : null,
      p_agent_name: body.agentName?.trim() || null,
    })
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const trip = data as { id: string; trip_no: string };
  return NextResponse.json({ id: trip.id, tripNo: trip.trip_no });
}
