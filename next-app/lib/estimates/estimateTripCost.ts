// Pure function, no DB access -- reused by both the human-facing Estimator
// page and the agent-callable /api/agent/estimate route, so the two can
// never disagree on the math. Mirrors lib/billing/paymentSchedule.ts's
// resolveMilestonesDue() in shape: a small set of template lines resolved
// against a trip's actual quantities.
export type CostTemplateLine = {
  category: string;
  amount: number;
  currency: string;
  basis: "per_trip" | "per_tonne" | "per_cbm" | "per_km";
};

export type EstimatedLine = {
  category: string;
  basis: CostTemplateLine["basis"];
  rate: number;
  currency: string;
  amount: number | null;
  needsInput?: "tonnage" | "volume" | "distance";
};

export type CostEstimate = {
  lines: EstimatedLine[];
  total: number;
  incomplete: boolean;
};

export function estimateTripCost(
  lines: CostTemplateLine[],
  quantities: { distanceKm: number | null; tonnage: number | null; volumeCbm: number | null },
): CostEstimate {
  let incomplete = false;

  const estimated = lines.map((line): EstimatedLine => {
    const qty =
      line.basis === "per_trip" ? 1
      : line.basis === "per_tonne" ? quantities.tonnage
      : line.basis === "per_cbm" ? quantities.volumeCbm
      : quantities.distanceKm; // per_km

    if (qty === null || !Number.isFinite(qty) || qty <= 0) {
      incomplete = true;
      return {
        category: line.category,
        basis: line.basis,
        rate: line.amount,
        currency: line.currency,
        amount: null,
        needsInput: line.basis === "per_tonne" ? "tonnage" : line.basis === "per_cbm" ? "volume" : "distance",
      };
    }

    return {
      category: line.category,
      basis: line.basis,
      rate: line.amount,
      currency: line.currency,
      amount: Math.round(line.amount * qty * 100) / 100,
    };
  });

  const total = estimated.reduce((s, l) => s + (l.amount ?? 0), 0);

  return { lines: estimated, total: Math.round(total * 100) / 100, incomplete };
}
