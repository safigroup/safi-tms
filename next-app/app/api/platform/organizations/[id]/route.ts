import { NextResponse } from "next/server";
import { getAuthedPlatformAdmin } from "@/lib/auth/getAuthedPlatformAdmin";
import { validTimeZone } from "@/lib/format";

const EDITABLE_FIELDS = ["name", "country", "base_currency", "trip_prefix", "invoice_prefix", "time_zone"] as const;
const UPPERCASE_FIELDS = new Set(["base_currency", "trip_prefix", "invoice_prefix"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedPlatformAdmin();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { id } = await params;
  const body = await request.json();

  const changed: Record<string, string> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body && typeof body[field] === "string" && body[field].trim()) {
      const value = body[field].trim();
      changed[field] = UPPERCASE_FIELDS.has(field) ? value.toUpperCase() : value;
    }
  }

  if ("time_zone" in changed && !validTimeZone(changed.time_zone)) {
    return NextResponse.json({ error: `Unknown time zone "${changed.time_zone}".` }, { status: 400 });
  }

  if (!Object.keys(changed).length) {
    return NextResponse.json({ ok: true, changed: 0 });
  }

  const { error } = await ctx.admin.from("organizations").update(changed).eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, changed: Object.keys(changed).length });
}
