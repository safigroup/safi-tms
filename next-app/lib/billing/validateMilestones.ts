import "server-only";

// Shared by both payment-schedule admin routes (the org default and a
// customer's own override) -- validates a submitted milestone list before
// it's written. Admins type each milestone's dollar amount, not a raw
// percentage; pct is derived here as that amount's share of the row set's
// own total (never trusted from the client), so the schedule still scales
// correctly to any trip's actual revenue. The last row absorbs whatever
// rounding remainder is left so the stored percentages always sum to
// exactly 100 -- the same rounding-drift-guard idiom raise_invoice() uses
// for a schedule's own final milestone.
export function validateMilestones(
  input: unknown,
): { label: string; amount: number; pct: number; requires_pod: boolean }[] | null {
  if (!Array.isArray(input) || !input.length) return null;

  const parsed: { label: string; amount: number; requires_pod: boolean }[] = [];
  let total = 0;
  for (const row of input) {
    const label = typeof row?.label === "string" ? row.label.trim() : "";
    const amount = Number(row?.amount);
    if (!label || !Number.isFinite(amount) || amount <= 0) return null;
    parsed.push({ label, amount, requires_pod: !!row?.requires_pod });
    total += amount;
  }

  let pctSoFar = 0;
  return parsed.map((r, i) => {
    const amount = Math.round(r.amount * 100) / 100;
    const pct = i === parsed.length - 1
      ? Math.round((100 - pctSoFar) * 100) / 100
      : Math.round(((r.amount / total) * 100) * 100) / 100;
    pctSoFar += pct;
    return { label: r.label, amount, pct, requires_pod: r.requires_pod };
  });
}
