import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";

// Ports saveDoc() (index.html): existence-check-then-insert-or-update by
// (trip_id, doc_type) -- create_trip() seeds 4 pending rows per trip
// (consignment_note, packing_list, t1_transit, pod), so those always hit
// the update path; any other doc_type hits insert.
export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const body = await request.json();
  const { tripId, docType, storagePath } = body;

  if (!storagePath) {
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
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

  const { data: existing } = await ctx.admin
    .from("trip_documents")
    .select("id")
    .eq("trip_id", tripId)
    .eq("org_id", ctx.orgId)
    .eq("doc_type", docType)
    .maybeSingle();

  const payload = {
    storage_path: storagePath,
    doc_number: body.docNumber?.trim() || null,
    status: "issued",
    issued_on: new Date().toISOString().slice(0, 10),
    uploaded_by: ctx.userId,
  };

  const { error } = existing
    ? await ctx.admin.from("trip_documents").update(payload).eq("id", existing.id).eq("org_id", ctx.orgId)
    : await ctx.admin.from("trip_documents").insert({
        org_id: ctx.orgId,
        trip_id: tripId,
        doc_type: docType,
        ...payload,
      });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
