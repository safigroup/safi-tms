import "server-only";
import { allRows, chunks, type Admin } from "./rows";

// How much of each trip's revenue has been invoiced and collected, in USD.
//
// A trip reaches an invoice through the invoice's lines (raise_invoice
// writes one line per milestone; older invoices could cover several
// trips). Payments are recorded against the whole invoice, so each line
// takes the invoice's paid and overdue fractions: an invoice for two trips
// that is half paid has collected half of each trip's line. Cancelled
// invoices count for nothing. Amounts are in the invoice's currency
// (payments too, as invoice_ar's paid assumes), converted at the rate on
// file on the day it was issued.

export type Paid = { invoiced: number; collected: number; overdue: number };

type Line = { id: string; invoice_id: string; trip_id: string | null; line_total: number };
type Invoice = { id: string; status: string; currency: string; total_due: number; paid: number; outstanding: number; days_overdue: number; issued_on: string | null };
type Rate = { id: string; currency: string; rate_to_usd: number; effective_on: string };

export async function tripCollections(admin: Admin, orgId: string, tripIds: string[]) {
  const byTrip = new Map<string, Paid>(tripIds.map((id) => [id, { invoiced: 0, collected: 0, overdue: 0 }]));
  const missing = new Set<string>();
  const done = (error: string | null = null) => ({ byTrip, missingRates: [...missing], error });
  if (!tripIds.length) return done();

  const lineBatches = await Promise.all(chunks(tripIds).map((ids) =>
    allRows<Line>((lo, hi) =>
      admin.from("invoice_lines").select("id, invoice_id, trip_id, line_total").eq("org_id", orgId).in("trip_id", ids).order("id").range(lo, hi),
    ),
  ));
  const lineError = lineBatches.find((b) => b.error)?.error;
  if (lineError) return done(lineError);
  const lines = lineBatches.flatMap((b) => b.rows);
  const invoiceIds = [...new Set(lines.map((l) => l.invoice_id))];
  if (!invoiceIds.length) return done();

  const [invoiceBatches, rates] = await Promise.all([
    Promise.all(chunks(invoiceIds).map((ids) =>
      allRows<Invoice>((lo, hi) =>
        admin
          .from("invoice_ar")
          .select("id, status, currency, total_due, paid, outstanding, days_overdue, issued_on")
          .eq("org_id", orgId)
          .in("id", ids)
          .order("id")
          .range(lo, hi),
      ),
    )),
    allRows<Rate>((lo, hi) =>
      admin.from("fx_rates").select("id, currency, rate_to_usd, effective_on").eq("org_id", orgId).order("effective_on", { ascending: false }).order("id").range(lo, hi),
    ),
  ]);
  const invoiceError = invoiceBatches.find((b) => b.error)?.error ?? rates.error;
  if (invoiceError) return done(invoiceError);
  const invoices = new Map(invoiceBatches.flatMap((b) => b.rows).map((i) => [i.id, i]));

  // The rate on file on a day, or the oldest one when the day predates
  // them all (the same rule as the Overview's cash collected).
  const rateOn = (currency: string, day: string | null) => {
    if (currency === "USD") return 1;
    const forCurrency = rates.rows.filter((r) => r.currency === currency);
    const r = (day ? forCurrency.find((x) => x.effective_on <= day) : forCurrency[0]) ?? forCurrency.at(-1);
    return r ? Number(r.rate_to_usd) : null;
  };

  for (const l of lines) {
    const inv = invoices.get(l.invoice_id);
    const paid = l.trip_id ? byTrip.get(l.trip_id) : undefined;
    if (!inv || !paid || inv.status === "cancelled") continue;
    const rate = rateOn(inv.currency, inv.issued_on);
    if (rate === null) {
      missing.add(inv.currency);
      continue;
    }
    const due = Number(inv.total_due || 0);
    const line = Number(l.line_total || 0) * rate;
    paid.invoiced += line;
    paid.collected += line * (due > 0 ? Math.min(1, Number(inv.paid || 0) / due) : 1);
    if (Number(inv.days_overdue || 0) > 0 && due > 0) paid.overdue += line * Math.max(0, Number(inv.outstanding || 0) / due);
  }
  return done();
}
