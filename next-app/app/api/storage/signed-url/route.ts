import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";

const BUCKET = "trip-docs";

// Takes a record id (a trip_costs or trip_documents row), never a raw
// storage path -- the path is re-derived from an org-scoped lookup here.
// Accepting a client-supplied path directly would mean this route's only
// protection was "did the client happen to already know a real path",
// which the client only knew because a previous org-scoped query returned
// it -- fine as a UI convenience, not something to trust as an auth check.
export async function GET(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { searchParams } = new URL(request.url);
  const costId = searchParams.get("costId");
  const docId = searchParams.get("docId");

  let storagePath: string | null = null;

  if (costId) {
    const { data } = await ctx.admin
      .from("trip_costs")
      .select("receipt_path")
      .eq("id", costId)
      .eq("org_id", ctx.orgId)
      .maybeSingle();
    storagePath = data?.receipt_path ?? null;
  } else if (docId) {
    const { data } = await ctx.admin
      .from("trip_documents")
      .select("storage_path")
      .eq("id", docId)
      .eq("org_id", ctx.orgId)
      .maybeSingle();
    storagePath = data?.storage_path ?? null;
  } else {
    return NextResponse.json({ error: "costId or docId is required" }, { status: 400 });
  }

  if (!storagePath) {
    return NextResponse.json({ error: "no file on this record" }, { status: 404 });
  }

  const { data, error } = await ctx.admin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600);

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "couldn't sign url" }, { status: 400 });
  }

  return NextResponse.json({ url: data.signedUrl });
}
