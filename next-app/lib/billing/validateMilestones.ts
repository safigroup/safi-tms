import "server-only";

// Shared by both payment-schedule admin routes (the org default and a
// customer's own override) -- validates a submitted milestone list before
// it's written, since a schedule that doesn't sum to 100% would silently
// under- or over-bill every trip raised against it.
export function validateMilestones(input: unknown): { label: string; pct: number; requires_pod: boolean }[] | null {
  if (!Array.isArray(input) || !input.length) return null;

  const rows: { label: string; pct: number; requires_pod: boolean }[] = [];
  let total = 0;
  for (const row of input) {
    const label = typeof row?.label === "string" ? row.label.trim() : "";
    const pct = Number(row?.pct);
    if (!label || !Number.isFinite(pct) || pct <= 0) return null;
    rows.push({ label, pct, requires_pod: !!row?.requires_pod });
    total += pct;
  }
  if (Math.abs(total - 100) > 0.01) return null;

  return rows;
}
