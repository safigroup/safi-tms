import { NextResponse } from "next/server";
import { getAuthedPlatformAdmin } from "@/lib/auth/getAuthedPlatformAdmin";

// Platform-admin only: these are the platform operator's sales leads from
// the public landing page, never visible to any tenant org.
export async function GET() {
  const ctx = await getAuthedPlatformAdmin();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { data, error } = await ctx.admin
    .from("demo_requests")
    .select("id, created_at, name, company, email, phone, country, fleet_size, message, lang")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ requests: data ?? [] });
}
