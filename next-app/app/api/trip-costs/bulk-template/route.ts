import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_MANAGE_TRIPS } from "@/lib/auth/permissions";

const HEADER = "trip_no,category,amount,currency,incurred_on,description,location,paid_by,receipt_ref,liters,price_per_liter";
const EXAMPLE = "TRIP-2026-0042,fuel,850.00,USD,2026-03-05,Diesel at Nakonde,Nakonde,driver_float,RCPT-1123,580,1.4655";

// Generated rather than a static file so the columns can never drift from
// what /api/trip-costs/bulk actually expects.
export async function GET() {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_MANAGE_TRIPS.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const csv = `${HEADER}\n${EXAMPLE}\n`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="trip-costs-template.csv"',
    },
  });
}
