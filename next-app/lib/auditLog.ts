import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Shared by trips/[id] and trip-costs/[id]'s PATCH routes -- both diff a
// submitted partial update against the current row, write one audit_log
// row per changed field, and expose that record's history back to the
// edit form that's already open on it.

export function diffFields(
  current: Record<string, unknown>,
  updates: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const f of fields) {
    if (!(f in updates)) continue;
    const next = updates[f];
    const prev = current[f];
    const same = Array.isArray(next) && Array.isArray(prev)
      ? JSON.stringify(next) === JSON.stringify(prev)
      : (next ?? null) === (prev ?? null);
    if (!same) changed[f] = next;
  }
  return changed;
}

function stringifyValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? v.join(", ") : String(v);
}

// Best-effort: a failed audit write doesn't fail the request that already
// succeeded, it's just logged server-side -- see the plan's reasoning on
// why this isn't wrapped in a single transactional RPC like create_trip is.
export async function writeAuditLog(
  admin: SupabaseClient,
  orgId: string,
  tableName: string,
  recordId: string,
  editedBy: string,
  current: Record<string, unknown>,
  changed: Record<string, unknown>,
) {
  const rows = Object.entries(changed).map(([field, newValue]) => ({
    org_id: orgId,
    table_name: tableName,
    record_id: recordId,
    field,
    old_value: stringifyValue(current[field]),
    new_value: stringifyValue(newValue),
    edited_by: editedBy,
  }));
  if (!rows.length) return;
  const { error } = await admin.from("audit_log").insert(rows);
  if (error) {
    console.error(`[audit_log] failed to record edit to ${tableName}/${recordId}:`, error.message);
  }
}

export async function getAuditLog(admin: SupabaseClient, orgId: string, tableName: string, recordId: string) {
  const { data: rows, error } = await admin
    .from("audit_log")
    .select("field, old_value, new_value, edited_by, edited_at")
    .eq("org_id", orgId)
    .eq("table_name", tableName)
    .eq("record_id", recordId)
    .order("edited_at", { ascending: false });

  if (error || !rows) return { entries: [], error };

  const userIds = Array.from(new Set(rows.map((r) => r.edited_by).filter(Boolean)));
  const emailById = new Map<string, string>();
  await Promise.all(
    userIds.map(async (uid) => {
      const { data } = await admin.auth.admin.getUserById(uid);
      if (data.user) emailById.set(uid, data.user.email ?? "");
    }),
  );

  const entries = rows.map((r) => ({
    field: r.field,
    old_value: r.old_value,
    new_value: r.new_value,
    edited_by_email: (r.edited_by && emailById.get(r.edited_by)) || "unknown",
    edited_at: r.edited_at,
  }));

  return { entries, error: null };
}
