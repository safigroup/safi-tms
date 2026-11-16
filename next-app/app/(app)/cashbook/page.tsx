"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { m2, today } from "@/lib/format";
import { COMPANY } from "@/lib/company";
import { Spinner } from "@/lib/components/Spinner";
import { PageBand } from "@/lib/components/PageBand";
import { t, type PrintLang } from "@/lib/print/translations";
import { buildCashStatement, reconciledBalance, type CashStatement } from "@/lib/cashbook/statement";
import { ACCOUNT_KIND_LABEL, DEFAULT_CATEGORIES } from "@/lib/cashbook/categories";
import { entryLabel, entryText } from "@/lib/cashbook/describe";
import { addMonths, monthLabel, type CashSummary } from "@/lib/cashbook/summary";
import type { CashAccount, CashAccountKind, CashAccountSummary, CashEntry, CashToPlace } from "@/lib/types";
import { useCompanyTimeZone } from "@/lib/components/CompanyTimeZone";

type Overview = { accounts: CashAccountSummary[]; currencies: string[]; usedCategories: { in: string[]; out: string[] } };
type ToPlaceList = { since: string | null; items: CashToPlace[]; more: boolean };
type Mode = "in" | "out" | "transfer" | "new-account" | "edit-account";

const pillTone = (e: { source: string; direction: string; transfer_id?: string | null }) =>
  e.transfer_id ? "grey" : e.direction === "in" ? "good" : "violet";

// The cashbook starts here: accounts open with their balance on this date.
const START_DATE = "2026-11-01";

