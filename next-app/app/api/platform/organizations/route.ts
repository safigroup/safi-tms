import { NextResponse } from "next/server";
import { getAuthedPlatformAdmin } from "@/lib/auth/getAuthedPlatformAdmin";

export async function GET() {
  const ctx = await getAuthedPlatformAdmin();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { data, error } = await ctx.admin
    .from("organizations")
    .select("id, name, country, base_currency, trip_prefix, invoice_prefix, created_at")
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ organizations: data ?? [] });
}

// Creates an organization and, in the same request, invites its first
// owner -- same generateLink()+memberships-insert technique as
// app/api/admin/invites/route.ts, just parameterized by the org just
// created here instead of the caller's own ctx.orgId, and always role
// "owner" since this is the org's very first member.
//
// Order matters: the invite is generated *before* the organization is
// created. generateLink() is the step most likely to fail (most commonly
// because ownerEmail already has an account), and failing there first means
// nothing has been written yet -- no orphaned organization left behind for
// the caller to clean up by hand. The remaining membership-insert step
// essentially can't fail (both ids were just created), but if it somehow
// does, the organization is deleted again rather than left ownerless.
export async function POST(request: Request) {
  const ctx = await getAuthedPlatformAdmin();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const body = await request.json();
  const { name, country, baseCurrency, tripPrefix, invoicePrefix, ownerEmail } = body;

  if (!name?.trim() || !country?.trim() || !baseCurrency?.trim() || !tripPrefix?.trim() || !invoicePrefix?.trim()) {
    return NextResponse.json({ error: "Name, country, currency, and both prefixes are required." }, { status: 400 });
  }
  if (!ownerEmail?.trim()) {
    return NextResponse.json({ error: "The new organization's owner email is required." }, { status: 400 });
  }

  const { data, error } = await ctx.admin.auth.admin.generateLink({
    type: "invite",
    email: ownerEmail.trim(),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data: org, error: orgError } = await ctx.admin
    .from("organizations")
    .insert({
      name: name.trim(),
      country: country.trim(),
      base_currency: baseCurrency.trim().toUpperCase(),
      trip_prefix: tripPrefix.trim().toUpperCase(),
      invoice_prefix: invoicePrefix.trim().toUpperCase(),
    })
    .select("id, name")
    .single();

  if (orgError) {
    return NextResponse.json({ error: orgError.message }, { status: 400 });
  }

  const { error: membershipError } = await ctx.admin.from("memberships").insert({
    org_id: org.id,
    user_id: data.user.id,
    role: "owner",
  });

  if (membershipError) {
    await ctx.admin.from("organizations").delete().eq("id", org.id);
    return NextResponse.json({ error: membershipError.message }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  return NextResponse.json({
    id: org.id,
    name: org.name,
    inviteUrl: `${origin}/accept-invite?token_hash=${data.properties.hashed_token}`,
  });
}
