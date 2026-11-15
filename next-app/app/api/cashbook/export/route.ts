import { NextResponse } from "next/server";
import { getAuthedOrgContext } from "@/lib/auth/getAuthedOrgContext";
import { CAN_USE_CASHBOOK } from "@/lib/auth/permissions";
import { isMonth, loadCashbook } from "@/lib/cashbook/report";
import { monthBounds } from "@/lib/cashbook/summary";
import { buildCashbookWorkbook } from "@/lib/cashbook/workbook";

// The cashbook for a range of months as an .xlsx file for the accountant:
// Summary (USD by category and month), Entries (every line, every account)
// and Accounts (balances at the start and end). ?lang=fr for French.
export async function GET(request: Request) {
  const ctx = await getAuthedOrgContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  }
  if (!CAN_USE_CASHBOOK.has(ctx.role)) {
    return NextResponse.json({ error: "not permitted" }, { status: 403 });
  }

  const q = new URL(request.url).searchParams;
  const from = q.get("from");
  const to = q.get("to");
  if (!isMonth(from) || !isMonth(to) || from > to) {
    return NextResponse.json({ error: "Pick a range of months." }, { status: 400 });
  }
  const lang = q.get("lang") === "fr" ? "fr" : "en";

  try {
    const { accounts, entries, rates } = await loadCashbook(ctx.admin, ctx.orgId, monthBounds(to).last);
    const file = await buildCashbookWorkbook({ accounts, entries, rates, fromMonth: from, toMonth: to, lang, company: ctx.orgName });
    const name = `cashbook-${from}${from === to ? "" : `-to-${to}`}.xlsx`;
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
