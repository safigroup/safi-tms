import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { ADMIN_ENTITIES, isAdminEntityKey } from "@/lib/admin/entities";
import { CAN_EDIT_COMMERCIAL, CAN_EDIT_FLEET } from "@/lib/auth/permissions";

// Generic create for the admin master-data entities. params.entity must be
// an allowlist key (404 otherwise) -- this is the one place in the app
// where a route segment maps to a table name, and it must never fall
// through to an unchecked .from(entity).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ entity: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { entity } = await params;
  if (!isAdminEntityKey(entity)) {
    return NextResponse.json({ error: "unknown entity" }, { status: 404 });
  }
  const { table, columns, permission } = ADMIN_ENTITIES[entity];
  const allowed = permission === "fleet" ? CAN_EDIT_FLEET : CAN_EDIT_COMMERCIAL;
  if (!allowed.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const body = await request.json();
  const payload: Record<string, unknown> = { org_id: ctx.orgId };
  for (const col of columns) {
    if (col in body) payload[col] = body[col];
  }

  const { data, error } = await ctx.admin.from(table).insert(payload).select("id").single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ id: data.id });
}
