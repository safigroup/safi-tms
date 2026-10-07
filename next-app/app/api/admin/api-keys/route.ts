import { NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_MANAGE_TEAM } from "@/lib/auth/permissions";

// Issuing a key that can call the agent-facing API on this org's behalf is
// comparable in sensitivity to inviting a new team member -- just a robot
// one -- so it's gated the same way (CAN_MANAGE_TEAM), not CAN_EDIT_FLEET
// or CAN_EDIT_COMMERCIAL like the data the agent API actually reads.
export async function GET() {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_MANAGE_TEAM.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const { data, error } = await ctx.admin
    .from("api_keys")
    .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ keys: data ?? [] });
}

// Only ever returns the raw key on this one response -- it's not
// recoverable afterward, same as an invite link. Only the hash is stored.
export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_MANAGE_TEAM.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const body = await request.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Give the key a name so it's recognizable later." }, { status: 400 });
  }

  const rawKey = "sk_" + randomBytes(32).toString("hex");
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 11);

  const { error } = await ctx.admin.from("api_keys").insert({
    org_id: ctx.orgId,
    name,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    created_by: ctx.userId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ key: rawKey });
}
