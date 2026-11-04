import type { TripAllocation, TripCost } from "@/lib/types";

export type StatementRow =
  | { kind: "allocation"; date: string; debit: number; credit: 0; balance: number; allocation: TripAllocation }
  | { kind: "cost"; date: string; debit: 0; credit: number; balance: number; cost: TripCost };

export type TripStatement = {
  rows: StatementRow[];
  allocated: number;
  spent: number;
  balance: number;
};

const cents = (n: number) => Math.round(n * 100) / 100;

// A trip's balance statement: money allocated to it as debits, every trip
// cost (whoever paid it) as a credit, in date order with a running
// balance -- positive is budget remaining, negative is overspend. Shared
// by the Docket's Balance tab and the printed trip ledger so the two can
// never disagree. Allocations sort ahead of costs on the same day, so a
// day's funding is in place before that day's spending draws on it.
export function buildTripStatement(allocations: TripAllocation[], costs: TripCost[]): TripStatement {
  const entries = [
    ...allocations.map((a) => ({ kind: "allocation" as const, date: a.allocated_on, amount: Number(a.amount_usd), allocation: a })),
    ...costs.map((c) => ({ kind: "cost" as const, date: c.incurred_on, amount: Number(c.amount_usd), cost: c })),
  ].sort((x, y) => x.date.localeCompare(y.date) || (x.kind === y.kind ? 0 : x.kind === "allocation" ? -1 : 1));

  let balance = 0;
  const rows: StatementRow[] = entries.map((e) => {
    if (e.kind === "allocation") {
      balance = cents(balance + e.amount);
      return { kind: "allocation", date: e.date, debit: e.amount, credit: 0, balance, allocation: e.allocation };
    }
    balance = cents(balance - e.amount);
    return { kind: "cost", date: e.date, debit: 0, credit: e.amount, balance, cost: e.cost };
  });

  const allocated = cents(allocations.reduce((s, a) => s + Number(a.amount_usd), 0));
  const spent = cents(costs.reduce((s, c) => s + Number(c.amount_usd), 0));
  return { rows, allocated, spent, balance: cents(allocated - spent) };
}
