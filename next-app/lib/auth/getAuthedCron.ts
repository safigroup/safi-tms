import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClientInternal } from "@/lib/supabase/admin";

type AuthedCron = {
  ok: true;
  admin: SupabaseClient;
};

type UnauthedResult = {
  ok: false;
  status: 401;
  reason: string;
};

/**
 * The one place a Vercel Cron job is allowed to get hold of the
 * service-role client. There's no user and no single org here -- a cron
 * route runs across every org -- so unlike getAuthedOrgContext() and
 * getAuthedApiKey(), the only credential is a shared secret. Once
 * CRON_SECRET is set as an environment variable, Vercel automatically
 * sends `Authorization: Bearer <CRON_SECRET>` on every request it makes to
 * a path listed in vercel.json's `crons` -- so a request missing or
 * mismatching that header was never sent by Vercel and is refused before
 * any query runs, the same "verification IS the lookup" shape as the other
 * two entry points.
 */
export async function getAuthedCron(request: Request): Promise<AuthedCron | UnauthedResult> {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization") ?? "";
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return { ok: false, status: 401, reason: "unauthorized" };
  }
  return { ok: true, admin: createAdminClientInternal() };
}
