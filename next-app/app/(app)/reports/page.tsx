"use client";

import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { m0, m2, num, lab, today } from "@/lib/format";
import { COMPANY } from "@/lib/company";
import { Spinner } from "@/lib/components/Spinner";
import type { BootstrapPayload, Breakeven, TruckReport } from "@/lib/types";

// Mirrors lib/auth/permissions.ts's CAN_EDIT_COMMERCIAL -- UI convenience
// only (hides actions a role can't use), the route handlers are the real check.
const CAN_EDIT_COMMERCIAL = ["owner", "admin", "finance"];

const CATS = ["purchase", "clearing", "registration", "maintenance", "insurance", "licensing", "depreciation", "tyres", "repairs", "other"];

// Accounting convention: a loss is shown in parentheses rather than with a
// leading minus sign.
const pl = (n: number) => (n < 0 ? "(" + m2(Math.abs(n)) + ")" : m2(n));

const subheadStyle: CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 9.5,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: "var(--ink-soft)",
  marginBottom: 4,
};

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function BreakevenPanel({ breakeven }: { breakeven: Breakeven }) {
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head"><h2>Asset breakeven</h2></div>
      <div className="panel-body">
        {breakeven.status === "no_data" ? (
          <div className="d-hint">
            No purchase date set and no cost or trip history yet. Set a purchase date for this truck under Admin → Fleet to start tracking breakeven.
          </div>
        ) : (
          <>
            <div className="d-kv"><span>Total investment</span><span>{m2(breakeven.investment)}</span></div>
            <div className="d-kv"><span>Purchase date</span><span>{breakeven.startDate}</span></div>
            <div
              className="d-kv"
              style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--rule-soft)", fontWeight: 600 }}
            >
              <span>Status</span>
              <span
                style={{
                  color: breakeven.status === "reached"
                    ? "var(--settled)"
                    : breakeven.status === "not_on_track"
                      ? "var(--alert)"
                      : "var(--waiting)",
                }}
              >
                {breakeven.status === "reached"
                  ? `Broke even ${monthLabel(breakeven.reachedOn)}`
                  : breakeven.status === "projected"
                    ? `Projected ${monthLabel(breakeven.projectedOn)}`
                    : "Not on track at current pace"}
              </span>
            </div>
            {breakeven.status !== "reached" ? (
              <div className="d-hint" style={{ marginTop: 4 }}>
                Based on an average net of {m2(breakeven.avgMonthlyNet)}/month over the trailing 6 months.{" "}
                {breakeven.status === "not_on_track"
                  ? "Costs have outpaced revenue recently, so no breakeven date is projected."
                  : "This is a straight-line estimate from recent performance, not a forecast."}
              </div>
            ) : null}
            <div style={{ marginTop: 13 }}>
              <div style={subheadStyle}>Monthly cashflow since purchase</div>
              <ul className="list" style={{ maxHeight: 260 }}>
                {breakeven.months.map((mo) => (
                  <li key={mo.month}>
                    <div>
                      <div className="r-no">{monthLabel(mo.month)}</div>
                      <div className="r-mono">rev {m0(mo.revenue)} · trip {m0(mo.tripCosts)} · other {m0(mo.operatingCosts)}</div>
                    </div>
                    <div className="r-right">
                      <div className={"r-amt " + (mo.net >= 0 ? "pos" : "neg")}>{pl(mo.net)}</div>
                      <div className="r-min">cum {pl(mo.cumulative)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const router = useRouter();
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [truckId, setTruckId] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<TruckReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [tab, setTab] = useState<"trips" | "standing">("trips");
  const [printing, setPrinting] = useState(false);

  async function load() {
    const res = await fetch("/api/bootstrap");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setLoadError("Couldn't load — try refreshing.");
      return;
    }
    const payload: BootstrapPayload = await res.json();
    setData(payload);
    setLoadError(payload.fetchErrors.length ? `Couldn't load ${payload.fetchErrors.join(", ")}.` : null);
    if (payload.trucks.length) setTruckId((cur) => cur ?? payload.trucks[0].id);
  }

  async function loadReport(id: string) {
    setLoadingReport(true);
    setReportError(null);
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const res = await fetch(`/api/reports/trucks/${id}?${qs.toString()}`);
    setLoadingReport(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setReportError(body.error || res.statusText);
      setReport(null);
      return;
    }
    setReport(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-once; load is recreated every render, adding it here would refetch on every render too
  }, []);

  useEffect(() => {
    if (!truckId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refetching the report when the selected truck or date range changes
    loadReport(truckId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate: only truckId/from/to should trigger a refetch
  }, [truckId, from, to]);

  useEffect(() => {
    if (printing) window.print();
  }, [printing]);

  if (!data) return <div className="panel"><Spinner /></div>;

  const canEdit = CAN_EDIT_COMMERCIAL.includes(data.role);

  // USD is always a valid entry currency (no conversion needed), whether
  // or not the org has ever bothered to add a redundant "1 USD = 1 USD"
  // row to fx_rates.
  const curOpts = Array.from(new Set([...data.fx.map((r) => r.currency), "USD"])).sort((a, b) => {
    const order = ["USD", "TZS", "ZMW", "CDF"];
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  return (
    <>
      {loadError ? <div className="note bad">{loadError}</div> : null}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-body" style={{ display: "flex", gap: 11, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0, minWidth: 220 }}>
            <label htmlFor="rTruck">Truck</label>
            <select id="rTruck" value={truckId ?? ""} onChange={(e) => setTruckId(e.target.value)}>
              {data.trucks.map((t) => <option key={t.id} value={t.id}>{t.fleet_no} — {t.horse_reg}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="rFrom">From</label>
            <input id="rFrom" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="rTo">To</label>
            <input id="rTo" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {from || to ? (
            <button className="ghost" type="button" style={{ marginTop: 0, width: "auto" }} onClick={() => { setFrom(""); setTo(""); }}>
              Clear range
            </button>
          ) : null}
        </div>
      </div>

      {loadingReport ? (
        <div className="panel"><Spinner /></div>
      ) : reportError ? (
        <div className="note bad">{reportError}</div>
      ) : report ? (
        <>
          <div className="strip">
            <div className="cell"><div className="k">Revenue</div><div className="v pos">{m0(report.tripRevenue)}</div><div className="n">{report.trips.length} trip{report.trips.length === 1 ? "" : "s"}</div></div>
            <div className="cell"><div className="k">Trip expenses</div><div className="v">{m0(report.tripExpenses)}</div><div className="n">fuel, border fees, etc.</div></div>
            <div className="cell"><div className="k">Standing expenses</div><div className="v">{m0(report.standingExpenses)}</div><div className="n">{report.standingCosts.length} entr{report.standingCosts.length === 1 ? "y" : "ies"}</div></div>
            <div className="cell"><div className="k">Net profit / (loss)</div><div className={"v" + (report.margin >= 0 ? " pos" : " bad")}>{m0(report.margin)}</div><div className="n">{report.tripRevenue > 0 ? Math.round((report.margin / report.tripRevenue) * 100) + "%" : "—"}</div></div>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-head"><h2>Profit &amp; loss</h2></div>
            <div className="panel-body">
              <div className="d-kv"><span>Revenue</span><span>{m2(report.tripRevenue)}</span></div>

              <div style={{ marginTop: 13 }}>
                <div style={subheadStyle}>Trip expenses</div>
                {report.tripExpensesByCategory.length ? report.tripExpensesByCategory.map((c) => (
                  <div key={c.category}>
                    <div className="d-kv" style={{ paddingLeft: 14 }}>
                      <span>{lab(c.category)}</span><span>{m2(c.amountUsd)}</span>
                    </div>
                    {c.liters ? (
                      <div className="d-hint" style={{ paddingLeft: 14, marginTop: -2 }}>
                        {num(c.liters)} L · avg {m2(c.avgPricePerLiterUsd)}/L
                      </div>
                    ) : null}
                  </div>
                )) : <div className="d-hint" style={{ paddingLeft: 14 }}>None in this range.</div>}
                <div className="d-kv" style={{ paddingLeft: 14, borderTop: "1px solid var(--rule-soft)", marginTop: 4, paddingTop: 6, fontWeight: 600 }}>
                  <span>Total trip expenses</span><span>{m2(report.tripExpenses)}</span>
                </div>
              </div>

              <div style={{ marginTop: 13 }}>
                <div style={subheadStyle}>Standing expenses</div>
                {report.standingExpensesByCategory.length ? report.standingExpensesByCategory.map((c) => (
                  <div key={c.category} className="d-kv" style={{ paddingLeft: 14 }}>
                    <span>{lab(c.category)}</span><span>{m2(c.amountUsd)}</span>
                  </div>
                )) : <div className="d-hint" style={{ paddingLeft: 14 }}>None in this range.</div>}
                <div className="d-kv" style={{ paddingLeft: 14, borderTop: "1px solid var(--rule-soft)", marginTop: 4, paddingTop: 6, fontWeight: 600 }}>
                  <span>Total standing expenses</span><span>{m2(report.standingExpenses)}</span>
                </div>
              </div>

              <div
                className="d-kv"
                style={{
                  marginTop: 13,
                  paddingTop: 10,
                  borderTop: "2px solid var(--ink)",
                  fontWeight: 700,
                  fontSize: 14.5,
                }}
              >
                <span>Net profit / (loss)</span>
                <span style={{ color: report.margin >= 0 ? "var(--settled)" : "var(--alert)" }}>{pl(report.margin)}</span>
              </div>
            </div>
          </div>

          <BreakevenPanel breakeven={report.breakeven} />

          <div className="grid">
            {canEdit ? (
              <div className="panel">
                <div className="panel-head"><h2>Add a standing cost</h2></div>
                <AddTruckCostForm
                  truckId={report.truck.id}
                  curOpts={curOpts}
                  fx={data.fx}
                  onSaved={() => loadReport(report.truck.id)}
                />
              </div>
            ) : (
              <div className="panel">
                <div className="panel-head"><h2>Add a standing cost</h2></div>
                <div className="empty">You have read-only access to truck costs.</div>
              </div>
            )}

            <div className="panel">
              <div className="panel-head">
                <h2>{report.truck.fleet_no}</h2>
                <button className="act" onClick={() => setPrinting(true)}>Print / PDF</button>
              </div>
              <div className="tabs">
                <button className={tab === "trips" ? "on" : ""} onClick={() => setTab("trips")}>
                  Trips {report.trips.length ? <span className="c">({report.trips.length})</span> : null}
                </button>
                <button className={tab === "standing" ? "on" : ""} onClick={() => setTab("standing")}>
                  Standing costs {report.standingCosts.length ? <span className="c">({report.standingCosts.length})</span> : null}
                </button>
              </div>
              {tab === "trips" ? (
                <ul className="list">
                  {report.trips.length ? report.trips.map((t) => (
                    <li key={t.trip_id}>
                      <div>
                        <div className="r-no">{t.trip_no}</div>
                        <div className="r-mono">{t.actual_load_date || "—"}</div>
                      </div>
                      <div className="r-right">
                        <div className={"r-amt " + (t.margin_usd >= 0 ? "pos" : "neg")}>{m2(t.margin_usd)}</div>
                        <div className="r-min">rev {m0(t.revenue_usd)} · cost {m0(t.cost_usd)}</div>
                      </div>
                    </li>
                  )) : <li className="empty">No trips in this range.</li>}
                </ul>
              ) : (
                <ul className="list">
                  {report.standingCosts.length ? report.standingCosts.map((c) => (
                    <li key={c.id}>
                      <div>
                        <div className="r-no" style={{ color: "var(--stamp)" }}>{lab(c.category)}</div>
                        <div style={{ fontSize: 13, marginTop: 1 }}>{c.description || "—"}</div>
                        <div className="r-mono">{c.incurred_on}</div>
                      </div>
                      <div className="r-right">
                        <div className="r-amt">{m2(c.amount_usd)}</div>
                        <div className="r-min">{c.currency !== "USD" ? m2(c.amount, c.currency) : " "}</div>
                      </div>
                      {canEdit ? (
                        <button className="x" onClick={() => deleteTruckCost(c.id, () => loadReport(report.truck.id))}>✕</button>
                      ) : null}
                    </li>
                  )) : <li className="empty">No standing costs in this range.</li>}
                </ul>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="empty">Pick a truck to see its report.</div>
      )}

      {printing && report ? <ReportPrintSheet report={report} onDone={() => setPrinting(false)} /> : null}
    </>
  );
}

async function deleteTruckCost(id: string, onDone: () => void) {
  if (!confirm("Remove this cost entry?")) return;
  const res = await fetch(`/api/truck-costs/${id}`, { method: "DELETE" });
  if (res.ok) {
    toast.success("Cost entry removed");
    onDone();
  }
}

function AddTruckCostForm({
  truckId,
  curOpts,
  fx,
  onSaved,
}: {
  truckId: string;
  curOpts: string[];
  fx: BootstrapPayload["fx"];
  onSaved: () => void;
}) {
  const [category, setCategory] = useState(CATS[0]);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(curOpts[0] ?? "USD");
  const [incurredOn, setIncurredOn] = useState(today());
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const amtNum = parseFloat(amount);
  const fxRate = fx.find((r) => r.currency === currency);
  const rateToUsd = currency === "USD" ? 1 : fxRate?.rate_to_usd;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(amtNum) || amtNum <= 0) {
      return setError("Enter an amount greater than zero.");
    }
    if (rateToUsd === undefined) {
      return setError(`No exchange rate on file for ${currency}.`);
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/truck-costs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        truckId,
        category,
        amount: amtNum,
        currency,
        incurredOn,
        description: description.trim() || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError(body.error || res.statusText);
    }
    toast.success(`${m2(amtNum, currency)} logged`);
    setAmount("");
    setDescription("");
    onSaved();
  }

  return (
    <form className="panel-body" onSubmit={handleSubmit}>
      {error ? <div className="note bad">{error}</div> : null}
      <div className="field">
        <label htmlFor="tcCat">Category</label>
        <select id="tcCat" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATS.map((c) => <option key={c} value={c}>{lab(c).replace(/^./, (x) => x.toUpperCase())}</option>)}
        </select>
      </div>
      <div className="row3">
        <div className="field">
          <label htmlFor="tcAmt">Amount</label>
          <input id="tcAmt" type="number" step="0.01" min="0" placeholder="0.00" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="tcCur">Currency</label>
          <select id="tcCur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {curOpts.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tcDate">Date</label>
          <input id="tcDate" type="date" value={incurredOn} onChange={(e) => setIncurredOn(e.target.value)} />
        </div>
      </div>
      <div className={"stamp" + (Number.isFinite(amtNum) && amtNum > 0 ? " live" : "")}>
        <span className="native">{Number.isFinite(amtNum) && amtNum > 0 ? m2(amtNum, currency) : "—"}</span>
        <span className="arrow">→</span>
        <span className={"usd" + (Number.isFinite(amtNum) && amtNum > 0 ? "" : " idle")}>
          {Number.isFinite(amtNum) && amtNum > 0 && rateToUsd !== undefined ? m2(amtNum * rateToUsd) : "USD 0.00"}
        </span>
        <span className="rate">
          {currency === "USD"
            ? "Recorded directly in USD — no conversion needed."
            : fxRate
              ? <>Rate on file <b>1 {currency} = {Number(fxRate.rate_to_usd).toFixed(8)} USD</b> · dated {fxRate.effective_on}</>
              : `No rate on file for ${currency}.`}
        </span>
      </div>
      <div className="field">
        <label htmlFor="tcDesc">Description</label>
        <input id="tcDesc" type="text" placeholder="e.g. Annual comprehensive cover" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save cost"}</button>
    </form>
  );
}

function ReportPrintSheet({ report, onDone }: { report: TruckReport; onDone: () => void }) {
  useEffect(() => {
    const handler = () => onDone();
    window.addEventListener("afterprint", handler);
    return () => window.removeEventListener("afterprint", handler);
  }, [onDone]);

  return createPortal(
    <div id="sheet">
      <div className="ih">
        <div className="co">
          <h1>{COMPANY.name}</h1>
          <p>{COMPANY.reg}<br />{COMPANY.address}<br />{COMPANY.phone} · {COMPANY.email}</p>
        </div>
        <div className="im">
          <div className="big">Truck Report</div>
          {report.truck.fleet_no} · {report.truck.horse_reg}<br />
          {report.from || "start"} – {report.to || "present"}
        </div>
      </div>
      <table>
        <thead><tr><th>Trip</th><th>Loaded</th><th className="num">Revenue</th><th className="num">Cost</th><th className="num">Margin</th></tr></thead>
        <tbody>
          {report.trips.map((t) => (
            <tr key={t.trip_id}>
              <td>{t.trip_no}</td>
              <td>{t.actual_load_date || "—"}</td>
              <td className="num">{m2(t.revenue_usd)}</td>
              <td className="num">{m2(t.cost_usd)}</td>
              <td className="num">{m2(t.margin_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.standingCosts.length ? (
        <table style={{ marginTop: 18 }}>
          <thead><tr><th>Standing cost</th><th>Date</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {report.standingCosts.map((c) => (
              <tr key={c.id}>
                <td>{lab(c.category)}{c.description ? " — " + c.description : ""}</td>
                <td>{c.incurred_on}</td>
                <td className="num">{m2(c.amount_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <h4 style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".14em", textTransform: "uppercase", color: "#666", marginTop: 26 }}>
        Profit &amp; loss
      </h4>
      <table style={{ marginTop: 8 }}>
        <tbody>
          <tr><td>Revenue</td><td className="num">{m2(report.tripRevenue)}</td></tr>
          {report.tripExpensesByCategory.map((c) => (
            <tr key={"t-" + c.category}>
              <td>Trip: {lab(c.category)}{c.liters ? ` (${num(c.liters)} L · avg ${m2(c.avgPricePerLiterUsd)}/L)` : ""}</td>
              <td className="num">− {m2(c.amountUsd)}</td>
            </tr>
          ))}
          {report.standingExpensesByCategory.map((c) => (
            <tr key={"s-" + c.category}><td>Standing: {lab(c.category)}</td><td className="num">− {m2(c.amountUsd)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="totals">
        <div><span>Total expenses</span><span>− {m2(report.totalExpenses)}</span></div>
        <div className="due"><span>Net profit / (loss)</span><span>{pl(report.margin)}</span></div>
      </div>
      {report.breakeven.status !== "no_data" ? (
        <>
          <h4 style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".14em", textTransform: "uppercase", color: "#666", marginTop: 26 }}>
            Asset breakeven
          </h4>
          <table style={{ marginTop: 8 }}>
            <tbody>
              <tr><td>Total investment</td><td className="num">{m2(report.breakeven.investment)}</td></tr>
              <tr><td>Purchase date</td><td className="num">{report.breakeven.startDate}</td></tr>
              <tr>
                <td>Status</td>
                <td className="num">
                  {report.breakeven.status === "reached"
                    ? `Broke even ${monthLabel(report.breakeven.reachedOn)}`
                    : report.breakeven.status === "projected"
                      ? `Projected ${monthLabel(report.breakeven.projectedOn)}`
                      : "Not on track at current pace"}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
