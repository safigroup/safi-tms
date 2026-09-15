import "server-only";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClientInternal } from "@/lib/supabase/admin";

type AuthedApiKey = {
  ok: true;
  orgId: string;
  admin: SupabaseClient;
};

type UnauthedResult = {
  ok: false;
  status: 401 | 403;
  reason: string;
};

/**
 * The one place an agent-facing route (app/api/agent/*) is allowed to get
 * hold of the service-role client. Unlike getAuthedOrgContext() and
 * getAuthedPlatformAdmin(), there's no Supabase auth session to check
 * first -- an external agent authenticates with a bearer API key, not a
 * login. The verification IS the service-role lookup itself: nothing is
 * handed back until the key's hash matches a real, non-revoked row, so a
 * route calling this still can't get a client without a real credential
 * checked first. Every agent route must start with:
 *
 *   const ctx = await getAuthedApiKey(request);
 *   if (!ctx.ok) return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
 *
 * and every query after that must filter by ctx.orgId, same as the
 * session-based entry points.
 */
export async function getAuthedApiKey(request: Request): Promise<AuthedApiKey | UnauthedResult> {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, status: 401, reason: "missing API key (Authorization: Bearer <key>)" };
  }

  const rawKey = match[1].trim();
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const admin = createAdminClientInternal();

  const { data: keyRow } = await admin
    .from("api_keys")
    .select("id, org_id")
    .eq("key_hash", keyHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (!keyRow) {
    return { ok: false, status: 401, reason: "invalid or revoked API key" };
  }

  try {
    await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRow.id);
  } catch (err) {
    console.error("[getAuthedApiKey] failed to bump last_used_at:", err instanceof Error ? err.message : err);
  }

  return { ok: true, orgId: keyRow.org_id, admin };
}
