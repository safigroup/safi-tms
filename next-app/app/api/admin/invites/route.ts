import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";

// Ports the reset-password hierarchy: an admin can invite ops/finance/viewer,
// but not another admin or the owner -- only the owner can do that.
export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { email, role } = await request.json();

  const allowed =
    ctx.role === "owner" ||
    (ctx.role === "admin" && role !== "owner" && role !== "admin");
  if (!allowed) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  // Creates the auth.users row and returns a hashed_token, without sending
  // any email itself -- the admin relays the link manually, same as the
  // temp-password reveal in the reset-password flow. We build our own URL
  // from hashed_token rather than forwarding action_link, so the invitee's
  // browser can redeem it via verifyOtp() directly regardless of this
  // project's redirect-URL/PKCE configuration.
  const { data, error } = await ctx.admin.auth.admin.generateLink({
    type: "invite",
    email,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { error: membershipError } = await ctx.admin.from("memberships").insert({
    org_id: ctx.orgId,
    user_id: data.user.id,
    role,
  });

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  return NextResponse.json({
    inviteUrl: `${origin}/accept-invite?token_hash=${data.properties.hashed_token}`,
  });
}
