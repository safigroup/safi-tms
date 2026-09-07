import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_MANAGE_BILLING } from "@/lib/auth/permissions";

// Wraps raise_invoice() -- the RPC's amount math and business rules
// (cumulative-percent-per-milestone, rounding-drift self-correction, the
// per-milestone POD gate) live entirely in the database function; this
// route just authenticates and forwards which milestone (by seq, from the
// customer's resolved payment schedule) to raise.
export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_MANAGE_BILLING.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { tripId, seq } = await request.json();

  const { data, error } = await ctx.admin.rpc("raise_invoice", {
    p_trip: tripId,
    p_seq: seq,
    p_org: ctx.orgId,
    p_user: ctx.userId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ id: data });
}
