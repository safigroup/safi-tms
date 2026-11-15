import { m2 } from "@/lib/format";
import { catLabel, t, type PrintLang } from "@/lib/print/translations";
import type { CashSource } from "@/lib/types";

// The fields a cashbook line is described from -- shared by statement
// entries and "To place" items.
type Describable = {
  source: CashSource;
  category: string;
  counterparty: string | null;
  description: string | null;
  detail: string | null;
  paid_by: string | null;
  trip_no: string | null;
  record_amount?: number | null;
  record_currency?: string | null;
};

const SOURCE_KEY = {
  payment: "src_payment",
  trip_cost: "src_trip_cost",
  allocation: "src_allocation",
  truck_cost: "src_truck_cost",
} as const;

// "Tolls", "Border fees" -- English labels come back lower case.
const category = (lang: PrintLang, code: string) => catLabel(lang, code).replace(/^./, (c) => c.toUpperCase());

const PAID_KEY: Record<string, "paid_office" | "paid_agent" | "paid_card"> = {
  office: "paid_office",
  agent: "paid_agent",
  card: "paid_card",
};

// What the line is: the category a manual entry was given, or the kind of
// TMS record it came from. Shown as the pill on screen and first on the
// printout.
export function entryLabel(e: Describable, lang: PrintLang): string {
  return e.source === "manual" ? e.category : t(lang, SOURCE_KEY[e.source]);
}

// The rest of the line. A TMS record says which trip, invoice, cost or
// truck it was; when it was in another currency than the account, its own
// figure is added so the line can be matched to the trip or invoice.
export function entryText(e: Describable, lang: PrintLang, accountCurrency?: string): string {
  const parts: (string | null)[] = [];
  switch (e.source) {
    case "manual":
      parts.push(e.counterparty, e.description);
      break;
    case "payment":
      parts.push(e.counterparty, e.detail ? `${t(lang, "invoice")} ${e.detail}` : null, e.trip_no);
      break;
    case "trip_cost":
      parts.push(
        e.trip_no,
        e.detail ? category(lang, e.detail) : null,
        e.paid_by && PAID_KEY[e.paid_by] ? t(lang, PAID_KEY[e.paid_by]) : null,
        e.description,
      );
      break;
    case "allocation":
      parts.push(e.trip_no, e.description);
      break;
    case "truck_cost":
      parts.push(e.counterparty, e.detail ? category(lang, e.detail) : null, e.description);
      break;
  }
  if (accountCurrency && e.record_currency && e.record_currency !== accountCurrency && e.record_amount != null) {
    parts.push(m2(e.record_amount, e.record_currency));
  }
  return parts.filter(Boolean).join(" · ");
}
