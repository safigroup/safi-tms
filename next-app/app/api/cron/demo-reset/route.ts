import { NextResponse } from "next/server";
import { getAuthedCron } from "@/lib/auth/getAuthedCron";

// Runs nightly (see vercel.json): rebuilds the demo company (Demo Haulage
// Ltd) from scratch with dates relative to today, so the Board shown to a
// prospect is always current and whatever was clicked during yesterday's
// demos is gone. reset_demo_company() only ever touches that one
// organization and does it in a single transaction. Safe to run more than
// once: each run starts by deleting what the last one built.
export async function GET(request: Request) {
  const ctx = await getAuthedCron(request);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { data, error } = await ctx.admin.rpc("reset_demo_company");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, demo: data });
}
