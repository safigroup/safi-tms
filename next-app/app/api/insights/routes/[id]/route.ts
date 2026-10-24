import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { computeRouteCostDeltas, type RouteCostAnalysis } from "@/lib/insights/computeRouteCostDeltas";
import type { CostTemplateLine } from "@/lib/estimates/estimateTripCost";

// A route needs at least this many trips that actually ran before an
// "average" or "trend" means anything -- below it we say so plainly
// rather than asking Claude to find a pattern in noise (and rather than
// spending a call on it at all).
const MIN_TRIPS_FOR_INSIGHTS = 2;
const MODEL = "claude-opus-5-5";

const FindingsSchema = z.object({
  findings: z.array(z.object({ finding: z.string(), suggestion: z.string() })),
});
type Finding = z.infer<typeof FindingsSchema>["findings"][number];

const SYSTEM_PROMPT =
  "You analyze real freight cost data for a trucking company and write short, concrete findings. " +
  "You are given precomputed numbers for one route -- expected cost per trip (from the route's cost " +
  "template) versus what trips on that route have actually averaged, per category, plus any categories " +
  "trips incur that have no template line at all. Use ONLY the numbers given; never invent or estimate " +
  "a figure yourself. Skip a category if its difference is small (roughly within 10%) and not worth " +
  "flagging. Write 1 to 4 findings, each a single plain sentence naming the category and the real " +
  "numbers, paired with one concrete, actionable suggestion. If nothing stands out, return an empty list " +
  "rather than inventing a finding.";

// Read-only, session-authenticated (not the agent API -- this is for the
// human-facing Estimator page). Gathers this route's cost template and
// every trip that's actually run on it, reduces that to the same kind of
// expected-vs-actual numbers the Estimator's own math already produces,
// then asks Claude for a short, grounded read on what those numbers say
// -- never to invent figures of its own. Degrades to insufficientData
// rather than an error when there isn't enough history yet.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }

  const { id: routeId } = await params;

  const { data: route } = await ctx.admin
    .from("routes")
    .select("id, name, origin, destination, distance_km")
    .eq("id", routeId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!route) {
    return NextResponse.json({ error: "route not found" }, { status: 404 });
  }

  const [{ data: templateRows, error: templateError }, { data: tripRows, error: tripsError }] = await Promise.all([
    ctx.admin
      .from("route_cost_templates")
      .select("category, amount, currency, basis")
      .eq("org_id", ctx.orgId)
      .eq("route_id", routeId),
    // "Actually run" -- excludes drafts/allocations that never left the
    // yard and anything cancelled, same bar the billable view itself uses.
    ctx.admin
      .from("trips")
      .select("id, tonnage, volume_cbm, revenue_amount")
      .eq("org_id", ctx.orgId)
      .eq("route_id", routeId)
      .not("actual_load_date", "is", null)
      .not("status", "in", "(draft,allocated,cancelled)"),
  ]);
  if (templateError) return NextResponse.json({ error: templateError.message }, { status: 400 });
  if (tripsError) return NextResponse.json({ error: tripsError.message }, { status: 400 });

  const trips = tripRows ?? [];
  const tripCount = trips.length;
  if (tripCount < MIN_TRIPS_FOR_INSIGHTS) {
    return NextResponse.json({ insufficientData: true, tripCount });
  }

  const templateLines: CostTemplateLine[] = templateRows ?? [];

  const tonnages = trips.map((t) => Number(t.tonnage)).filter((n) => Number.isFinite(n) && n > 0);
  const volumes = trips.map((t) => Number(t.volume_cbm)).filter((n) => Number.isFinite(n) && n > 0);
  const revenues = trips.map((t) => Number(t.revenue_amount)).filter((n) => Number.isFinite(n) && n > 0);
  const avg = (ns: number[]) => (ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : null);

  const tripIds = trips.map((t) => t.id);
  const { data: costRows, error: costsError } = tripIds.length
    ? await ctx.admin.from("trip_costs").select("trip_id, category, amount_usd").in("trip_id", tripIds)
    : { data: [] as { trip_id: string; category: string; amount_usd: number }[], error: null };
  if (costsError) return NextResponse.json({ error: costsError.message }, { status: 400 });

  const actualUsdByCategory = new Map<string, number>();
  for (const c of costRows ?? []) {
    actualUsdByCategory.set(c.category, (actualUsdByCategory.get(c.category) ?? 0) + Number(c.amount_usd || 0));
  }

  const analysis = computeRouteCostDeltas(
    templateLines,
    { distanceKm: route.distance_km, avgTonnage: avg(tonnages), avgVolumeCbm: avg(volumes) },
    actualUsdByCategory,
    tripCount,
    avg(revenues),
  );

  // Nothing to say and nothing a model could usefully add -- no template
  // and no trip_costs logged against this route's trips at all. Skip the
  // call rather than spend one asking Claude to comment on an empty brief.
  if (analysis.deltas.length === 0 && analysis.untemplated.length === 0) {
    return NextResponse.json({ insufficientData: false, tripCount, analysis, findings: [] });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI insights aren't configured yet -- ANTHROPIC_API_KEY is missing." }, { status: 500 });
  }

  // A failed call must not come back as an empty list -- the page would
  // read that as "nothing stands out" about costs nobody analyzed.
  const findings = await generateFindings(route, analysis);
  if (!findings) {
    return NextResponse.json({ error: "AI insights are unavailable right now." }, { status: 502 });
  }
  return NextResponse.json({ insufficientData: false, tripCount, analysis, findings });
}

async function generateFindings(
  route: { name: string; origin: string; destination: string; distance_km: number | null },
  analysis: RouteCostAnalysis,
): Promise<Finding[] | null> {
  const brief = {
    route: { name: route.name, origin: route.origin, destination: route.destination, distanceKm: route.distance_km },
    tripsAnalyzed: analysis.tripCount,
    avgRevenuePerTrip: analysis.avgRevenuePerTrip,
    avgActualCostPerTrip: analysis.avgActualCostPerTrip,
    avgMarginPerTrip: analysis.avgMarginPerTrip,
    costCategories: analysis.deltas.map((d) => ({
      category: d.category,
      basis: d.basis,
      templateExpectedPerTrip: d.expectedPerTrip,
      actualAveragePerTrip: d.actualAvgPerTrip,
      differenceUsd: d.deltaUsd,
      differencePct: d.deltaPct,
    })),
    categoriesNotInTemplate: analysis.untemplated,
  };

  const client = new Anthropic();
  let response;
  try {
    // Thinking can't be turned off on this model and counts toward
    // max_tokens, hence the headroom. Low effort: the numbers are already
    // computed; the model only picks what's worth flagging and words it.
    response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(FindingsSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(brief) }],
    });
  } catch (err) {
    console.error("[insights] Claude request failed:", err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
    return null;
  }

  if (response.stop_reason === "refusal") {
    console.error("[insights] Claude declined the request:", response.stop_details?.category ?? "no category");
    return null;
  }
  if (!response.parsed_output) {
    console.error("[insights] no structured output; stop_reason:", response.stop_reason);
    return null;
  }

  // The schema guarantees the shape, not the content -- still drop empty
  // entries and hold the panel to the 4 findings the prompt asks for.
  return response.parsed_output.findings
    .filter((f) => f.finding.trim() && f.suggestion.trim())
    .slice(0, 4);
}
