import { estimateTripCost, type CostTemplateLine } from "@/lib/estimates/estimateTripCost";

// Pure function, no DB access, no LLM call -- just the arithmetic that
// grounds the AI insight in real numbers. Resolves each cost template
// line against this route's *average* historical quantities (the same
// estimateTripCost() the Estimator page itself uses, reused rather than
// re-implemented), then compares that "expected per trip" figure against
// what trips on this route have actually averaged per category. Also
// surfaces categories trips actually incurred that the template doesn't
// cover at all -- a gap the template-only view can't see.
export type RouteCostDelta = {
  category: string;
  basis: CostTemplateLine["basis"];
  expectedPerTrip: number | null; // null if the basis quantity (tonnage/volume/distance) isn't known on average
  actualAvgPerTrip: number;
  deltaUsd: number | null;
  deltaPct: number | null;
};

export type UntemplatedCategory = {
  category: string;
  actualAvgPerTrip: number;
};

export type RouteCostAnalysis = {
  tripCount: number;
  deltas: RouteCostDelta[];
  untemplated: UntemplatedCategory[];
  avgRevenuePerTrip: number | null;
  avgActualCostPerTrip: number;
  avgMarginPerTrip: number | null;
};

export function computeRouteCostDeltas(
  templateLines: CostTemplateLine[],
  avgQuantities: { distanceKm: number | null; avgTonnage: number | null; avgVolumeCbm: number | null },
  actualUsdByCategory: Map<string, number>, // total across all historical trips, not yet averaged
  tripCount: number,
  avgRevenuePerTrip: number | null,
): RouteCostAnalysis {
  const templatedCategories = new Set(templateLines.map((l) => l.category));

  const deltas: RouteCostDelta[] = templateLines.map((line) => {
    const resolved = estimateTripCost([line], {
      distanceKm: avgQuantities.distanceKm,
      tonnage: avgQuantities.avgTonnage,
      volumeCbm: avgQuantities.avgVolumeCbm,
    }).lines[0];
    const expectedPerTrip = resolved.amount;
    const actualAvgPerTrip = Math.round(((actualUsdByCategory.get(line.category) ?? 0) / tripCount) * 100) / 100;
    const deltaUsd = expectedPerTrip !== null ? Math.round((actualAvgPerTrip - expectedPerTrip) * 100) / 100 : null;
    const deltaPct = expectedPerTrip !== null && expectedPerTrip > 0
      ? Math.round((deltaUsd! / expectedPerTrip) * 1000) / 10
      : null;
    return { category: line.category, basis: line.basis, expectedPerTrip, actualAvgPerTrip, deltaUsd, deltaPct };
  });

  const untemplated: UntemplatedCategory[] = Array.from(actualUsdByCategory.entries())
    .filter(([category]) => !templatedCategories.has(category))
    .map(([category, total]) => ({ category, actualAvgPerTrip: Math.round((total / tripCount) * 100) / 100 }))
    .sort((a, b) => b.actualAvgPerTrip - a.actualAvgPerTrip);

  const avgActualCostPerTrip = Math.round(
    (Array.from(actualUsdByCategory.values()).reduce((s, v) => s + v, 0) / tripCount) * 100,
  ) / 100;

  const avgMarginPerTrip = avgRevenuePerTrip !== null
    ? Math.round((avgRevenuePerTrip - avgActualCostPerTrip) * 100) / 100
    : null;

  return { tripCount, deltas, untemplated, avgRevenuePerTrip, avgActualCostPerTrip, avgMarginPerTrip };
}
