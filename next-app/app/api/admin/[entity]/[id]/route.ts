import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { ADMIN_ENTITIES, isAdminEntityKey } from "@/lib/admin/entities";

// Handles both a full edit and a toggle (is_active) -- a toggle is just a
// PATCH with one field, filtered through the same allowlist. An entity
// without is_active in its column list (routes, rate_cards) silently drops
// that key if somehow sent, rather than needing a separate check.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ entity: string; id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { entity, id } = await params;
  if (!isAdminEntityKey(entity)) {
    return NextResponse.json({ error: "unknown entity" }, { status: 404 });
  }
  const { table, columns } = ADMIN_ENTITIES[entity];

  const body = await request.json();
  const payload: Record<string, unknown> = {};
  for (const col of columns) {
    if (col in body) payload[col] = body[col];
  }

  const { error } = await ctx.admin
    .from(table)
    .update(payload)
    .eq("id", id)
    .eq("org_id", ctx.orgId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
