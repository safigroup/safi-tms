import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_MANAGE_BILLING } from "@/lib/auth/permissions";

// Wraps raise_invoice() -- the RPC's amount math and business rules
// (50/50 split, delivery-half self-correction, POD gate) are untouched
// from the original; only the auth model changed, in the Phase 0
// migration that made this callable from a service-role context.
export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_MANAGE_BILLING.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { tripId, type } = await request.json();

  const { data, error } = await ctx.admin.rpc("raise_invoice", {
    p_trip: tripId,
    p_type: type,
    p_org: ctx.orgId,
    p_user: ctx.userId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ id: data });
}
