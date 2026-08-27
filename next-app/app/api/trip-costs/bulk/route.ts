import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_MANAGE_TRIPS } from "@/lib/auth/permissions";
import { parseSpreadsheet } from "@/lib/parseSpreadsheet";

// Accepts ISO (the template's format) and MM/DD/YYYY (what Google Sheets
// exports by default under a US locale) -- anything else is rejected
// rather than guessed at, since a format like "5/6/2026" is genuinely
// ambiguous (5 June or 6 May) and silently inserting the wrong date into
// a financial record is worse than a caught error.
function normalizeDate(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${us[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return null;
}

// Bulk version of trip-costs/route.ts's FX-freeze-at-entry pattern, batched:
// trip numbers and currencies are resolved in two upfront queries instead
// of one per row. Unlike the interactive cost form (which only offers
// non-closed trips), this resolves against every trip in the org regardless
// of status -- the point is backfilling historical data. Each row is
// validated and inserted independently so one bad row doesn't discard the
// rest of a batch.
export async function POST(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_MANAGE_TRIPS.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  let rows;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    rows = await parseSpreadsheet(buffer, file.name);
  } catch (err) {
    return NextResponse.json(
      { error: "Couldn't read that file: " + (err instanceof Error ? err.message : String(err)) },
      { status: 400 },
    );
  }

  if (!rows.length) {
    return NextResponse.json({ error: "No rows found in that file." }, { status: 400 });
  }

  const tripNos = Array.from(new Set(rows.map((r) => r.trip_no).filter(Boolean)));
  const currencies = Array.from(new Set(rows.map((r) => r.currency).filter(Boolean)));

  const [{ data: trips }, { data: rates }] = await Promise.all([
    tripNos.length
      ? ctx.admin.from("trips").select("id, trip_no").eq("org_id", ctx.orgId).in("trip_no", tripNos)
      : Promise.resolve({ data: [] as { id: string; trip_no: string }[] }),
    currencies.length
      ? ctx.admin
          .from("fx_rates")
          .select("currency, rate_to_usd, effective_on")
          .eq("org_id", ctx.orgId)
          .in("currency", currencies)
          .order("effective_on", { ascending: false })
      : Promise.resolve({ data: [] as { currency: string; rate_to_usd: number; effective_on: string }[] }),
  ]);

  const tripByNo = new Map((trips ?? []).map((t) => [t.trip_no, t.id]));
  const rateByCurrency = new Map<string, number>();
  for (const r of rates ?? []) {
    if (!rateByCurrency.has(r.currency)) rateByCurrency.set(r.currency, r.rate_to_usd);
  }

  let inserted = 0;
  const errors: { row: number; message: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNo = i + 2; // header is row 1

    if (!row.trip_no) {
      errors.push({ row: rowNo, message: "Trip number is required." });
      continue;
    }
    const tripId = tripByNo.get(row.trip_no);
    if (!tripId) {
      errors.push({ row: rowNo, message: `Trip "${row.trip_no}" not found.` });
      continue;
    }
    if (!row.currency) {
      errors.push({ row: rowNo, message: "Currency is required." });
      continue;
    }
    const rate = rateByCurrency.get(row.currency);
    if (rate === undefined) {
      errors.push({ row: rowNo, message: `No exchange rate on file for ${row.currency}.` });
      continue;
    }
    // Strips thousands separators/currency symbols -- a value like
    // "1,200.00" round-trips through CSV as a quoted string (Google
    // Sheets quotes any field containing a comma), and Number() doesn't
    // understand comma separators on its own.
    const amount = Number(String(row.amount).replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push({ row: rowNo, message: "Amount must be a number greater than zero." });
      continue;
    }
    if (!row.incurred_on) {
      errors.push({ row: rowNo, message: "Date is required." });
      continue;
    }
    const incurredOn = normalizeDate(row.incurred_on);
    if (!incurredOn) {
      errors.push({ row: rowNo, message: `Date must be in YYYY-MM-DD or MM/DD/YYYY format (got "${row.incurred_on}").` });
      continue;
    }

    // cost_category is lowercase snake_case (fuel, driver_advance, ...) --
    // real-world exports commonly have this capitalized or space-separated
    // ("Other", "Driver Advance"), so normalize before the enum rejects it.
    const category = row.category.trim().toLowerCase().replace(/\s+/g, "_");

    const { error } = await ctx.admin.from("trip_costs").insert({
      org_id: ctx.orgId,
      trip_id: tripId,
      category,
      amount,
      currency: row.currency,
      fx_rate_to_usd: rate,
      incurred_on: incurredOn,
      description: row.description || null,
      location: row.location || null,
      paid_by: row.paid_by || null,
      receipt_ref: row.receipt_ref || null,
      recorded_by: ctx.userId,
    });

    if (error) {
      errors.push({ row: rowNo, message: error.message });
      continue;
    }
    inserted++;
  }

  return NextResponse.json({ inserted, errors });
}