export default function CashbookPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ account: CashAccount; entries: CashEntry[] } | null>(null);
  const [toPlace, setToPlace] = useState<ToPlaceList | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [mode, setMode] = useState<Mode>("out");
  const [printLang, setPrintLang] = useState<PrintLang>("en");
  const [printing, setPrinting] = useState<CashStatement | null>(null);
  const [view, setView] = useState<"statements" | "summary">("statements");
  const [openOnly, setOpenOnly] = useState(false);
  const [bankBalance, setBankBalance] = useState("");
  const timeZone = useCompanyTimeZone();

  async function loadOverview() {
    const res = await fetch("/api/cashbook");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoadError(res.status === 403 ? "Only owners, admins and finance can see the cashbook." : body.error || res.statusText);
      return;
    }
    setOverview(body);
    setSelectedId((cur) => cur ?? body.accounts.find((a: CashAccountSummary) => a.is_active)?.id ?? body.accounts[0]?.id ?? null);
  }

  async function loadDetail(id: string) {
    const res = await fetch(`/api/cashbook/accounts/${id}`);
    if (res.ok) setDetail(await res.json());
  }

  async function loadToPlace() {
    const res = await fetch("/api/cashbook/links");
    if (res.ok) setToPlace(await res.json());
  }

  async function refresh() {
    await Promise.all([loadOverview(), loadToPlace(), selectedId ? loadDetail(selectedId) : null]);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    loadOverview();
    loadToPlace();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading the newly selected account's statement
    loadDetail(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (printing) window.print();
  }, [printing]);

  if (loadError) return <div className="note bad">{loadError}</div>;
  if (!overview) return <div className="panel"><Spinner /></div>;

  const { accounts } = overview;
  const active = accounts.filter((a) => a.is_active);
  const account = detail && detail.account.id === selectedId ? detail.account : null;
  const statement = account ? buildCashStatement(account, detail!.entries, from || null, to || null) : null;
  const formMode: Mode = accounts.length ? mode : "new-account";
  // Reconciliation: what the bank (wallet, cash count) should show at the
  // end of the period, from the lines ticked off so far.
  const asOf = to || today(timeZone);
  const recBalance = account ? reconciledBalance(account, detail!.entries, asOf) : 0;
  const openRows = statement ? statement.rows.filter((r) => !r.tx.reconciled_at) : [];
  const shownRows = statement ? (openOnly ? openRows : statement.rows) : [];
  const allShownTicked = shownRows.length > 0 && shownRows.every((r) => r.tx.reconciled_at);
  const bankNum = parseFloat(bankBalance);
  const firstMonth = accounts.length ? accounts.map((a) => a.opening_date).sort()[0].slice(0, 7) : null;

  // Ticked or unticked straight away on screen; put back if the save fails.
  async function setReconciled(lines: CashEntry[], reconciled: boolean) {
    if (!lines.length) return;
    const keys = new Set(lines.map((l) => l.source + ":" + l.id));
    const stamp = reconciled ? new Date().toISOString() : null;
    setDetail((d) => d && { ...d, entries: d.entries.map((e) => (keys.has(e.source + ":" + e.id) ? { ...e, reconciled_at: stamp } : e)) });
    const res = await fetch("/api/cashbook/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: lines.map((l) => ({ source: l.source, id: l.id })), reconciled }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || res.statusText);
      if (selectedId) await loadDetail(selectedId);
    }
  }

  async function handleDelete(tx: CashEntry) {
    const what = tx.transfer_id ? "Remove this transfer from both accounts?" : "Remove this entry?";
    if (!confirm(tx.reconciled_at ? `${what} It's been reconciled with the account's statement.` : what)) return;
    const res = await fetch(`/api/cashbook/transactions/${tx.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(tx.transfer_id ? "Transfer removed" : "Entry removed");
      await refresh();
    }
  }

  // A TMS record isn't deleted here -- that's done where it was entered.
  // It just leaves this account and goes back to To place.
  async function handleUnplace(tx: CashEntry) {
    if (!confirm("Take this out of the account? It goes back to To place, and stays recorded where it was entered.")) return;
    const res = await fetch("/api/cashbook/links", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: tx.source, id: tx.id }),
    });
    if (res.ok) {
      toast.success("Moved back to To place");
      await refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || res.statusText);
    }
  }

  return (
    <>
      {/* Each account is a figure: its balance today, and a click opens its
          statement below. */}
      <PageBand
        kicker="Cashbook"
        title={accounts.length ? `${active.length} account${active.length === 1 ? "" : "s"}` : "No accounts yet"}
        sub={accounts.length
          ? `Bank, mobile money and cash, with today's balances${toPlace?.items.length ? ` · ${toPlace.items.length} payment${toPlace.items.length === 1 ? "" : "s"} to place` : ""}`
          : "Add each bank account, mobile money wallet and cash box with its balance on 1 November 2026."}
        actions={
          <button className="ops-cta" type="button" onClick={() => { setView("statements"); setMode("new-account"); }}>+ New account</button>
        }
        figsWrap
        figs={accounts.map((a) => ({
          key: a.id,
          k: a.name,
          v: m2(a.balance, a.currency),
          tone: a.balance < 0 ? "bad" : undefined,
          n: `${ACCOUNT_KIND_LABEL[a.kind]} · ${a.currency}${a.is_active ? "" : " · closed"}`,
          on: view === "statements" && a.id === selectedId,
          onClick: () => { setView("statements"); setSelectedId(a.id); setFrom(""); setTo(""); },
        }))}
        tabs={accounts.length ? [{ key: "statements", label: "Statements" }, { key: "summary", label: "Monthly summary" }] : undefined}
        tab={view}
        onTab={(k) => setView(k as typeof view)}
      />

      {view === "summary" && firstMonth ? (
        <SummaryView firstMonth={firstMonth} thisMonth={today(timeZone).slice(0, 7)} />
      ) : (
      <>
      {toPlace && toPlace.items.length && active.length ? (
        <ToPlacePanel list={toPlace} accounts={active} onPlaced={refresh} />
      ) : null}

      <div className="grid">
        <div className="panel">
          {account && statement ? (
            <>
              <div className="d-head trip-card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div className="r-no">{ACCOUNT_KIND_LABEL[account.kind]} · {account.currency}</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button type="button" className={"chip" + (printLang === "en" ? " on" : "")} onClick={() => setPrintLang("en")}>EN</button>
                    <button type="button" className={"chip" + (printLang === "fr" ? " on" : "")} onClick={() => setPrintLang("fr")}>FR</button>
                    <button type="button" className="act" onClick={() => setPrinting(statement)}>Print statement</button>
                  </div>
                </div>
                <div className="tc-title">
                  {account.name}{" "}
                  <button type="button" className="ghost" style={{ width: "auto", marginTop: 0, padding: "2px 8px", fontSize: 12 }} onClick={() => setMode("edit-account")}>
                    Edit
                  </button>
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="cbFrom">From</label>
                    <input id="cbFrom" type="date" min={account.opening_date} value={from || account.opening_date} onChange={(e) => setFrom(e.target.value)} />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="cbTo">To</label>
                    <input id="cbTo" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                  </div>
                </div>
                <div className="d-figs">
                  <div><div className="k">Money in</div><div className="v pos">{m2(statement.totalIn, account.currency)}</div></div>
                  <div><div className="k">Money out</div><div className="v neg">{m2(statement.totalOut, account.currency)}</div></div>
                  <div>
                    <div className="k">Closing balance</div>
                    <div className={"v" + (statement.closingBalance < 0 ? " neg" : "")}>{m2(statement.closingBalance, account.currency)}</div>
                  </div>
                </div>
                <div className="rec-bar">
                  <div className="rec-fig">
                    <div className="k">Reconciled balance · {asOf}</div>
                    <div className="v">{m2(recBalance, account.currency)}</div>
                    <div className="r-min">
                      {openRows.length ? `${openRows.length} line${openRows.length === 1 ? "" : "s"} in this period not reconciled yet` : "Every line in this period is reconciled"}
                    </div>
                  </div>
                  <div className="field rec-bank">
                    <label htmlFor="cbBank">The account&apos;s own statement says</label>
                    <input id="cbBank" type="number" inputMode="decimal" step="0.01" placeholder={`${account.currency} on ${asOf}`} value={bankBalance} onChange={(e) => setBankBalance(e.target.value)} />
                    {Number.isFinite(bankNum) ? (
                      <div className={"hint rec-diff" + (Math.abs(bankNum - recBalance) < 0.005 ? " ok" : "")}>
                        {Math.abs(bankNum - recBalance) < 0.005
                          ? "Matches the reconciled balance."
                          : `Difference ${m2(Math.round((bankNum - recBalance) * 100) / 100, account.currency)}: tick the lines that appear on it.`}
                      </div>
                    ) : null}
                  </div>
                  <button type="button" className={"chip" + (openOnly ? " on" : "")} onClick={() => setOpenOnly((v) => !v)}>
                    Not reconciled only
                  </button>
                </div>
              </div>
              <div className="stmt-wrap">
                <table className="stmt">
                  <thead>
                    <tr>
                      <th className="rec-col">
                        <input
                          type="checkbox"
                          checked={allShownTicked}
                          disabled={!shownRows.length}
                          onChange={() => setReconciled(shownRows.filter((r) => !!r.tx.reconciled_at === allShownTicked).map((r) => r.tx), !allShownTicked)}
                          aria-label={allShownTicked ? "Untick every line shown" : "Tick every line shown as reconciled"}
                          title="Reconciled with the account's own statement"
                        />
                      </th>
                      <th>Date</th>
                      <th>Description</th>
                      <th className="num">Money in (Dr)</th>
                      <th className="num">Money out (Cr)</th>
                      <th className="num">Balance</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bf">
                      <td />
                      <td className="mono">{statement.from}</td>
                      <td>{statement.from === account.opening_date ? "Opening balance" : "Balance brought forward"}</td>
                      <td className="num" />
                      <td className="num" />
                      <td className={"num" + (statement.openingBalance < 0 ? " neg" : "")}>{m2(statement.openingBalance, account.currency)}</td>
                      <td />
                    </tr>
                    {shownRows.map((r) => (
                      <tr key={r.tx.source + r.tx.id} className={r.tx.reconciled_at ? "rec" : undefined}>
                        <td className="rec-col">
                          <input
                            type="checkbox"
                            checked={!!r.tx.reconciled_at}
                            onChange={(e) => setReconciled([r.tx], e.target.checked)}
                            aria-label={`Reconciled: ${entryLabel(r.tx, "en")} on ${r.tx.occurred_on}`}
                            title="Reconciled with the account's own statement"
                          />
                        </td>
                        <td className="mono">{r.tx.occurred_on}</td>
                        <td>
                          <span className={"pill " + pillTone(r.tx)}>{entryLabel(r.tx, "en")}</span>{" "}
                          {r.tx.source === "manual" ? (
                            <>
                              {r.tx.counterparty ? <b style={{ fontWeight: 600 }}>{r.tx.counterparty}</b> : null}
                              {r.tx.description ? (r.tx.counterparty ? " — " : "") + r.tx.description : null}
                            </>
                          ) : (
                            entryText(r.tx, "en", account.currency)
                          )}
                          {r.tx.reference ? <div className="r-mono">{r.tx.reference}</div> : null}
                        </td>
                        <td className="num">{r.moneyIn ? m2(r.moneyIn, account.currency) : ""}</td>
                        <td className="num">{r.moneyOut ? m2(r.moneyOut, account.currency) : ""}</td>
                        <td className={"num" + (r.balance < 0 ? " neg" : "")}>{m2(r.balance, account.currency)}</td>
                        <td>
                          {r.tx.source === "manual" ? (
                            <button className="x" type="button" title="Remove this entry" onClick={() => handleDelete(r.tx)}>✕</button>
                          ) : (
                            <button className="x" type="button" title="Take out of this account (back to To place)" onClick={() => handleUnplace(r.tx)}>↩</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Totals</td>
                      <td className="num">{m2(statement.totalIn, account.currency)}</td>
                      <td className="num">{m2(statement.totalOut, account.currency)}</td>
                      <td className={"num" + (statement.closingBalance < 0 ? " neg" : "")}>{m2(statement.closingBalance, account.currency)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
                {!statement.rows.length ? (
                  <div className="empty">No entries in this period.</div>
                ) : !shownRows.length ? (
                  <div className="empty">Every line in this period is reconciled.</div>
                ) : null}
              </div>
            </>
          ) : accounts.length ? (
            <Spinner />
          ) : (
            <div className="empty">Statements appear here once you&apos;ve added an account.</div>
          )}
        </div>

        <div className="panel">
          {formMode === "new-account" || (formMode === "edit-account" && account) ? (
            <AccountForm
              key={formMode === "edit-account" ? account!.id : "new"}
              account={formMode === "edit-account" ? account! : null}
              currencies={overview.currencies}
              hasEntries={formMode === "edit-account" && !!detail?.entries.length}
              onSaved={async (id) => {
                setMode("out");
                if (id) setSelectedId(id);
                await refresh();
              }}
              onCancel={accounts.length ? () => setMode("out") : undefined}
            />
          ) : (
            <>
              <div className="tabs">
                <button type="button" className={formMode === "in" ? "on" : ""} onClick={() => setMode("in")}>Money in</button>
                <button type="button" className={formMode === "out" ? "on" : ""} onClick={() => setMode("out")}>Money out</button>
                <button type="button" className={formMode === "transfer" ? "on" : ""} onClick={() => setMode("transfer")}>Transfer</button>
              </div>
              {!active.length ? (
                <div className="empty">All accounts are closed. Reopen one or add a new account.</div>
              ) : formMode === "transfer" ? (
                <TransferForm accounts={active} defaultFromId={account?.is_active ? account.id : active[0].id} onSaved={refresh} />
              ) : (
                <EntryForm
                  key={formMode}
                  direction={formMode === "in" ? "in" : "out"}
                  accounts={active}
                  defaultAccountId={account?.is_active ? account.id : active[0].id}
                  categories={Array.from(new Set([...DEFAULT_CATEGORIES[formMode === "in" ? "in" : "out"], ...overview.usedCategories[formMode === "in" ? "in" : "out"]]))}
                  onSaved={refresh}
                />
              )}
            </>
          )}
        </div>
      </div>
      </>
      )}

      {printing && account ? (
        <StatementPrintSheet account={account} statement={printing} lang={printLang} onDone={() => setPrinting(null)} />
      ) : null}
    </>
  );
}

function EntryForm({
  direction,
  accounts,
  defaultAccountId,
  categories,
  onSaved,
}: {
  direction: "in" | "out";
  accounts: CashAccountSummary[];
  defaultAccountId: string;
  categories: string[];
  onSaved: () => Promise<void>;
}) {
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [occurredOn, setOccurredOn] = useState(today(useCompanyTimeZone()));
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currency = accounts.find((a) => a.id === accountId)?.currency ?? "";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/cashbook/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, direction, occurredOn, amount: Number(amount), category, counterparty, description, reference }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError(body.error || res.statusText);
    }
    toast.success(`${direction === "in" ? "Money in" : "Money out"}: ${m2(Number(amount), currency)}`);
    setAmount("");
    setCounterparty("");
    setDescription("");
    setReference("");
    await onSaved();
  }

  return (
    <form className="panel-body" onSubmit={handleSubmit}>
      {error ? <div className="note bad">{error}</div> : null}
      <div className="field">
        <label htmlFor="enAccount">Account</label>
        <select id="enAccount" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
        </select>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="enAmount">Amount ({currency})</label>
          <input id="enAmount" type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="enDate">Date</label>
          <input id="enDate" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="enCategory">Category</label>
        <input id="enCategory" type="text" list="enCategories" placeholder="Pick or type a category" value={category} onChange={(e) => setCategory(e.target.value)} />
        <datalist id="enCategories">
          {categories.map((c) => <option key={c} value={c} />)}
        </datalist>
      </div>
      <div className="field">
        <label htmlFor="enCounterparty">{direction === "in" ? "Received from" : "Paid to"}</label>
        <input id="enCounterparty" type="text" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="enDesc">Description</label>
          <input id="enDesc" type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="enRef">Reference</label>
          <input id="enRef" type="text" placeholder="Receipt, cheque, M-Pesa code" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      </div>
      <button className={"primary" + (direction === "in" ? " settle" : "")} type="submit" disabled={saving || !(Number(amount) > 0) || !category.trim()}>
        {saving ? "Saving…" : direction === "in" ? "Record money in" : "Record money out"}
      </button>
    </form>
  );
}

function TransferForm({
  accounts,
  defaultFromId,
  onSaved,
}: {
  accounts: CashAccountSummary[];
  defaultFromId: string;
  onSaved: () => Promise<void>;
}) {
  const [fromId, setFromId] = useState(defaultFromId);
  const [toId, setToId] = useState(accounts.find((a) => a.id !== defaultFromId)?.id ?? "");
  const [occurredOn, setOccurredOn] = useState(today(useCompanyTimeZone()));
  const [amountOut, setAmountOut] = useState("");
  const [amountIn, setAmountIn] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fromAcc = accounts.find((a) => a.id === fromId);
  const toAcc = accounts.find((a) => a.id === toId);
  const sameCurrency = !!fromAcc && !!toAcc && fromAcc.currency === toAcc.currency;

  if (accounts.length < 2) {
    return <div className="empty">A transfer needs at least two open accounts.</div>;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/cashbook/transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromAccountId: fromId,
        toAccountId: toId,
        occurredOn,
        amountOut: Number(amountOut),
        amountIn: sameCurrency ? Number(amountOut) : Number(amountIn),
        description,
        reference,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError(body.error || res.statusText);
    }
    toast.success(`Transferred ${m2(Number(amountOut), fromAcc?.currency)} to ${toAcc?.name}`);
    setAmountOut("");
    setAmountIn("");
    setDescription("");
    setReference("");
    await onSaved();
  }

  return (
    <form className="panel-body" onSubmit={handleSubmit}>
      {error ? <div className="note bad">{error}</div> : null}
      <div className="row">
        <div className="field">
          <label htmlFor="trFrom">From</label>
          <select id="trFrom" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="trTo">To</label>
          <select id="trTo" value={toId} onChange={(e) => setToId(e.target.value)}>
            {accounts.filter((a) => a.id !== fromId).map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
          </select>
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="trOut">Amount sent ({fromAcc?.currency})</label>
          <input id="trOut" type="number" inputMode="decimal" min="0" step="0.01" value={amountOut} onChange={(e) => setAmountOut(e.target.value)} />
        </div>
        {sameCurrency ? (
          <div className="field">
            <label htmlFor="trDate">Date</label>
            <input id="trDate" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
          </div>
        ) : (
          <div className="field">
            <label htmlFor="trIn">Amount received ({toAcc?.currency})</label>
            <input id="trIn" type="number" inputMode="decimal" min="0" step="0.01" value={amountIn} onChange={(e) => setAmountIn(e.target.value)} />
          </div>
        )}
      </div>
      {!sameCurrency ? (
        <div className="field">
          <label htmlFor="trDate">Date</label>
          <input id="trDate" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
        </div>
      ) : null}
      <div className="row">
        <div className="field">
          <label htmlFor="trDesc">Description</label>
          <input id="trDesc" type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="trRef">Reference</label>
          <input id="trRef" type="text" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      </div>
      <button className="primary" type="submit" disabled={saving || !toId || !(Number(amountOut) > 0) || (!sameCurrency && !(Number(amountIn) > 0))}>
        {saving ? "Saving…" : "Record transfer"}
      </button>
    </form>
  );
}

function AccountForm({
  account,
  currencies,
  hasEntries,
  onSaved,
  onCancel,
}: {
  account: CashAccount | null;
  currencies: string[];
  hasEntries: boolean;
  onSaved: (id: string | null) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<CashAccountKind>(account?.kind ?? "bank");
  const [currency, setCurrency] = useState(account?.currency ?? "USD");
  const [openingBalance, setOpeningBalance] = useState(account ? String(account.opening_balance) : "");
  const [openingDate, setOpeningDate] = useState(account?.opening_date ?? START_DATE);
  const [isActive, setIsActive] = useState(account?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = account
      ? await fetch(`/api/cashbook/accounts/${account.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, kind, currency, openingBalance: Number(openingBalance || 0), openingDate, isActive }),
        })
      : await fetch("/api/cashbook/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, kind, currency, openingBalance: Number(openingBalance || 0), openingDate }),
        });
    setSaving(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error || res.statusText);
    toast.success(account ? "Account updated" : `${name} added`);
    await onSaved(account ? null : body.id);
  }

  return (
    <>
      <div className="panel-head"><h2>{account ? "Edit account" : "New account"}</h2></div>
      <form className="panel-body" onSubmit={handleSubmit}>
        {error ? <div className="note bad">{error}</div> : null}
        <div className="field">
          <label htmlFor="acName">Name</label>
          <input id="acName" type="text" placeholder="e.g. Stanbic USD, M-Pesa, Petty cash" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="acKind">Type</label>
            <select id="acKind" value={kind} onChange={(e) => setKind(e.target.value as CashAccountKind)}>
              <option value="bank">Bank</option>
              <option value="mobile_money">Mobile money</option>
              <option value="cash">Cash</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="acCur">Currency</label>
            <select id="acCur" value={currency} disabled={hasEntries} onChange={(e) => setCurrency(e.target.value)}>
              {currencies.map((c) => <option key={c}>{c}</option>)}
            </select>
            {hasEntries ? <div className="hint">Locked: this account already has entries in {account?.currency}.</div> : null}
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="acBal">Opening balance ({currency})</label>
            <input id="acBal" type="number" inputMode="decimal" step="0.01" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="acDate">Balance on</label>
            <input id="acDate" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
          </div>
        </div>
        {account ? (
          <div className="check">
            <input id="acActive" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <label htmlFor="acActive">Open — untick to close the account to new entries</label>
          </div>
        ) : null}
        <button className="primary" type="submit" disabled={saving || !name.trim()}>
          {saving ? "Saving…" : account ? "Save account" : "Add account"}
        </button>
        {onCancel ? <button className="ghost" type="button" onClick={onCancel}>Cancel</button> : null}
      </form>
    </>
  );
}

// Money in against money out by category, month by month, across every
// account in USD (lib/cashbook/summary.ts), and the same months as an
// Excel workbook for the accountant.
function SummaryView({ firstMonth, thisMonth }: { firstMonth: string; thisMonth: string }) {
  const [fromMonth, setFromMonth] = useState(() => {
    const sixBack = addMonths(thisMonth, -5);
    return sixBack < firstMonth ? firstMonth : sixBack;
  });
  const [toMonth, setToMonth] = useState(thisMonth);
  const [lang, setLang] = useState<PrintLang>("en");
  const key = `${fromMonth}|${toMonth}`;
  const [loaded, setLoaded] = useState<{ key: string; summary: CashSummary | null; error: string | null } | null>(null);
  const valid = /^\d{4}-\d{2}$/.test(fromMonth) && /^\d{4}-\d{2}$/.test(toMonth) && fromMonth <= toMonth;

  useEffect(() => {
    if (!valid) return;
    let current = true;
    fetch(`/api/cashbook/summary?${new URLSearchParams({ from: fromMonth, to: toMonth })}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (current) setLoaded({ key, summary: res.ok ? body : null, error: res.ok ? null : body.error || res.statusText });
      })
      .catch(() => {
        if (current) setLoaded({ key, summary: null, error: "Couldn't load the summary." });
      });
    return () => {
      current = false;
    };
  }, [key, fromMonth, toMonth, valid]);

  const s = loaded?.key === key ? loaded.summary : null;
  const usd = (n: number | undefined) => (n ? m2(n) : "");
  const exportHref = `/api/cashbook/export?${new URLSearchParams({ from: fromMonth, to: toMonth, lang })}`;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Monthly summary</h2>
        <span className="r-min">USD, every account · transfers between accounts left out</span>
      </div>
      <div className="panel-body sum-tools">
        <div className="field">
          <label htmlFor="smFrom">From</label>
          <input id="smFrom" type="month" min={firstMonth} max={toMonth} value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="smTo">To</label>
          <input id="smTo" type="month" min={fromMonth} value={toMonth} onChange={(e) => setToMonth(e.target.value)} />
        </div>
        <div className="sum-export">
          <button type="button" className={"chip" + (lang === "en" ? " on" : "")} onClick={() => setLang("en")}>EN</button>
          <button type="button" className={"chip" + (lang === "fr" ? " on" : "")} onClick={() => setLang("fr")}>FR</button>
          {valid ? <a className="act" href={exportHref} download>Export to Excel</a> : null}
        </div>
      </div>
      {!valid ? (
        <div className="panel-body"><div className="note warn" style={{ marginBottom: 0 }}>Pick a From month on or before the To month.</div></div>
      ) : loaded?.key === key && loaded.error ? (
        <div className="panel-body"><div className="note bad" style={{ marginBottom: 0 }}>{loaded.error}</div></div>
      ) : !s ? (
        <Spinner />
      ) : (
        <>
          {s.missingRates.length ? (
            <div className="panel-body" style={{ paddingTop: 0 }}>
              <div className="note warn" style={{ marginBottom: 0 }}>Left out: no exchange rate on file for {s.missingRates.join(", ")}.</div>
            </div>
          ) : null}
          <div className="stmt-wrap">
            <table className="stmt sum-table">
              <thead>
                <tr>
                  <th>Category</th>
                  {s.months.map((m) => <th key={m} className="num">{monthLabel(m, "en")}</th>)}
                  <th className="num">Total</th>
                </tr>
              </thead>
              {(["in", "out"] as const).map((direction) => {
                const rows = s.rows.filter((r) => r.direction === direction);
                const totals = direction === "in" ? s.totalIn : s.totalOut;
                return (
                  <tbody key={direction}>
                    <tr className="sum-sec">
                      <td colSpan={s.months.length + 2}>{direction === "in" ? "Money in" : "Money out"}</td>
                    </tr>
                    {rows.length ? rows.map((r) => (
                      <tr key={r.key}>
                        <td className="sum-label">{r.label}</td>
                        {s.months.map((m) => <td key={m} className="num">{usd(r.byMonth[m])}</td>)}
                        <td className="num">{m2(r.total)}</td>
                      </tr>
                    )) : (
                      <tr><td className="sum-label" colSpan={s.months.length + 2} style={{ color: "var(--ink-soft)" }}>Nothing in these months.</td></tr>
                    )}
                    <tr className="sum-total">
                      <td>{direction === "in" ? "Total money in" : "Total money out"}</td>
                      {s.months.map((m) => <td key={m} className="num">{m2(totals[m])}</td>)}
                      <td className="num">{m2(direction === "in" ? s.grand.in : s.grand.out)}</td>
                    </tr>
                  </tbody>
                );
              })}
              <tfoot>
                <tr>
                  <td>Net (in − out)</td>
                  {s.months.map((m) => <td key={m} className={"num" + (s.net[m] < 0 ? " neg" : "")}>{m2(s.net[m])}</td>)}
                  <td className={"num" + (s.grand.net < 0 ? " neg" : "")}>{m2(s.grand.net)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="panel-body bar-note">
            Each line in USD at the rate locked when it was entered; customer payments in other currencies at the rate on file the day they arrived. Trip costs paid from a driver&apos;s float aren&apos;t here: they&apos;re inside the trip allocations.
          </div>
        </>
      )}
    </div>
  );
}

// TMS records the cashbook takes that aren't in an account yet: anything
// entered by someone who can't see the cashbook, anything left as "decide
// later", everything from before these links existed, and anything taken
// back out of a statement. Tick them and pick the account they went
// through. Several at once must be in the account's currency; one in
// another currency also needs the amount as it went through the account.
function ToPlacePanel({ list, accounts, onPlaced }: {
  list: ToPlaceList;
  accounts: CashAccountSummary[];
  onPlaced: () => Promise<void>;
}) {
  const key = (i: CashToPlace) => i.source + ":" + i.id;
  const currencies = Array.from(new Set(list.items.map((i) => i.record_currency))).sort();
  const [cur, setCur] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = list.items.filter((i) => cur === "all" || i.record_currency === cur);
  const picked = list.items.filter((i) => selected.has(key(i)));
  const pickedCurrencies = new Set(picked.map((i) => i.record_currency));
  // all ticked in one currency with a single open account in it: that one
  const onlyMatch = pickedCurrencies.size === 1 ? accounts.filter((a) => pickedCurrencies.has(a.currency)) : [];
  const effectiveId = accountId || (onlyMatch.length === 1 ? onlyMatch[0].id : "");
  const account = accounts.find((a) => a.id === effectiveId);
  const otherCurrency = account ? picked.filter((i) => i.record_currency !== account.currency) : [];
  const needsAmount = picked.length === 1 && otherCurrency.length === 1;
  const blocked = picked.length > 1 && otherCurrency.length > 0;
  const allShownPicked = shown.length > 0 && shown.every((i) => selected.has(key(i)));

  function toggle(i: CashToPlace) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key(i))) next.delete(key(i));
      else next.add(key(i));
      return next;
    });
  }

  function toggleAllShown() {
    setSelected((s) => {
      const next = new Set(s);
      for (const i of shown) {
        if (allShownPicked) next.delete(key(i));
        else next.add(key(i));
      }
      return next;
    });
  }

  async function place(e: FormEvent) {
    e.preventDefault();
    if (!account) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/cashbook/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        items: picked.map((i) => ({ source: i.source, id: i.id })),
        amount: needsAmount ? Number(amount) : undefined,
      }),
    });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (body.placed) toast.success(`${body.placed} placed in ${account.name}`);
    if (body.errors?.length) {
      setError(`${body.errors.length === 1 ? "One" : body.errors.length} couldn't be placed: ${body.errors[0].error}`);
    } else if (!res.ok) {
      setError(body.error || res.statusText);
    }
    setSelected(new Set());
    setAmount("");
    await onPlaced();
  }

  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-head">
        <h2>To place</h2>
        <span className="r-min">
          {list.items.length}{list.more ? "+" : ""} from Billing, the Docket and truck costs{list.since ? `, since ${list.since}` : ""}
        </span>
      </div>
      <div className="panel-body" style={{ paddingBottom: 6 }}>
        <div className="d-hint" style={{ marginBottom: currencies.length > 1 ? 10 : 0 }}>
          Payments, office/agent/card costs, allocations and truck costs that aren&apos;t in an account yet. Tick them and pick the account they went through.
        </div>
        {currencies.length > 1 ? (
          <div className="chips">
            {["all", ...currencies].map((c) => (
              <button key={c} type="button" className={"chip" + (cur === c ? " on" : "")} onClick={() => setCur(c)}>
                {c === "all" ? "All" : c}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="stmt-wrap" style={{ maxHeight: 380, overflowY: "auto" }}>
        <table className="stmt">
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input type="checkbox" checked={allShownPicked} onChange={toggleAllShown} aria-label="Tick everything shown" />
              </th>
              <th>Date</th>
              <th>Description</th>
              <th className="num">Money in</th>
              <th className="num">Money out</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={key(i)}>
                <td>
                  <input type="checkbox" checked={selected.has(key(i))} onChange={() => toggle(i)} aria-label={`Tick ${entryLabel(i, "en")} on ${i.occurred_on}`} />
                </td>
                <td className="mono">{i.occurred_on}</td>
                <td>
                  <span className={"pill " + pillTone(i)}>{entryLabel(i, "en")}</span> {entryText(i, "en")}
                  {i.reference ? <div className="r-mono">{i.reference}</div> : null}
                </td>
                <td className="num">{i.direction === "in" ? m2(i.record_amount, i.record_currency) : ""}</td>
                <td className="num">{i.direction === "out" ? m2(i.record_amount, i.record_currency) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="panel-body" onSubmit={place}>
        {error ? <div className="note bad">{error}</div> : null}
        <div className="row">
          <div className="field">
            <label htmlFor="tpAccount">{picked.length ? `Place ${picked.length} ticked in` : "Place ticked in"}</label>
            <select id="tpAccount" value={effectiveId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Pick an account…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
            </select>
          </div>
          {needsAmount && account ? (
            <div className="field">
              <label htmlFor="tpAmount">Amount in {account.currency}</label>
              <input id="tpAmount" type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <div className="hint">
                {m2(picked[0].record_amount, picked[0].record_currency)} as it went through {account.name}
              </div>
            </div>
          ) : null}
        </div>
        {blocked && account ? (
          <div className="note warn">
            {otherCurrency.length} ticked {otherCurrency.length === 1 ? "is" : "are"} not in {account.currency}. Place {otherCurrency.length === 1 ? "it" : "those"} one at a time, with the amount that went through the account.
          </div>
        ) : null}
        <button
          className="primary"
          type="submit"
          disabled={busy || !picked.length || !account || blocked || (needsAmount && !(Number(amount) > 0))}
        >
          {busy ? "Placing…" : picked.length && account ? `Place ${picked.length} in ${account.name}` : "Place"}
        </button>
      </form>
    </div>
  );
}

function StatementPrintSheet({
  account,
  statement,
  lang,
  onDone,
}: {
  account: CashAccount;
  statement: CashStatement;
  lang: PrintLang;
  onDone: () => void;
}) {
  const timeZone = useCompanyTimeZone();
  useEffect(() => {
    const handler = () => onDone();
    window.addEventListener("afterprint", handler);
    return () => window.removeEventListener("afterprint", handler);
  }, [onDone]);

  const cur = account.currency;
  return createPortal(
    <div id="sheet">
      <div className="ih">
        <div className="co">
          <h1>{COMPANY.name}</h1>
          <p>{COMPANY.reg}<br />TPIN {COMPANY.tpin}<br />{COMPANY.address}<br />{COMPANY.phone} · {COMPANY.email}</p>
        </div>
        <div className="im">
          <div className="big">{t(lang, "account_statement")}</div>
          {account.name}<br />{t(lang, "printed")} {today(timeZone)}
        </div>
      </div>
      <div className="parties">
        <div>
          <h4>{t(lang, "account")}</h4>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{account.name}</div>
          <div style={{ fontSize: 12, color: "#333" }}>{t(lang, `kind_${account.kind}`)} · {cur}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <h4>{t(lang, "period")}</h4>
          <div style={{ fontSize: 13 }}>{statement.from} → {statement.to ?? today(timeZone)}</div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>{t(lang, "date")}</th>
            <th>{t(lang, "description")}</th>
            <th className="num">{t(lang, "money_in_dr")}</th>
            <th className="num">{t(lang, "money_out_cr")}</th>
            <th className="num">{t(lang, "balance")}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{statement.from}</td>
            <td style={{ fontWeight: 600 }}>{t(lang, "balance_brought_forward")}</td>
            <td className="num" />
            <td className="num" />
            <td className="num">{m2(statement.openingBalance, cur)}</td>
          </tr>
          {statement.rows.map((r) => (
            <tr key={r.tx.source + r.tx.id}>
              <td>{r.tx.occurred_on}</td>
              <td>
                {[entryLabel(r.tx, lang), entryText(r.tx, lang, cur)].filter(Boolean).join(" — ")}
                {r.tx.reference ? " · " + r.tx.reference : ""}
              </td>
              <td className="num">{r.moneyIn ? m2(r.moneyIn, cur) : ""}</td>
              <td className="num">{r.moneyOut ? m2(r.moneyOut, cur) : ""}</td>
              <td className="num" style={r.balance < 0 ? { color: "#B23A26" } : undefined}>{m2(r.balance, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Wider than the invoice's totals box: "Closing balance" plus an
          amount like TZS 4,640,190.00 doesn't fit in 265px. */}
      <div className="totals" style={{ width: 360 }}>
        <div><span>{t(lang, "total_in")}</span><span>{m2(statement.totalIn, cur)}</span></div>
        <div><span>{t(lang, "total_out")}</span><span>{m2(statement.totalOut, cur)}</span></div>
        <div className="due"><span>{t(lang, "closing_balance")}</span><span>{m2(statement.closingBalance, cur)}</span></div>
      </div>
    </div>,
    document.body,
  );
}
