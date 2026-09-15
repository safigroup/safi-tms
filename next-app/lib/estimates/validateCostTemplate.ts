import "server-only";

// Same trip-cost vocabulary as the Cost Docket (app/(app)/docket/page.tsx's
// CATS), minus driver_advance/driver_allowance -- those are per-driver-float
// reimbursements, not something a route-level cost estimate predicts.
export const ESTIMATE_CATEGORIES = [
  "fuel", "border_fees", "customs_duty", "clearing_agent", "tolls",
  "weighbridge", "permits", "escort", "demurrage", "detention",
  "repairs", "tyres", "police", "other",
];

const BASES = ["per_trip", "per_tonne", "per_cbm", "per_km"];

export type CostTemplateRow = { category: string; amount: number; currency: string; basis: string };

// Shared by the admin route-cost-template route. Unlike payment
// milestones, cost lines don't need to sum to anything -- each is
// independent, so this just validates the shape of each row.
//
// Currency is always forced to USD, never taken from the request: neither
// this table nor rate_cards has FX-conversion logic (rate cards are
// USD-only in the UI already), so a non-USD line would silently corrupt
// the estimator's total the moment it's summed against everything else.
export function validateCostTemplate(input: unknown): CostTemplateRow[] | null {
  if (!Array.isArray(input)) return null;

  const rows: CostTemplateRow[] = [];
  for (const row of input) {
    const category = typeof row?.category === "string" ? row.category : "";
    const amount = Number(row?.amount);
    const basis = typeof row?.basis === "string" ? row.basis : "";
    if (!ESTIMATE_CATEGORIES.includes(category)) return null;
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (!BASES.includes(basis)) return null;
    rows.push({ category, amount, currency: "USD", basis });
  }
  return rows;
}
