import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";

// Mirrors loadTrip() (index.html): trip_costs + trip_documents for one
// trip. Both tables carry their own org_id, so filtering directly by it
// (alongside trip_id) is the same "tables with their own org_id column"
// pattern as /api/bootstrap, not the verify-parent-first pattern needed
// for tables without one (e.g. invoice_lines).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { id } = await params;

  const [costs, documents] = await Promise.all([
    ctx.admin
      .from("trip_costs")
      .select("*")
      .eq("trip_id", id)
      .eq("org_id", ctx.orgId)
      .order("incurred_on", { ascending: false }),
    ctx.admin
      .from("trip_documents")
      .select("*")
      .eq("trip_id", id)
      .eq("org_id", ctx.orgId)
      .order("doc_type"),
  ]);

  return NextResponse.json({
    costs: costs.data ?? [],
    documents: documents.data ?? [],
  });
}
