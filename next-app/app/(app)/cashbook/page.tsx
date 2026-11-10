"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { m2, today } from "@/lib/format";
import { COMPANY } from "@/lib/company";
import { Spinner } from "@/lib/components/Spinner";
import { t, type PrintLang } from "@/lib/print/translations";
import { buildCashStatement, type CashStatement } from "@/lib/cashbook/statement";
import { ACCOUNT_KIND_LABEL, DEFAULT_CATEGORIES } from "@/lib/cashbook/categories";
import type { CashAccount, CashAccountKind, CashAccountSummary, CashTransaction } from "@/lib/types";

type Overview = { accounts: CashAccountSummary[]; currencies: string[]; usedCategories: { in: string[]; out: string[] } };
type Mode = "in" | "out" | "transfer" | "new-account" | "edit-account";

// The cashbook starts here: accounts open with their balance on this date.
const START_DATE = "2026-11-01";

export default function CashbookPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ account: CashAccount; transactions: CashTransaction[] } | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [mode, setMode] = useState<Mode>("out");
  const [printLang, setPrintLang] = useState<PrintLang>("en");
  const [printing, setPrinting] = useState<CashStatement | null>(null);

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

  async function refresh() {
    await loadOverview();
    if (selectedId) await loadDetail(selectedId);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    loadOverview();
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
  const statement = account ? buildCashStatement(account, detail!.transactions, from || null, to || null) : null;
  const formMode: Mode = accounts.length ? mode : "new-account";

  async function handleDelete(tx: CashTransaction) {
    if (!confirm(tx.transfer_id ? "Remove this transfer from both accounts?" : "Remove this entry?")) return;
    const res = await fetch(`/api/cashbook/transactions/${tx.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(tx.transfer_id ? "Transfer removed" : "Entry removed");
      await refresh();
    }
  }

  return (
    <>
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <h2>Cashbook</h2>
          <button className="act" type="button" onClick={() => setMode("new-account")}>+ New account</button>
        </div>
        {accounts.length ? (
          <div className="acct-grid">
            {accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                className={"acct" + (a.id === selectedId ? " on" : "") + (a.is_active ? "" : " off")}
                onClick={() => { setSelectedId(a.id); setFrom(""); setTo(""); }}
              >
                <span className="acct-name">{a.name}</span>
                <span className="acct-kind">{ACCOUNT_KIND_LABEL[a.kind]} · {a.currency}{a.is_active ? "" : " · closed"}</span>
                <span className={"acct-bal" + (a.balance < 0 ? " neg" : "")}>{m2(a.balance, a.currency)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty">
            No accounts yet. Add each bank account, mobile money wallet and cash box with its balance on 1 November 2026.
          </div>
        )}
      </div>

      <div className="grid">
        <div className="panel">
          {account && statement ? (
            <>
              <div className="d-head">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div className="r-no">{ACCOUNT_KIND_LABEL[account.kind]} · {account.currency}</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button type="button" className={"chip" + (printLang === "en" ? " on" : "")} onClick={() => setPrintLang("en")}>EN</button>
                    <button type="button" className={"chip" + (printLang === "fr" ? " on" : "")} onClick={() => setPrintLang("fr")}>FR</button>
                    <button type="button" className="act" onClick={() => setPrinting(statement)}>Print statement</button>
                  </div>
                </div>
                <div className="r-title" style={{ fontSize: 18 }}>
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
              </div>
              <div className="stmt-wrap">
                <table className="stmt">
                  <thead>
                    <tr>
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
                      <td className="mono">{statement.from}</td>
                      <td>{statement.from === account.opening_date ? "Opening balance" : "Balance brought forward"}</td>
                      <td className="num" />
                      <td className="num" />
                      <td className={"num" + (statement.openingBalance < 0 ? " neg" : "")}>{m2(statement.openingBalance, account.currency)}</td>
                      <td />
                    </tr>
                    {statement.rows.map((r) => (
                      <tr key={r.tx.id}>
                        <td className="mono">{r.tx.occurred_on}</td>
                        <td>
                          <span className={"pill " + (r.tx.transfer_id ? "grey" : r.tx.direction === "in" ? "good" : "violet")}>{r.tx.category}</span>{" "}
                          {r.tx.counterparty ? <b style={{ fontWeight: 600 }}>{r.tx.counterparty}</b> : null}
                          {r.tx.description ? (r.tx.counterparty ? " — " : "") + r.tx.description : null}
                          {r.tx.reference ? <div className="r-mono">{r.tx.reference}</div> : null}
                        </td>
                        <td className="num">{r.moneyIn ? m2(r.moneyIn, account.currency) : ""}</td>
                        <td className="num">{r.moneyOut ? m2(r.moneyOut, account.currency) : ""}</td>
                        <td className={"num" + (r.balance < 0 ? " neg" : "")}>{m2(r.balance, account.currency)}</td>
                        <td><button className="x" type="button" onClick={() => handleDelete(r.tx)}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>Totals</td>
                      <td className="num">{m2(statement.totalIn, account.currency)}</td>
                      <td className="num">{m2(statement.totalOut, account.currency)}</td>
                      <td className={"num" + (statement.closingBalance < 0 ? " neg" : "")}>{m2(statement.closingBalance, account.currency)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
                {!statement.rows.length ? <div className="empty">No entries in this period.</div> : null}
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
              hasEntries={formMode === "edit-account" && !!detail?.transactions.length}
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
  const [occurredOn, setOccurredOn] = useState(today());
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
  const [occurredOn, setOccurredOn] = useState(today());
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
          {account.name}<br />{t(lang, "printed")} {today()}
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
          <div style={{ fontSize: 13 }}>{statement.from} → {statement.to ?? today()}</div>
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
            <tr key={r.tx.id}>
              <td>{r.tx.occurred_on}</td>
              <td>
                {[r.tx.category, r.tx.counterparty, r.tx.description].filter(Boolean).join(" — ")}
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
