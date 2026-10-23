import "server-only";
import { createAdminClientInternal } from "@/lib/supabase/admin";
import type { DemoRequestInput } from "./createDemoRequest";
import { buildDemoRequestEmail } from "./notificationEmail";
import { DEMO_COUNTRIES, DEMO_FLEET_SIZES } from "./options";

// Resend's shared test sender. It only delivers to the Resend account's
// own address, which is enough to start with; set DEMO_REQUEST_FROM to an
// address on a domain verified in Resend to reach every platform admin.
const DEFAULT_FROM = "Safi TMS <onboarding@resend.dev>";

// Emails every platform admin -- the same people who can see
// /demo-requests -- about a new landing-page demo request. Does nothing
// until RESEND_API_KEY is set. Runs after the visitor already has their
// response (see after() in the route), and the request is saved either
// way, so a failure here is only logged.
export async function notifyDemoRequest(input: DemoRequestInput, appOrigin: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[notifyDemoRequest] RESEND_API_KEY is not set; no email sent");
    return;
  }

  try {
    const admin = createAdminClientInternal();
    const { data: admins, error } = await admin.from("platform_admins").select("user_id");
    if (error) throw new Error(`platform_admins lookup failed: ${error.message}`);
    const users = await Promise.all((admins ?? []).map((a) => admin.auth.admin.getUserById(a.user_id)));
    const to = users.map((u) => u.data.user?.email).filter((e): e is string => !!e);
    if (!to.length) throw new Error("no platform admin has an email address");

    const email = buildDemoRequestEmail({
      name: input.name,
      company: input.company,
      email: input.email,
      phone: input.phone,
      countryName: DEMO_COUNTRIES.find((c) => c.code === input.country)?.en ?? null,
      fleetLabel: DEMO_FLEET_SIZES.find((f) => f.code === input.fleetSize)?.en ?? null,
      message: input.message,
      lang: input.lang,
      requestsUrl: `${appOrigin}/demo-requests`,
    });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.DEMO_REQUEST_FROM || DEFAULT_FROM,
        to,
        ...(input.email ? { reply_to: input.email } : {}),
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
  } catch (err) {
    console.error("[notifyDemoRequest]", err instanceof Error ? err.message : err);
  }
}
