import "server-only";
import writeXlsxFile, { type Cell, type Row } from "write-excel-file/node";
import type { PrintLang } from "@/lib/print/translations";
import type { CashAccount, CashEntry } from "@/lib/types";
import { entryLabel, entryText } from "./describe";
import { buildCashSummary, entryUsd, monthBounds, monthLabel, rateLookup, type FxRow } from "./summary";

// The cashbook as an Excel workbook for the accountant, for a range of
// months: the monthly summary in USD, every statement line in the period,
// and each account's balances at the start and end. English or French.

const WORDS = {
  en: {
    summary: "Summary",
    entries: "Entries",
    accounts: "Accounts",
    title: "Cashbook",
    period: "Period",
    usdNote: "USD at the rate locked on each line; customer payments in other currencies at the rate on file the day they arrived. Transfers between the company's own accounts are left out.",
    missing: "Left out, no exchange rate on file for",
    moneyIn: "Money in",
    moneyOut: "Money out",
    totalIn: "Total money in",
    totalOut: "Total money out",
    net: "Net (in − out)",
    total: "Total",
    category: "Category",
    date: "Date",
    account: "Account",
    currency: "Currency",
    usd: "USD (in + / out −)",
    type: "Type",
    description: "Description",
    reference: "Reference",
    trip: "Trip",
    reconciled: "Reconciled",
    yes: "Yes",
    no: "No",
    kind: "Kind",
    openingDate: "Opening date",
    openingBalance: "Opening balance",
    balanceStart: "Balance at start of period",
    balanceEnd: "Balance at end of period",
    reconciledBalance: "Reconciled balance at end",
    kinds: { bank: "Bank", mobile_money: "Mobile money", cash: "Cash" },
  },
  fr: {
    summary: "Synthèse",
    entries: "Écritures",
    accounts: "Comptes",
    title: "Livre de caisse",
    period: "Période",
    usdNote: "USD au taux figé sur chaque ligne ; paiements clients dans d'autres devises au taux en vigueur le jour de leur réception. Les virements entre les comptes de l'entreprise sont exclus.",
    missing: "Exclu, aucun taux de change pour",
    moneyIn: "Entrées",
    moneyOut: "Sorties",
    totalIn: "Total des entrées",
    totalOut: "Total des sorties",
    net: "Net (entrées − sorties)",
    total: "Total",
    category: "Catégorie",
    date: "Date",
    account: "Compte",
    currency: "Devise",
    usd: "USD (entrées + / sorties −)",
    type: "Type",
    description: "Libellé",
    reference: "Référence",
    trip: "Voyage",
    reconciled: "Rapproché",
    yes: "Oui",
    no: "Non",
    kind: "Nature",
    openingDate: "Date d'ouverture",
    openingBalance: "Solde d'ouverture",
    balanceStart: "Solde en début de période",
    balanceEnd: "Solde en fin de période",
    reconciledBalance: "Solde rapproché en fin de période",
    kinds: { bank: "Banque", mobile_money: "Mobile money", cash: "Caisse" },
  },
} as const;

const MONEY = "#,##0.00";
const HEAD = { fontWeight: "bold" as const, backgroundColor: "#E9EEF5", bottomBorderStyle: "thin" as const };
const num = (value: number, bold = false): Cell => ({ value, type: Number, format: MONEY, ...(bold ? { fontWeight: "bold" as const } : {}) });
const day = (iso: string): Cell => {
  const [y, m, d] = iso.split("-").map(Number);
  return { value: new Date(Date.UTC(y, m - 1, d)), type: Date, format: "yyyy-mm-dd" };
};
const text = (value: string | null | undefined, bold = false): Cell => (value ? { value, ...(bold ? { fontWeight: "bold" as const } : {}) } : null);
const cents = (n: number) => Math.round(n * 100) / 100;
const signed = (e: CashEntry) => (e.direction === "in" ? 1 : -1) * Number(e.amount);

