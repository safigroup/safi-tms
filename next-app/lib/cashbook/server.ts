import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgRole } from "@/lib/auth/getAuthedOrgContext";
import { CAN_USE_CASHBOOK } from "@/lib/auth/permissions";

// Most recent rate on file for a currency, the same lookup trip costs use
// at entry; null when there isn't one, which callers report as an error
// rather than guessing.
export async function rateToUsd(admin: SupabaseClient, orgId: string, currency: string): Promise<number | null> {
  if (currency === "USD") return 1;
  const { data } = await admin
    .from("fx_rates")
    .select("rate_to_usd")
    .eq("org_id", orgId)
    .eq("currency", currency)
    .order("effective_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? Number(data.rate_to_usd) : null;
}

// The table behind each kind of TMS record the cashbook takes; the
// cash_account_id/cash_amount columns on each say which account its money
// went through (guarded by the cash_link_guard trigger).
export const LINK_TABLE = {
  payment: "payments",
  trip_cost: "trip_costs",
  allocation: "trip_allocations",
  truck_cost: "truck_costs",
} as const;

export type LinkSource = keyof typeof LINK_TABLE;

export const isLinkSource = (v: unknown): v is LinkSource => typeof v === "string" && v in LINK_TABLE;

// The account a payment, cost or allocation was recorded against when it
// was entered -- only from someone who can see the cashbook. Anyone else's
// record waits in the Cashbook's "To place" list for finance. The
// cash_link_guard trigger checks the account itself.
export function requestedCashAccount(role: OrgRole, value: unknown): string | null {
  return CAN_USE_CASHBOOK.has(role) && typeof value === "string" && value ? value : null;
}

// Every cashbook account lookup goes through here, so no route can reach
// another organization's account by id.
export async function getOrgCashAccount(admin: SupabaseClient, orgId: string, id: string) {
  const { data } = await admin
    .from("cash_accounts")
    .select("id, name, kind, currency, opening_balance, opening_date, is_active")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  return data;
}
