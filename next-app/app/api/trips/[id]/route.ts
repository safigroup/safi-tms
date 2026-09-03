import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_OVERRIDE_RECORDS } from "@/lib/auth/permissions";
import { diffFields, writeAuditLog, getAuditLog } from "@/lib/auditLog";

const EDITABLE_FIELDS = [
  "customer_id", "route_id", "truck_id", "driver_id",
  "commodity", "tonnage", "container_no", "seal_no", "borders", "agent_name",
  "revenue_amount", "actual_load_date", "planned_eta", "actual_delivery_at",
];

// Edit history for the trip -- trip_no and status are deliberately not
// editable here: trip_no is the business identifier referenced on
// invoices/documents, and status stays behind advance_trip_status's
// state-machine validation.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { id } = await params;
  const { entries, error } = await getAuditLog(ctx.admin, ctx.orgId, "trips", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ entries });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_OVERRIDE_RECORDS.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { id } = await params;
  const { data: current } = await ctx.admin
    .from("trips")
    .select("*")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!current) {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }

  const body = await request.json();

  if (body.customer_id && !(await belongsToOrg(ctx.admin, "customers", body.customer_id, ctx.orgId))) {
    return NextResponse.json({ error: "customer does not belong to this organisation" }, { status: 400 });
  }
  if (body.route_id && !(await belongsToOrg(ctx.admin, "routes", body.route_id, ctx.orgId))) {
    return NextResponse.json({ error: "route does not belong to this organisation" }, { status: 400 });
  }
  if (body.truck_id && !(await belongsToOrg(ctx.admin, "trucks", body.truck_id, ctx.orgId))) {
    return NextResponse.json({ error: "truck does not belong to this organisation" }, { status: 400 });
  }
  if (body.driver_id && !(await belongsToOrg(ctx.admin, "drivers", body.driver_id, ctx.orgId))) {
    return NextResponse.json({ error: "driver does not belong to this organisation" }, { status: 400 });
  }

  const changed = diffFields(current, body, EDITABLE_FIELDS);
  if (!Object.keys(changed).length) {
    return NextResponse.json({ ok: true, changed: 0 });
  }

  const { error } = await ctx.admin.from("trips").update(changed).eq("id", id).eq("org_id", ctx.orgId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await writeAuditLog(ctx.admin, ctx.orgId, "trips", id, ctx.userId, current, changed);

  let warning: string | null = null;
  if ("revenue_amount" in changed) {
    const { count } = await ctx.admin
      .from("invoice_lines")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", id);
    if (count && count > 0) {
      warning = "This trip already has invoice(s) raised against it — they were not updated automatically.";
    }
  }

  return NextResponse.json({ ok: true, changed: Object.keys(changed).length, warning });
}

async function belongsToOrg(admin: SupabaseClient, table: string, id: string, orgId: string) {
  const { data } = await admin.from(table).select("id").eq("id", id).eq("org_id", orgId).maybeSingle();
  return !!data;
}
