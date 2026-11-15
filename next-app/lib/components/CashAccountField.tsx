"use client";

import { useEffect, useState } from "react";
import type { CashAccountSummary } from "@/lib/types";

// "Received into" / "Paid from" on the forms that move company money:
// Billing's payments, the Docket's office/agent/card costs and allocations,
// and truck costs. It only appears for people who can see the cashbook
// (owner, admin, finance -- /api/cashbook refuses everyone else); anyone
// else's record waits in the Cashbook's "To place" list instead.

let cache: { at: number; accounts: Promise<CashAccountSummary[] | null> } | null = null;

function loadAccounts(): Promise<CashAccountSummary[] | null> {
  if (!cache || Date.now() - cache.at > 60_000) {
    cache = {
      at: Date.now(),
      accounts: fetch("/api/cashbook")
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { accounts: CashAccountSummary[] } | null) => body?.accounts ?? null)
        .catch(() => null),
    };
  }
  return cache.accounts;
}

const storageKey = (direction: "in" | "out", currency: string) => `safi:cash-account:${direction}:${currency}`;

function remembered(direction: "in" | "out", currency: string): string | null {
  try {
    return localStorage.getItem(storageKey(direction, currency));
  } catch {
    return null;
  }
}

export type CashAccountChoice = {
  // undefined while loading, null for someone who can't see the cashbook
  accounts: CashAccountSummary[] | null | undefined;
  options: CashAccountSummary[];
  value: string;
  choose: (id: string) => void;
  // what to send as cashAccountId: an account id, or null to decide later
  submitted: string | null;
};

// Open accounts in the record's currency. The choice starts as the one
// this person last used for that currency, else the only account in it,
// else "decide later".
export function useCashAccountChoice(direction: "in" | "out", currency: string): CashAccountChoice {
  const [accounts, setAccounts] = useState<CashAccountSummary[] | null | undefined>(undefined);
  const [picked, setPicked] = useState<Record<string, string>>({});

  useEffect(() => {
    let current = true;
    loadAccounts().then((a) => {
      if (current) setAccounts(a);
    });
    return () => {
      current = false;
    };
  }, []);

  const options = (accounts ?? []).filter((a) => a.is_active && a.currency === currency);
  let value = picked[currency];
  if (value === undefined) {
    const last = remembered(direction, currency);
    value = last !== null && (last === "" || options.some((o) => o.id === last)) ? last : options.length === 1 ? options[0].id : "";
  }
  if (value && !options.some((o) => o.id === value)) value = "";

  function choose(id: string) {
    setPicked((p) => ({ ...p, [currency]: id }));
    try {
      localStorage.setItem(storageKey(direction, currency), id);
    } catch {
      // the choice just isn't remembered next time
    }
  }

  return { accounts, options, value, choose, submitted: accounts ? value || null : null };
}

export function CashAccountField({ id, direction, currency, choice }: {
  id: string;
  direction: "in" | "out";
  currency: string;
  choice: CashAccountChoice;
}) {
  if (!choice.accounts) return null;
  return (
    <div className="field">
      <label htmlFor={id}>{direction === "in" ? "Received into" : "Paid from"}</label>
      <select id={id} value={choice.value} onChange={(e) => choice.choose(e.target.value)}>
        {choice.options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        <option value="">Decide later in the Cashbook</option>
      </select>
      <div className="hint">
        {!choice.options.length
          ? `No open ${currency} account in the cashbook, so this will wait there under To place.`
          : choice.value
            ? "It shows on that account's cashbook statement."
            : "It will wait in the Cashbook under To place."}
      </div>
    </div>
  );
}