export async function buildCashbookWorkbook(input: {
  accounts: CashAccount[];
  entries: CashEntry[]; // every line up to the end of the period
  rates: FxRow[];
  fromMonth: string;
  toMonth: string;
  lang: PrintLang;
  company: string;
}): Promise<Buffer> {
  const { accounts, entries, rates, fromMonth, toMonth, lang, company } = input;
  const w = WORDS[lang];
  const first = monthBounds(fromMonth).first;
  const last = monthBounds(toMonth).last;
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]));
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
  const rateOn = rateLookup(rates);
  const periodText = `${monthLabel(fromMonth, lang)} – ${monthLabel(toMonth, lang)} (${first} → ${last})`;

  // --- Summary
  const s = buildCashSummary(entries, currencyOf, rates, fromMonth, toMonth, lang);
  const monthHeads = s.months.map((m) => ({ value: monthLabel(m, lang), ...HEAD, align: "right" as const }));
  const summary: Row[] = [
    [{ value: `${company} — ${w.title}: ${w.summary} (USD)`, fontWeight: "bold", fontSize: 13 }],
    [`${w.period}: ${periodText}`],
    [{ value: w.usdNote, fontStyle: "italic" }],
    ...(s.missingRates.length ? [[{ value: `${w.missing}: ${s.missingRates.join(", ")}`, textColor: "#B23A26" }] as Row] : []),
    [],
    [{ value: w.category, ...HEAD }, ...monthHeads, { value: w.total, ...HEAD, align: "right" }],
  ];
  for (const direction of ["in", "out"] as const) {
    summary.push([text(direction === "in" ? w.moneyIn : w.moneyOut, true)]);
    for (const r of s.rows.filter((x) => x.direction === direction)) {
      summary.push([{ value: r.label, indent: 1 }, ...s.months.map((m) => (r.byMonth[m] ? num(r.byMonth[m]) : null)), num(r.total)]);
    }
    const totals = direction === "in" ? s.totalIn : s.totalOut;
    summary.push([
      { value: direction === "in" ? w.totalIn : w.totalOut, fontWeight: "bold", topBorderStyle: "thin" },
      ...s.months.map((m) => ({ ...(num(totals[m], true) as object), topBorderStyle: "thin" as const })),
      { ...(num(direction === "in" ? s.grand.in : s.grand.out, true) as object), topBorderStyle: "thin" as const },
    ]);
    summary.push([]);
  }
  summary.push([text(w.net, true), ...s.months.map((m) => num(s.net[m], true)), num(s.grand.net, true)]);

  // --- Entries in the period, every account
  const inPeriod = entries.filter((e) => e.occurred_on >= first && e.occurred_on <= last);
  const entryRows: Row[] = [
    [w.date, w.account, w.currency, w.moneyIn, w.moneyOut, w.usd, w.type, w.description, w.reference, w.trip, w.reconciled].map((h, i) => ({
      value: h,
      ...HEAD,
      ...(i >= 3 && i <= 5 ? { align: "right" as const } : {}),
    })),
  ];
  for (const e of [...inPeriod].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || (nameOf.get(a.account_id) ?? "").localeCompare(nameOf.get(b.account_id) ?? "") || a.created_at.localeCompare(b.created_at))) {
    const currency = currencyOf.get(e.account_id) ?? "";
    const usd = entryUsd(e, currency, rateOn);
    entryRows.push([
      day(e.occurred_on),
      text(nameOf.get(e.account_id)),
      text(currency),
      e.direction === "in" ? num(Number(e.amount)) : null,
      e.direction === "out" ? num(Number(e.amount)) : null,
      usd === null ? null : num(e.direction === "in" ? usd : -usd),
      text(entryLabel(e, lang)),
      text(entryText(e, lang, currency)),
      text(e.reference),
      text(e.trip_no),
      e.reconciled_at ? w.yes : w.no,
    ]);
  }

  // --- Accounts: balances at the start and end of the period, own currency
  const accountRows: Row[] = [
    [w.account, w.kind, w.currency, w.openingDate, w.openingBalance, w.balanceStart, w.moneyIn, w.moneyOut, w.balanceEnd, w.reconciledBalance].map((h, i) => ({
      value: h,
      ...HEAD,
      ...(i >= 4 ? { align: "right" as const } : {}),
    })),
  ];
  for (const a of accounts) {
    const mine = entries.filter((e) => e.account_id === a.id);
    const opening = Number(a.opening_balance);
    const start = cents(opening + mine.filter((e) => e.occurred_on < first).reduce((t, e) => t + signed(e), 0));
    const during = mine.filter((e) => e.occurred_on >= first && e.occurred_on <= last);
    const moneyIn = cents(during.filter((e) => e.direction === "in").reduce((t, e) => t + Number(e.amount), 0));
    const moneyOut = cents(during.filter((e) => e.direction === "out").reduce((t, e) => t + Number(e.amount), 0));
    const reconciled = cents(opening + mine.filter((e) => e.reconciled_at).reduce((t, e) => t + signed(e), 0));
    accountRows.push([
      text(a.name, true),
      text(w.kinds[a.kind]),
      text(a.currency),
      day(a.opening_date),
      num(opening),
      a.opening_date > last ? null : num(start),
      num(moneyIn),
      num(moneyOut),
      a.opening_date > last ? null : num(cents(start + moneyIn - moneyOut)),
      num(reconciled),
    ]);
  }

  const widths = (n: number[]) => n.map((width) => ({ width }));
  return writeXlsxFile([
    { sheet: w.summary, data: summary, columns: widths([44, ...s.months.map(() => 14), 16]), stickyRowsCount: 0 },
    { sheet: w.entries, data: entryRows, columns: widths([12, 24, 9, 15, 15, 16, 20, 60, 18, 16, 11]), stickyRowsCount: 1 },
    { sheet: w.accounts, data: accountRows, columns: widths([26, 14, 9, 14, 16, 22, 16, 16, 22, 26]), stickyRowsCount: 1 },
  ]).toBuffer();
}
