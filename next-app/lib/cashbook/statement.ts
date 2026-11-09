import type { CashAccount, CashTransaction } from "@/lib/types";

export type CashStatementRow = { tx: CashTransaction; moneyIn: number; moneyOut: number; balance: number };

export type CashStatement = {
  from: string;
  to: string | null;
  openingBalance: number;
  rows: CashStatementRow[];
  totalIn: number;
  totalOut: number;
  closingBalance: number;
};

const cents = (n: number) => Math.round(n * 100) / 100;

// One account's statement for a period, in the account's own currency:
// the balance brought forward to the period's first day (the opening
// balance plus everything before it), then each movement with a running
// balance. Money in is the debit side, money out the credit side -- the
// same convention as a trip's balance statement. Shared by the Cashbook
// page and its printout so the two can't disagree.
export function buildCashStatement(
  account: CashAccount,
  transactions: CashTransaction[],
  from: string | null,
  to: string | null,
): CashStatement {
  const start = from && from > account.opening_date ? from : account.opening_date;
  const sorted = [...transactions].sort(
    (a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.created_at.localeCompare(b.created_at),
  );
  const signed = (t: CashTransaction) => (t.direction === "in" ? 1 : -1) * Number(t.amount);

  let balance = cents(
    Number(account.opening_balance) + sorted.filter((t) => t.occurred_on < start).reduce((s, t) => s + signed(t), 0),
  );
  const openingBalance = balance;

  let totalIn = 0;
  let totalOut = 0;
  const rows = sorted
    .filter((t) => t.occurred_on >= start && (!to || t.occurred_on <= to))
    .map((tx) => {
      const amount = Number(tx.amount);
      if (tx.direction === "in") totalIn += amount;
      else totalOut += amount;
      balance = cents(balance + signed(tx));
      return { tx, moneyIn: tx.direction === "in" ? amount : 0, moneyOut: tx.direction === "out" ? amount : 0, balance };
    });

  return { from: start, to, openingBalance, rows, totalIn: cents(totalIn), totalOut: cents(totalOut), closingBalance: balance };
}
