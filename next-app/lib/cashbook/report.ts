import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CashAccount, CashEntry } from "@/lib/types";
import type { FxRow } from "./summary";

const PAGE = 1000;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isMonth = (v: unknown): v is string => typeof v === "string" && MONTH.test(v);

export const ENTRY_COLUMNS =
  "id, account_id, occurred_on, direction, amount, category, counterparty, description, reference, transfer_id, source, detail, paid_by, trip_id, trip_no, record_amount, record_currency, amount_usd, reconciled_at, created_at";

// Everything the summary and the export need: the accounts, every
// statement line up to a day (earlier ones carry balances forward), and
// the exchange rates on file. Lines are paged past the API's 1,000-row cap.
export async function loadCashbook(admin: SupabaseClient, orgId: string, upTo: string) {
  const [accounts, rates] = await Promise.all([
    admin
      .from("cash_accounts")
      .select("id, name, kind, currency, opening_balance, opening_date, is_active")
      .eq("org_id", orgId)
      .order("name"),
    admin.from("fx_rates").select("currency, rate_to_usd, effective_on").eq("org_id", orgId),
  ]);
  if (accounts.error) throw new Error(accounts.error.message);
  if (rates.error) throw new Error(rates.error.message);

  const entries: CashEntry[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("cash_entries")
      .select(ENTRY_COLUMNS)
      .eq("org_id", orgId)
      .lte("occurred_on", upTo)
      .order("occurred_on")
      .order("created_at")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    entries.push(...((data ?? []) as CashEntry[]));
    if (!data || data.length < PAGE) break;
  }

  return { accounts: (accounts.data ?? []) as CashAccount[], entries, rates: (rates.data ?? []) as FxRow[] };
}
