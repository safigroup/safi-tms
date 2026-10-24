import "server-only";
import { createHash } from "crypto";
import { createAdminClientInternal } from "@/lib/supabase/admin";

export type DemoRequestInput = {
  name: string;
  company: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  fleetSize: string | null;
  message: string | null;
  lang: "en" | "fr";
};

const MAX_PER_IP_PER_HOUR = 5;

// The public landing page's only write path. Unlike the getAuthed*()
// helpers this never hands the service-role client back to its caller --
// a public form has no one to authenticate, so the client stays inside
// this file and the route can do exactly one thing with it: record a demo
// request, subject to a per-IP hourly limit.
export async function createDemoRequest(
  input: DemoRequestInput,
  ip: string,
): Promise<{ ok: true } | { ok: false; reason: "rate_limited" | "failed" }> {
  const admin = createAdminClientInternal();
  const ipHash = createHash("sha256").update(ip).digest("hex");
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count, error: countError } = await admin
    .from("demo_requests")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  if (countError) {
    console.error("[createDemoRequest] rate-limit lookup failed:", countError.message);
    return { ok: false, reason: "failed" };
  }
  if ((count ?? 0) >= MAX_PER_IP_PER_HOUR) {
    return { ok: false, reason: "rate_limited" };
  }

  const { error } = await admin.from("demo_requests").insert({
    name: input.name,
    company: input.company,
    email: input.email,
    phone: input.phone,
    country: input.country,
    fleet_size: input.fleetSize,
    message: input.message,
    lang: input.lang,
    ip_hash: ipHash,
  });
  if (error) {
    console.error("[createDemoRequest] insert failed:", error.message);
    return { ok: false, reason: "failed" };
  }
  return { ok: true };
}
