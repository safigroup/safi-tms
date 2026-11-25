import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_MANAGE_TEAM } from "@/lib/auth/permissions";
import { COMPANY_FIELDS, COMPANY_MAX } from "@/lib/company";

// Admin -> Company: the letterhead every printed document carries, and the
// bank details invoices print under "Remit to". Owners and admins only --
// it's what customers see the company as. Only fields present in the body
// change; an empty one is cleared (and left off the page).
const LABEL: Record<(typeof COMPANY_FIELDS)[number], string> = {
  legal_name: "Name",
  registration_no: "Registration",
  tax_id: "Tax number",
  address: "Address",
  contact_phone: "Phone",
  contact_email: "Email",
  bank_details: "Bank details",
};

export async function PATCH(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_MANAGE_TEAM.has(ctx.role)) {
    return NextResponse.json({ error: "Only an owner or admin can change the company's details." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }

  const changed: Record<string, string | null> = {};
  for (const field of COMPANY_FIELDS) {
    if (!(field in body)) continue;
    const raw = body[field];
    if (raw !== null && typeof raw !== "string") {
      return NextResponse.json({ error: `${LABEL[field]} must be text.` }, { status: 400 });
    }
    // Trim each line; keep line breaks only where they mean something.
    const value = (raw ?? "")
      .split("\n")
      .map((l: string) => l.trim())
      .filter(Boolean)
      .join(field === "address" || field === "bank_details" ? "\n" : " ");
    if (value.length > COMPANY_MAX[field]) {
      return NextResponse.json({ error: `${LABEL[field]} is too long (at most ${COMPANY_MAX[field]} characters).` }, { status: 400 });
    }
    if (field === "contact_email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
    }
    changed[field] = value || null;
  }

  if (!Object.keys(changed).length) {
    return NextResponse.json({ ok: true, changed: 0 });
  }

  const { error } = await ctx.admin.from("organizations").update(changed).eq("id", ctx.orgId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, changed: Object.keys(changed).length });
}
