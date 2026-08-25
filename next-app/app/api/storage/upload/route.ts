import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_MANAGE_TRIPS } from "@/lib/auth/permissions";

const BUCKET = "trip-docs";

// Ports upload() (index.html) server-side. The path scheme
// (${org}/${trip}/${timestamp}-${safeName}) is unchanged, but computing it
// here instead of client-side is the point: a service-role caller must
// verify the trip belongs to this org before writing into its folder,
// which the old RLS-protected client-side path didn't need to check
// explicitly (RLS enforced it implicitly).
export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_MANAGE_TRIPS.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const tripId = form.get("tripId");

  if (!(file instanceof File) || typeof tripId !== "string") {
    return NextResponse.json({ error: "file and tripId are required" }, { status: 400 });
  }

  const { data: trip } = await ctx.admin
    .from("trips")
    .select("id")
    .eq("id", tripId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }

  const safe = file.name.replace(/[^\w.-]/g, "_");
  const path = `${ctx.orgId}/${tripId}/${Date.now()}-${safe}`;

  const { error } = await ctx.admin.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ path });
}
