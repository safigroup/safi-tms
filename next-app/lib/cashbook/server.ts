import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

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
